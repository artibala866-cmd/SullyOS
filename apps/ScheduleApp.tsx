import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { ContextBuilder } from '../utils/context';
import WorkspacePanel from './WorkspacePanel';
import StudyCharPicker from './StudyCharPicker';
import StudyAvatar from './StudyAvatar';
import {ArrowRight,ChartBar,Pause,Play,Stop,Target,NotePencil,PenNib,CalendarDots,BookOpen} from '@phosphor-icons/react';
import {notesForStudyContext,legacyUnscopedStudyNotes,legacyUnattributedStudyNotes,type FocusChatNote,type StudyDialogueScope} from '../utils/studyRoomFocusNotes';
import {resolveDialogueApi} from '../utils/characterApi';
import {buildCompanionOverview,companionMomentText} from '../utils/studyRoomCompanion';
import { focusChatAllowance, newWorkspaceId, readWorkspace, type WorkKind, type WorkspaceData } from '../utils/sullyWorkspace';
import {
  createCommissionPlanRequest, parseCommissionPlanReply,
  type CommissionPlanPreview, type CommissionPlanRequest,
} from '../utils/commissionPlanProposals';
const StudyApp = React.lazy(() => import('./StudyApp'));

import { safeResponseJson, extractContent } from '../utils/safeApi';

type FocusTask = { id: string; title: string; done: boolean; sessions: number; source?: {kind:WorkKind;id:string} };
type FocusRecord = { date: string; minutes: number; taskId: string; sessionId?: string };
type FocusMode = 'focus' | 'break';
type Session = { id?: string; mode: FocusMode; deadline: number; duration: number; taskId: string; pauseRemainingMs?: number; usedChatWindows?: number[] };
type Note = FocusChatNote;
const STORAGE = 'sully_pomodoro_v1';
const EXIT_PHRASE = '真的要退出学习吗';
const pad = (n: number) => String(n).padStart(2, '0');
const today = () => new Date().toLocaleDateString('sv-SE');
const load = <T,>(key: string, fallback: T): T => {
  try { const raw = localStorage.getItem(STORAGE + '_' + key); return raw ? JSON.parse(raw) as T : fallback; }
  catch { return fallback; }
};
const save = (key: string, value: unknown) => {
  try { localStorage.setItem(STORAGE + '_' + key, JSON.stringify(value)); } catch { /* storage disabled */ }
};

