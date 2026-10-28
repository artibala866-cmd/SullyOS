import {describe,expect,it} from 'vitest';
import {autonomyWakeSkipReason} from './amsgAutonomyPolicy';
const now=Date.parse('2026-07-25T12:00:00Z'); // 20:00 Shanghai
const scene:any={charId:'test',dateKey:'2026-07-25',songPool:[],schedule:{
  slots:[{startTime:'00:00',activity:'睡觉'},{startTime:'09:00',activity:'上班'},
    {startTime:'18:00',activity:'吃晚餐'},{startTime:'21:00',activity:'睡觉'}],
}};
const judge=(last:number|null,s:any=scene)=>autonomyWakeSkipReason({nowMs:now,
  lastUserMessageAt:last,scene:s,tzId:'Asia/Shanghai'});
describe('AMSG2 voluntary wake vs. real-person conversation and phone schedule',()=>{
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
 it('unknown schedule remains an opportunity but cannot claim to have done things',()=>{
   expect(judge(null,null)).toBe(null);
 });
});
