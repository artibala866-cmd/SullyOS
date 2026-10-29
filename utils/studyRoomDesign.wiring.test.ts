import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const read=(path:string)=>readFileSync(resolve(process.cwd(),path),'utf8');
const schedule=read('apps/ScheduleApp.tsx');
const workspace=read('apps/WorkspacePanel.tsx');
const calendar=read('apps/StudyCommissionCalendar.tsx');
const timetable=read('apps/StudyWeekTimetable.tsx');
const picker=read('apps/StudyCharPicker.tsx');
const avatar=read('apps/StudyAvatar.tsx');
const reminders=read('apps/WorkspaceReminderControls.tsx');
describe('学习室黑白灰视觉改造 · 真实数据、操作和隐私入口',()=>{
 it('Char 取系统角色的真实头像，支持 blobref/data/URL 且角色切换仍真实调用 chooseChar',()=>{
   expect(picker).toContain('<StudyAvatar value={char.avatar} name={char.name}');
   expect(avatar).toContain("isImageValue(value)");
   expect(avatar).toContain('onError={()=>setBroken(imageValue)}');
   expect(avatar).toContain('broken!==imageValue');
   expect(schedule).toContain('<StudyAvatar value={activeChar?.avatar}');
   expect(picker).toContain('onClick={()=>onSelect(char.id)}');
   expect(picker).toContain('aria-pressed={selectedId===char.id}');
   expect(schedule).toContain('StudyCharPicker compact characters={characters} selectedId={charId} onSelect={chooseChar}');
   expect(schedule).toContain('StudyCharPicker compact characters={characters} selectedId={charId} onSelect={chooseChar}');
   expect(workspace).toContain('StudyCharPicker compact characters={characters} selectedId={selectedCharId} onSelect={onSelectChar}');
 });
 it('月历从原有数据生成，支持月份移动、日历选日、当天编辑与开始专注',()=>{
   expect(workspace).toContain('StudyCommissionCalendar commissions={data.commissions}');
   expect(workspace).toContain("onFocus={(id,title)=>onFocus('commission',id,title)}");
   expect(workspace).toContain('setShowCommissionList(true)');
   expect(calendar).toContain('commissionCalendarEvents(commissions)');
   expect(calendar).toContain('onClick={()=>stepMonth(-1)}');
   expect(calendar).toContain('onClick={()=>stepMonth(1)}');
   expect(calendar).toContain('onClick={()=>onEdit(event.id)}');
   expect(calendar).toContain('onFocus(event.id,event.title)');
   expect(calendar).not.toContain('window.localStorage');
   expect(calendar).toContain('undatedCommissionItems(commissions)');
   expect(calendar).toContain('onClick={()=>onEdit(undated[0].id)}');
 });
 it('周课程表读取原课程关联且触发原有作业、笔记选择，不读写 PDF',()=>{
   expect(workspace).toContain('StudyWeekTimetable classes={data.classes} selectedId={selectedClassId}');
   expect(workspace).toContain("document.getElementById('study-homework-panel')?.scrollIntoView");
   expect(workspace).toContain('id="study-homework-panel"');
   expect(timetable).toContain('onSelect(c.id)');
   expect(timetable).toContain('!c.cancelled&&c.weekday===day.getDay()');
   expect(timetable).toContain('aria-label="上一周"');
   expect(timetable).toContain('aria-label="下一周"');
   expect(timetable).toContain('aria-label="回到本周"');
 });
 it('新 UI 保留重要操作但按需展开冗长设置：添加/修改/远端提醒/复盘',()=>{
   expect(workspace).toContain('onSubmit={addCommission}');
   expect(workspace).toContain('onSubmit={addClass}');
   expect(workspace).toContain("onClick={()=>void requestPlan()}");
   expect(workspace).toContain('WorkspaceReminderControls kind="commission"');
   expect(workspace).toContain('WorkspaceReminderControls kind="homework"');
   expect(workspace).toContain('buildHomeworkReviewTopic(h,selectedClass?.name');
   expect(workspace).toContain('mergeWorkspaceLocalEdit(before,after,current)');
   expect(workspace).toContain('普通私聊');
   expect(schedule).toContain('setSession({ id: newWorkspaceId()');
   expect(schedule).toContain('专注保护');
   expect(schedule).toContain("if (session) {");
   expect(schedule).toContain("已有专注或休息轮次进行中");
   expect(schedule).toContain('aria-label="结束或退出本轮选项"');
   expect(schedule).toContain('onClick={requestExit}');
   expect(schedule).toContain('onClick={() => stop(false)}');
   expect(schedule).toContain("day.minutes?");
 });
 it('折叠栏只显示短标题，具体规则留在正文，原表单仍保留',()=>{
   for(const title of [
     '时间容量','＋ 新增委托','提醒','编辑委托','＋ 新增课程',
     '识别课表','编辑课程','作业提醒'
   ])expect(workspace).toContain('>'+title+'</summary>');
   expect(workspace).toContain('全部委托（{data.commissions.filter(c=>c.status!==');
   expect(workspace).toContain('课程管理与关联（{data.classes.length}）');
   expect(workspace).toContain('未归属资料（{orphaned.homework.length+orphaned.notes.length}）');
   expect(workspace).toContain('<span>隐私授权</span>');
   expect(schedule).toContain('>发送内容</summary>');
   expect(schedule).toContain('旧对话（{unscopedNotes.length}）');
   expect(schedule).toContain('旧记录（{unassignedNotes.length}）');
   expect(reminders).toContain('>到点提醒</summary>');
   for(const noisy of ['点击展开','按需展开','编辑与提醒（','需要时再展开',
     '管理旧自习室关联（','设置与核查','不会发送给 AI）</summary>'])
     expect(workspace+schedule+reminders).not.toContain(noisy);
   expect(workspace).toContain('onSubmit={addCommission}');
   expect(workspace).toContain('onSubmit={addClass}');
   expect(workspace).toContain('<WorkspaceReminderControls kind="commission"');
 });

});
