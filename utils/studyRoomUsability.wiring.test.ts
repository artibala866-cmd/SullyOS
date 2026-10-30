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
 it('切换排单与课程仍保留已挂载编辑器，学习笔记按课程保存草稿',()=>{
  expect(panel).toContain("<div className={'space-y-4 sm:space-y-5 '+(section==='commissions'?'':'hidden')}>");
  expect(panel).toContain("<div className={'space-y-4 sm:space-y-5 '+(section==='calendar'?'':'hidden')}>");
  expect(panel).not.toContain("{section==='commissions' ? <>");
  expect(panel).toContain('const [noteDrafts, setNoteDrafts]');
  expect(panel).toContain('const raw=noteDrafts[classId]');
  expect(panel).toContain('await change(current=>');
  expect(panel).toContain("setNoteDrafts(prev=>prev[classId]===raw?");
  expect(panel).toContain('笔记未保存，草稿仍保留');
  expect(panel).toContain('disabled={!noteBody.trim()||noteSaving}');
 });
 it('可以从下一张画稿和待做作业确认结算，但绝不自动标记完成',()=>{
  expect(panel).toContain("pendingMinutes('commission',c.id).minutes>0");
  expect(panel).toContain("pendingMinutes('homework',h.id).minutes>0");
  expect(panel).toContain("settleLinkedFocus('commission',c.id,c.remainingMinutes)");
  expect(panel).toContain("settleLinkedFocus('homework',h.id,h.minutes)");
  expect(schedule).toContain('setRecentLinkedFocus({kind:completedTask.source.kind');
  expect(schedule).toContain('records.some(r=>r.sessionId===recentLinkedFocus.sessionId)');
  expect(schedule).toContain('去核对并手动结算');
  expect(panel).toContain('不会自动认定任务完成、改变交期或触发提醒');
 });
 it('手机 Char 弹层限制动态高度，并给输入区预留最小点击尺寸',()=>{
  expect(schedule).toContain('h-[min(57dvh,470px)] min-h-[245px] max-h-[calc(100dvh-72px)]');
  expect(schedule).toContain('min-h-0 flex-1 overflow-y-auto overscroll-contain');
  expect(schedule).toContain('flex shrink-0 gap-2 border-t border-neutral-200');
  expect(schedule).toContain("className="grid h-11 min-w-12 shrink-0");
  expect(schedule).toContain('max-h-[90dvh] overflow-y-auto');
 });

 it('新增委托、课程和作业必须等保存完成才清空表单，失败保留草稿',()=>{
  const commission=panel.split('const addCommission = async ')[1]?.split('const reorder =')[0]||'';
  const classes=panel.split('const addClass = async ')[1]?.split('const addHomework =')[0]||'';
  const homework=panel.split('const addHomework = async ')[1]?.split('const pickImage =')[0]||'';
  for(const [section,clear] of [[commission,'setDraft(prev=>'],[classes,'setClassDraft(prev=>'],[homework,'setHomeworkTitle(prev=>']]){
    expect(section).toContain('await change(');
    expect(section.indexOf('await change(')).toBeLessThan(section.indexOf(clear));
    expect(section).toContain('await resyncAfterFailedWrite()');
    expect(section).toContain('填写内容仍保留');
  }
  const done=panel.split('const changeHomeworkDone = async ')[1]?.split('const removeHomework =')[0]||'';
  expect(done.indexOf('await change(')).toBeLessThan(done.indexOf("stopItemReminders('homework',id)"));
  expect(panel).toContain('disabled={addingCommission}');
  expect(panel).toContain('disabled={addingHomework}');
  expect(panel).toContain('disabled={addingClass}');
 });

});
