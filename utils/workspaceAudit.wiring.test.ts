import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const panel=readFileSync(resolve(process.cwd(),'apps/WorkspacePanel.tsx'),'utf8');
const schedule=readFileSync(resolve(process.cwd(),'apps/ScheduleApp.tsx'),'utf8');
const reminder=readFileSync(resolve(process.cwd(),'utils/studyRoomReminders.ts'),'utf8');
describe('学习室深度审计 · 实际业务接线',()=>{
 it('表单不再以旧 React 快照覆盖所有委托/作业/课程/提醒数据',()=>{
  expect(panel).toContain('mergeWorkspaceLocalEdit(before,after,current)');
  expect(panel).not.toContain('commissions: snapshot.commissions');
  expect(panel).not.toContain('homework: snapshot.homework');
  expect(panel).toContain('await change(current=>setClassStudyCourseLink');
 });
 it('新增课程识别条目 ID 在异步保存前确定',()=>{
  expect(panel).toContain('const added=previewRows.map(c=>({...c,id:newWorkspaceId(),sourceImageRef:ref}))');
  expect(panel).toContain('await change(v=>({...v,classes:[...v.classes,...added]}))');
  expect(panel).toContain('const note={id:newWorkspaceId()');
 });
 it('孤立作业保留关联提醒取消入口，单稿件问 Char 不默传备注',()=>{
  expect(panel).toContain('未归属资料');
  expect(panel).toContain('WorkspaceReminderControls kind="homework" itemId={h.id}');
  expect(panel).not.toContain('remainingMinutes:c.remainingMinutes,note:c.note');
 });
 it('每个 Char 只发送自己的监督聊天历史，过时 AI 回复不能重启旧方案',()=>{
  expect(schedule).toContain('notesForStudyContext(notes,activeChar.id,requestScope,requestItemId)');
  expect(schedule).toContain('if(requestVersion!==discussionVersion.current) return');
  expect(schedule).toContain("setNotes(prev=>[...prev,note])");
  expect(schedule).not.toContain('const history:Note[] = [...notes,');
 });
 it('提醒服务层校验事项，创建期间撤销/完成后必须远端补偿',()=>{
  expect(reminder).toContain('isRemindableItem(w,kind,itemId)');
  expect(reminder).toContain("pendingNow?.status!=='creating'");
  expect(reminder).toContain('await remote.cancel(confirmed.uuid)');
 });
});
