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
describe('手机学习室按 P2 紧凑仪表盘比例整改',()=>{
 it('主屏首段是缩短的头像条与单卡计时，不再是超大字号/垂直留白',()=>{
  expect(schedule).toContain('StudyCharPicker compact characters={characters}');
  expect(schedule).toContain('StudyHomeOverview onCommissions=');
  expect(schedule).toContain('text-[clamp(48px,13vw,74px)]');
  expect(schedule).not.toContain('text-[clamp(64px,12vw,112px)]');
  expect(schedule).not.toContain('px-5 py-10 sm:py-14');
  expect(schedule).toContain('grid grid-cols-2 gap-3');
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
 it('迷你日历、课程与作业预览都走现有 IndexedDB，只用于读取而不提交私密资料',()=>{
  expect(home).toContain('readWorkspace()');
  expect(home).toContain('commissionCalendarEvents(data.commissions)');
  expect(home).toContain('calendarMonthGrid(year,month-1)');
  expect(home).toContain('data.classes');
  expect(home).toContain('data.homework');
  expect(home).toContain('onClick={onCommissions}');
  expect(home).toContain('onClick={onCourses}');
  expect(home).not.toContain('mutateWorkspace(');
  expect(home).not.toContain('fetch(');
  expect(home).not.toContain('brief');
  expect(home).not.toContain('client:');
 });
 it('正式排单与课程界面也缩小单元格和留白，保留编辑/导航',()=>{
  expect(panel).toContain('StudyCommissionCalendar commissions={data.commissions}');
  expect(panel).toContain('StudyWeekTimetable classes={data.classes}');
  expect(commission).toContain('min-h-[45px] sm:min-h-[65px]');
  expect(commission).toContain('onClick={()=>onEdit(event.id)}');
  expect(weekly).toContain('onSelect(c.id)');
  expect(weekly).toContain('aria-label="下一周"');
 });
});
