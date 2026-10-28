import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const panel=readFileSync(resolve(process.cwd(),'apps/WorkspacePanel.tsx'),'utf8');
const schedule=readFileSync(resolve(process.cwd(),'apps/ScheduleApp.tsx'),'utf8');
const workspace=readFileSync(resolve(process.cwd(),'utils/sullyWorkspace.ts'),'utf8');
describe('原始学习室目标：专注、作业、排单的实际闭环接线',()=>{
  it('画稿和作业均有手动结算入口，禁止仅计时结束就写入业务工时',()=>{
    expect(panel).toContain("settleLinkedFocus('commission',c.id,c.remainingMinutes)");
    expect(panel).toContain("settleLinkedFocus('homework',h.id,h.minutes)");
    expect(panel).toContain("settleFocusProgress(current,focusTasks,records,kind,id,ids,estimate)");
    expect(panel).toContain("await mutateWorkspace(current=>");
    expect(panel).toContain("不会自动认定任务完成、改变交期或触发提醒");
    expect(schedule).not.toContain('settleFocusProgress(');
  });
  it('只结算有原始 sessionId 的已完成记录，且旧版数据不会误改',()=>{
    expect(workspace).toContain('focusSettlements:');
    expect(schedule).toContain('sessionId: id');
    expect(schedule).toContain('if (!stored.some(r => r.sessionId === id))');
    expect(panel).toContain('legacyMinutes');
  });
  it('统计和任务清单提供回到原事项，避免结算时找不到稿件或作业',()=>{
    expect(schedule).toContain('去核对进度');
    expect(schedule).toContain('查看原事项');
    expect(schedule).toContain("'commissions':'calendar'");
    expect(schedule).toContain('将失去与原事项的关联');
  });
  it('人工更改剩余估算不影响是否完成的开关',()=>{
    expect(panel).toContain("x.id===h.id?{...x,minutes:Math.max(");
    expect(panel).toContain("Math.min(10080,Number(e.target.value)||0)");
    expect(panel).toContain("onChange={e=>void changeHomeworkDone(h.id,e.target.checked)}");
  });
});
