/** Autonomous contact bootstrap for AMSG2. Existing cloud scheduler does
 * all real delivery: no front-end timer, parallel engine, or extra API call
 * at idle. Inspired by Marshmallow's schedule opportunities + fallback.
 */
import type {ActiveMsg2CharacterConfig,ActiveMsg2TaskRecord,APIConfig,CharacterProfile,GroupProfile,RealtimeConfig,ScheduleSlot,UserProfile} from '../types';
import {ActiveMsgClient} from './activeMsgClient';
import {getDailyScheduleForChar} from './dailySchedule';
import {isPendingTask,reconcileTasksWithRemote} from './amsg2Tasks';
import {resolveAmsgLimits} from './amsgLimits';
import {classifyLifeActivity} from './sullyLifeClock';
import {getScheduleDateKey,getScheduleWallClock,parseScheduleStartMinutes} from './scheduleTime';
import {withAutonomyWakeLock} from './amsgAutonomyLock';
import {autonomyWakeUuid} from './amsgAutonomyIdentity';
import {resolveCharTimeZone,wallClockToTimestamp} from './timezone';
import {isScheduleFeatureOn} from './scheduleFeature';

export const AMSG_AUTONOMY_SCHEDULE_EVENT='amsg2-schedule-saved';
export const isAutonomyWakeTask=(task:Pick<ActiveMsg2TaskRecord,'clientTaskId'>)=>
  typeof task.clientTaskId==='string'&&task.clientTaskId.startsWith('autowake:');
type Slot='day'|'evening';
export type WakeSlot={slot:Slot;firstSendTime:string};

/** At most two separated daily opportunities; life schedule can eliminate
 * busy/sleep windows. Missing schedules never disable the fallback. */
export function planAutonomyWakes(
  char:Pick<CharacterProfile,'id'|'customTimezoneEnabled'|'customTimezone'>,
  schedule:readonly Pick<ScheduleSlot,'startTime'|'activity'>[]|null,now=Date.now(),
):WakeSlot[]{
  const zone=resolveCharTimeZone(char);
  const source=(schedule||[]).map(s=>{
    const at=parseScheduleStartMinutes(s.startTime);
    return at===null?null:{at,kind:classifyLifeActivity(s.activity)};
  }).filter((v):v is {at:number;kind:'busy'|'sleep'|'free'}=>v!==null)
    .sort((a,b)=>a.at-b.at);
  let hash=2166136261;
  for(let i=0;i<char.id.length;i++)hash=Math.imul(hash^char.id.charCodeAt(i),16777619)>>>0;
  const windows:[Slot,number,number][]=[['day',10*60+45,14*60+30],['evening',18*60,21*60+45]];
  // Advance using the CHARACTER'S calendar, not fixed UTC milliseconds.
  // On spring DST change, 23:30 + 24 real hours can skip tomorrow entirely.
  const firstDay=getScheduleDateKey(char,new Date(now));
  const localCalendarDay=new Date(firstDay+'T12:00:00Z');
  const dayKeyAtOffset=(offset:number)=>{
    const date=new Date(localCalendarDay);
    date.setUTCDate(date.getUTCDate()+offset);
    return date.toISOString().slice(0,10);
  };
  const selected=windows.flatMap(([slot,begin,end],i)=>{
    const preferred=begin+15+((hash>>>i*7)%(end-begin-30));
    const isFree=(minute:number)=>{
      const active=[...source].reverse().find(s=>s.at<=minute);
      return active?.kind==='free';
    };
    let minute=preferred;
    if(source.length&&!isFree(minute)){
      const possible=Array.from({length:Math.floor((end-begin)/15)},(_,j)=>begin+15*j)
        .filter(m=>isFree(m));
      if(!possible.length)return [];
      minute=possible.reduce((a,b)=>Math.abs(a-preferred)<Math.abs(b-preferred)?a:b);
    }
    const clock=`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}:00`;
    for(let d=0;d<3;d++){
      const day=dayKeyAtOffset(d);
      const ts=wallClockToTimestamp(day+' '+clock,zone);
      if(Number.isFinite(ts)&&ts>now+12*60000)return [{slot,firstSendTime:new Date(ts).toISOString()}];
    }
    return [];
  });
  // APK's ordinary-contact fallback matters: even when a daily-life plan
  // offers no usable window, the enabled feature must not go permanently
  // silent. Keep just ONE evening opportunity rather than ignoring the
  // busy/sleep schedule with two automatic checks.
  return selected.length ? selected
    : source.length ? planAutonomyWakes(char,null,now).filter(x=>x.slot==='evening')
    : selected;
}

