import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const schedule=readFileSync(resolve(process.cwd(),'apps/ScheduleApp.tsx'),'utf8');
describe('原始学习室 Char 陪伴贯穿每个区域的真实页面接线',()=>{
 it('旧自习室挂载期间仍展示 Char 同一聊天，不再放在隐藏的工作台容器里',()=>{
  expect(schedule).toContain('aria-label="在自习室和当前 Char 继续陪伴"');
  expect(schedule).toContain('aria-label="Char 持续陪伴状态"');
  expect(schedule).toContain('onClick={()=>void openCompanionOverview()}');
  expect(schedule).toContain('assistantScope===\'overview\'?\'今日陪伴\'');
  const hidden=schedule.indexOf("className={tab === 'study'");
  const overlay=schedule.indexOf('      {assistantOpen && <div');
  const hiddenClose=schedule.indexOf('      </div>\n      {assistantOpen && <div');
  expect(hidden).toBeGreaterThan(0);
  expect(overlay).toBeGreaterThan(hiddenClose);
  expect(hiddenClose).toBeGreaterThan(hidden);
  expect(schedule).toContain('<div className="relative h-full w-full overflow-hidden">');
 });
 it('只有手动点击今日计划后才读取最新工作空间，在发送前展示摘要',()=>{
  const fn=schedule.split('const openCompanionOverview=async()=>{')[1]?.split('const discuss =')[0]||'';
  expect(fn).toContain('await readWorkspace()');
  expect(fn).toContain('buildCompanionOverview(workspace,session,activeTask?.title');
  expect(fn).toContain("setAssistantScope('overview')");
  expect(fn).toContain('setAssistantOpen(true)');
  expect(fn).not.toContain('fetch(');
  expect(fn).not.toContain('sendNote()');
  expect(schedule).toContain('assistantTopic.slice(0,12000)');
  expect(schedule).toContain('onSubmit={e=>{e.preventDefault();void sendNote();}}');
 });
 it('专注结束生成的是本机陪伴提示，不冒充 Char 已发 AI 消息',()=>{
  expect(schedule).toContain("setCompanionMoment('这轮专注完成啦");
  expect(schedule).toContain('companionMomentText(session,activeTask?.title');
  expect(schedule).toContain('focusChatAllowance(session, now)');
  expect(schedule).toContain('if (session?.mode === \'focus\')');
 });
});
