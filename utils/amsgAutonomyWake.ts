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
import {getScheduleDateKey} from './scheduleTime';
import {resolveCharTimeZone,wallClockToTimestamp} from './timezone';

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
    const m=/^(\d{1,2}):(\d{2})$/.exec(s.startTime);
    if(!m||Number(m[1])>23||Number(m[2])>59)return null;
    return {at:Number(m[1])*60+Number(m[2]),kind:classifyLifeActivity(s.activity)};
  }).filter((v):v is {at:number;kind:'busy'|'sleep'|'free'}=>v!==null)
    .sort((a,b)=>a.at-b.at);
  let hash=2166136261;
  for(let i=0;i<char.id.length;i++)hash=Math.imul(hash^char.id.charCodeAt(i),16777619)>>>0;
  const windows:[Slot,number,number][]=[['day',10*60+45,14*60+30],['evening',18*60,21*60+45]];
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
      const day=getScheduleDateKey(char,new Date(now+d*86400000));
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
  onSave:(updater:(prev:ActiveMsg2CharacterConfig|undefined)=>ActiveMsg2CharacterConfig)=>void};
const inFlight=new Set<string>();
const recentFailure=new Map<string,number>();
/** Works for characters enabled days ago: called when their chat opens.
 * Backend tasks are daily recurring, not consumed one-shot alarms. */
export async function ensureAutonomyWakes(args:Args):Promise<void>{
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
    const schedule=await getDailyScheduleForChar(char).catch(()=>null);
    const targets=planAutonomyWakes(char,schedule?.slots||null);
    const existing=new Set(tasks.filter(isAutonomyWakeTask).map(t=>t.clientTaskId.split(':')[1]));
    for(const target of targets){
      if(existing.has(target.slot)||tasks.length>=resolveAmsgLimits(char.activeMsg2Config).maxActiveTasks)continue;
      const result=await ActiveMsgClient.scheduleCharacterTask({
        char,config:{...char.activeMsg2Config,tasks},task:{
          mode:'auto',firstSendTime:target.firstSendTime,recurrenceType:'daily',
          expirePolicy:'expire',autonomyWakeSlot:target.slot,
        },apiConfig:args.apiConfig,userProfile:args.userProfile,
        groups:args.groups,realtimeConfig:args.realtimeConfig,
      });
      const record:ActiveMsg2TaskRecord={
        taskUuid:result.uuid,clientTaskId:result.clientTaskId,mode:'auto',
        firstSendTime:result.firstSendAt,recurrenceType:'daily',expirePolicy:'expire',
        source:'user',status:'scheduled',createdAt:Date.now(),
      };
      tasks.push(record);existing.add(target.slot);
      args.onSave(prev=>({
        ...(prev||{enabled:true}),tasks:[
          ...(prev?.tasks||[]).filter(t=>t.taskUuid!==record.taskUuid),record,
        ],lastSyncedAt:Date.now(),
        lastError:prev?.lastError?.startsWith('自主联系建立失败')?undefined:prev?.lastError,
      }));
    }
    recentFailure.delete(char.id);
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