type Args={char:CharacterProfile;apiConfig:APIConfig;userProfile:UserProfile;
  groups:GroupProfile[];realtimeConfig:RealtimeConfig;
  onSave:(updater:(prev:ActiveMsg2CharacterConfig|undefined)=>ActiveMsg2CharacterConfig)=>void;
  /** Test-only data injection; production reads the existing daily schedule DB. */
  readSchedule?:()=>Promise<{slots:readonly Pick<ScheduleSlot,'startTime'|'activity'>[]}|null>;
  /** Live enabled state; prevents stale async cloud writes after turning 2.0 off. */
  isEnabledNow?:()=>boolean;
};
const inFlight=new Set<string>();
const recentFailure=new Map<string,number>();
/** Works for characters enabled days ago: called when their chat opens.
 * Backend tasks are daily recurring, not consumed one-shot alarms. */
export async function ensureAutonomyWakes(args:Args):Promise<void>{
  return void await withAutonomyWakeLock(args.char?.id||'',()=>ensureAutonomyWakesUnlocked(args));
}
async function ensureAutonomyWakesUnlocked(args:Args):Promise<void>{
  const {char}=args;
  if(!char?.id||char.activeMsg2Config?.enabled!==true||inFlight.has(char.id))return;
  if(Date.now()-(recentFailure.get(char.id)??0)<60000)return;
  const active=(char.activeMsg2Config.tasks||[]).filter(t=>isPendingTask(t,Date.now()));
  // A saved recurring task can silently fail or disappear in the cloud.
  // Never trust "two local rows" as proof that automation is healthy.
  inFlight.add(char.id);
  try{
    const g=await ActiveMsgClient.getGlobalConfig();
    if(!g.workerUrl?.trim())throw new Error('未配置主动消息 2.0 的云端 Worker');
    // Older Workers accept task creation but don't understand the current
    // autonomous gating and cloud life context. Do NOT create a paid daily
    // task that will silently behave like the old alarm-only version.
    const version=await ActiveMsgClient.probeWorkerVersion({timeoutMs:8000});
    if(version.state!=='current'){
      throw new Error(version.state==='outdated'
        ? `云端 Worker 还是旧版（${version.deployed||'未知'}），当前网页需要 ${version.expected}；先部署同一分支的 Worker 包`
        : '暂时无法确认云端 Worker 版本，已暂停创建新的后台自主任务以防重复或错误收费');
    }
    // The browser can disappear AFTER cloud schedule success but BEFORE local
    // persist. Never make another daily task based on an empty local list:
    // adopt any cloud-owned autowakes first. This also handles app restarts.
    const remote=await ActiveMsgClient.listRemoteTasksForChar(char.id).catch(error=>{
      // Network offline while two local recurring wakes already exist does
      // not prove the cloud jobs died. Leave healthy-looking local identity
      // intact rather than falsely labelling the switch broken.
      if(active.filter(isAutonomyWakeTask).length>=2){
        console.warn('[amsg2] 云端暂不可对账，保留已登记的每日联系任务',error);
        return null;
      }
      throw error;
    });
    if(remote===null)return;
    const cloudWakes=remote.filter(t=>
      t.clientTaskId?.startsWith('autowake:')
      && t.status!=='failed' && t.status!=='cancelled' && t.status!=='completed'
    );
    // A terminally failed worker task is a configuration/runtime error,
    // not another empty slot to blindly fill and charge the user's API again.
    const failed=remote.filter(t=>t.clientTaskId?.startsWith('autowake:')&&t.status==='failed');
    if(failed.length){
      throw new Error('云端自主联系任务已失败，请查看任务列表中的最后错误；不重复建立可能继续失败的任务');
    }
    if(cloudWakes.some(t=>!t.nextSendAt||!t.recurrenceType||!t.messageType)){
      throw new Error('云端已有自主联系任务，但当前 Worker 缺少对账字段；为避免重复发消息，暂不创建第二份');
    }
    // Recently created rows get a short grace period for remote projection
    // latency. An OLD local-only row must never silently block restoration.
    const known=new Set(cloudWakes.map(t=>t.uuid));
    const staleIds=new Set(active.filter(t=>isAutonomyWakeTask(t)
      && !known.has(t.taskUuid)
      && (!Number.isFinite(t.createdAt)||Date.now()-t.createdAt>5*60_000)).map(t=>t.taskUuid));
    const healthy=active.filter(t=>!staleIds.has(t.taskUuid));
    const tasks=reconcileTasksWithRemote(healthy,cloudWakes);
    const restored=tasks.filter(t=>isAutonomyWakeTask(t)
      && !healthy.some(existing=>existing.taskUuid===t.taskUuid));
    if(restored.length||staleIds.size){
      args.onSave(prev=>prev?.enabled===false?prev:{
        ...(prev||{enabled:true}),
        tasks:[
          ...(prev?.tasks||[]).filter(t=>!staleIds.has(t.taskUuid)),
          ...restored.filter(t=>!(prev?.tasks||[]).some(existing=>existing.taskUuid===t.taskUuid)),
        ],
        lastSyncedAt:Date.now(),
      });
    }
    // The schedule's own switch is separate from AMSG2. Turning the
    // timetable off must immediately stop treating old saved slots as busy
    // or free facts when planning cloud contact opportunities.
    const schedule=isScheduleFeatureOn(char)
      ? await (args.readSchedule?args.readSchedule():getDailyScheduleForChar(char)).catch(()=>null)
      : null;
    const targets=planAutonomyWakes(char,schedule?.slots||null);
    // Only an actual daily schedule change may reschedule an existing wake.
    // Never rewrite a user's manual reminder or retime a cloud job because
    // the phone temporarily cannot read its offline schedule database.
    if(schedule?.slots?.length){
      const wanted=new Map(targets.map(t=>[t.slot,t]));
      const current=tasks.filter(isAutonomyWakeTask);
      const minutes=(iso:string)=>{
        const when=new Date(iso);
        if(!Number.isFinite(when.getTime()))return null;
        const wall=getScheduleWallClock(char,when);
        return wall.getHours()*60+wall.getMinutes();
      };
      // If a previous replace succeeded but cancelling the old cloud job
      // failed, do not perform further moves on either duplicate. The user
      // must reconcile that abnormal remote state first.
      const counts=new Map<string,number>();
      for(const t of current){
        const key=t.clientTaskId.split(':')[1];
        counts.set(key,(counts.get(key)||0)+1);
      }
      if([...counts.values()].some(n=>n>1)){
        throw new Error('同一时段有重复云端自主任务，已停止自动改期，需先清理重复任务');
      }
      for(const old of current){
        if(args.isEnabledNow?.()===false)return;
        const slot=old.clientTaskId.split(':')[1] as 'day'|'evening';
        const desired=wanted.get(slot);
        if(!desired){
          // This part of the day is now occupied. Remove the autonomous
          // *opportunity* only; leave the other channels and manual tasks.
          await ActiveMsgClient.cancelTask(old.taskUuid);
          const index=tasks.findIndex(t=>t.taskUuid===old.taskUuid);
          if(index>=0)tasks.splice(index,1);
          args.onSave(prev=>prev?.enabled===false?prev:{
            ...(prev||{enabled:true}),tasks:(prev?.tasks||[]).filter(t=>t.taskUuid!==old.taskUuid),
          });
          continue;
        }
        const oldMinute=minutes(old.nextSendAt||old.firstSendTime);
        const newMinute=minutes(desired.firstSendTime);
        if(oldMinute===null||newMinute===null)continue;
        const stableId=autonomyWakeUuid(g.userId,char.id,slot);
        const moveNeeded=Math.abs(oldMinute-newMinute)>=30;
        // Migrate legacy random UUIDs even when the clock is unchanged:
        // otherwise existing users would never gain D1-atomic protection.
        if(!moveNeeded&&old.taskUuid===stableId)continue;
        // Already using D1-unique identity: change the server's next_send_at
        // instead of creating a second task. Upstream rejects updates while
        // a fire lease is active, leaving the old time intact for retry.
        if(old.taskUuid===stableId){
          const updated=await ActiveMsgClient.updatePendingTasksRemote(
            [old.taskUuid],{nextSendAt:desired.firstSendTime});
          if(updated.failed.length||updated.updated!==1)
            throw new Error('云端任务正在投递或改期失败，保留原时段稍后重试');
          const refreshed={...old,firstSendTime:desired.firstSendTime,
            nextSendAt:desired.firstSendTime};
          const pos=tasks.findIndex(t=>t.taskUuid===old.taskUuid);
          if(pos>=0)tasks.splice(pos,1,refreshed);
          args.onSave(prev=>prev?.enabled===false?prev:{
            ...(prev||{enabled:true}),
            tasks:(prev?.tasks||[]).map(t=>t.taskUuid===old.taskUuid?refreshed:t),
            lastSyncedAt:Date.now(),
          });
          wanted.delete(slot);
          continue;
        }
        // Old autowakes used a random UUID. Migrate one time using upstream
        // atomic supersede, so no two billable recurring rows coexist.
        const result=await ActiveMsgClient.scheduleCharacterTask({
          char,config:{...char.activeMsg2Config,tasks},
          task:{mode:'auto',firstSendTime:moveNeeded
            ? desired.firstSendTime : (old.nextSendAt||old.firstSendTime),
            recurrenceType:'daily',expirePolicy:'expire',autonomyWakeSlot:slot},
          replaceTaskUuid:old.taskUuid,apiConfig:args.apiConfig,
          userProfile:args.userProfile,groups:args.groups,realtimeConfig:args.realtimeConfig,
        });
        if(args.isEnabledNow?.()===false){
          await ActiveMsgClient.cancelTask(result.uuid);
          return;
        }
        const replacement:ActiveMsg2TaskRecord={
          ...old,taskUuid:result.uuid,clientTaskId:result.clientTaskId,
          firstSendTime:result.firstSendAt,nextSendAt:result.firstSendAt,
          createdAt:Date.now(),
        };
        if(result.replacedCancelFailed){
          // New and old remote jobs may both exist. Keep both ids visible
          // and do not silently create another replacement on next refresh.
          tasks.push(replacement);
          args.onSave(prev=>prev?.enabled===false?prev:{
            ...(prev||{enabled:true}),
            tasks:[...(prev?.tasks||[]),replacement],
            lastError:'自主联系改期后旧任务取消失败：请先检查并清理云端重复任务',
          });
          throw new Error('改期后旧任务取消失败；为防止重复发消息，已停止后续修改');
        }
        const at=tasks.findIndex(t=>t.taskUuid===old.taskUuid);
        if(at>=0)tasks.splice(at,1,replacement);
        args.onSave(prev=>prev?.enabled===false?prev:{
          ...(prev||{enabled:true}),
          tasks:[...(prev?.tasks||[]).filter(t=>t.taskUuid!==old.taskUuid),replacement],
          lastSyncedAt:Date.now(),
        });
        wanted.delete(slot);
      }
    }
    const existing=new Set(tasks.filter(isAutonomyWakeTask).map(t=>t.clientTaskId.split(':')[1]));
    for(const target of targets){
      if(args.isEnabledNow?.()===false)return;
      if(existing.has(target.slot)||tasks.length>=resolveAmsgLimits(char.activeMsg2Config).maxActiveTasks)continue;
      const result=await ActiveMsgClient.scheduleCharacterTask({
        char,config:{...char.activeMsg2Config,tasks},task:{
          mode:'auto',firstSendTime:target.firstSendTime,recurrenceType:'daily',
          expirePolicy:'expire',autonomyWakeSlot:target.slot,
        },apiConfig:args.apiConfig,userProfile:args.userProfile,
        groups:args.groups,realtimeConfig:args.realtimeConfig,
      });
      if(args.isEnabledNow?.()===false){
        // User disabled background autonomy while scheduling was in flight.
        // Roll back this newly-created cloud task instead of leaving a
        // billable orphan which the disabled UI will never show.
        await ActiveMsgClient.cancelTask(result.uuid);
        return;
      }
      const record:ActiveMsg2TaskRecord={
        taskUuid:result.uuid,clientTaskId:result.clientTaskId,mode:'auto',
        firstSendTime:result.firstSendAt,recurrenceType:'daily',expirePolicy:'expire',
        source:'user',status:'scheduled',createdAt:Date.now(),
      };
      tasks.push(record);existing.add(target.slot);
      args.onSave(prev=>prev?.enabled===false?prev:{
        ...(prev||{enabled:true}),tasks:[
          ...(prev?.tasks||[]).filter(t=>t.taskUuid!==record.taskUuid),record,
        ],lastSyncedAt:Date.now(),
        lastError:prev?.lastError?.startsWith('自主联系建立失败')?undefined:prev?.lastError,
      });
    }
    recentFailure.delete(char.id);
    // A prior transient cloud error is no longer current once at least one
    // durable wake is confirmed. Don't leave a scary stale failure beside
    // an actually healthy recurring schedule.
    if(tasks.some(isAutonomyWakeTask)&&char.activeMsg2Config?.lastError?.startsWith('自主联系建立失败')){
      args.onSave(prev=>prev?.enabled===false?prev:{
        ...(prev||{enabled:true}),lastError:undefined,
      });
    }
  }catch(e){
    recentFailure.set(char.id,Date.now());
    // A failed background schedule must not look like a successful
    // "enabled" contact loop. Persist a visible reason without credentials.
    const detail=e instanceof Error?e.message.slice(0,160):'未知原因';
    args.onSave(prev=>({
      ...(prev||{enabled:true}),lastError:'自主联系建立失败：'+detail,
    }));
    console.warn('[amsg2] 自主联系机会建立失败，下次进入聊天自动重试',e);
  }finally{inFlight.delete(char.id)}
}
