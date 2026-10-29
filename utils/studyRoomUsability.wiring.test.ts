import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const read=(path:string)=>readFileSync(resolve(process.cwd(),path),'utf8');
const panel=read('apps/WorkspacePanel.tsx');
const schedule=read('apps/ScheduleApp.tsx');
const editor=read('apps/StudyCommissionEditor.tsx');
describe('学习室原始需求：流畅的画稿与作业操作路径',()=>{
 it('排单第一屏直接看到可画画稿，保持原有手动顺序并能启动专注',()=>{
  expect(panel).toContain('aria-label="可直接继续的画稿"');
  expect(panel).toContain('nextDrawableCommissions(data.commissions)');
  expect(panel).toContain("onFocus('commission',c.id,c.title)");
  expect(panel).toContain("onClick={()=>editCommission(c.id)}");
  expect(panel.indexOf('aria-label="可直接继续的画稿"')).toBeLessThan(panel.indexOf('<StudyCommissionCalendar'));
  expect(panel).toContain('editCommission(commission.id)');
 });
 it('课程直接看到待做作业，可开始学习或定位课程的作业区',()=>{
  expect(panel).toContain('aria-label="接下来要做的作业"');
  expect(panel).toContain('nextHomework(data.homework)');
  expect(panel).toContain("onFocus('homework',h.id,h.title)");
  expect(panel).toContain('onClick={()=>showClassWork(h.classId)}');
  expect(panel).toContain('onSelect={showClassWork}');
  expect(panel.indexOf('aria-label="接下来要做的作业"')).toBeLessThan(panel.indexOf('<StudyWeekTimetable'));
 });
 it('切换回来自动选已有课程，从自习室返回恢复此前的学习室区域',()=>{
  expect(panel).toContain('if(first)setSelectedClassId(first.id)');
  expect(panel).toContain('showClassWork(id)');
  expect(schedule).toContain("setStudyReturnTab('calendar')");
  expect(schedule).toContain('setTab(studyReturnTab)');
  expect(schedule).toContain("setStudyReturnTab(tab==='commissions' || tab==='calendar'?tab:'timer')");
 });
 it('委托表单必须明确保存，而不是每打一个字触发 IndexedDB 写入',()=>{
  expect(panel).toContain('StudyCommissionEditor');
  expect(panel).toContain('onSave={patch=>saveCommissionEdits(c.id,patch)}');
  expect(panel).not.toContain('patchCommission(c.id,{');
  expect(editor).toContain('commissionFormPatch(commission,');
  expect(editor).toContain('await onSave(patch)');
  expect(editor).toContain('保存修改');
  expect(editor).toContain('取消');
  expect(panel).toContain("stopItemReminders('commission',id)");
 });
 it('从画稿与作业点开始后立即启动一轮专注，而不是只选任务',()=>{
  expect(schedule).toContain('const taskIdForNewLinkedWork=existing?.id||newWorkspaceId()');
  expect(schedule).toContain("id:newWorkspaceId(),mode:'focus',duration:focusMinutes");
  expect(schedule).toContain('deadline:Date.now()+focusMinutes*60000');
  expect(schedule).toContain('taskId:existing?.id||taskIdForNewLinkedWork');
  expect(schedule).toContain('if (session) {');
  expect(schedule).toContain('processed.current=null;');
 });
 it('番茄钟仍然纯粹，未将看板硬塞进计时页面',()=>{
  const focus=schedule.split("{tab === 'timer' &&")[1]?.split("{tab === 'tasks' &&")[0]||'';
  expect(focus).toContain('aria-label="开始专注"');
  expect(focus).not.toContain('可直接继续的画稿');
  expect(focus).not.toContain('接下来要做的作业');
 });
});
