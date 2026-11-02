import { describe, expect, it } from 'vitest';
import { buildCharacterLifeFacts } from './characterLifeContext';
const now=Date.parse('2026-11-03T05:00:00Z');
const char={id:'facts',customTimezoneEnabled:true,customTimezone:'Asia/Shanghai',timeAwarenessEnabled:true};
const event=(id:string,occurredAt:number,characterId=char.id)=>({id,occurredAt,characterId,kind:'npc-chat' as const,source:'phone' as const,summary:id});
describe('one shared life-fact boundary',()=>{
 it('excludes stale/future/foreign events and uses the character timezone',()=>{
  const out=buildCharacterLifeFacts(char,{now,events:[event('当前记录',now),event('旧蛋糕',now-74*3600_000),event('未来',now+1),event('别人的',now,'other')]});
  expect(out).toContain('当前记录');expect(out).toContain('13:00:00');
  expect(out).not.toMatch(/旧蛋糕|未来|别人的/);
  expect(out).toContain('不是计划、待办或必须汇报');
 });
 it('switching time awareness off removes context-added timestamps without deleting facts',()=>{
  const out=buildCharacterLifeFacts({...char,timeAwarenessEnabled:false},{now,events:[event('画稿完成',now)]});
  expect(out).toContain('画稿完成');expect(out).not.toContain('13:00');expect(out).not.toContain('2026');
 });
});
