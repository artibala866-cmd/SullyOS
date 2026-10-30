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
const legacyClassroom=read('apps/StudyApp.tsx');
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
   expect(workspace).toContain('onClick={()=>setPrivacyOpen(true)}');
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
   expect(workspace).toContain('<Plus size={18} weight="light"/> 新建</summary>');
   expect(workspace).toContain('<Camera size={18} weight="light"/> 识别</summary>');
   expect(workspace).toContain('<ListBullets size={18} weight="light"/> 全部');
   expect(workspace).toContain('编辑委托</summary>');
   expect(workspace).toContain('编辑课程</summary>');
   expect(workspace).toContain('时间容量');
   expect(workspace).toContain("data.commissions.length>0 && <details");
   expect(workspace).toContain('data.classes.length>0 && <details');
   expect(workspace).toContain('未归属资料（{orphaned.homework.length+orphaned.notes.length}）');
   expect(workspace).toContain('aria-label="私聊权限"');
   expect(workspace).toContain('role="dialog" aria-modal="true"');
   expect(workspace).not.toContain('学习室设置 · 私聊授权');
   expect(schedule).toContain('>本轮共享内容 · 点击查看</summary>');
   expect(schedule).toContain('旧记录 ({unscopedNotes.length+unassignedNotes.length})');
   expect(schedule).toContain('旧记录（{unassignedNotes.length}）');
   expect(reminders).toContain('>到点提醒</summary>');
   expect(workspace).not.toContain('>作业提醒</summary>');
   expect(workspace).not.toContain('>提醒</summary>');
   expect(reminders).toContain('读取 AMSG 云端状态（不修改）');
   expect(reminders).toContain('请求远端取消（UUID 已确认）');
   for(const noisy of ['点击展开','按需展开','编辑与提醒（','需要时再展开',
     '管理旧自习室关联（','设置与核查','不会发送给 AI）</summary>'])
     expect(workspace+schedule+reminders).not.toContain(noisy);
   expect(workspace).toContain('onSubmit={addCommission}');
   expect(workspace).toContain('onSubmit={addClass}');
   expect(workspace).toContain('<WorkspaceReminderControls kind="commission"');
 });

 it('柔和灰阶在选中导航、月历与 PDF 课堂保持统一，公式不再强制白色',()=>{
   expect(schedule).toContain("bg-[#252525] text-white");
   expect(schedule).not.toContain("tab===id?'bg-neutral-900 text-white'");
   expect(workspace).toContain('const primaryButton = ');
   expect(workspace).toContain("bg-[#f1f1f1] text-[#292929]");
   expect(calendar).toContain("h-1.5 w-1.5 rounded-full");
   expect(calendar).not.toContain('text-[8px]');
   expect(calendar).toContain('min-h-[44px] sm:min-h-[52px]');
   expect(timetable).toContain('grid grid-cols-7 gap-1');
   expect(legacyClassroom).not.toContain('bg-[#2b2b2b]');
   expect(legacyClassroom).not.toContain('bg-[#1a1a1a]');
   expect(legacyClassroom).toContain('study-paper-content');
   expect(legacyClassroom).toContain('.study-paper-content .katex { color: #292929 !important; }');
   expect(legacyClassroom).not.toContain('.katex { color: white !important; }');
   expect(legacyClassroom).toContain('bg-white/95 backdrop-blur-xl border-t border-[#e5e5e5]');
   expect(reminders).toContain('读取 AMSG 云端状态（不修改）');
 });

 it('参考图式编辑布局：主视觉加侧边信息块，重要入口优先图标表达',()=>{
   expect(schedule).toContain('rounded-[26px] bg-white px-4 py-4');
   expect(schedule).toContain('grid grid-cols-2 gap-3');
   expect(schedule).toContain('bg-[#252525] text-white');
   expect(schedule).toContain('<PenNib size={19}/>');
   expect(schedule).toContain('<CalendarDots size={19}/>');
   expect(schedule).toContain('<BookOpen size={19}/>');
   expect(workspace).toContain('col-span-2 sm:col-span-3 flex min-h-[160px] sm:min-h-[198px]');
   expect(workspace).toContain('col-span-2 sm:col-span-3 flex min-h-[160px] sm:min-h-[194px]');
   expect(workspace).toContain('col-span-2 sm:col-span-1 grid grid-cols-2 gap-3 sm:grid-cols-1');
   expect(workspace).toContain("quickCommissions.slice(0,1).map");
   expect(workspace).toContain("pendingHomework.slice(0,1).map");
   expect(workspace).toContain('aria-label="可直接继续的画稿"');
   expect(workspace).toContain('aria-label="接下来要做的作业"');
 });
 it('密集信息已移到次层：月历靠圆点、课程靠日期卡片，课程书架仅改外观',()=>{
   expect(calendar).toContain('h-1.5 w-1.5 rounded-full');
   expect(calendar).not.toContain('list.slice(0,2).map((e,i)=><span key={e.id+e.kind+i} title=');
   expect(calendar).toContain('aria-label={day.date+');
   expect(timetable).toContain('aria-label="选择星期"');
   expect(timetable).toContain('grid grid-cols-7 gap-1');
   expect(legacyClassroom).toContain('aspect-[4/5] rounded-[26px]');
   expect(legacyClassroom).toContain('style={{ background: course.coverStyle }}');
   expect(legacyClassroom).toContain('onClick={() => startSession(course)}');
   expect(workspace).toContain('时间容量');
   expect(workspace).toContain('关闭私聊权限');
   expect(workspace).toContain('permissionForChar(data, selectedCharId)');
   expect(workspace).toContain('togglePrivateChat(category,e.target.checked)');
   expect(workspace).toContain('读取旧自习室课程');
 });

 it('手机短屏不能用巨大固定高度、重复入口和装饰英文撑满首屏',()=>{
   const focus=schedule.split("{tab === 'timer' &&")[1]?.split("{tab === 'tasks' &&")[0]||'';
   expect(focus).toContain('rounded-[26px] bg-white px-4 py-4');
   expect(focus).toContain('min-h-[80px] sm:min-h-[100px]');
   expect(focus).toContain('aria-label="打开任务清单"');
   expect(focus).toContain('aria-label="当前任务"');
   expect(focus).not.toContain('py-9 sm:py-12');
   expect(focus).not.toContain('min-h-[118px]');
   expect(focus).not.toContain('DEEP FOCUS');
   expect(focus).not.toContain('CURRENT TASK');
   expect(focus).not.toContain('>选任务</button>');
   expect(workspace).not.toContain('min-h-[222px]');
   expect(workspace).not.toContain('min-h-[216px]');
   expect(workspace).not.toContain('min-h-[108px]');
   expect(workspace).toContain('quickCommissions.slice(1,2)');
   expect(workspace).toContain('pendingHomework.slice(1,2)');
   expect(workspace).not.toContain('NOW CREATING');
   expect(workspace).not.toContain('UP NEXT / STUDY');
   expect(calendar).toContain('min-h-[44px] sm:min-h-[52px]');
   expect(calendar).not.toContain('min-h-[52px] sm:min-h-[62px]');
   expect(calendar).not.toContain('grid grid-cols-4 gap-2 border-t');
   expect(timetable).not.toContain('WEEKLY TIMETABLE');
 });

 it('手机截图修正：空白页面不渲染无意义管理卡，私聊仅有一个按需弹层',()=>{
   expect(workspace).toContain("data.classes.length>0 && <section id=\"study-homework-panel\"");
   expect(workspace).toContain("data.commissions.length>0 && <details");
   expect(workspace).toContain('role="dialog" aria-modal="true" aria-label="私聊权限"');
   expect(workspace).toContain('onClick={()=>setPrivacyOpen(true)}');
   expect(workspace).toContain('onClick={()=>setPrivacyOpen(false)}');
   expect(workspace).not.toContain('学习室设置 · 私聊授权');
   expect(workspace).not.toContain('＋ 新增委托');
   expect(workspace).not.toContain('全部委托（');
   expect(workspace).not.toContain('课程管理与关联（');
   expect(calendar).not.toContain('进行中 {summary.active} · 七天内 {summary.upcoming}');
   expect(timetable).not.toContain('滑动看下一天 · 点击课程查看作业');
   expect(timetable).not.toContain('min-w-[122px]');
   expect(timetable).toContain('grid grid-cols-7 gap-1');
   expect(legacyClassroom).toContain('col-span-2 sm:col-span-1 flex h-[88px]');
   expect(legacyClassroom).toContain('onClick={() => fileInputRef.current?.click()}');
 });

});
