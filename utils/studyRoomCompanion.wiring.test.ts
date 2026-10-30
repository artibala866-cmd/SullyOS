import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const schedule=readFileSync(resolve(process.cwd(),'apps/ScheduleApp.tsx'),'utf8');
const study=readFileSync(resolve(process.cwd(),'apps/StudyApp.tsx'),'utf8');
const workspace=readFileSync(resolve(process.cwd(),'apps/WorkspacePanel.tsx'),'utf8');
describe('原始学习室 Char 陪伴贯穿每个区域的真实页面接线',()=>{
 it('PDF 保持原有助教教学与问答，不再叠加第二个独立浮动聊天按钮',()=>{
  expect(schedule).not.toContain('aria-label="在自习室和当前 Char 继续陪伴"');
  expect(study).toContain('handleAskQuestion');
  expect(study).toContain('showAssistant');
  expect(schedule).toContain('aria-label="Char 持续陪伴状态"');
  expect(schedule).toContain('onClick={()=>void openCompanionOverview()}');
  expect(schedule).toContain('assistantScope===\'overview\'?\'今日陪伴\'');
  const hidden=schedule.indexOf("className={tab === 'study'");
  const overlay=schedule.indexOf('      {assistantOpen && <div');
  const hiddenClose=schedule.indexOf('      </div>\n      {coachSettingsOpen && <div');
  expect(hidden).toBeGreaterThan(0);
  expect(overlay).toBeGreaterThan(hiddenClose);
  expect(hiddenClose).toBeGreaterThan(hidden);
  expect(schedule).toContain('<div className="relative h-full w-full overflow-hidden">');
 });
 it('尚未选择 Char 时，自习室也能打开真实角色选择框，再手动读取最新计划',()=>{
  expect(schedule).toContain("setAssistantScope('overview');setAssistantItemId('');setAssistantTopic('');");
  expect(schedule).toContain("setMessage('');setAssistantOpen(true);");
  expect(schedule).toContain("disabled={!activeChar||overviewBusy}");
  expect(schedule).toContain('查看最新学习和画稿计划');
  expect(schedule).toContain("setAssistantScope(assistantOpen && assistantScope==='overview'?'overview':'focus')");
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
  expect(schedule).toContain("setCompanionMoment('刚完成一轮专注");
  expect(schedule).toContain('companionMomentText(session,activeTask?.title');
  expect(schedule).toContain('focusChatAllowance(session, now)');
  expect(schedule).toContain('if (session?.mode === \'focus\')');
 });
 it('督促单独保存每位 Char 配置，默认关闭，绝不调用自动 AI 或 AMSG',()=>{
  expect(schedule).toContain("load('coachByChar',{})");
  expect(schedule).toContain("save('coachByChar', coachByChar)");
  expect(schedule).toContain("load('coachLastShown',{})");
  expect(schedule).toContain("load('coachEventByChar',{})");
  expect(schedule).toContain("save('coachEventByChar', coachEventByChar)");
  expect(schedule).toContain('normalizeStudyCoachSetting(coachByChar?.[charId])');
  expect(schedule).toContain("setCoachByChar(prev=>({...prev,[charId]:normalizeStudyCoachSetting({");
  expect(schedule).toContain('setCoachPrompt(\'\');');
  expect(schedule).toContain("coachIdleSince.current=Date.now()");
  expect(schedule).toContain('if(!activeChar || coachSetting.level===\'off\'');
  expect(schedule).toContain("isVisible:document.visibilityState==='visible'");
  expect(schedule).toContain("isTimerTab:tab==='timer'");
  expect(schedule).toContain("lastEventKey:sameDay?seen.key:''");
  expect(schedule).toContain("if(isStudyCoachQuietTime(coachSetting,new Date(when)))");
  expect(schedule).toContain('window.setInterval(check,60000)');
  const watch=schedule.split("  useEffect(()=>{\n    if(!activeChar || coachSetting.level==='off'")[1]?.split('  useEffect(')[0]||'';
  expect(watch).not.toContain('sendNote(');
  expect(watch).not.toContain('ContextBuilder');
  expect(watch).not.toContain('ActiveMsgClient');
 });
 it('设置是单个轻量面板，兼顾免打扰、暂停、频率及用户发送授权',()=>{
  expect(schedule).toContain('aria-label="督促设置"');
  expect(schedule).toContain('role="dialog" aria-modal="true" aria-label="督促设置"');
  for(const part of ['轻提醒 · 最多每天 1 次','适度陪学 · 最多每天 2 次','认真陪学 · 最多每天 3 次',
   '暂停督促','免打扰','免打扰开始','免打扰结束'])expect(schedule).toContain(part);
  expect(schedule).toContain('coachPrompt && tab===\'timer\'');
  expect(schedule).toContain('onClick={()=>setCoachPrompt(\'\')}');
  expect(schedule).toContain("const brief=studyCoachBrief(coachSetting)");
  expect(schedule).toContain('const overview=buildCompanionOverview(');
  expect(schedule).toContain('onSubmit={e=>{e.preventDefault();void sendNote();}}');
  expect(schedule).toContain('Reopening a backgrounded app is not evidence');
 });

 it('一个陪伴 Char 贯穿 PDF 助教、专注与排单，双方选择同步，不是叠加独立聊天窗',()=>{
  expect(schedule).toContain('companionCharId={charId} onCompanionSelect={chooseChar}');
  expect(study).toContain('companionCharId?:string;onCompanionSelect?:(id:string)=>void');
  expect(study).toContain('setSelectedChar(characters.find(c=>c.id===tutorId)||fallback)');
  expect(study).toContain('tutorCharId:tutorId');
  expect(study).toContain('onClick={()=>void chooseCourseTutor(c.id)}');
  expect(study).toContain('onClick={()=>void chooseCourseTutor(undefined)}');
  expect(study).toContain('onCompanionSelect?.(c.id)');
  expect(study).toContain('companionCharId!==undefined');
  expect(study).toContain('useAppShortcut(ShortcutAppID.Study');
  expect(schedule).toContain('onLearningStateChange={onLearningStateChange}');
  expect(study).toContain('onLearningStateChange?.({');
  expect(study).toContain('courseTitle:activeCourse.title.slice(0,80)');
  expect(schedule).toContain("pdfLearning:tab==='study'?studyPresence:recentPdf?");
 });
 it('工作区已确认保存的进度实时进入陪伴状态，AI 仅收到用户主动审阅的数据',()=>{
  expect(schedule).toContain('buildStudyRoomReality(');
  expect(schedule).toContain('const companionReality=workspaceSnapshot?');
  expect(schedule).toContain("const evidence='【学习室实际状态");
  expect(schedule).toContain('setAssistantTopic([brief,evidence,overview]');
  expect(schedule).toContain('onWorkspaceSnapshot={onWorkspaceSnapshot}');
  expect(workspace).toContain('onWorkspaceSnapshot?.(confirmed)');
  expect(workspace).toContain('onWorkspaceSnapshot?.(value)');
  expect(workspace).toContain('previous.onWorkspaceSnapshot===next.onWorkspaceSnapshot');
  expect(schedule).toContain('await readWorkspace()');
  const overview=schedule.split('const openCompanionOverview=async()=>{')[1]?.split('const discuss =')[0]||'';
  expect(overview).toContain('buildStudyRoomReality(');
  expect(overview).not.toContain('sendNote()');
  expect(overview).not.toContain('fetch(');
 });

 it('同一角色在所有非课堂页面保留真实最近回复和上下文行动，不另造聊天或冒充主动 AI',()=>{
  expect(schedule).toContain('recentCompanionReply(notes,charId)');
  expect(schedule).toContain('companionActionLabel');
  expect(schedule).toContain('companionEntryPrompt(actual,activeTask?.title');
  expect(schedule).toContain('createdAt:Date.now()');
  expect(schedule).not.toContain('aria-label="在自习室和当前 Char 继续陪伴"');
  const open=schedule.split('const openCompanionOverview=async()=>{')[1]?.split('const discuss =')[0]||'';
  expect(open).toContain('setMessage(companionEntryPrompt(');
  expect(open).not.toContain('sendNote()');
  expect(open).not.toContain('fetch(');
 });

 it('返回课程表或专注页，同一个 Char 只延续最近 30 分钟自己的 PDF 章节',()=>{
  expect(schedule).toContain('setRecentStudyByChar(prev=>({...prev,[charId]:{...value,seenAt:Date.now()}}))');
  expect(schedule).toContain('recentStudyByChar[charId]');
  expect(schedule).toContain('Date.now()-lastStudy.seenAt<30*60000');
  expect(schedule).toContain('pdfLearning:tab===\'study\'?studyPresence:recentPdf?');
  expect(schedule).toContain('刚一起看过《');
  expect(schedule).toContain("setMessage(companionEntryPrompt(");
 });
 it('后台工作空间读取不能覆盖更晚确认的课程与画稿进度',()=>{
  expect(schedule).toContain('const workspaceRevision=useRef(0)');
  expect(schedule).toContain('workspaceRevision.current+=1');
  expect(schedule).toContain('workspaceRevision.current===revision');
  expect(schedule).toContain('onWorkspaceSnapshot={onWorkspaceSnapshot}');
 });

 it('本机督促从不冒充 Char 回复，角色切换不会串发旧聊天',()=>{
   const coach=schedule.split("  useEffect(()=>{\n    if(!activeChar || coachSetting.level==='off'")[1]?.split('  useEffect(')[0]||'';
   expect(coach).not.toContain('fetch(');
   expect(coach).not.toContain('sendNote(');
   expect(coach).toContain('studyCoachEvent(reality,date)');
   expect(schedule).toContain('<strong>学习室提醒</strong>');
   expect(schedule).toContain('const companionStatus=(');
   expect(schedule).not.toContain('const companionStatus=coachPrompt||(');
   expect(schedule).toContain('discussionVersion.current += 1');
   expect(schedule).toContain('setMessage(\'\')');
 });
 it('单门 PDF 助教覆盖只保存该门课程，并保留独立的学习室陪伴角色',()=>{
   expect(study).toContain('const updated={...activeCourse,tutorCharId:tutorId}');
   expect(study).toContain('await DB.saveCourse(updated)');
   const choose=study.split('const chooseCourseTutor=async')[1]?.split('useAppShortcut')[0]||'';
   expect(choose).not.toContain('onCompanionSelect?.(');
   expect(choose).not.toContain('prompt =');
   expect(study).toContain('handleTeach(course, targetIdx, false, tutor||null)');
   expect(study).toContain('onClick={()=>void chooseCourseTutor(undefined)}');
   expect(study).toContain('已有讲解不重写');
 });

});