const ScheduleApp: React.FC = () => {
  const { closeApp, characters, activeCharacterId, addToast, apiConfig, userProfile } = useOS();
  const [tasks, setTasks] = useState<FocusTask[]>(() => load('tasks', []));
  const [records, setRecords] = useState<FocusRecord[]>(() => load('records', []));
  const [taskInput, setTaskInput] = useState('');
  const [selectedTask, setSelectedTask] = useState(() => load('selectedTask', ''));
  const [charId, setCharId] = useState(() => load('charId', activeCharacterId || ''));
  const [focusMinutes, setFocusMinutes] = useState(() => load('focusMinutes', 25));
  const [breakMinutes, setBreakMinutes] = useState(() => load('breakMinutes', 5));
  const [session, setSession] = useState<Session | null>(() => load('session', null));
  const [now, setNow] = useState(Date.now());
  const [exitOpen, setExitOpen] = useState(false);
  const [exitPhrase, setExitPhrase] = useState('');
  const [exitDeadline, setExitDeadline] = useState(0);
  const [tab, setTab] = useState<'timer' | 'tasks' | 'stats' | 'commissions' | 'calendar' | 'study'>('timer');
  const [workspaceVisited,setWorkspaceVisited]=useState(false);
  const mainScrollRef=useRef<HTMLElement|null>(null);
  const tabScrollOffsets=useRef<Record<string,number>>({});
  const [studyTargetCourseId, setStudyTargetCourseId] = useState<string | null>(null);
  const [studyReturnTab,setStudyReturnTab] = useState<'timer'|'commissions'|'calendar'>('timer');
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [companionMoment,setCompanionMoment]=useState('');
  const [recentLinkedFocus,setRecentLinkedFocus]=useState<{kind:WorkKind;title:string;minutes:number;sessionId:string}|null>(null);
  const [overviewBusy,setOverviewBusy]=useState(false);
  const [showCharPicker,setShowCharPicker]=useState(false);
  const [assistantTopic, setAssistantTopic] = useState('');
  const [assistantScope,setAssistantScope]=useState<StudyDialogueScope>('focus');
  const [assistantItemId,setAssistantItemId]=useState('');
  const [planRequest, setPlanRequest] = useState<CommissionPlanRequest | null>(null);
  const [planPreview, setPlanPreview] = useState<CommissionPlanPreview | null>(null);
  const [focusLock, setFocusLock] = useState<boolean>(() => load('lock', false));
  const [notes, setNotes] = useState<Note[]>(() => {
    const saved=load<unknown>('notes',[]);
    return Array.isArray(saved) ? saved.filter((n):n is Note=>n
      && typeof n.id==='string' && (n.role==='user'||n.role==='assistant')
      && typeof n.content==='string') : [];
  });
  const [message, setMessage] = useState('');
  const [replying, setReplying] = useState(false);
  const processed = useRef<string | null>(null);
  const chatBusy = useRef(false);
  const discussionVersion = useRef(0);
  const activeChar = characters.find(c => c.id === charId);
  const visibleNotes = notesForStudyContext(notes,charId,assistantScope,assistantItemId);
  const unassignedNotes = legacyUnattributedStudyNotes(notes);
  const unscopedNotes = legacyUnscopedStudyNotes(notes,charId);
  const selectedDialogueApi = resolveDialogueApi(apiConfig,activeChar);
  const remaining = session ? Math.max(0, Math.ceil((session.pauseRemainingMs ?? (session.deadline - now)) / 1000)) : (focusMinutes * 60);
  const allowance = focusChatAllowance(session, now);
  const activeTask = tasks.find(t => t.id === (session?.taskId || selectedTask));
  const todayRecords = records.filter(r => r.date === today());
  const totalToday = todayRecords.reduce((sum, r) => sum + r.minutes, 0);
  const linkedFocusTotals = tasks.filter(t=>t.source).map(task=>({
    task,minutes:records.filter(r=>r.taskId===task.id)
      .reduce((sum,r)=>sum+(Number.isFinite(r.minutes)?r.minutes:0),0),
  })).filter(row=>row.minutes>0);
  const shell = 'rounded-[26px] bg-white shadow-[0_8px_30px_rgba(18,18,18,0.035)]';
  const inset = 'rounded-xl bg-[#fafafa] border border-neutral-200';
  const btn = 'rounded-xl border border-[#dedede] bg-[#f0f0f0] px-3 py-2.5 text-sm font-medium text-[#292929] disabled:opacity-40 active:scale-[.98] transition-transform';
  const weeklyFocus=Array.from({length:7},(_,i)=>{
    const day=new Date(now);
    day.setDate(day.getDate()-(6-i));
    const key=day.toLocaleDateString('sv-SE');
    return {key,minutes:records.filter(r=>r.date===key).reduce((sum,r)=>sum+r.minutes,0)};
  });
  const maxWeekFocus=Math.max(25,...weeklyFocus.map(day=>day.minutes));
  // Do not rerender large forms twice per second while editing orders/classes.
  useEffect(()=>{
    if(tab!=='timer' && !assistantOpen && !exitOpen)return;
    const refresh=()=>setNow(Date.now());
    refresh();
    const timer=window.setInterval(refresh,1000);
    document.addEventListener('visibilitychange',refresh);
    return ()=>{
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange',refresh);
    };
  },[tab,assistantOpen,exitOpen]);
  // A single deadline wake-up still settles sessions while the other tabs are open.
  useEffect(()=>{
    if(!session || session.pauseRemainingMs!=null || tab==='timer' || assistantOpen || exitOpen)return;
    const wait=session.deadline-Date.now();
    if(wait<=0){setNow(Date.now());return;}
    const timer=window.setTimeout(()=>setNow(Date.now()),wait+20);
    return ()=>window.clearTimeout(timer);
  },[session?.deadline,session?.pauseRemainingMs,tab,assistantOpen,exitOpen]);
  useEffect(()=>{if(tab==='calendar'||tab==='commissions')setWorkspaceVisited(true);},[tab]);
  useLayoutEffect(()=>{
    if(mainScrollRef.current)mainScrollRef.current.scrollTop=tabScrollOffsets.current[tab]??0;
  },[tab]);
  useEffect(() => { save('tasks', tasks); }, [tasks]);
  useEffect(() => { save('records', records); }, [records]);
  useEffect(() => { save('selectedTask', selectedTask); }, [selectedTask]);
  useEffect(() => { save('charId', charId); }, [charId]);
  useEffect(() => { save('focusMinutes', focusMinutes); }, [focusMinutes]);
  useEffect(() => { save('breakMinutes', breakMinutes); }, [breakMinutes]);
  useEffect(() => { save('session', session); }, [session]);
  useEffect(() => { save('notes', notes); }, [notes]);
  useEffect(() => { save('lock', focusLock); }, [focusLock]);
  useEffect(() => {
    if (!session || session.pauseRemainingMs != null || now < session.deadline) return;
    const id = session.id || String(session.deadline);
    if (processed.current === id) return;
    processed.current = id;
    // Settle synchronously into the legacy keys BEFORE clearing the session.
    // Reloading or two effect invocations cannot double-credit the same round.
    if (session.mode === 'focus') {
      const stored = load<FocusRecord[]>('records', []);
      if (!stored.some(r => r.sessionId === id)) {
        const completedTask=load<FocusTask[]>('tasks',[]).find(t=>t.id===session.taskId);
        if(completedTask?.source){
          setRecentLinkedFocus({kind:completedTask.source.kind,title:completedTask.title,minutes:session.duration,sessionId:id});
        }
        const date = new Date(session.deadline).toLocaleDateString('sv-SE');
        const updatedRecords = [...stored, { date, minutes: session.duration, taskId: session.taskId, sessionId: id }];
        save('records', updatedRecords);
        setRecords(updatedRecords);
        const storedTasks = load<FocusTask[]>('tasks', []);
        const updatedTasks = storedTasks.map(t => t.id === session.taskId ? { ...t, sessions: t.sessions + 1 } : t);
        save('tasks', updatedTasks);
        setTasks(updatedTasks);
      }
      addToast('专注完成，可以休息了', 'success');
      setCompanionMoment('这轮专注完成啦。可以休息一下，或和 Char 聊聊刚才的进展。');
    } else {
      addToast('休息结束，准备下一轮', 'success');
      setCompanionMoment('休息结束啦。想继续刚才的任务，可以再开始一轮。');
    }
    save('session', null);
    setSession(null);
  }, [session, now, addToast]);
  useEffect(() => {
    if (!session) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [session]);
  const addTask = () => {
    const title = taskInput.trim();
    if (!title) return;
    const id = String(Date.now()) + Math.random().toString(36).slice(2);
    setTasks(prev => [...prev, { id, title, done: false, sessions: 0 }]);
    setSelectedTask(id);
    setTaskInput('');
  };
  const start = (mode: FocusMode) => {
    if (mode === 'focus' && !selectedTask) { addToast('请先选择或创建任务', 'error'); setTab('tasks'); return; }
    const duration = mode === 'focus' ? focusMinutes : breakMinutes;
    processed.current = null;
    setCompanionMoment('');
    setRecentLinkedFocus(null);
    setSession({ id: newWorkspaceId(), mode, duration, deadline: Date.now() + duration * 60000, taskId: selectedTask, usedChatWindows: [] });
    setTab('timer');
  };
  const requestExit = () => {
    if (!session) { closeApp(); return; }
    setExitPhrase('');
    setExitDeadline(Date.now() + 10_000);
    setExitOpen(true);
  };
  const stop = (exitApp: boolean) => {
    // Explicit interruption is never a completed session.
    save('session', null);
    setSession(null);
    setExitOpen(false);
    if (exitApp) closeApp();
  };
  const pause = () => setSession(prev => prev && prev.pauseRemainingMs == null
    ? {...prev, pauseRemainingMs: Math.max(0, prev.deadline - Date.now())} : prev);
  const resume = () => setSession(prev => prev && prev.pauseRemainingMs != null
    ? {...prev, deadline: Date.now() + prev.pauseRemainingMs, pauseRemainingMs: undefined} : prev);
  const switchTab = (next: typeof tab) => {
    if (focusLock && session?.mode === 'focus' && session.pauseRemainingMs == null && next !== 'timer') {
      addToast('专注保护已开启。请暂停或中断本轮再切换区域。', 'error');
      return;
    }
    if (next === 'study') {
      setStudyTargetCourseId(null);
      setStudyReturnTab(tab==='commissions' || tab==='calendar'?tab:'timer');
    }
    if(mainScrollRef.current)tabScrollOffsets.current[tab]=mainScrollRef.current.scrollTop;
    setTab(next);
  };
  const openLinkedStudyCourse=(courseId:string)=>{
    if (!courseId) return;
    if (focusLock && session?.mode==='focus' && session.pauseRemainingMs==null) {
      addToast('专注保护开启中，请先暂停或中断后打开自习室','error');
      return;
    }
    setStudyReturnTab('calendar');
    setStudyTargetCourseId(courseId);
    setTab('study');
  };
  const startLinked = (kind:WorkKind, id:string, title:string) => {
    // A running (even paused) round belongs to its original taskId.
    // Do not silently select a new source item until that round finishes.
    if (session) {
      addToast('已有专注或休息轮次进行中，请先完成或中断，再切换到这项任务', 'error');
      setTab('timer');
      return;
    }
    const existing = tasks.find(t=>t.source?.kind===kind && t.source.id===id);
    const taskIdForNewLinkedWork=existing?.id||newWorkspaceId();
    if (existing) {
      // A linked task may be marked done only inside the focus checklist.
      // Reopen it when the original homework/commission is chosen again.
      if(existing.done)setTasks(prev=>prev.map(t=>t.id===existing.id?{...t,done:false}:t));
      setSelectedTask(existing.id);
    }
    else {
      const task:FocusTask={id:taskIdForNewLinkedWork,title,done:false,sessions:0,source:{kind,id}};
      setTasks(prev=>[...prev,task]);
      setSelectedTask(task.id);
    }
    // Starting from an actionable work card requires only one deliberate tap.
    processed.current=null;
    setCompanionMoment('');
    setRecentLinkedFocus(null);
    setSession({
      id:newWorkspaceId(),mode:'focus',duration:focusMinutes,
      deadline:Date.now()+focusMinutes*60000,
      taskId:existing?.id||taskIdForNewLinkedWork,usedChatWindows:[],
    });
    setTab('timer');
  };
  const chooseChar = (id:string) => {
    if (id===charId) {setShowCharPicker(false);return;}
    discussionVersion.current += 1;
    setCharId(id);
    setShowCharPicker(false);
    // Never transfer one Char's user-selected context to another Char.
    setAssistantTopic('');
    // First-time selection from the shared companion keeps the overview tab,
    // but never carries another Char's message or unreviewed context.
    setAssistantScope(assistantOpen && assistantScope==='overview'?'overview':'focus');
    setAssistantItemId('');
    setPlanRequest(null);
    setPlanPreview(null);
    setMessage('');
  };
  const openCompanionOverview=async()=>{
    if(overviewBusy)return;
    if(!activeChar){
      setAssistantScope('overview');setAssistantItemId('');setAssistantTopic('');
      setMessage('');setAssistantOpen(true);
      addToast('请先在学习室陪伴对话框中选择 Char','info');return;
    }
    const version=++discussionVersion.current;
    setOverviewBusy(true);
    try{
      // Read only on a deliberate user action; no paid AI call yet.
      const workspace=await readWorkspace();
      if(version!==discussionVersion.current)return;
      setPlanRequest(null);setPlanPreview(null);
      setAssistantScope('overview');setAssistantItemId('');
      setAssistantTopic(buildCompanionOverview(workspace,session,activeTask?.title||''));
      setMessage('陪我一起看看现在先做什么比较好？');
      setAssistantOpen(true);
    }catch(e){addToast('无法读取今天的学习室计划：'+String(e),'error');}
    finally{setOverviewBusy(false);}
  };
  const discuss = (topic:string,scope:'study'|'commission',itemId='') => {
    if(!activeChar){addToast('请先选择 Char 再发起讨论','error');return;}
    discussionVersion.current += 1;
    setPlanRequest(null);
    setPlanPreview(null);
    setAssistantScope(scope);
    setAssistantItemId(itemId);
    setAssistantTopic(topic);
    setMessage(scope==='study'?'请根据我提供的作业或笔记追问我，帮我复盘。':'请根据当前画稿进度建议下一步。');
    setAssistantOpen(true);
  };
  const proposeCommissionPlan = (workspace: WorkspaceData) => {
    try {
      discussionVersion.current += 1;
      const request=createCommissionPlanRequest(workspace,charId);
      setPlanRequest(request);
      setPlanPreview(null);
      setAssistantScope('plan');
      setAssistantItemId('');
      setAssistantTopic(request.prompt);
      setMessage('请按上述 JSON 格式给出一份待我逐项审核的排单方案。');
      setAssistantOpen(true);
    } catch(error) {
      addToast(error instanceof Error ? error.message : '无法整理排单资料','error');
    }
  };
  const sendNote = async () => {
    const content = message.trim();
    if (!content || replying || chatBusy.current) return;
    if (!activeChar) { addToast('请先选择 Char', 'error'); return; }
    if (planRequest && planRequest.charId!==charId) {
      addToast('这份排单请求绑定了原 Char，请重新选择或重新生成','error');
      return;
    }
    if (!selectedDialogueApi.apiKey || !selectedDialogueApi.model || !selectedDialogueApi.baseUrl) {
      addToast('当前 Char 的对话 API 配置不完整，请检查神经链接或全局 AI 设置','error');
      return;
    }
    const gate = focusChatAllowance(session, Date.now());
    if (!gate.canSend) { addToast('本五分钟窗口的交流机会已用完，或计时已暂停', 'error'); return; }
    chatBusy.current = true;
    const requestVersion=discussionVersion.current;
    if (session?.mode === 'focus') {
      // Reserve the slot before any await. Persist even if request fails or page reloads.
      const nextSession = {
        ...session, usedChatWindows: [...new Set([...(session.usedChatWindows || []), gate.currentWindow])],
      };
      save('session', nextSession);
      setSession(nextSession);
    }
    const requestScope=assistantScope;
    const requestItemId=assistantItemId;
    const note:Note={id:newWorkspaceId(),role:'user',content,charId:activeChar.id,
      scope:requestScope,topicId:requestItemId};
    const history:Note[]=[...notesForStudyContext(notes,activeChar.id,requestScope,requestItemId),note];
    setNotes(prev=>[...prev,note]);
    setMessage('');
    setReplying(true);
    try {
      const phase = session?.mode === 'focus' ? '正在专注' : session?.mode === 'break' ? '正在休息' : '未计时';
      const taskContext = requestScope==='focus'
        ? '当前专注任务：'+(activeTask?.title||'自由专注')+'；状态：'+phase+
          '；剩余约 '+Math.ceil(remaining/60)+' 分钟。'
        : '本次只处理用户主动提交的专题，不引用其他任务或未授权资料。';
      const appContext = '你在学习室应用内帮助用户。保持角色身份自然回应，不要自动催促，也不能替用户把作业标为完成、委托标为交付。'
        + taskContext
        + (assistantTopic ? '用户主动请求讨论的工作信息：' + assistantTopic.slice(0, 12000) : '');
      const msgs = await ContextBuilder.buildCharacterRequest(
        {char:activeChar,user:userProfile},
        [{role:'system',content:appContext},...history.slice(-16).map(n=>({role:n.role,content:n.content}))],
      );
      const response = await fetch(selectedDialogueApi.baseUrl.replace(/\/$/, '')+'/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + selectedDialogueApi.apiKey },
        body: JSON.stringify({model:selectedDialogueApi.model,messages:msgs,
          temperature:typeof selectedDialogueApi.temperature==='number'?selectedDialogueApi.temperature:0.8}),
      });
      const data = await safeResponseJson(response);
      if (!response.ok) throw new Error(data?.error?.message || 'HTTP ' + response.status);
      const reply = extractContent(data);
      if (!reply?.trim()) throw new Error('AI 返回了空回复');
      setNotes(prev=>[...prev,{id:newWorkspaceId(),role:'assistant',content:reply.trim(),
        charId:activeChar.id,scope:requestScope,topicId:requestItemId}]);
      // A role/topic changed while the call was in flight: preserve the answer
      // only under its original Char, never turn it into a new role's proposal.
      if(requestVersion!==discussionVersion.current) return;
      if (planRequest) {
        try {
          // Read latest DB value: don't apply a response for stale edits.
          const current=await readWorkspace();
          const preview=parseCommissionPlanReply(reply,planRequest,current);
          if (preview.changes.length) {
            setPlanPreview(preview);
            setAssistantOpen(false);
            setTab('commissions');
            addToast('Char 提出了 '+preview.changes.length+' 项调整，请逐项勾选后再应用','success');
          } else {
            addToast('Char 没提出需要修改的项，原排单没有变化','info');
          }
          setPlanRequest(null);
          setAssistantTopic('');
        } catch(error) {
          addToast('建议未通过校验，排单没有修改：'+(error instanceof Error?error.message:String(error)),'error');
          setMessage('上轮建议格式无效，请严格按 changes JSON 格式重发，不要多余字段。');
        }
      } else {
        setAssistantTopic('');
      }
    } catch(e) {
      addToast('Char 回复失败：' + (e instanceof Error ? e.message : '请检查 API 配置'), 'error');
    } finally {
      chatBusy.current = false;
      setReplying(false);
    }
  };
  const companionStatus=companionMoment || companionMomentText(session,activeTask?.title||'',(records.length?records[records.length-1].minutes:0));
  return (
    <div className="relative h-full w-full overflow-hidden">
      {tab === 'study' && (
        <div className="relative h-full w-full overflow-hidden bg-white">
          <React.Suspense fallback={<p className="p-5">正在打开自习室…</p>}>
            <StudyApp highlightCourseId={studyTargetCourseId || undefined}
              onExit={() => {setTab(studyReturnTab);setStudyTargetCourseId(null);}} />
          </React.Suspense>
          <button type="button" disabled={overviewBusy}
            className="absolute right-3 bottom-16 z-[60] flex max-w-[85%] items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-2 shadow-lg text-xs disabled:opacity-60"
            aria-label="在自习室和当前 Char 继续陪伴"
            onClick={()=>void openCompanionOverview()}>
            <span className="grid h-7 w-7 place-items-center overflow-hidden rounded-full bg-neutral-100">
              <StudyAvatar value={activeChar?.avatar} name={activeChar?.name||'Char'} className="h-full w-full rounded-full"/>
            </span>
            <span className="min-w-0 truncate">{activeChar?.name||'选择 Char'} · 陪我学习</span>
          </button>
        </div>
      )}
      <div className={tab === 'study'
        ? 'hidden'
        : 'h-full w-full flex flex-col overflow-hidden bg-[#eeeeed] text-[#242424] font-sans'}
        style={{paddingTop:'var(--safe-top)'}}>
      <header className="shrink-0 mx-3 mt-2 sm:mx-6 rounded-[24px] bg-white px-3 sm:px-5 py-2.5 shadow-[0_6px_22px_rgba(0,0,0,.025)]">
        <div className="mx-auto max-w-6xl flex items-center justify-between gap-2.5">
          <button aria-label="返回" onClick={requestExit} className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-neutral-200 text-lg hover:bg-neutral-100">‹</button>
          <div className="flex-1 min-w-0"><h1 className="text-[20px] font-semibold leading-tight tracking-tight">学习室</h1>
          </div>
          <button type="button" aria-label="选择陪伴 Char" aria-expanded={showCharPicker}
            onClick={()=>setShowCharPicker(v=>!v)}
            className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full border border-neutral-200 bg-neutral-100 focus-visible:ring-2 focus-visible:ring-neutral-900">
            <StudyAvatar value={activeChar?.avatar} name={activeChar?.name||'Char'} className="h-full w-full rounded-full"/>
          </button>
        </div>
      </header>
      <div className="shrink-0 mx-3 mt-2 sm:mx-6 flex items-center justify-between gap-2 rounded-2xl bg-white/65 px-4 py-2 text-xs" aria-label="Char 持续陪伴状态">
        <p className="min-w-0 flex-1 truncate text-neutral-500" title={companionStatus}>
          <span className="inline-block mr-2 h-1.5 w-1.5 rounded-full bg-neutral-500 align-middle" aria-hidden="true"></span>
          <strong className="text-neutral-800">{activeChar?.name||'尚未选 Char'}</strong> <span className="hidden sm:inline">· {companionStatus}</span>
          <span className="sm:hidden">· 陪伴中</span>
        </p>
        <button type="button" disabled={overviewBusy} onClick={()=>void openCompanionOverview()}
          className="shrink-0 rounded-full border border-neutral-300 bg-neutral-50 px-3 py-1.5 text-xs font-medium disabled:opacity-50">
          {overviewBusy?'读取中…':'一起看今天'}
        </button>
      </div>
      <main ref={mainScrollRef} className="mx-auto w-full max-w-6xl flex-1 overflow-y-auto px-3 sm:px-6 py-3 sm:py-5 pb-5 space-y-3 sm:space-y-5">
        {showCharPicker&&<section className={shell + ' px-2.5 py-2'} aria-label="Char 头像角色栏">
          <StudyCharPicker compact characters={characters} selectedId={charId} onSelect={chooseChar}/>
        </section>}
        {tab === 'timer' && <section className="relative mx-auto w-full max-w-[510px] space-y-3 pb-2 sm:pt-3">
            
            <div className="flex items-center justify-between gap-2 px-1">
              <div className="flex min-w-0 items-center gap-2.5"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#242424] text-white"><Target size={20} weight="regular"/></span>
                <div className="min-w-0"><p className="text-[17px] font-semibold leading-tight">专注计时</p></div></div>
              <span className="shrink-0 rounded-full border border-neutral-200 bg-[#fafafa] px-2.5 py-1.5 text-xs text-neutral-600">{session?.mode==='break'?'休息中':session?.mode==='focus'?'沉浸进行中':'准备开始'}</span>
            </div>
            <div className="relative overflow-hidden rounded-[26px] bg-white px-4 py-4 sm:px-6 sm:py-8 text-center shadow-[0_12px_36px_rgba(0,0,0,0.035)]">
              <div className="font-sans font-semibold text-[clamp(48px,13vw,70px)] leading-none tracking-[-.055em] tabular-nums">{pad(Math.floor(remaining/60))}:{pad(remaining%60)}</div>
              <div className="mx-auto mt-2 sm:mt-5 h-1 w-full max-w-[260px] overflow-hidden rounded-full bg-[#e9e9e9]"><div className="h-full rounded-full bg-neutral-900 transition-[width]"
                style={{width:session?`${Math.max(0,Math.min(100,(1-remaining/(session.duration*60))*100))}%`:'0%'}}/></div>
              <p className="mt-3 sm:mt-5 text-[11px] text-neutral-500">当前任务</p>
              <p className="mt-1 line-clamp-1 text-[14px] font-semibold">{session?.mode==='break'?'好好休息一下':activeTask?.title||'选一件重要的事开始'}</p>
              <div className="mt-3 sm:mt-6 flex items-center justify-center gap-4">
                {session ? <>
                  <button className="grid h-11 w-11 place-items-center rounded-full border border-neutral-300 bg-white" aria-label={session.pauseRemainingMs!=null?'继续专注':'暂停专注'} onClick={session.pauseRemainingMs!=null?resume:pause}>
                    {session.pauseRemainingMs!=null?<Play size={22} weight="fill"/>:<Pause size={22} weight="fill"/>}</button>
                  <button className="grid h-[48px] w-[48px] place-items-center rounded-full bg-[#363636] text-white shadow-sm" aria-label="结束或退出本轮选项" title="选择留在学习室或退出" onClick={requestExit}><Stop size={22} weight="fill"/></button>
                </> : <>
                  <button className="min-h-11 rounded-full bg-[#f2f2f2] px-5 py-2 text-xs font-medium" onClick={()=>start('break')}>休息</button>
                  <button className="grid h-[50px] w-[50px] place-items-center rounded-full bg-[#232323] text-white shadow-sm" aria-label="开始专注" onClick={()=>start('focus')}><Play size={23} weight="fill"/></button>
                                  </>}
              </div>
              {session&&<p className="mt-2 text-xs text-neutral-600">结束先确认，未完成不计入记录。</p>}
              {!session&&<div className="mx-auto mt-2.5 flex max-w-xs items-center justify-center gap-2.5 text-xs text-neutral-600">
                <label className="flex items-center gap-2">专注<input type="number" aria-label="专注分钟" min={1} max={180} value={focusMinutes} onChange={e=>setFocusMinutes(Math.max(1,Math.min(180,Number(e.target.value)||1)))} className="w-11 rounded-lg border border-neutral-200 bg-white px-1 py-1.5 text-center outline-none"/></label>
                <label className="flex items-center gap-2">休息<input type="number" aria-label="休息分钟" min={1} max={60} value={breakMinutes} onChange={e=>setBreakMinutes(Math.max(1,Math.min(60,Number(e.target.value)||1)))} className="w-14 rounded-xl border border-neutral-200 bg-white p-2 text-center outline-none"/></label>
                <span className="text-neutral-400">分</span>
              </div>}
            </div>
            {!session && recentLinkedFocus && records.some(r=>r.sessionId===recentLinkedFocus.sessionId) &&
              <div role="status" className="rounded-xl border border-[#e5e5e5] bg-[#fafafa] px-3 py-3 text-sm">
                <p className="font-medium break-words">已完成 {recentLinkedFocus.minutes} 分钟 · {recentLinkedFocus.title}</p>
                <p className="mt-1 text-xs text-neutral-600">时长已记录。是否抵扣剩余工时，需要你在原事项中确认，不会自动完成作业或画稿。</p>
                <button type="button" className={btn+' mt-2 min-h-11'}
                  onClick={()=>switchTab(recentLinkedFocus.kind==='commission'?'commissions':'calendar')}>
                  去核对并手动结算
                </button>
              </div>}
            <div className="flex items-center gap-2 rounded-[20px] bg-white px-3 py-2 shadow-[0_4px_20px_rgba(0,0,0,.02)]">
              <select aria-label="当前任务" value={selectedTask} disabled={!!session} onChange={e=>setSelectedTask(e.target.value)} className={'min-w-0 flex-1 rounded-xl bg-[#f4f4f4] px-3 py-2.5 text-sm outline-none'}>
                <option value="">请选择今天的专注任务</option>
                {tasks.filter(t=>!t.done).map(t=><option value={t.id} key={t.id}>{t.title}</option>)}
              </select>
              <button type="button" aria-label="打开任务清单" title="任务清单" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#f4f4f4]"
                onClick={()=>switchTab('tasks')}><NotePencil size={19}/></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex min-h-[80px] sm:min-h-[100px] flex-col justify-between rounded-[20px] bg-white p-3 sm:p-4 shadow-[0_4px_20px_rgba(0,0,0,.02)]">
                <div className="flex items-center justify-between"><span className="text-xs text-neutral-500">今日专注</span><Target size={19} weight="light"/></div>
                <p className="text-[25px] sm:text-[30px] font-semibold tabular-nums leading-none">{totalToday}<span className="ml-1.5 text-xs font-normal text-neutral-500">min</span></p>
              </div>
              <button type="button" onClick={()=>switchTab('stats')} className="flex min-h-[80px] sm:min-h-[100px] flex-col justify-between rounded-[20px] bg-[#252525] p-3 sm:p-4 text-left text-white">
                <div className="flex items-center justify-between"><span className="text-xs text-white/70">专注轮次</span><ArrowRight size={19}/></div>
                <p className="text-[25px] sm:text-[30px] font-semibold tabular-nums leading-none">{todayRecords.length}<span className="ml-1.5 text-xs font-normal text-white/60">次</span></p>
              </button>
            </div>
            <div className="flex items-center justify-between gap-3 px-2 pt-1">
              <label className="flex min-w-0 items-center gap-2 text-xs text-neutral-600">
                <input type="checkbox" checked={focusLock} onChange={e=>setFocusLock(e.target.checked)}/>
                专注保护
              </label>
              <button type="button" className="flex shrink-0 items-center gap-1.5 rounded-xl border border-neutral-200 bg-[#f7f7f7] px-3 py-2 text-xs text-neutral-800"
                onClick={()=>{
                  discussionVersion.current+=1;
                  setPlanRequest(null);setAssistantTopic('');
                  setAssistantScope('focus');setAssistantItemId('');
                  setAssistantOpen(true);
                }}>与 Char 陪伴交流 <ArrowRight size={13}/></button>
            </div>
          </section>}
        {tab === 'tasks' && <section className={shell + ' p-5 space-y-4'}>
          <div className="flex items-center justify-between"><div><h2 className="text-xl font-semibold">任务清单</h2></div><NotePencil size={26} weight="light"/></div>
          <form onSubmit={e => { e.preventDefault(); addTask(); }} className="flex gap-2"><input aria-label="新任务" value={taskInput} onChange={e => setTaskInput(e.target.value)} placeholder="写下今天的目标" className={inset + ' min-w-0 flex-1 p-3 text-sm outline-none'} /><button className={btn} type="submit">添加</button></form>
          {tasks.length === 0 && <p className="text-sm text-[#999999] py-5 text-center">还没有任务</p>}
          {tasks.map(t => <div key={t.id} className={'rounded-2xl border p-4 flex items-center gap-3 text-sm '+(t.done?'border-neutral-100 bg-[#f5f5f5]':'border-neutral-200 bg-white')}>
            <input type="checkbox" aria-label={`完成${t.title}`} checked={t.done} onChange={e => setTasks(prev => prev.map(x => x.id === t.id ? { ...x, done: e.target.checked } : x))} />
            <button className={`min-w-0 flex-1 text-left break-words ${t.done ? 'line-through opacity-50' : ''}`} onClick={() => { setSelectedTask(t.id); setTab('timer'); }}>{t.title}<span className="block text-xs text-[#aaaaaa] mt-1">{t.sessions} 轮专注</span></button>
            {t.source && <button className="text-xs underline underline-offset-2 text-neutral-700"
              onClick={()=>switchTab(t.source!.kind==='commission'?'commissions':'calendar')}>
              查看原事项
            </button>}
            <button aria-label={`删除${t.title}`} className="px-2 text-[#aaaaaa]" onClick={() => {
              if(t.source && records.some(r=>r.taskId===t.id) &&
                !window.confirm('删除这个专注任务后，历史专注记录仍在，但将失去与原事项的关联，不能再自动结算。仍要删除？'))return;
              setTasks(prev => prev.filter(x => x.id !== t.id));
              if (selectedTask === t.id) setSelectedTask('');
            }}>×</button>
          </div>)}
        </section>}
        {tab === 'stats' && <section className={shell + ' p-5 space-y-5'}>
          <div className="flex items-center justify-between"><div><h2 className="text-xl font-semibold">专注统计</h2></div><ChartBar size={27} weight="light"/></div>
          <div className="grid grid-cols-2 gap-3"><div className={inset + ' p-4 text-center'}><div className="text-3xl">{totalToday}</div><div className="text-xs mt-2">今日分钟</div></div><div className={inset + ' p-4 text-center'}><div className="text-3xl">{todayRecords.length}</div><div className="text-xs mt-2">今日轮次</div></div></div>
          <div className="rounded-2xl bg-[#f5f5f5] px-5 py-4"><p className="text-xs text-neutral-400">累计专注</p><p className="mt-1 font-serif text-4xl tabular-nums">{records.reduce((sum,r)=>sum+r.minutes,0)}<span className="ml-2 text-xs font-sans text-neutral-500">分钟</span></p></div>
          <div className="grid grid-cols-7 gap-2 items-end h-32" aria-label="最近七天专注图">
            {weeklyFocus.map(day=><div className="flex flex-col h-full items-center justify-end gap-1" key={day.key}>
              <span className="text-xs text-neutral-600">{day.minutes||''}</span>
              <span title={day.key+' · '+day.minutes+' 分钟'} className="block w-full max-w-8 rounded-t-md bg-neutral-900" style={{height:day.minutes?Math.max(4,day.minutes/maxWeekFocus*85)+'px':'0px'}}/>
              <span className="text-xs text-neutral-400">{day.key.slice(-2)}</span>
            </div>)}
          </div>
          <div className="text-sm">专注清单已勾选：{tasks.filter(t => t.done).length} 项</div>
          <p className="text-xs text-neutral-600">专注清单勾选不等于原委托交付或作业完成；原事项须你单独确认。已完成轮次可在原事项中手动核算剩余时间。</p>
          {linkedFocusTotals.length>0 && <div className="space-y-2 border-t border-neutral-200 pt-3">
            <h3 className="text-sm font-semibold">专注记录与原事项</h3>
            {linkedFocusTotals.map(({task,minutes})=><div key={task.id}
              className="flex flex-wrap items-center justify-between gap-2 text-xs border-b border-neutral-100 pb-2">
              <span className="min-w-0 break-words">{task.source?.kind==='commission'?'画稿':'作业'} · {task.title} · {minutes} 分钟</span>
              <button className="underline underline-offset-2" onClick={()=>switchTab(task.source?.kind==='commission'?'commissions':'calendar')}>
                去核对进度
              </button>
            </div>)}
          </div>}
          <p className="text-xs text-[#aaaaaa]">仅统计完整结束的专注轮次；旧轮次如缺少唯一编号，不会自动抵扣。数据保存在当前浏览器。</p>
        </section>}
        {/* One persistent editor across sections: changing tabs no longer
            destroys unfinished course/commission forms or image previews. */}
        {workspaceVisited && <div className={tab==='commissions'||tab==='calendar'?'':'hidden'}>
          <WorkspacePanel visible={tab==='calendar'||tab==='commissions'} section={tab==='calendar'?'calendar':'commissions'}
            focusTasks={tasks} records={records}
            onFocus={startLinked} onDiscuss={discuss} onPlan={proposeCommissionPlan}
            planPreview={planPreview} onClearPlan={()=>setPlanPreview(null)}
            onOpenStudyCourse={openLinkedStudyCourse}
            selectedCharId={charId} onSelectChar={chooseChar}/>
        </div>}

      </main>
      <nav className="shrink-0 grid grid-cols-4 gap-1.5 mx-3 mb-2 rounded-[24px] bg-white px-2 py-1.5 shadow-[0_-3px_22px_rgba(0,0,0,0.035)]"
        style={{paddingBottom:'max(12px, var(--safe-bottom, 0px))'}}>
        {([['timer','专注'],['commissions','排单'],['calendar','课程表'],['study','自习室']] as const)
          .map(([id,title])=><button key={id} onClick={()=>switchTab(id)}
            className={'min-h-[52px] flex flex-col items-center justify-center gap-0.5 rounded-[16px] py-1.5 text-[11px] font-medium transition-colors '+(tab===id?'bg-[#252525] text-white':'text-neutral-500 hover:bg-[#f4f4f4]')}>
            {id==='timer'?<Target size={19}/>:id==='commissions'?<PenNib size={19}/>:id==='calendar'?<CalendarDots size={19}/>:<BookOpen size={19}/>}
            <span>{title}</span></button>)}
      </nav>
      {exitOpen && <div className="absolute inset-0 z-[100] bg-black/40 flex items-center justify-center p-6">
        <div className="w-full max-w-md max-h-[90dvh] overflow-y-auto bg-[#eeeeee] rounded-3xl p-6 space-y-4 shadow-xl">
          <h2 className="text-lg font-medium">结束当前计时轮次？</h2>
          <p className="text-sm">尚未完成的轮次不会计入专注成绩。可以继续、仅中断留在学习室，或者确认退出。</p>
          <div className="text-xs text-[#999999]">冷静倒计时：{Math.max(0, Math.ceil((exitDeadline - now) / 1000))} 秒</div>
          <input aria-label="退出确认文字" value={exitPhrase} onChange={e => setExitPhrase(e.target.value)} placeholder={EXIT_PHRASE} className="w-full p-3 bg-white rounded-xl text-sm" />
          <button className={btn + ' w-full'} onClick={() => setExitOpen(false)}>继续专注</button>
          <button className="w-full text-sm py-2 underline" onClick={() => stop(false)}>中断本轮，留在学习室</button>
          <button className="w-full py-2 text-sm disabled:opacity-30" disabled={exitPhrase.trim() !== EXIT_PHRASE || now < exitDeadline} onClick={() => stop(true)}>确认中断并退出</button>
          <button className="w-full text-xs underline" onClick={() => stop(true)}>紧急退出</button>
        </div>
      </div>}
      </div>
      {assistantOpen && <div className="absolute inset-0 z-[80] bg-black/40 flex items-end justify-center"
        onClick={()=>setAssistantOpen(false)}>
        <section className="bg-white text-neutral-900 w-full max-w-xl h-[78dvh] max-h-full min-h-0 rounded-t-2xl p-4 pb-[max(16px,var(--safe-bottom,0px))] flex flex-col gap-3"
          onClick={e=>e.stopPropagation()}>
          <div className="flex justify-between items-center">
            <h2 className="font-semibold text-sm">Char · 当前工作陪伴</h2>
            <button className="text-lg px-3" aria-label="关闭 Char" onClick={()=>setAssistantOpen(false)}>×</button>
          </div>
          <StudyCharPicker compact characters={characters} selectedId={charId} onSelect={chooseChar}/>
          {assistantScope==='overview' && <button type="button" disabled={!activeChar||overviewBusy}
            className="self-start rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-1.5 text-xs disabled:opacity-50"
            onClick={()=>void openCompanionOverview()}>
            {overviewBusy?'正在读取计划…':'查看最新学习和画稿计划'}
          </button>}
          <p className="text-xs text-neutral-500">{assistantScope==='focus'?'专注陪伴':assistantScope==='study'?'作业复盘':assistantScope==='commission'?'画稿建议':assistantScope==='overview'?'今日陪伴':'排单建议'}</p>
          {assistantTopic && <details className="text-xs rounded-lg border border-neutral-200 px-3 py-2">
            <summary className="cursor-pointer">发送内容</summary>
            <p className="mt-2 whitespace-pre-wrap break-words max-h-36 overflow-y-auto">{assistantTopic.slice(0,12000)}</p>
            {planRequest && <p>本轮只返回待审核的 JSON 方案，不自动改稿件。</p>}
          </details>}
          {session?.mode==='focus' && <p className="text-xs">本轮已交流 {allowance.used}/{allowance.limit} 次。
            {allowance.canSend?'当前五分钟窗口可交流':'当前窗口不可再交流'}</p>}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border border-neutral-200 rounded-lg p-3 space-y-2">
            {visibleNotes.length===0 && <p className="text-sm text-neutral-500">当前 Char 尚无学习室交流记录。</p>}
            {visibleNotes.map(n=><p key={n.id} className="text-sm whitespace-pre-wrap break-words">
              <span className="text-neutral-500">{n.role==='user'?'我':activeChar?.name||'Char'}：</span>{n.content}</p>)}
          </div>
          {unscopedNotes.length>0 && <details className="text-xs text-neutral-600">
            <summary>旧对话（{unscopedNotes.length}）</summary>
            <div className="max-h-24 overflow-auto whitespace-pre-wrap">
              {unscopedNotes.map(n=><p key={n.id}>{n.role==='user'?'我':'旧回复'}：{n.content}</p>)}
            </div>
          </details>}
          {unassignedNotes.length>0 && <details className="text-xs text-neutral-600">
            <summary>旧记录（{unassignedNotes.length}）</summary>
            <div className="max-h-24 overflow-auto whitespace-pre-wrap">
              {unassignedNotes.map(n=><p key={n.id}>{n.role==='user'?'我':'旧回复'}：{n.content}</p>)}
            </div>
          </details>}
          <form onSubmit={e=>{e.preventDefault();void sendNote();}} className="shrink-0 flex gap-2">
            <input className={inset+' min-h-11 flex-1 min-w-0 p-2 text-sm'} value={message} onChange={e=>setMessage(e.target.value)}
              aria-label="对 Char 说" placeholder="主动问 Char…"/>
            <button className={btn+' min-h-11'} disabled={replying || !allowance.canSend} type="submit">{replying?'回复中':'发送'}</button>
          </form>
        </section>
      </div>}
    </div>
  );
};
export default ScheduleApp;
