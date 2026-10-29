import {describe,it,expect,beforeEach,afterEach,vi} from 'vitest';
beforeEach(async()=>{
  const {ActiveMsgClient}=await import('./activeMsgClient');
  vi.spyOn(ActiveMsgClient,'probeWorkerVersion').mockResolvedValue({
    state:'current',deployed:'test',expected:'test',autoUpdate:null,
  });
});
afterEach(()=>vi.restoreAllMocks());
import {isAutonomyWakeTask,planAutonomyWakes} from './amsgAutonomyWake';
import {getScheduleDateKey} from './scheduleTime';
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
 it('does not skip tomorrow after a spring DST jump in the role timezone',()=>{
   const ny={id:'dst-spring',customTimezoneEnabled:true,customTimezone:'America/New_York'};
   // March 7 23:30 EST; adding 24 UTC hours jumps to March 9 00:30 EDT.
   const now=Date.parse('2026-03-08T04:30:00Z');
   const plans=planAutonomyWakes(ny,null,now);
   expect(plans.map(x=>x.slot)).toEqual(['day','evening']);
   expect(plans.map(x=>getScheduleDateKey(ny,new Date(x.firstSendTime))))
     .toEqual(['2026-03-08','2026-03-08']);
   expect(plans.every(x=>Date.parse(x.firstSendTime)>now)).toBe(true);
 });
 it('chooses the correct date after autumn DST rollback',()=>{
   const ny={id:'dst-fall',customTimezoneEnabled:true,customTimezone:'America/New_York'};
   // October 31 23:45 EDT, next calendar day is the 25-hour Nov 1.
   const now=Date.parse('2026-11-01T03:45:00Z');
   const plans=planAutonomyWakes(ny,null,now);
   expect(plans.map(x=>getScheduleDateKey(ny,new Date(x.firstSendTime))))
     .toEqual(['2026-11-01','2026-11-01']);
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

describe('AMSG2 recurring cloud task health: local switch cannot mask a dead Worker row',()=>{
 it('replaces an old local daily wake whose cloud row has disappeared, without preserving a phantom slot',async()=>{
   const {ensureAutonomyWakes}=await import('./amsgAutonomyWake');
   const {ActiveMsgClient}=await import('./activeMsgClient');
   const oldGlobal=ActiveMsgClient.getGlobalConfig,oldRemote=ActiveMsgClient.listRemoteTasksForChar;
   const oldSchedule=ActiveMsgClient.scheduleCharacterTask;
   let created=0;
   let cfg:any={enabled:true,tasks:[
     {taskUuid:'ghost-day',clientTaskId:'autowake:day:ghost',mode:'auto',
       firstSendTime:new Date(Date.now()-86400000).toISOString(),
       recurrenceType:'daily',expirePolicy:'expire',source:'user',status:'scheduled',
       createdAt:Date.now()-2*86400000},
     {taskUuid:'ghost-evening',clientTaskId:'autowake:evening:ghost',mode:'auto',
       firstSendTime:new Date(Date.now()-86400000).toISOString(),
       recurrenceType:'daily',expirePolicy:'expire',source:'user',status:'scheduled',
       createdAt:Date.now()-2*86400000},
   ]};
   const charProfile:any={...char,id:'ghost-health',activeMsg2Config:cfg};
   (ActiveMsgClient as any).getGlobalConfig=async()=>({workerUrl:'https://example.com'});
   (ActiveMsgClient as any).listRemoteTasksForChar=async()=>[];
   (ActiveMsgClient as any).scheduleCharacterTask=async(arg:any)=>({
      uuid:'fresh-'+(++created),clientTaskId:'autowake:'+arg.task.autonomyWakeSlot+':fresh',
      firstSendAt:arg.task.firstSendTime,
   });
   try{
     await ensureAutonomyWakes({char:charProfile,apiConfig:{} as any,userProfile:{} as any,
       groups:[],realtimeConfig:{} as any,onSave:update=>{
         cfg=update(cfg);charProfile.activeMsg2Config=cfg;
       }});
     expect(created).toBe(2);
     expect(cfg.tasks.map((x:any)=>x.taskUuid)).toEqual(['fresh-1','fresh-2']);
   }finally{
     (ActiveMsgClient as any).getGlobalConfig=oldGlobal;
     (ActiveMsgClient as any).listRemoteTasksForChar=oldRemote;
     (ActiveMsgClient as any).scheduleCharacterTask=oldSchedule;
   }
 });
 it('reports a failed cloud recurrence instead of repeatedly creating replacement jobs',async()=>{
   const {ensureAutonomyWakes}=await import('./amsgAutonomyWake');
   const {ActiveMsgClient}=await import('./activeMsgClient');
   const oldGlobal=ActiveMsgClient.getGlobalConfig,oldRemote=ActiveMsgClient.listRemoteTasksForChar;
   const oldSchedule=ActiveMsgClient.scheduleCharacterTask;
   let created=0;
   let config:any={enabled:true,tasks:[]};
   const charProfile:any={...char,id:'terminal-failure',activeMsg2Config:config};
   (ActiveMsgClient as any).getGlobalConfig=async()=>({workerUrl:'https://example.com'});
   (ActiveMsgClient as any).listRemoteTasksForChar=async()=>[{
       uuid:'failed-1',clientTaskId:'autowake:day:dead',status:'failed',
   }];
   (ActiveMsgClient as any).scheduleCharacterTask=async()=>{created++;throw Error('unexpected schedule')};
   try{
     await ensureAutonomyWakes({char:charProfile,apiConfig:{} as any,userProfile:{} as any,
       groups:[],realtimeConfig:{} as any,onSave:update=>{config=update(config);charProfile.activeMsg2Config=config;}});
     expect(created).toBe(0);
     expect(config.lastError).toMatch(/任务已失败/);
   }finally{
     (ActiveMsgClient as any).getGlobalConfig=oldGlobal;
     (ActiveMsgClient as any).listRemoteTasksForChar=oldRemote;
     (ActiveMsgClient as any).scheduleCharacterTask=oldSchedule;
   }
 });
});
describe('AMSG2 P1 daily schedule drift, without touching manual reminders',()=>{
 it('retimes an existing evening cloud opportunity after a confirmed new daily schedule',async()=>{
   const {ensureAutonomyWakes,planAutonomyWakes}=await import('./amsgAutonomyWake');
   const {ActiveMsgClient}=await import('./activeMsgClient');
   const oldGlobal=ActiveMsgClient.getGlobalConfig,oldRemote=ActiveMsgClient.listRemoteTasksForChar;
   const oldSchedule=ActiveMsgClient.scheduleCharacterTask,oldCancel=ActiveMsgClient.cancelTask;
   const role:any={...char,id:'schedule-drift',scheduleFeatureEnabled:true,activeMsg2Config:{enabled:true,tasks:[]}};
   const plan=planAutonomyWakes(role,[
     {startTime:'00:00',activity:'睡觉'},
     {startTime:'09:00',activity:'工作'},
     {startTime:'18:00',activity:'散步'},
     {startTime:'22:00',activity:'睡觉'},
   ]);
   const desired=plan.find(x=>x.slot==='evening');
   expect(desired).toBeDefined();
   // The old daily wake fired at 10:30 local, now within today's working time.
   const at=new Date(desired!.firstSendTime);
   const oldIso=new Date(at.getTime()-(9*60+30)*60000).toISOString();
   const previous:any={taskUuid:'old-evening',clientTaskId:'autowake:evening:old',
     mode:'auto',firstSendTime:oldIso,nextSendAt:oldIso,
     recurrenceType:'daily',expirePolicy:'expire',source:'user',
     status:'scheduled',createdAt:Date.now()-86400000};
   let state:any={enabled:true,tasks:[previous]},calls=0,removed:string[]=[];
   role.activeMsg2Config=state;
   (ActiveMsgClient as any).getGlobalConfig=async()=>({workerUrl:'https://example.com',userId:'test-user'});
   (ActiveMsgClient as any).listRemoteTasksForChar=async()=>[{
     uuid:previous.taskUuid,clientTaskId:previous.clientTaskId,
     nextSendAt:oldIso,recurrenceType:'daily',messageType:'auto',status:'pending',
   }];
   (ActiveMsgClient as any).scheduleCharacterTask=async(p:any)=>{
     calls++;expect(p.replaceTaskUuid).toBe('old-evening');
     expect(p.task.autonomyWakeSlot).toBe('evening');
     return {uuid:'new-evening',clientTaskId:'autowake:evening:new',
       firstSendAt:p.task.firstSendTime,replacedCancelFailed:false};
   };
   (ActiveMsgClient as any).cancelTask=async(uuid:string)=>{removed.push(uuid);return{uuid,alreadyGone:false}};
   try{
     await ensureAutonomyWakes({char:role,apiConfig:{} as any,userProfile:{} as any,groups:[],
       realtimeConfig:{} as any,
       readSchedule:async()=>({slots:[
         {startTime:'00:00',activity:'睡觉'},
         {startTime:'09:00',activity:'工作'},
         {startTime:'18:00',activity:'散步'},
         {startTime:'22:00',activity:'睡觉'},
       ]}),
       onSave:fn=>{state=fn(state);role.activeMsg2Config=state;},
     });
     expect(calls).toBe(1);
     expect(state.tasks.map((t:any)=>t.taskUuid)).toEqual(['new-evening']);
     expect(removed).toEqual([]);
   }finally{
     (ActiveMsgClient as any).getGlobalConfig=oldGlobal;
     (ActiveMsgClient as any).listRemoteTasksForChar=oldRemote;
     (ActiveMsgClient as any).scheduleCharacterTask=oldSchedule;
     (ActiveMsgClient as any).cancelTask=oldCancel;
   }
 });
});

describe('AMSG2 schedule toggle is independent from autonomous contact',()=>{
  it('turning off the timetable does not suppress daily wake planning using stale saved busy slots',async()=>{
    const {ensureAutonomyWakes}=await import('./amsgAutonomyWake');
    const {ActiveMsgClient}=await import('./activeMsgClient');
    const oldGlobal=ActiveMsgClient.getGlobalConfig;
    const oldRemote=ActiveMsgClient.listRemoteTasksForChar;
    const oldSchedule=ActiveMsgClient.scheduleCharacterTask;
    let config:any={enabled:true,tasks:[]};
    const role:any={...char,id:'wake-schedule-off',scheduleFeatureEnabled:false,
      activeMsg2Config:config};
    let readCount=0;
    const created:string[]=[];
    (ActiveMsgClient as any).getGlobalConfig=async()=>({workerUrl:'https://example.com'});
    (ActiveMsgClient as any).listRemoteTasksForChar=async()=>[];
    (ActiveMsgClient as any).scheduleCharacterTask=async(args:any)=>{
      const slot=args.task.autonomyWakeSlot;
      created.push(slot);
      return {uuid:'off-'+slot,clientTaskId:'autowake:'+slot+':off',firstSendAt:args.task.firstSendTime};
    };
    try{
      await ensureAutonomyWakes({char:role,apiConfig:{} as any,userProfile:{} as any,
        groups:[],realtimeConfig:{} as any,
        readSchedule:async()=>{readCount++;return {slots:[
          {startTime:'00:00',activity:'睡觉'},
          {startTime:'08:00',activity:'工作'},
        ]};},
        onSave:update=>{config=update(config);role.activeMsg2Config=config;},
      });
      expect(readCount).toBe(0);
      expect(created).toEqual(['day','evening']);
      expect(config.tasks).toHaveLength(2);
    }finally{
      (ActiveMsgClient as any).getGlobalConfig=oldGlobal;
      (ActiveMsgClient as any).listRemoteTasksForChar=oldRemote;
      (ActiveMsgClient as any).scheduleCharacterTask=oldSchedule;
    }
  });
});
