import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const read=(path:string)=>readFileSync(resolve(process.cwd(),path),'utf8');
const schedule=read('apps/ScheduleApp.tsx');
const picker=read('apps/StudyCharPicker.tsx');
const home=read('apps/StudyHomeOverview.tsx');
const panel=read('apps/WorkspacePanel.tsx');
const commission=read('apps/StudyCommissionCalendar.tsx');
const weekly=read('apps/StudyWeekTimetable.tsx');
describe('手机学习室按 P2 的视觉比例与分区原则：番茄钟只做番茄钟',()=>{
 it('专注页只渲染单卡计时器：日历、课程和作业预览不混入番茄钟',()=>{
  expect(schedule).toContain('StudyCharPicker compact characters={characters}');
  const focusView=schedule.split("{tab === 'timer' &&")[1]?.split("{tab === 'tasks' &&")[0]||'';
  expect(focusView).toContain('max-w-[510px]');
  expect(focusView).not.toContain('StudyHomeOverview');
  expect(focusView).not.toContain('StudyCommissionCalendar');
  expect(focusView).not.toContain('StudyWeekTimetable');
  expect(focusView).not.toContain('委托日程');
  expect(focusView).not.toContain('待做作业');
  expect(focusView).not.toContain('专注数据');
  expect(focusView).toContain('aria-label="开始专注"');
  expect(focusView).toContain('aria-label="专注分钟"');
  expect(focusView).toContain('aria-label="休息分钟"');
  expect(focusView).toContain("onClick={()=>start('break')}");
  expect(focusView).toContain("onClick={()=>switchTab('tasks')}");
  expect(focusView).toContain("onClick={()=>switchTab('stats')}");
  expect(schedule).toContain('aria-label="打开 Char 悬浮手机"');
  expect(focusView).toContain('专注保护');
  // A persistent workspace editor keeps in-progress class/order forms when
  // changing sections. Both categories still use the same old data source.
  expect(schedule).toContain('workspaceVisited && <div');
  expect(schedule).toContain("section={tab==='calendar'?'calendar':'commissions'}");
  expect((schedule.match(/<WorkspacePanel /g)||[]).length).toBe(1);
  expect(schedule).toContain("tab === 'study'");
  expect(schedule).toContain('text-[clamp(48px,13vw,70px)]');
  expect(schedule).not.toContain('text-[clamp(64px,12vw,112px)]');
  expect(schedule).not.toContain('px-5 py-10 sm:py-14');
  expect(schedule).not.toContain('<StudyHomeOverview');
  expect(schedule).toContain('focusLock');
  expect(schedule).toContain('aria-label="当前任务"');
  expect(schedule).toContain('aria-label="开始专注"');
  expect(schedule).toContain('aria-label="结束或退出本轮选项"');
 });
 it('角色头像可滑动且压缩了默认大小，无假图',()=>{
  expect(picker).toContain("(compact?'h-12 w-12':'h-14 w-14')");
  expect(picker).toContain('StudyAvatar value={char.avatar}');
  expect(picker).toContain('onClick={()=>onSelect(char.id)}');
  expect(picker).toContain('aria-pressed={selectedId===char.id}');
 });
 it('已开发的总览组件留在代码中但不挂载专注页；委托与课程仍只从各自页面进入',()=>{
  expect(home).toContain('readWorkspace()');
  expect(home).toContain('commissionCalendarEvents(data.commissions)');
  expect(home).toContain('calendarMonthGrid(year,month-1)');
  expect(home).toContain('aria-label="迷你日历上一月"');
  expect(home).toContain('aria-label="迷你日历下一月"');
  expect(home).toContain('aria-label="迷你日历回本月"');
  expect(home).toContain('min-h-[36px]');
  expect(home).toContain('setSelectedDate(nextMonth+');
  expect(home).toContain('chooseDate(d.date)');
  expect(home).toContain('data.classes');
  expect(home).toContain('data.homework');
  expect(home).toContain('onClick={onCommissions}');
  expect(schedule).not.toContain('import StudyHomeOverview');
  expect(home).toContain('onClick={onCourses}');
  expect(home).not.toContain('mutateWorkspace(');
  expect(home).not.toContain('fetch(');
  expect(home).not.toContain('brief');
  expect(home).not.toContain('client:');
 });
 it('正式排单与课程界面也缩小单元格和留白，保留编辑/导航',()=>{
  expect(panel).toContain('StudyCommissionCalendar commissions={data.commissions}');
  expect(panel).toContain('StudyWeekTimetable classes={data.classes}');
  expect(commission).toContain('min-h-[44px] sm:min-h-[52px]');
  expect(commission).toContain('onClick={()=>onEdit(event.id)}');
  expect(weekly).toContain('onSelect(c.id)');
  expect(weekly).toContain('aria-label="下一周"');
 });
});
