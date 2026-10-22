import React, { useEffect, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { ContextBuilder } from '../utils/context';
import { safeResponseJson, extractContent } from '../utils/safeApi';

type FocusTask = { id: string; title: string; done: boolean; sessions: number };
type FocusRecord = { date: string; minutes: number; taskId: string };
type FocusMode = 'focus' | 'break';
type Session = { mode: FocusMode; deadline: number; duration: number; taskId: string };
type Note = { id: string; role: 'user' | 'assistant'; content: string };
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
  const [tab, setTab] = useState<'timer' | 'tasks' | 'stats' | 'chat'>('timer');
  const [notes, setNotes] = useState<Note[]>(() => load('notes', []));
  const [message, setMessage] = useState('');
  const [replying, setReplying] = useState(false);
  const processed = useRef<number | null>(null);
  const activeChar = characters.find(c => c.id === charId);
  const remaining = session ? Math.max(0, Math.ceil((session.deadline - now) / 1000)) : (focusMinutes * 60);
  const activeTask = tasks.find(t => t.id === (session?.taskId || selectedTask));
  const todayRecords = records.filter(r => r.date === today());
  const totalToday = todayRecords.reduce((sum, r) => sum + r.minutes, 0);
  const shell = 'rounded-[24px] bg-[#eeeeee] shadow-[6px_6px_14px_#d2d2d2,-6px_-6px_14px_#ffffff]';
  const inset = 'rounded-2xl bg-[#eeeeee] shadow-[inset_3px_3px_7px_#d1d1d1,inset_-3px_-3px_7px_#ffffff]';
  const btn = 'rounded-2xl px-4 py-3 text-sm font-medium bg-[#777] text-white disabled:opacity-40';
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 500); return () => window.clearInterval(id); }, []);
  useEffect(() => { save('tasks', tasks); }, [tasks]);
  useEffect(() => { save('records', records); }, [records]);
  useEffect(() => { save('selectedTask', selectedTask); }, [selectedTask]);
  useEffect(() => { save('charId', charId); }, [charId]);
  useEffect(() => { save('focusMinutes', focusMinutes); }, [focusMinutes]);
  useEffect(() => { save('breakMinutes', breakMinutes); }, [breakMinutes]);
  useEffect(() => { save('session', session); }, [session]);
  useEffect(() => { save('notes', notes); }, [notes]);
  useEffect(() => {
    if (!session || now < session.deadline || processed.current === session.deadline) return;
    processed.current = session.deadline;
    if (session.mode === 'focus') {
      setRecords(prev => [...prev, { date: today(), minutes: session.duration, taskId: session.taskId }]);
      setTasks(prev => prev.map(t => t.id === session.taskId ? { ...t, sessions: t.sessions + 1 } : t));
      addToast('专注完成，可以休息了', 'success');
    } else {
      addToast('休息结束，准备下一轮', 'success');
    }
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
    setSession({ mode, duration, deadline: Date.now() + duration * 60000, taskId: selectedTask });
    setTab('timer');
  };
  const requestExit = () => {
    if (!session) { closeApp(); return; }
    setExitPhrase('');
    setExitDeadline(Date.now() + 10_000);
    setExitOpen(true);
  };
  const quit = () => { setSession(null); setExitOpen(false); closeApp(); };
  const sendNote = async () => {
    const content = message.trim();
    if (!content || replying) return;
    if (!activeChar) { addToast('请先选择监督角色', 'error'); return; }
    if (!apiConfig.apiKey || !apiConfig.model) { addToast('请先配置聊天 AI', 'error'); return; }
    const history = [...notes, { id: String(Date.now()), role: 'user' as const, content }];
    setNotes(history);
    setMessage('');
    setReplying(true);
    try {
      const context = ContextBuilder.buildCoreContext(activeChar, userProfile, true);
      const task = activeTask?.title || '自由专注';
      const phase = session?.mode === 'focus' ? '正在专注' : session?.mode === 'break' ? '正在休息' : '尚未开始计时';
      const response = await fetch(`${apiConfig.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiConfig.apiKey}` },
        body: JSON.stringify({
          model: apiConfig.model,
          messages: [
            { role: 'system', content: `${context}\\n\\n你正在番茄钟的独立监督对话中。保持角色原本的人设和说话方式，像自然交流一样回应用户，适度鼓励、提醒或陪伴，不要扮演系统提示。当前任务：${task}；状态：${phase}；剩余约 ${Math.ceil(remaining / 60)} 分钟。回答简短自然。` },
            ...history.slice(-16).map(n => ({ role: n.role, content: n.content })),
          ],
          temperature: 0.8,
        }),
      });
      const data = await safeResponseJson(response);
      if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`);
      const reply = extractContent(data?.choices?.[0]?.message?.content);
      if (!reply?.trim()) throw new Error('AI 返回了空回复');
      setNotes(prev => [...prev, { id: String(Date.now()) + '_reply', role: 'assistant', content: reply.trim() }]);
    } catch (error) {
      addToast(`角色回复失败：${error instanceof Error ? error.message : '请检查 API 设置'}`, 'error');
    } finally {
      setReplying(false);
    }
  };
  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-[#eeeeee] text-[#666] font-sans" style={{ paddingTop: 'var(--safe-top)' }}>
      <header className="px-5 pt-5 pb-4 flex items-center justify-between shrink-0">
        <button aria-label="返回" onClick={requestExit} className="text-2xl px-2">‹</button>
        <div className="text-xs tracking-[0.3em] font-medium">FOCUS / 番茄钟</div>
        <div className="w-8" />
      </header>
      <main className="flex-1 overflow-y-auto px-5 pb-8 space-y-5">
        {tab === 'timer' && <>
          <section className={shell + ' p-6 space-y-5'}>
            <div className="text-center text-xs tracking-widest text-[#999]">{session?.mode === 'break' ? 'REST TIME' : 'STAY FOCUSED'}</div>
            <div className="text-center text-sm truncate">{session?.mode === 'break' ? '好好休息一下' : activeTask?.title || '先选择一项任务'}</div>
            <div className="text-center text-[62px] leading-none font-light tracking-wider tabular-nums">{pad(Math.floor(remaining / 60))}:{pad(remaining % 60)}</div>
            <div className="h-1.5 rounded-full bg-[#d6d6d6] overflow-hidden"><div className="h-full bg-[#888] transition-all" style={{ width: session ? `${Math.max(0, Math.min(100, (1 - remaining / (session.duration * 60)) * 100))}%` : '0%' }} /></div>
            <div className="text-center text-xs text-[#999]">{session ? session.mode === 'focus' ? '正在专注，请保持节奏' : '休息中' : '准备开始'}</div>
            {!session && <div className="grid grid-cols-2 gap-3">
              <label className="text-xs space-y-2">专注分钟<input aria-label="专注分钟" type="number" min={1} max={180} value={focusMinutes} onChange={e => setFocusMinutes(Math.max(1, Math.min(180, Number(e.target.value) || 1)))} className={inset + ' w-full p-3 text-center outline-none'} /></label>
              <label className="text-xs space-y-2">休息分钟<input aria-label="休息分钟" type="number" min={1} max={60} value={breakMinutes} onChange={e => setBreakMinutes(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} className={inset + ' w-full p-3 text-center outline-none'} /></label>
            </div>}
            {session ? <button className={btn + ' w-full'} onClick={requestExit}>中断本轮</button> : <div className="grid grid-cols-2 gap-3"><button className={btn} onClick={() => start('focus')}>开始专注</button><button className={btn + ' !bg-[#aaa]'} onClick={() => start('break')}>开始休息</button></div>}
          </section>
          <section className={shell + ' p-5 space-y-3'}>
            <div className="text-xs tracking-widest">当前任务</div>
            <select aria-label="当前任务" value={selectedTask} disabled={!!session} onChange={e => setSelectedTask(e.target.value)} className={inset + ' w-full p-3 text-sm outline-none'}>
              <option value="">请选择任务</option>
              {tasks.filter(t => !t.done).map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
            <div className="flex justify-between text-xs text-[#999]"><span>今日专注</span><span>{totalToday} 分钟 · {todayRecords.length} 轮</span></div>
          </section>
        </>}
        {tab === 'tasks' && <section className={shell + ' p-5 space-y-4'}>
          <div className="tracking-widest text-xs">TASKS / 任务清单</div>
          <form onSubmit={e => { e.preventDefault(); addTask(); }} className="flex gap-2"><input aria-label="新任务" value={taskInput} onChange={e => setTaskInput(e.target.value)} placeholder="写下今天的目标" className={inset + ' min-w-0 flex-1 p-3 text-sm outline-none'} /><button className={btn} type="submit">添加</button></form>
          {tasks.length === 0 && <p className="text-sm text-[#999] py-5 text-center">还没有任务</p>}
          {tasks.map(t => <div key={t.id} className={inset + ' p-3 flex items-center gap-3 text-sm'}>
            <input type="checkbox" aria-label={`完成${t.title}`} checked={t.done} onChange={e => setTasks(prev => prev.map(x => x.id === t.id ? { ...x, done: e.target.checked } : x))} />
            <button className={`min-w-0 flex-1 text-left break-words ${t.done ? 'line-through opacity-50' : ''}`} onClick={() => { setSelectedTask(t.id); setTab('timer'); }}>{t.title}<span className="block text-xs text-[#aaa] mt-1">{t.sessions} 轮专注</span></button>
            <button aria-label={`删除${t.title}`} className="px-2 text-[#aaa]" onClick={() => { setTasks(prev => prev.filter(x => x.id !== t.id)); if (selectedTask === t.id) setSelectedTask(''); }}>×</button>
          </div>)}
        </section>}
        {tab === 'stats' && <section className={shell + ' p-5 space-y-5'}>
          <div className="tracking-widest text-xs">STATISTICS / 专注统计</div>
          <div className="grid grid-cols-2 gap-3"><div className={inset + ' p-4 text-center'}><div className="text-3xl">{totalToday}</div><div className="text-xs mt-2">今日分钟</div></div><div className={inset + ' p-4 text-center'}><div className="text-3xl">{todayRecords.length}</div><div className="text-xs mt-2">今日轮次</div></div></div>
          <div className="text-sm">累计专注：{records.reduce((sum, r) => sum + r.minutes, 0)} 分钟</div>
          <div className="text-sm">完成任务：{tasks.filter(t => t.done).length} 项</div>
          <p className="text-xs text-[#aaa]">仅统计完整结束的专注轮次；数据保存在当前浏览器。</p>
        </section>}
        {tab === 'chat' && <section className={shell + ' p-5 space-y-4'}>
          <div className="tracking-widest text-xs">SUPERVISOR / 监督记录</div>
          <select aria-label="监督角色" value={charId} onChange={e => setCharId(e.target.value)} className={inset + ' w-full p-3 text-sm'}>
            <option value="">不选择角色</option>{characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <p className="text-xs text-[#999]">已选择：{activeChar?.name || '无'}。监督记录与神经链接聊天分开保存；角色会根据当前任务与专注状态回复。</p>
          <div className={inset + ' min-h-[150px] max-h-[300px] overflow-y-auto p-3 space-y-2'}>
            {notes.length === 0 && <p className="text-xs text-[#aaa]">记录一下今天的专注感受吧。</p>}
            {notes.map(n => <p key={n.id} className="text-sm break-words"><span className="text-xs text-[#999]">{n.role === 'assistant' ? (activeChar?.name || '角色') : '我'}：</span>{n.content}</p>)}
            {replying && <p className="text-xs text-[#999]">角色正在回复…</p>}
          </div>
          <form onSubmit={e => { e.preventDefault(); void sendNote(); }} className="flex gap-2"><input aria-label="记录内容" value={message} onChange={e => setMessage(e.target.value)} className={inset + ' min-w-0 flex-1 p-3 text-sm'} placeholder="写下想说的话" /><button type="submit" disabled={replying} className={btn}>{replying ? '回复中' : '发送'}</button></form>
        </section>}
      </main>
      <nav className="shrink-0 grid grid-cols-4 gap-2 px-4 py-4 border-t border-[#dedede] bg-[#eeeeee]" style={{ paddingBottom: 'max(16px, var(--safe-bottom, 0px))' }}>
        {([['timer','计时'],['tasks','任务'],['stats','统计'],['chat','监督']] as const).map(([id, title]) => <button key={id} onClick={() => setTab(id)} className={`rounded-2xl py-3 text-xs ${tab === id ? 'bg-[#777] text-white' : 'bg-[#eeeeee] shadow-[3px_3px_7px_#d1d1d1,-3px_-3px_7px_#fff]'}`}>{title}</button>)}
      </nav>
      {exitOpen && <div className="absolute inset-0 z-[100] bg-black/40 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-[#eeeeee] rounded-3xl p-6 space-y-4 shadow-xl">
          <h2 className="text-lg font-medium">真的要退出学习吗？</h2>
          <p className="text-sm">还没完成这一轮。你可以继续，也可以确认退出。</p>
          <div className="text-xs text-[#999]">冷静倒计时：{Math.max(0, Math.ceil((exitDeadline - now) / 1000))} 秒</div>
          <input aria-label="退出确认文字" value={exitPhrase} onChange={e => setExitPhrase(e.target.value)} placeholder={EXIT_PHRASE} className="w-full p-3 bg-white rounded-xl text-sm" />
          <button className={btn + ' w-full'} onClick={() => setExitOpen(false)}>继续专注</button>
          <button className="w-full py-2 text-sm disabled:opacity-30" disabled={exitPhrase.trim() !== EXIT_PHRASE || now < exitDeadline} onClick={quit}>确认中断并退出</button>
          <button className="w-full text-xs underline" onClick={quit}>紧急退出</button>
        </div>
      </div>}
    </div>
  );
};
export default ScheduleApp;
