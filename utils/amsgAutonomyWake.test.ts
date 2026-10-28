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
 it('a sleep/busy-only schedule does not silently invent life',()=>{
   expect(planAutonomyWakes(char,[{startTime:'00:00',activity:'睡觉'},{startTime:'08:00',activity:'工作'}],now)).toEqual([]);
 });
 it('auto wakes are separate from user-created reminders',()=>{
   expect(isAutonomyWakeTask({clientTaskId:'autowake:day:some-uuid'})).toBe(true);
   expect(isAutonomyWakeTask({clientTaskId:'some-uuid'})).toBe(false);
 });
});