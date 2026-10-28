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
    const previousRemote=ActiveMsgClient.listRemoteTasksForChar;
    (ActiveMsgClient as any).listRemoteTasksForChar=async()=>[];
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
      (ActiveMsgClient as any).listRemoteTasksForChar=previousRemote;
    }
  });
});

describe('AMSG2 cloud/local lost-ledger repair',()=>{
 it('adopts a real remote daily wake and never creates a duplicate when the local task save was lost',async()=>{
   const {ensureAutonomyWakes}=await import('./amsgAutonomyWake');
   const {ActiveMsgClient}=await import('./activeMsgClient');
   const prevConfig=ActiveMsgClient.getGlobalConfig;
   const prevSchedule=ActiveMsgClient.scheduleCharacterTask;
   const prevRemote=ActiveMsgClient.listRemoteTasksForChar;
   let created=0;let config:any={enabled:true,tasks:[]};
   const profile:any={...char,id:'repair-remote-wake',activeMsg2Config:config};
   (ActiveMsgClient as any).getGlobalConfig=async()=>({workerUrl:'https://example.com'});
   (ActiveMsgClient as any).scheduleCharacterTask=async(opts:any)=>{
     created++;return {uuid:'created:'+created,
       clientTaskId:'autowake:'+opts.task.autonomyWakeSlot+':created',
       firstSendAt:opts.task.firstSendTime};
   };
   (ActiveMsgClient as any).listRemoteTasksForChar=async()=>[
     {uuid:'orphan-cloud-1',clientTaskId:'autowake:day:orphan',
       messageType:'auto',recurrenceType:'daily',nextSendAt:new Date(Date.now()+86400000).toISOString(),status:'pending'},
   ];
   try{
     await ensureAutonomyWakes({
       char:profile,apiConfig:{} as any,userProfile:{} as any,groups:[],realtimeConfig:{} as any,
       onSave:update=>{config=update(config);profile.activeMsg2Config=config;},
     });
     expect(config.tasks.some((t:any)=>t.taskUuid==='orphan-cloud-1')).toBe(true);
     expect(config.tasks.filter((t:any)=>t.clientTaskId.startsWith('autowake:day:'))).toHaveLength(1);
     expect(created).toBeLessThanOrEqual(1);
   }finally{
     (ActiveMsgClient as any).getGlobalConfig=prevConfig;
     (ActiveMsgClient as any).scheduleCharacterTask=prevSchedule;
     (ActiveMsgClient as any).listRemoteTasksForChar=prevRemote;
   }
 });
 it('refuses to create a second task if Worker cannot return safe remote identity fields',async()=>{
   const {ensureAutonomyWakes}=await import('./amsgAutonomyWake');
   const {ActiveMsgClient}=await import('./activeMsgClient');
   const oldGlobal=ActiveMsgClient.getGlobalConfig,oldRemote=ActiveMsgClient.listRemoteTasksForChar;
   const oldSchedule=ActiveMsgClient.scheduleCharacterTask;
   const profile:any={...char,id:'repair-unsafe-worker',activeMsg2Config:{enabled:true,tasks:[]}};
   let created=0;
   (ActiveMsgClient as any).getGlobalConfig=async()=>({workerUrl:'https://example.com'});
   (ActiveMsgClient as any).listRemoteTasksForChar=async()=>[{
     uuid:'old',clientTaskId:'autowake:day:orphan',status:'pending',
   }];
   (ActiveMsgClient as any).scheduleCharacterTask=async()=>{created++;throw Error('should not be called')};
   try{
     await ensureAutonomyWakes({char:profile,apiConfig:{} as any,userProfile:{} as any,groups:[],
       realtimeConfig:{} as any,onSave:update=>{
         profile.activeMsg2Config=update(profile.activeMsg2Config);
       }});
     expect(created).toBe(0);
     expect(profile.activeMsg2Config.lastError).toMatch(/对账字段/);
   }finally{
     (ActiveMsgClient as any).getGlobalConfig=oldGlobal;
     (ActiveMsgClient as any).scheduleCharacterTask=oldSchedule;
     (ActiveMsgClient as any).listRemoteTasksForChar=oldRemote;
   }
 });
});
