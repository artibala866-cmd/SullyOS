import React, { useEffect, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { ContextBuilder } from '../utils/context';
import WorkspacePanel from './WorkspacePanel';
import {notesForStudyChar,legacyUnattributedStudyNotes,type FocusChatNote} from '../utils/studyRoomFocusNotes';
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
  const [studyTargetCourseId, setStudyTargetCourseId] = useState<string | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantTopic, setAssistantTopic] = useState('');
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
  const visibleNotes = notesForStudyChar(notes,charId);
  const unassignedNotes = legacyUnattributedStudyNotes(notes);
  const remaining = session ? Math.max(0, Math.ceil((session.pauseRemainingMs ?? (session.deadline - now)) / 1000)) : (focusMinutes * 60);
  const allowance = focusChatAllowance(session, now);
  const activeTask = tasks.find(t => t.id === (session?.taskId || selectedTask));
  const todayRecords = records.filter(r => r.date === today());
  const totalToday = todayRecords.reduce((sum, r) => sum + r.minutes, 0);
  const linkedFocusTotals = tasks.filter(t=>t.source).map(task=>({
    task,minutes:records.filter(r=>r.taskId===task.id)
      .reduce((sum,r)=>sum+(Number.isFinite(r.minutes)?r.minutes:0),0),
  })).filter(row=>row.minutes>0);
  const shell = 'rounded-2xl bg-white border border-neutral-200';
  const inset = 'rounded-xl bg-white border border-neutral-300';
  const btn = 'rounded-xl px-4 py-3 text-sm font-medium bg-neutral-900 text-white disabled:opacity-40';
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 500); return () => window.clearInterval(id); }, []);
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
    } else {
      addToast('休息结束，准备下一轮', 'success');
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
    if (next === 'study') setStudyTargetCourseId(null);
    setTab(next);
  };
  const openLinkedStudyCourse=(courseId:string)=>{
    if (!courseId) return;
    if (focusLock && session?.mode==='focus' && session.pauseRemainingMs==null) {
      addToast('专注保护开启中，请先暂停或中断后打开自习室','error');
      return;
    }
    setStudyTargetCourseId(courseId);
    setTab('study');
  };
  const startLinked = (kind:WorkKind, id:string, title:string) => {
    const existing = tasks.find(t=>t.source?.kind===kind && t.source.id===id);
    if (existing) {
      // A linked task may be marked done only inside the focus checklist.
      // Reopen it when the original homework/commission is chosen again.
      if(existing.done)setTasks(prev=>prev.map(t=>t.id===existing.id?{...t,done:false}:t));
      setSelectedTask(existing.id);
    }
    else {
      const task:FocusTask={id:newWorkspaceId(),title,done:false,sessions:0,source:{kind,id}};
      setTasks(prev=>[...prev,task]);
      setSelectedTask(task.id);
    }
    setTab('timer');
  };
  const chooseChar = (id:string) => {
    if (id===charId) return;
    discussionVersion.current += 1;
    setCharId(id);
    // Never transfer one Char's user-selected context to another Char.
    setAssistantTopic('');
    setPlanRequest(null);
    setMessage('');
  };
  const discuss = (topic:string) => {
    discussionVersion.current += 1;
    setPlanRequest(null);
    setAssistantTopic(topic);
    setMessage('请根据当前信息给我建议。');
    setAssistantOpen(true);
  };
  const proposeCommissionPlan = (workspace: WorkspaceData) => {
    try {
      discussionVersion.current += 1;
      const request=createCommissionPlanRequest(workspace,charId);
      setPlanRequest(request);
      setPlanPreview(null);
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
    if (!apiConfig.apiKey || !apiConfig.model) { addToast('请先配置聊天 AI', 'error'); return; }
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
    const note:Note={id:newWorkspaceId(),role:'user',content,charId:activeChar.id};
    const history:Note[]=[...notesForStudyChar(notes,activeChar.id),note];
    setNotes(prev=>[...prev,note]);
    setMessage('');
    setReplying(true);
    try {
      const task = activeTask?.title || '自由专注';
      const phase = session?.mode === 'focus' ? '正在专注' : session?.mode === 'break' ? '正在休息' : '未计时';
      const appContext = '你在学习室应用内帮助用户。保持角色身份自然回应，不要自动催促，也不能替用户把作业标为完成。'
        + '当前任务：' + task + '；状态：' + phase + '；剩余约 ' + Math.ceil(remaining/60) + ' 分钟。'
        + (assistantTopic ? '用户主动请求讨论的工作信息：' + assistantTopic.slice(0, 12000) : '');
      const msgs = await ContextBuilder.buildCharacterRequest(
        {char:activeChar,user:userProfile},
        [{role:'system',content:appContext},...history.slice(-16).map(n=>({role:n.role,content:n.content}))],
      );
      const response = await fetch(apiConfig.baseUrl.replace(/\/$/, '')+'/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiConfig.apiKey },
        body: JSON.stringify({model:apiConfig.model,messages:msgs,temperature:0.8}),
      });
      const data = await safeResponseJson(response);
      if (!response.ok) throw new Error(data?.error?.message || 'HTTP ' + response.status);
      const reply = extractContent(data);
      if (!reply?.trim()) throw new Error('AI 返回了空回复');
      setNotes(prev=>[...prev,{id:newWorkspaceId(),role:'assistant',content:reply.trim(),charId:activeChar.id}]);
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
  if (tab === 'study') return (
    <div className="h-full w-full overflow-hidden bg-white">
      <React.Suspense fallback={<p className="p-5">正在打开自习室…</p>}>
        <StudyApp highlightCourseId={studyTargetCourseId || undefined}
          onExit={() => {setTab(studyTargetCourseId ? 'calendar' : 'timer');setStudyTargetCourseId(null);}} />
      </React.Suspense>
    </div>
  );
  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-[#fafafa] text-neutral-900 font-sans" style={{ paddingTop: 'var(--safe-top)' }}>
      <header className="px-5 pt-5 pb-4 flex items-center justify-between shrink-0">
        <button aria-label="返回" onClick={requestExit} className="text-2xl px-2">‹</button>
        <div className="text-xs tracking-[0.2em] font-semibold text-neutral-900">学习室 / FOCUS</div>
        <div className="w-8" />
      </header>
      <main className="flex-1 overflow-y-auto px-5 pb-8 space-y-5">
        {tab === 'timer' && <>
          <section className={shell + ' p-6 space-y-5'}>
            <div className="text-center text-xs tracking-widest text-[#999999]">{session?.mode === 'break' ? 'REST TIME' : 'STAY FOCUSED'}</div>
            <div className="text-center text-sm truncate">{session?.mode === 'break' ? '好好休息一下' : activeTask?.title || '先选择一项任务'}</div>
            <div className="text-center text-[62px] leading-none font-light tracking-wider tabular-nums">{pad(Math.floor(remaining / 60))}:{pad(remaining % 60)}</div>
            <div className="h-1.5 rounded-full bg-[#d6d6d6] overflow-hidden"><div className="h-full bg-[#888888] transition-all" style={{ width: session ? `${Math.max(0, Math.min(100, (1 - remaining / (session.duration * 60)) * 100))}%` : '0%' }} /></div>
            <div className="text-center text-xs text-[#999999]">{session ? session.mode === 'focus' ? '正在专注，请保持节奏' : '休息中' : '准备开始'}</div>
            {!session && <div className="grid grid-cols-2 gap-3">
              <label className="text-xs space-y-2">专注分钟<input aria-label="专注分钟" type="number" min={1} max={180} value={focusMinutes} onChange={e => setFocusMinutes(Math.max(1, Math.min(180, Number(e.target.value) || 1)))} className={inset + ' w-full p-3 text-center outline-none'} /></label>
              <label className="text-xs space-y-2">休息分钟<input aria-label="休息分钟" type="number" min={1} max={60} value={breakMinutes} onChange={e => setBreakMinutes(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} className={inset + ' w-full p-3 text-center outline-none'} /></label>
            </div>}
            {session ? <div className="grid grid-cols-2 gap-2">
              {session.pauseRemainingMs != null
                ? <button className={btn} onClick={resume}>继续</button>
                : <button className={btn} onClick={pause}>暂停</button>}
              <button className="border border-neutral-300 rounded-xl text-sm" onClick={requestExit}>中断本轮</button>
            </div> : <div className="grid grid-cols-2 gap-3"><button className={btn} onClick={() => start('focus')}>开始专注</button><button className={btn + ' !bg-[#aaaaaa]'} onClick={() => start('break')}>开始休息</button></div>}
            <button className="block mx-auto text-sm underline underline-offset-4" onClick={() => setAssistantOpen(true)}>
              {activeChar?.name || 'Char'} · 交流 {session?.mode==='focus' ? allowance.used+'/'+allowance.limit : '不限额'}
            </button>
          </section>
          <section className={shell + ' p-5 space-y-3'}>
            <div className="text-xs tracking-widest">当前任务</div>
            <select aria-label="当前任务" value={selectedTask} disabled={!!session} onChange={e => setSelectedTask(e.target.value)} className={inset + ' w-full p-3 text-sm outline-none'}>
              <option value="">请选择任务</option>
              {tasks.filter(t => !t.done).map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
            <div className="flex justify-between text-xs text-neutral-600"><span>今日专注</span><span>{totalToday} 分钟 · {todayRecords.length} 轮</span></div>
            <div className="flex gap-3 text-xs"><button className="underline" onClick={()=>switchTab('tasks')}>任务清单</button>
              <button className="underline" onClick={()=>switchTab('stats')}>专注统计</button></div>
            <label className="flex gap-2 items-center text-xs"><input type="checkbox" checked={focusLock}
              onChange={e=>setFocusLock(e.target.checked)}/>专注保护（仅限制本应用内切换）</label>
          </section>
        </>}
        {tab === 'tasks' && <section className={shell + ' p-5 space-y-4'}>
          <div className="tracking-widest text-xs">TASKS / 任务清单</div>
          <form onSubmit={e => { e.preventDefault(); addTask(); }} className="flex gap-2"><input aria-label="新任务" value={taskInput} onChange={e => setTaskInput(e.target.value)} placeholder="写下今天的目标" className={inset + ' min-w-0 flex-1 p-3 text-sm outline-none'} /><button className={btn} type="submit">添加</button></form>
          {tasks.length === 0 && <p className="text-sm text-[#999999] py-5 text-center">还没有任务</p>}
          {tasks.map(t => <div key={t.id} className={inset + ' p-3 flex items-center gap-3 text-sm'}>
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
          <div className="tracking-widest text-xs">STATISTICS / 专注统计</div>
          <div className="grid grid-cols-2 gap-3"><div className={inset + ' p-4 text-center'}><div className="text-3xl">{totalToday}</div><div className="text-xs mt-2">今日分钟</div></div><div className={inset + ' p-4 text-center'}><div className="text-3xl">{todayRecords.length}</div><div className="text-xs mt-2">今日轮次</div></div></div>
          <div className="text-sm">累计专注：{records.reduce((sum, r) => sum + r.minutes, 0)} 分钟</div>
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
        {tab === 'commissions' && <WorkspacePanel section="commissions" focusTasks={tasks} records={records} onFocus={startLinked} onDiscuss={discuss} onPlan={proposeCommissionPlan} planPreview={planPreview} onClearPlan={()=>setPlanPreview(null)} onOpenStudyCourse={openLinkedStudyCourse} selectedCharId={charId} onSelectChar={chooseChar}/>}
        {tab === 'calendar' && <WorkspacePanel section="calendar" focusTasks={tasks} records={records} onFocus={startLinked} onDiscuss={discuss} onPlan={proposeCommissionPlan} planPreview={null} onClearPlan={()=>{}} onOpenStudyCourse={openLinkedStudyCourse} selectedCharId={charId} onSelectChar={chooseChar}/>}

      </main>
      <nav className="shrink-0 grid grid-cols-4 gap-1 px-2 py-3 border-t border-neutral-200 bg-white"
        style={{paddingBottom:'max(12px, var(--safe-bottom, 0px))'}}>
        {([['timer','专注'],['commissions','排单'],['calendar','课程表'],['study','自习室']] as const)
          .map(([id,title])=><button key={id} onClick={()=>switchTab(id)}
            className={'rounded-lg py-3 text-sm '+(tab===id?'bg-neutral-900 text-white':'text-neutral-700')}>{title}</button>)}
      </nav>
      {assistantOpen && <div className="absolute inset-0 z-[80] bg-black/40 flex items-end justify-center"
        onClick={()=>setAssistantOpen(false)}>
        <section className="bg-white text-neutral-900 w-full max-w-xl h-[65%] rounded-t-2xl p-4 flex flex-col gap-3"
          onClick={e=>e.stopPropagation()}>
          <div className="flex justify-between items-center">
            <h2 className="font-semibold text-sm">Char · 当前工作陪伴</h2>
            <button className="text-lg px-3" aria-label="关闭 Char" onClick={()=>setAssistantOpen(false)}>×</button>
          </div>
          <select aria-label="选择 Char" value={charId} onChange={e=>chooseChar(e.target.value)}
            className={inset + ' p-2 text-sm'}>
            <option value="">请选择 Char</option>{characters.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {assistantTopic && <p className="text-xs text-neutral-600">已带入当前请求的任务背景，仅点击发送后才会提交给 AI。{planRequest?'本轮将返回待审核 JSON 方案；不会自动改稿件。':''}</p>}
          {session?.mode==='focus' && <p className="text-xs">本轮已交流 {allowance.used}/{allowance.limit} 次。
            {allowance.canSend?'当前五分钟窗口可交流':'当前窗口不可再交流'}</p>}
          <div className="flex-1 overflow-y-auto border border-neutral-200 rounded-lg p-3 space-y-2">
            {visibleNotes.length===0 && <p className="text-sm text-neutral-500">当前 Char 尚无学习室交流记录。</p>}
            {visibleNotes.map(n=><p key={n.id} className="text-sm whitespace-pre-wrap break-words">
              <span className="text-neutral-500">{n.role==='user'?'我':activeChar?.name||'Char'}：</span>{n.content}</p>)}
          </div>
          {unassignedNotes.length>0 && <details className="text-xs text-neutral-600">
            <summary>查看 {unassignedNotes.length} 条旧监督记录（未绑定 Char，仅本机查看；不会发送给 AI）</summary>
            <div className="max-h-24 overflow-auto whitespace-pre-wrap">
              {unassignedNotes.map(n=><p key={n.id}>{n.role==='user'?'我':'旧回复'}：{n.content}</p>)}
            </div>
          </details>}
          <form onSubmit={e=>{e.preventDefault();void sendNote();}} className="flex gap-2">
            <input className={inset+' flex-1 min-w-0 p-2 text-sm'} value={message} onChange={e=>setMessage(e.target.value)}
              aria-label="对 Char 说" placeholder="主动问 Char…"/>
            <button className={btn} disabled={replying || !allowance.canSend} type="submit">{replying?'回复中':'发送'}</button>
          </form>
        </section>
      </div>}
      {exitOpen && <div className="absolute inset-0 z-[100] bg-black/40 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-[#eeeeee] rounded-3xl p-6 space-y-4 shadow-xl">
          <h2 className="text-lg font-medium">真的要退出学习吗？</h2>
          <p className="text-sm">还没完成这一轮。你可以继续，也可以确认退出。</p>
          <div className="text-xs text-[#999999]">冷静倒计时：{Math.max(0, Math.ceil((exitDeadline - now) / 1000))} 秒</div>
          <input aria-label="退出确认文字" value={exitPhrase} onChange={e => setExitPhrase(e.target.value)} placeholder={EXIT_PHRASE} className="w-full p-3 bg-white rounded-xl text-sm" />
          <button className={btn + ' w-full'} onClick={() => setExitOpen(false)}>继续专注</button>
          <button className="w-full text-sm py-2 underline" onClick={() => stop(false)}>中断本轮，留在学习室</button>
          <button className="w-full py-2 text-sm disabled:opacity-30" disabled={exitPhrase.trim() !== EXIT_PHRASE || now < exitDeadline} onClick={() => stop(true)}>确认中断并退出</button>
          <button className="w-full text-xs underline" onClick={() => stop(true)}>紧急退出</button>
        </div>
      </div>}
    </div>
  );
};
export default ScheduleApp;
