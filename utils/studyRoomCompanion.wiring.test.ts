import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const schedule=readFileSync(resolve(process.cwd(),'apps/ScheduleApp.tsx'),'utf8');
const study=readFileSync(resolve(process.cwd(),'apps/StudyApp.tsx'),'utf8');
const workspace=readFileSync(resolve(process.cwd(),'apps/WorkspacePanel.tsx'),'utf8');
const studyPhoneCss=readFileSync(resolve(process.cwd(),'apps/studyRoomPhone.css'),'utf8');
const nativeChat=readFileSync(resolve(process.cwd(),'apps/Chat.tsx'),'utf8');
describe('原始学习室 Char 陪伴贯穿每个区域的真实页面接线',()=>{
 it('PDF 保持原有助教教学与问答，不再叠加第二个独立浮动聊天按钮',()=>{
  expect(schedule).not.toContain('aria-label="在自习室和当前 Char 继续陪伴"');
  expect(study).toContain('handleAskQuestion');
  expect(study).toContain('showAssistant');
  expect(schedule).toContain('aria-label="Char 持续陪伴状态"');
  expect(schedule).toContain('onClick={()=>void openCompanionOverview()}');
  expect(schedule).toContain('setPhonePage(\'study\')');
  const hidden=schedule.indexOf("className={tab === 'study'");
  const overlay=schedule.indexOf("      {tab!=='study' && assistantOpen && !assistantMinimized && <div");
  const hiddenClose=schedule.indexOf('      </div>\n      {coachSettingsOpen && <div');
  expect(hidden).toBeGreaterThan(0);
  expect(overlay).toBeGreaterThan(hiddenClose);
  expect(hiddenClose).toBeGreaterThan(hidden);
  expect(schedule).toContain('<div className="relative h-full w-full overflow-hidden">');
 });
 it('尚未选择 Char 时，自习室也能打开真实角色选择框，再手动读取最新计划',()=>{
  expect(schedule).toContain("setAssistantScope('overview');setAssistantItemId('');setAssistantTopic('');");
  expect(schedule).toContain("setMessage('');setPhonePage('study');setAssistantMinimized(false);setAssistantOpen(true);");
  expect(schedule).toContain('disabled={overviewBusy}');
  expect(schedule).toContain('一起看今天');
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
  expect(schedule).toContain('assistantTopic.slice(0,8000)');
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
  expect(schedule).toContain("isTimerTab:true, // caller already exits on the separate legacy PDF tab");
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
  expect(schedule).toContain('coachPrompt && tab!==\'study\'');
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
  expect(schedule).toContain('aria-label="打开 Char 悬浮手机"');
  expect(schedule).toContain('companionEntryPrompt(actual,activeTask?.title');
  expect(schedule).toContain('createdAt:Date.now()');
  expect(schedule).not.toContain('aria-label="在自习室和当前 Char 继续陪伴"');
  const open=schedule.split('const openCompanionOverview=async()=>{')[1]?.split('const discuss =')[0]||'';
  expect(open).toContain('const draft=companionEntryPrompt(');
  expect(open).not.toContain('sendNote()');
  expect(open).not.toContain('fetch(');
 });

 it('返回课程表或专注页，同一个 Char 只延续最近 30 分钟自己的 PDF 章节',()=>{
  expect(schedule).toContain('setRecentStudyByChar(prev=>({...prev,[charId]:{...value,seenAt:Date.now()}}))');
  expect(schedule).toContain('recentStudyByChar[charId]');
  expect(schedule).toContain('Date.now()-lastStudy.seenAt<30*60000');
  expect(schedule).toContain('pdfLearning:tab===\'study\'?studyPresence:recentPdf?');
  expect(schedule).toContain('刚一起看过《');
  expect(schedule).toContain("const draft=companionEntryPrompt(");
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

 it('真正主动 AI 仅在学习室单独授权，按事件去重且关闭/离开/后台中止',()=>{
   expect(schedule).toContain('checked={coachSetting.allowAutoAI}');
   expect(schedule).toContain('updateCoachSetting({allowAutoAI:e.target.checked})');
   expect(schedule).toContain('使用你的模型额度');
   const proactive=schedule.split('// The optional paid model request is separate')[1]?.split('  useEffect(() => {\n    if (!session')[0]||'';
   expect(proactive).toContain('coachSetting.allowAutoAI');
   expect(proactive).toContain('!workspaceSnapshot');
   expect(proactive).toContain("tab==='study'");
   expect(proactive).toContain("document.visibilityState!=='visible'");
   expect(proactive).toContain('isStudyCoachQuietTime(coachSetting,clock)');
   expect(proactive).toContain('autoCoachAttempted.current.add(key)');
   expect(proactive).toContain('controller.abort()');
   expect(proactive).toContain('notesForStudyContext(notes,chosen.id,\'overview\')');
   expect(proactive).toContain("role:'assistant',content:answer");
   expect(proactive).toContain("scope:'overview'");
   expect(proactive).not.toContain('ActiveMsgClient');
   expect(proactive).not.toContain('loadWorkspacePrivateChatBlock');
   expect(schedule).toContain('学习室提醒</strong>');
   expect(schedule).toContain('Revalidate the visible cue against freshly confirmed workspace changes');
   expect(schedule).toContain('current.key!==coachEventByChar[charId]?.key');
   expect(schedule).toContain('autoCoachController.current?.abort()');
 });

 it('真陪伴审计：跨分区不打断表单，真实主动消息可辨识且上下文不丢',()=>{
   expect(schedule).toContain("['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName||'')");
   expect(schedule).toContain("isTimerTab:true, // caller already exits on the separate legacy PDF tab");
   expect(schedule).toContain('seenEventKeys:sameDay?seen.seenKeys:[]');
   expect(schedule).toContain('rememberStudyCoachEvent(');
   expect(schedule).toContain("origin:'auto_coach'");
   expect(schedule).toContain("n.origin==='auto_coach'&&<span");
   expect(schedule).toContain("if(requestScope!=='overview')setAssistantTopic('')");
   expect(schedule).toContain("continuing?'':draft");
   expect(schedule).toContain("assistantOpen&&assistantScope==='overview'&&message.trim()?message");
   expect(study).toContain("tutorCharId:activeCourse.tutorCharId||selectedChar?.id");
   expect(schedule).toContain('最近在看《');
   expect(schedule).not.toContain('const companionStatus=coachPrompt||(');
 });

 it('切换 Char/话题时旧请求立即取消，不会晚到后混入新角色的对话',()=>{
   expect(schedule).toContain('const manualChatController=useRef<AbortController|null>(null)');
   expect(schedule).toContain('manualChatController.current?.abort()');
   expect(schedule).toContain('manualChatController.current=controller');
   expect(schedule).toContain('signal:controller.signal');
   expect(schedule).toContain('controller.signal.aborted||requestVersion!==discussionVersion.current');
   expect(schedule).toContain('if(!controller.signal.aborted)addToast(');
   expect(schedule).toContain('if(manualChatController.current===controller)manualChatController.current=null');
 });

 it('学习室悬浮聊天是小手机尺寸、独立对话气泡并支持收起和拖动',()=>{
   expect(schedule).toContain('data-study-floating-chat');
   expect(schedule).toContain('aria-modal="false" aria-label="Char 手机私聊"');
   expect(schedule).toContain('pointer-events-none absolute inset-0 z-[80]');
   expect(schedule).not.toContain('absolute inset-0 z-[80] bg-black/40 flex items-end');
   expect(schedule).toContain('className="home-phone study-room-phone"');
   expect(schedule).toContain('study-phone-screen');
   expect(schedule).toContain('onPointerDown={onAssistantDragStart}');
   expect(schedule).toContain('onPointerMove={onAssistantDragMove}');
   expect(schedule).toContain('onPointerUp={onAssistantDragEnd}');
   expect(schedule).toContain('(!assistantOpen||assistantMinimized)');
   expect(schedule).toContain('onClick={()=>{setAssistantPickerOpen(false);setAssistantMinimized(true);}}');
   expect(schedule).toContain('aria-label="打开 Char 悬浮手机"');
   expect(schedule).toContain("n.role==='user'?'justify-end':'justify-start'");
   expect(schedule).toContain("n.origin==='auto_coach'");
   expect(schedule).toContain('aria-label="快速选择 Char"');
   expect(schedule).toContain('onSelect={chooseChar}');
 });
 it('手机内直接嵌入真正私聊的原组件，不改变提示词，不绕过专注聊天额度',()=>{
   expect(schedule).toContain("const NativeChat = React.lazy(() => import('./Chat'))");
   expect(schedule).toContain("registerEmbeddedChatView(charId)");
   expect(schedule).toContain("homePhone={{characterId:charId,getContext:blankPhoneContext,onBack:()=>setAssistantMinimized(true),hideHeader:true}}");
   expect(schedule).toContain("const blankPhoneContext=useCallback(()=>'',[])");
   expect(schedule).toContain("!session&&phonePage==='private'&&activeChar");
   expect(schedule).toContain("session?'study':'private'");
   expect(schedule).toContain("disabled={!!session}");
   expect(schedule).toContain('aria-label="学习室限额消息"');
   expect(schedule).toContain('focusChatAllowance(session, Date.now())');
   expect(schedule).not.toContain('openApp(AppID.Chat)');
   expect(schedule).not.toContain('onClick={openSelectedPrivateChat}');
   expect(schedule).not.toContain('与 Char 陪伴交流 <ArrowRight');
   expect(schedule).toContain('setPhonePage(\'study\')');
 });;


 it('手机外壳与真正私聊继续独立，保留悬浮球和原有私聊数据路径',()=>{
   expect(schedule).toContain('aria-label="打开 Char 悬浮手机"');
   expect(schedule).toContain('className="study-room-float-ball"');
   expect(schedule).toContain('className="home-phone study-room-phone"');
   expect(schedule).toContain('study-phone-speaker');
   expect(schedule).toContain('study-phone-homebar');
   expect(studyPhoneCss).toContain('border:5px solid #252525');
   expect(studyPhoneCss).toContain('width:min(306px,calc(100% - 30px),calc((100dvh - 140px)*0.5625))');
   expect(studyPhoneCss).toContain('aspect-ratio:9 / 16;height:auto;min-height:0;max-height:none');
   expect(nativeChat).toContain('homePhone?.characterId??osActiveCharacterId');
   expect(nativeChat).toContain('hideHeader?:boolean');
   expect(schedule).toContain("getContext:blankPhoneContext");
   expect(schedule).toContain("const blankPhoneContext=useCallback(()=>'',[])");
   expect(schedule).not.toContain("openApp(AppID.Chat)");
   expect(schedule).not.toContain('与 Char 陪伴交流');
   expect(schedule).toContain("!session&&phonePage==='private'&&activeChar");
 });
 it('320/349/360/390/430 和宽屏：手机比例不被压扁，也不超出屏幕',()=>{
   for(const [w,h] of [[320,568],[349,768],[360,740],[390,844],[430,932],[698,768]]){
      const phoneWidth=Math.min(306,w-30,(h-140)*0.5625);
      const phoneHeight=phoneWidth*16/9;
      const bottom=h<=620?76:100;
      expect(phoneHeight/phoneWidth).toBeCloseTo(16/9,5);
      expect(phoneWidth).toBeLessThanOrEqual(w-30);
      expect(phoneHeight+bottom).toBeLessThan(h);
   }
   const screenshotWidth=Math.min(306,349-30,(768-140)*0.5625);
   expect(screenshotWidth).toBeGreaterThanOrEqual(300);
   expect(studyPhoneCss).not.toContain('width:min(218px');
   expect(studyPhoneCss).not.toContain('width:min(232px');
   expect(studyPhoneCss).toContain('font-size:17px!important');
   expect(studyPhoneCss).toContain('line-height:1.55!important');
   expect(studyPhoneCss).toContain('font-size:21px!important');
   const shortFont=21*((Math.min(306,320-30,(568-140)*0.5625)-22)/300);
   expect(shortFont).toBeGreaterThanOrEqual(15);
   expect(schedule).toContain('<NotePencil size={17}/>');
 });
 it('真实私聊按300px逻辑宽度排版，常见手机的实际聊天文字至少约15px',()=>{
   expect(schedule).toContain('const nativePhoneWidth=300;');
   expect(schedule).toContain('new ResizeObserver(measure)');
   expect(schedule).toContain('width:nativePhoneWidth');
   expect(schedule).toContain('height:Math.ceil(nativeViewportSize.height/nativePhoneScale)');
   expect(schedule).toContain('transform:\`scale(\${nativePhoneScale})\`');
   expect(schedule).toContain('ref={nativePhoneViewport} className="study-phone-native-viewport"');
   expect(schedule).toContain('className="study-phone-native-canvas"');
   expect(studyPhoneCss).toContain('transform-origin:top left');
   expect(studyPhoneCss).toContain('position:absolute;inset:0;overflow:hidden');
   expect(studyPhoneCss).toContain('width:100%!important;height:100%!important');
   for(const [w,h] of [[349,768],[360,740],[390,844],[430,932]]){
     const phoneWidth=Math.min(306,w-30,(h-140)*0.5625);
     const interior=phoneWidth-22;
     const scale=interior/300;
     expect(300*scale).toBeCloseTo(interior);
     expect(17*scale).toBeGreaterThanOrEqual(15);
   }
   expect(studyPhoneCss).toContain('.study-room-phone .sully-chat-inputbar textarea');
   expect(studyPhoneCss).not.toContain('font-size:7px');
 });

});
