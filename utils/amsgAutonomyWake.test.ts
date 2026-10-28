import {describe,it,expect} from 'vitest';
import {isAutonomyWakeTask,planAutonomyWakes} from './amsgAutonomyWake';
const char={id:'mary',customTimezoneEnabled:true,customTimezone:'Asia/Shanghai'};
const now=Date.parse('2026-10-29T01:00:00Z');
describe('AMSG2 automatic, durable contact opportunities',()=>{
 it('opening an enabled chat plans two daily cloud opportunities even without user tasks or schedules',()=>{
   const a=planAutonomyWakes(char,null,now);
   expect(a.map(x=>x.slot)).toEqual(['day','evening']);
   expect(a.every(x=>Date.parse(x.firstSendTime)>now+12*60000)).toBe(true);
   expect(planAutonomyWakes(char,null,now)).toEqual(a);
 });
 it('life schedule excludes a working afternoon and picks the evening free window',()=>{
   const a=planAutonomyWakes(char,[
      {startTime:'00:00',activity:'睡觉'},
      {startTime:'09:00',activity:'上班'},
      {startTime:'18:00',activity:'散步'},
      {startTime:'22:00',activity:'睡觉'},
   ],now);
   expect(a.map(x=>x.slot)).toEqual(['evening']);
 });
 it('a full busy schedule still retains one restrained APK-style fallback opportunity',()=>{
   const found=planAutonomyWakes(char,[{startTime:'00:00',activity:'睡觉'},{startTime:'08:00',activity:'工作'}],now);
   expect(found.map(x=>x.slot)).toEqual(['evening']);
 });
 it('auto wakes are separate from user-created reminders',()=>{
   expect(isAutonomyWakeTask({clientTaskId:'autowake:day:some-uuid'})).toBe(true);
   expect(isAutonomyWakeTask({clientTaskId:'some-uuid'})).toBe(false);
 });
});

describe('cloud wake bootstrap, not an inert switch',()=>{
  it('registers real daily tasks on an already enabled character without manual task creation; does not recreate them on the next visit',async()=>{
    const {ensureAutonomyWakes}=await import('./amsgAutonomyWake');
    const {ActiveMsgClient}=await import('./activeMsgClient');
    const {getDailyScheduleForChar}=await import('./dailySchedule');
    // Integration uses the actual ActiveMsgClient contract; the transport is
    // mocked so no credential or Cloudflare account is touched in tests.
    const previousGlobal=ActiveMsgClient.getGlobalConfig;
    const previousSchedule=ActiveMsgClient.scheduleCharacterTask;
    let count=0, saved:any={enabled:true,tasks:[]};
    (ActiveMsgClient as any).getGlobalConfig=async()=>({workerUrl:'https://example.com'});
    (ActiveMsgClient as any).scheduleCharacterTask=async(params:any)=>({
      uuid:'wake-task-'+(++count),clientTaskId:'autowake:'+params.task.autonomyWakeSlot+':'+count,
      firstSendAt:params.task.firstSendTime,
    });
    try{
      const charProfile:any={...char,id:'auto-bootstrap-integration',activeMsg2Config:saved};
      const options:any={
        char:charProfile,apiConfig:{},userProfile:{},groups:[],realtimeConfig:{},
        onSave:(updater:any)=>{saved=updater(saved);charProfile.activeMsg2Config=saved;},
      };
      await ensureAutonomyWakes(options);
      expect(count).toBe(2);
      expect(saved.tasks).toHaveLength(2);
      expect(saved.tasks.every((t:any)=>t.recurrenceType==='daily')).toBe(true);
      await ensureAutonomyWakes(options);
      expect(count).toBe(2);
      charProfile.activeMsg2Config={enabled:false,tasks:[]};
      await ensureAutonomyWakes(options);
      expect(count).toBe(2);
    }finally{
      (ActiveMsgClient as any).getGlobalConfig=previousGlobal;
      (ActiveMsgClient as any).scheduleCharacterTask=previousSchedule;
    }
  });
});
