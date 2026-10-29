import {describe,expect,it} from 'vitest';
import {autonomyWakeSkipReason,renderAutonomyCrossDayHint} from './amsgAutonomyPolicy';
const now=Date.parse('2026-07-25T12:00:00Z'); // 20:00 Shanghai
const scene:any={charId:'test',dateKey:'2026-07-25',songPool:[],schedule:{
  slots:[{startTime:'00:00',activity:'睡觉'},{startTime:'09:00',activity:'上班'},
    {startTime:'18:00',activity:'吃晚餐'},{startTime:'21:00',activity:'睡觉'}],
}};
const judge=(last:number|null,s:any=scene)=>autonomyWakeSkipReason({nowMs:now,
  lastUserMessageAt:last,scene:s,tzId:'Asia/Shanghai'});
describe('AMSG2 voluntary wake vs. real-person conversation and phone schedule',()=>{
 it('a stale phone schedule is not promoted to truth after several offline days',()=>{
   const old={...scene,dateKey:'2026-07-21'};
   const hint=renderAutonomyCrossDayHint(old,now,'Asia/Shanghai');
   expect(hint).toContain('2026-07-21');
   expect(hint).toContain('2026-07-25');
   expect(hint).toContain('[[SILENT]]');
   expect(hint).not.toContain('当前时段：');
   expect(renderAutonomyCrossDayHint(scene,now,'Asia/Shanghai')).toBe('');
   expect(renderAutonomyCrossDayHint(null,now,'Asia/Shanghai')).toContain('没有从角色手机确认');
 });
 it('defers to active real conversation, even with old phone events',()=>{
   expect(judge(now-5*60000)).toBe('autonomy-chatting');
   expect(judge(now-13*60000)).toBe(null);
 });
 it('does not speak while the confirmed same-day schedule says sleep/work',()=>{
   const sleeping={...scene,schedule:{slots:[{startTime:'00:00',activity:'工作'}]}};
   expect(judge(null,sleeping)).toBe('autonomy-busy');
   expect(judge(null,scene)).toBe(null);
 });
 it('never mistakes yesterday schedule for todays confirmed reality',()=>{
   expect(judge(null,{...scene,dateKey:'2026-07-24'})).toBe(null);
 });
 it('ignores malformed schedule times rather than treating 18:99 as 19:39 busy time',()=>{
   const corrupted={...scene,schedule:{slots:[
     {startTime:'00:00',activity:'散步'},
     {startTime:'18:99',activity:'睡觉'},
     {startTime:'25:00',activity:'工作'},
   ]}};
   expect(judge(null,corrupted)).toBe(null);
 });
 it('unknown schedule remains an opportunity but cannot claim to have done things',()=>{
   expect(judge(null,null)).toBe(null);
 });
});
