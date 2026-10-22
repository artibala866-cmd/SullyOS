


import React, { useState, useEffect, useMemo } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { Task, Anniversary, CharacterProfile } from '../types';
import Modal from '../components/os/Modal';
import { ContextBuilder } from '../utils/context';
import { safeResponseJson } from '../utils/safeApi';
import { injectMemoryPalace } from '../utils/memoryPalace/pipeline';
import { CharacterGroupFilterBar, filterCharactersByGroup, GROUP_FILTER_ALL } from '../components/character/CharacterGroupFilter';
import { getCalendarDayDifference, getLocalDateKey } from '../utils/localDate';
import { useLocalDateKey } from '../hooks/useLocalDateKey';
import { trackEvent } from '../utils/analytics';
import TokenImg from '../components/os/TokenImg';

const TWEMOJI_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72';
const twemojiUrl = (codepoint: string) => `${TWEMOJI_BASE}/${codepoint}.png`;

type ThemeMode = 'cyber' | 'soft' | 'minimal';

// Theme Configuration Definitions
const THEMES: Record<ThemeMode, any> = {
    cyber: {
        id: 'cyber',
        bg: 'bg-[#0f172a]',
        text: 'text-slate-200',
        textSub: 'text-slate-500',
        accent: 'text-cyan-400',
        border: 'border-cyan-900/30',
        card: 'bg-slate-900/50 backdrop-blur-md border border-slate-700/50',
        buttonPrimary: 'bg-cyan-600 hover:bg-cyan-500 text-white rounded-none skew-x-[-10deg]',
        font: 'font-mono',
        iconDone: 'text-green-500',
        decoLine: 'bg-slate-800',
        modalBg: 'bg-[#0f172a] border border-cyan-500',
        input: 'bg-slate-800 text-white border-none rounded-none',
        label: 'QUEST LOG',
        eventLabel: 'SERVER EVENTS'
    },
    soft: {
        id: 'soft',
        bg: 'bg-[#fff0f5]', // Lavender Blush
        text: 'text-slate-700',
        textSub: 'text-slate-400',
        accent: 'text-pink-500',
        border: 'border-pink-100',
        card: 'bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-sm border border-white',
        buttonPrimary: 'bg-pink-400 hover:bg-pink-500 text-white rounded-2xl shadow-lg shadow-pink-200',
        font: 'font-sans',
        iconDone: 'text-pink-400',
        decoLine: 'bg-pink-200',
        modalBg: 'bg-white/90 rounded-[2.5rem]',
        input: 'bg-pink-50 text-slate-700 border border-pink-100 rounded-xl',
        label: '心愿单',
        eventLabel: '纪念日'
    },
    minimal: {
        id: 'minimal',
        bg: 'bg-[#eef2f6]', // Classic Neumorphism base
        text: 'text-slate-600',
        textSub: 'text-slate-400',
        accent: 'text-indigo-500',
        border: 'border-transparent',
        // Neumorphism Outer Shadow
        card: 'bg-[#eef2f6] rounded-2xl shadow-[6px_6px_12px_#d1d9e6,-6px_-6px_12px_#ffffff]',
        // Neumorphism Pressed State simulation for buttons usually, but here flat prompt
        buttonPrimary: 'bg-[#eef2f6] text-slate-600 font-bold rounded-xl shadow-[6px_6px_12px_#d1d9e6,-6px_-6px_12px_#ffffff] active:shadow-[inset_4px_4px_8px_#d1d9e6,inset_-4px_-4px_8px_#ffffff]',
        font: 'font-sans',
        iconDone: 'text-slate-400',
        decoLine: 'bg-slate-300',
        modalBg: 'bg-[#eef2f6] rounded-2xl shadow-2xl',
        input: 'bg-[#eef2f6] text-slate-700 rounded-xl shadow-[inset_2px_2px_5px_#d1d9e6,inset_-2px_-2px_5px_#ffffff]',
        label: 'Focus',
        eventLabel: 'Timeline'
    }
};

const ScheduleApp: React.FC = () => {
    const { closeApp, characters, activeCharacterId, apiConfig, addToast, userProfile, characterGroups } = useOS();
    const localDateKey = useLocalDateKey();
    const [tasks, setTasks] = useState<Task[]>([]);
    const [anniversaries, setAnniversaries] = useState<Anniversary[]>([]);
    const [activeTab, setActiveTab] = useState<'quest' | 'server_events'>('quest');
    useAppShortcut(ShortcutAppID.Schedule, intent => setActiveTab(intent.entryId === 'server_events' ? 'server_events' : 'quest'));
    
    // Pomodoro session uses a wall-clock deadline so background tabs do not slow the timer.
    const [focusMinutes, setFocusMinutes] = useState(25);
    const [focusTask, setFocusTask] = useState('');
    const [focusCharId, setFocusCharId] = useState(activeCharacterId || '');
    const [focusDeadline, setFocusDeadline] = useState<number | null>(null);
    const [focusSeconds, setFocusSeconds] = useState(25 * 60);
    const [focusFinished, setFocusFinished] = useState(false);
    const [exitConfirm, setExitConfirm] = useState(false);
    const [exitText, setExitText] = useState('');
    const [exitWaitUntil, setExitWaitUntil] = useState<number | null>(null);
    const [focusNow, setFocusNow] = useState(Date.now());
    useEffect(() => {
        const timer = window.setInterval(() => setFocusNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);
    useEffect(() => {
        if (focusDeadline === null) return;
        const remaining = Math.max(0, Math.ceil((focusDeadline - focusNow) / 1000));
        setFocusSeconds(remaining);
        if (remaining === 0) {
            setFocusDeadline(null);
            setFocusFinished(true);
        }
    }, [focusDeadline, focusNow]);
    const startFocus = () => {
        if (!focusTask.trim()) { addToast('请先填写专注任务', 'error'); return; }
        setFocusSeconds(focusMinutes * 60);
        setFocusDeadline(Date.now() + focusMinutes * 60000);
        setFocusFinished(false);
        setExitConfirm(false);
    };
    const leaveFocus = () => {
        if (focusDeadline === null) { closeApp(); return; }
        setExitConfirm(true);
        setExitText('');
        setExitWaitUntil(Date.now() + 10000);
    };
    const stopFocus = () => {
        setFocusDeadline(null);
        setFocusFinished(false);
        setFocusSeconds(focusMinutes * 60);
        setExitConfirm(false);
        closeApp();
    };

    // Processing State for feedback
    const [processingTaskIds, setProcessingTaskIds] = useState<Set<string>>(new Set());

    // Theme State
    const [currentThemeMode, setCurrentThemeMode] = useState<ThemeMode>('minimal');
    const theme = THEMES[currentThemeMode];

    // Add Modal States
    const [showTaskModal, setShowTaskModal] = useState(false);
    const [showAnniModal, setShowAnniModal] = useState(false);

    // Forms
    const [newTaskTitle, setNewTaskTitle] = useState('');
    const [newTaskSupervisor, setNewTaskSupervisor] = useState<string>(activeCharacterId || '');
    const [supervisorGroupId, setSupervisorGroupId] = useState<string>(GROUP_FILTER_ALL); // 选监督人的分组筛选

    const [newAnniTitle, setNewAnniTitle] = useState('');
    const [newAnniDate, setNewAnniDate] = useState('');
    const [newAnniChar, setNewAnniChar] = useState<string>(activeCharacterId || '');
    const [anniCharGroupId, setAnniCharGroupId] = useState<string>(GROUP_FILTER_ALL); // 纪念日关联对象的分组筛选

    useEffect(() => {
        loadData();
        // Load theme from local storage if needed, defaulting to cyber
        const saved = localStorage.getItem('schedule_app_theme');
        if (saved && THEMES[saved as ThemeMode]) {
            setCurrentThemeMode(saved as ThemeMode);
        }
    }, []);

    const toggleTheme = () => {
        const modes: ThemeMode[] = ['cyber', 'soft', 'minimal'];
        const nextIndex = (modes.indexOf(currentThemeMode) + 1) % modes.length;
        const nextMode = modes[nextIndex];
        setCurrentThemeMode(nextMode);
        localStorage.setItem('schedule_app_theme', nextMode);
        trackEvent('切换日程界面主题', { theme: nextMode });
    };

    const loadData = async () => {
        const [t, a] = await Promise.all([DB.getAllTasks(), DB.getAllAnniversaries()]);
        setTasks(t.sort((a, b) => b.createdAt - a.createdAt));
        setAnniversaries(a.sort((a, b) => a.date.localeCompare(b.date)));
    };

    // --- AI Logic ---

    const generateTaskReward = async (task: Task) => {

        const supervisor = characters.find(c => c.id === task.supervisorId);
        if (!supervisor || !apiConfig.apiKey) {
            addToast('任务已完成', 'success');
            return;
        }

        // FEEDBACK: Show loading state immediately
        // Note: The caller handles setting processingTaskIds, but we can also add a toast
        addToast(`${supervisor.name} 正在确认你的成果...`, 'info');

        try {
            // 1. Build Persona Context
            // RESTORED: Full context
            await injectMemoryPalace(supervisor, undefined, task.title);
            const characterContextInput = { char: supervisor, user: userProfile };


            const userPrompt = `
### 场景：任务完成 (Task Completed)
用户 (${userProfile.name}) 刚刚在现实生活中完成了一个任务/契约： "${task.title}"。
你是监督人。

### 任务
请根据你的人设，对用户完成任务这一行为做出反应。
- 如果你是严厉的：勉强认可，或者催促下一个。
- 如果你是温柔的：给予温暖的夸奖。
- 如果你是傲娇的：别扭地表示一下。
- **关键**：不要问我用什么语气，**你自己**根据你的人设决定。

**输出要求**:
- 仅输出一句话（类似气泡通知）。
- **必须使用用户常用语言**。
- 不要有引号。`;

            // 2. Separate System and User roles
            const messages = [
                { role: "system", content: '' },
                { role: "user", content: userPrompt }
            ];

            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({
                    model: apiConfig.model,
                    messages: (await ContextBuilder.buildCharacterRequest(characterContextInput, messages)),
                    temperature: 0.9, 
                    max_tokens: 8000 
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API Error ${response.status}: ${errorText.slice(0, 100)}`);
            }

            const data = await safeResponseJson(response);
            
            // Extract content, handling potential reasoning_content or empty standard content
            let text = data.choices?.[0]?.message?.content?.trim();
            if (!text && data.choices?.[0]?.message?.reasoning_content) {
                // If standard content is empty but model "thought" about it, try to use thought or fallback
                console.warn("AI returned empty content but has reasoning.");
            }
            
            if (text) {
                text = text.replace(/^["']|["']$/g, '');
                addToast(`${supervisor.name}: ${text}`, 'success');
                // Inject into Chat Memory (Localized & Personalized)
                await DB.saveMessage({
                    charId: supervisor.id,
                    role: 'system',
                    type: 'text',
                    content: `[系统: ${userProfile.name} 完成了任务 "${task.title}"。${supervisor.name} 评价道: "${text}"]`
                });
            } else {
                console.warn("AI returned empty content", data);
                addToast('任务完成 (AI 未返回评价)', 'success');
            }

        } catch (e: any) {
            console.error("Task Reward Error:", e);
            addToast(`评价生成失败: ${e.message}`, 'error');
        }
    };

    const generateAnniversaryThought = async (anni: Anniversary) => {

        const char = characters.find(c => c.id === anni.charId);
        if (!char || !apiConfig.apiKey) return;

        // Check cache (24h)
        if (anni.aiThought && anni.lastThoughtGeneratedAt && (Date.now() - anni.lastThoughtGeneratedAt < 24 * 60 * 60 * 1000)) {
            return;
        }

        // FEEDBACK: Show loading state if explicit call
        if (Date.now() - (anni.lastThoughtGeneratedAt || 0) > 10000) {
             addToast(`${char.name} 正在查阅日历...`, 'info');
        }

        const daysDiff = getCalendarDayDifference(getLocalDateKey(), anni.date) ?? 0;
        const dayText = daysDiff > 0 ? `还有 ${daysDiff} 天` : (daysDiff === 0 ? '就是今天!' : `已经过去 ${Math.abs(daysDiff)} 天了`);

        // RESTORED: Full context
        await injectMemoryPalace(char, undefined, anni.title);
        const characterContextInput = { char, user: userProfile };


        const userPrompt = `
### 场景：纪念日提醒
事件: "${anni.title}"
时间状态: ${dayText}

### 任务
请根据你的人设，针对这个日期发表一句简短的感想。
**输出要求**:
- 仅输出一句话。
- **必须使用用户常用语言**。`;

        const messages = [
            { role: "system", content: '' },
            { role: "user", content: userPrompt }
        ];

        try {
            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({
                    model: apiConfig.model,
                    messages: (await ContextBuilder.buildCharacterRequest(characterContextInput, messages)),
                    temperature: 0.8,
                    max_tokens: 8000
                })
            });

            if (!response.ok) {
                 const errorText = await response.text();
                 throw new Error(`API Error ${response.status}: ${errorText.slice(0, 50)}`);
            }

            const data = await safeResponseJson(response);
            const text = data.choices?.[0]?.message?.content?.trim().replace(/^["']|["']$/g, '');
            
            if (text) {
                const updatedAnni = { ...anni, aiThought: text, lastThoughtGeneratedAt: Date.now() };
                await DB.saveAnniversary(updatedAnni);
                setAnniversaries(prev => prev.map(a => a.id === anni.id ? updatedAnni : a));
            } else {
                console.warn("AI returned empty thought", data);
            }
        } catch (e: any) { 
            console.error("Anniversary Thought Error:", e);
            // No toast for background update failure to avoid annoyance
        }
    };

    // --- Actions ---

    const handleAddTask = async () => {
        if (!newTaskTitle.trim()) return;
        const task: Task = {
            id: `task-${Date.now()}`,
            title: newTaskTitle,
            supervisorId: newTaskSupervisor || characters[0]?.id,
            tone: 'gentle', // Deprecated but kept for type compatibility
            isCompleted: false,
            createdAt: Date.now()
        };
        await DB.saveTask(task);
        setTasks(prev => [task, ...prev]);
        setShowTaskModal(false);
        setNewTaskTitle('');
    };

    const handleToggleTask = async (task: Task) => {
        const updated = { ...task, isCompleted: !task.isCompleted, completedAt: !task.isCompleted ? Date.now() : undefined };
        await DB.saveTask(updated);
        setTasks(prev => prev.map(t => t.id === task.id ? updated : t));
        
        if (updated.isCompleted) {
            // Start Visual Loading State on the Item
            setProcessingTaskIds(prev => new Set(prev).add(task.id));
            try {
                await generateTaskReward(updated);
            } finally {
                // End Visual Loading State
                setProcessingTaskIds(prev => {
                    const next = new Set(prev);
                    next.delete(task.id);
                    return next;
                });
            }
        }
    };

    const handleDeleteTask = async (id: string) => {
        await DB.deleteTask(id);
        setTasks(prev => prev.filter(t => t.id !== id));
    };

    const handleAddAnni = async () => {
        if (!newAnniTitle.trim() || !newAnniDate) return;
        const anni: Anniversary = {
            id: `anni-${Date.now()}`,
            title: newAnniTitle,
            date: newAnniDate,
            charId: newAnniChar || characters[0]?.id
        };
        await DB.saveAnniversary(anni);
        setAnniversaries(prev => [...prev, anni].sort((a, b) => a.date.localeCompare(b.date)));
        setShowAnniModal(false);
        setNewAnniTitle('');
        setNewAnniDate('');
        
        // Remove immediate trigger to avoid double calls (useEffect will handle if it's upcoming)
    };

    const handleDeleteAnni = async (id: string) => {
        await DB.deleteAnniversary(id);
        setAnniversaries(prev => prev.filter(a => a.id !== id));
    };

    // --- Render Helpers ---

    const getDaysUntil = (dateStr: string) => {
        return getCalendarDayDifference(localDateKey, dateStr) ?? Number.POSITIVE_INFINITY;
    };

    const upcomingAnni = useMemo(() => {
        return anniversaries.filter(a => getDaysUntil(a.date) >= 0).sort((a, b) => a.date.localeCompare(b.date))[0];
    }, [anniversaries, localDateKey]);

    // Trigger thoughts for upcoming anniversary on load
    useEffect(() => {
        if (upcomingAnni) {
            generateAnniversaryThought(upcomingAnni);
        }
    }, [upcomingAnni]);

    return (
        <div className={`h-full w-full flex flex-col ${theme.font} ${theme.bg} ${theme.text} relative overflow-hidden transition-colors duration-500`}>
             
             <section className="relative z-10 px-5 pt-4 pb-3 bg-[#eeeeee] border-b border-[#d7d7d7] text-[#666666]">
                <div className="text-[10px] tracking-[0.3em] uppercase text-center mb-3">Focus / 番茄钟</div>
                <div className="rounded-3xl bg-[#eeeeee] shadow-[5px_5px_12px_#d1d1d1,-5px_-5px_12px_#ffffff] p-4 space-y-3">
                    <input aria-label="专注任务" className="w-full bg-white/70 rounded-xl px-3 py-2 text-sm outline-none" placeholder="今天要完成什么？" value={focusTask} disabled={focusDeadline !== null} onChange={e => setFocusTask(e.target.value)} />
                    <div className="flex items-center gap-2">
                        <label className="text-xs shrink-0">监督 Char</label>
                        <select aria-label="选择监督角色" className="flex-1 min-w-0 rounded-xl p-2 text-sm bg-white/70" value={focusCharId} onChange={e => setFocusCharId(e.target.value)}>
                            <option value="">暂不选择</option>
                            {characters.map(char => <option key={char.id} value={char.id}>{char.name}</option>)}
                        </select>
                        <select aria-label="专注时长" className="rounded-xl p-2 text-sm bg-white/70" disabled={focusDeadline !== null} value={focusMinutes} onChange={e => { const minutes = Number(e.target.value); setFocusMinutes(minutes); setFocusSeconds(minutes * 60); }}>
                            {[15, 25, 45, 60].map(n => <option key={n} value={n}>{n} 分钟</option>)}
                        </select>
                    </div>
                    <div className="text-center text-5xl tracking-widest font-light tabular-nums">{String(Math.floor(focusSeconds / 60)).padStart(2, '0')}:{String(focusSeconds % 60).padStart(2, '0')}</div>
                    <div className="text-center text-xs text-[#999]">{focusFinished ? '本轮专注已结束' : focusDeadline !== null ? '专注进行中' : '准备开始'}</div>
                    <button className="w-full py-2.5 rounded-xl bg-[#777] text-white text-sm" disabled={focusDeadline !== null} onClick={startFocus}>{focusFinished ? '开始下一轮' : '开始专注'}</button>
                    {focusDeadline !== null && <button className="w-full py-2 text-xs underline" onClick={leaveFocus}>中断本轮专注</button>}
                </div>
             </section>
             {exitConfirm && <div className="absolute inset-0 z-[100] bg-black/40 flex items-center justify-center p-6">
                <div className="w-full bg-[#f3f3f3] rounded-3xl p-5 space-y-4 text-[#555] shadow-xl">
                    <h2 className="text-lg font-medium">真的要退出学习吗？</h2>
                    <p className="text-sm">任务尚未完成。可以再坚持一会儿，或确认中断。</p>
                    <p className="text-xs">冷静倒计时：{Math.max(0, Math.ceil(((exitWaitUntil || 0) - focusNow) / 1000))} 秒</p>
                    <input className="w-full p-3 bg-white rounded-xl text-sm" placeholder="输入：真的要退出学习吗" value={exitText} onChange={e => setExitText(e.target.value)} />
                    <button className="w-full rounded-xl bg-[#777] text-white p-3" onClick={() => setExitConfirm(false)}>继续专注</button>
                    <button className="w-full text-sm disabled:opacity-30" disabled={exitText.trim() !== '真的要退出学习吗' || focusNow < (exitWaitUntil || 0)} onClick={stopFocus}>确认中断并退出</button>
                    <button className="w-full text-xs underline" onClick={stopFocus}>紧急退出</button>
                </div>
             </div>}
             {/* Tech Background Grid (Only for Cyber) */}
             {currentThemeMode === 'cyber' && (
                 <div className="absolute inset-0 pointer-events-none opacity-20" 
                      style={{ 
                          backgroundImage: 'linear-gradient(rgba(56, 189, 248, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(56, 189, 248, 0.1) 1px, transparent 1px)', 
                          backgroundSize: '40px 40px' 
                      }}>
                 </div>
             )}
             
             {/* Soft Background Pattern (Only for Soft) */}
             {currentThemeMode === 'soft' && (
                 <div className="absolute inset-0 pointer-events-none opacity-30" 
                      style={{ 
                          backgroundImage: 'radial-gradient(#fbcfe8 2px, transparent 2px)', 
                          backgroundSize: '20px 20px' 
                      }}>
                 </div>
             )}

             {/* Header */}
             <div className={`border-b ${theme.border} backdrop-blur-sm sticky top-0 z-20 shrink-0 relative transition-colors duration-300`} style={{ paddingTop: 'var(--safe-top)' }}>
                <div className="pt-12 pb-4 px-6 flex items-center justify-between h-24 box-border">
                <button onClick={leaveFocus} className={`p-2 -ml-2 rounded-full active:scale-90 transition-transform ${currentThemeMode === 'minimal' ? 'bg-[#eef2f6] shadow-[4px_4px_8px_#d1d9e6,-4px_-4px_8px_#ffffff]' : 'hover:bg-black/5'}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={`w-6 h-6 ${theme.accent}`}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                </button>

                {/* Tabs */}
                <div className={`flex gap-1 p-1 rounded-lg ${currentThemeMode === 'cyber' ? 'bg-black/40 border border-cyan-900/50' : (currentThemeMode === 'minimal' ? 'bg-[#eef2f6] shadow-[inset_2px_2px_5px_#d1d9e6,inset_-2px_-2px_5px_#ffffff]' : 'bg-white/50')}`}>
                    <button onClick={() => { setActiveTab('quest'); trackEvent('切换日程标签页', { tab: 'quest' }); }} className={`px-4 py-1.5 rounded text-xs font-bold transition-all ${activeTab === 'quest' ? `${theme.accent} ${currentThemeMode === 'cyber' ? 'bg-cyan-900/50 shadow-sm' : (currentThemeMode === 'minimal' ? 'shadow-[2px_2px_5px_#d1d9e6,-2px_-2px_5px_#ffffff] bg-[#eef2f6]' : 'bg-white shadow-sm')}` : `${theme.textSub}`}`}>{theme.label}</button>
                    <button onClick={() => { setActiveTab('server_events'); trackEvent('切换日程标签页', { tab: 'server_events' }); }} className={`px-4 py-1.5 rounded text-xs font-bold transition-all ${activeTab === 'server_events' ? `${theme.accent} ${currentThemeMode === 'cyber' ? 'bg-cyan-900/50 shadow-sm' : (currentThemeMode === 'minimal' ? 'shadow-[2px_2px_5px_#d1d9e6,-2px_-2px_5px_#ffffff] bg-[#eef2f6]' : 'bg-white shadow-sm')}` : `${theme.textSub}`}`}>{theme.eventLabel}</button>
                </div>

                {/* Right Actions */}
                <div className="flex gap-2">
                    {/* Theme Switcher */}
                    <button onClick={toggleTheme} className={`p-2 rounded-full active:scale-90 transition-transform ${currentThemeMode === 'minimal' ? 'shadow-[4px_4px_8px_#d1d9e6,-4px_-4px_8px_#ffffff]' : 'bg-white/10 hover:bg-white/20'}`}>
                        {currentThemeMode === 'cyber' && <img src={twemojiUrl('1f47e')} alt="alien" className="w-5 h-5" />}
                        {currentThemeMode === 'soft' && <img src={twemojiUrl('1f338')} alt="blossom" className="w-5 h-5" />}
                        {currentThemeMode === 'minimal' && <img src={twemojiUrl('26aa')} alt="circle" className="w-5 h-5" />}
                    </button>

                    {/* Add Button */}
                    <button onClick={() => { activeTab === 'quest' ? setShowTaskModal(true) : setShowAnniModal(true); trackEvent('打开新建条目弹窗', { kind: activeTab }); }} className={`p-2 rounded-full active:scale-90 transition-transform ${theme.accent} ${currentThemeMode === 'minimal' ? 'shadow-[4px_4px_8px_#d1d9e6,-4px_-4px_8px_#ffffff]' : 'hover:bg-white/10'}`}>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                    </button>
                </div>
                </div>

                {/* Decoration Line */}
                {currentThemeMode === 'cyber' && <div className="absolute bottom-0 left-0 h-[1px] w-full bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent"></div>}
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar p-6 space-y-8 z-10">
                
                {/* Hero Anniversary Card */}
                {upcomingAnni && (
                    <div className={`w-full rounded-2xl p-5 relative overflow-hidden group transition-all duration-300 ${currentThemeMode === 'minimal' ? 'bg-[#eef2f6] shadow-[inset_5px_5px_10px_#d1d9e6,inset_-5px_-5px_10px_#ffffff]' : (currentThemeMode === 'soft' ? 'bg-gradient-to-r from-pink-300 to-purple-300 text-white shadow-lg shadow-pink-200' : 'bg-gradient-to-r from-slate-900 to-slate-800 border border-purple-500/30')}`}>
                        <div className="relative z-10">
                            <div className="flex justify-between items-start mb-2">
                                <div className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded ${currentThemeMode === 'minimal' ? 'text-slate-400' : 'text-white/80 bg-white/20'}`}>即将到来</div>
                                <div className="text-3xl font-bold tracking-tighter">{getDaysUntil(upcomingAnni.date)} <span className="text-xs opacity-60 font-normal">天后</span></div>
                            </div>
                            <div className="text-xl font-bold mb-4">{upcomingAnni.title}</div>
                            
                            {/* AI Thought Bubble */}
                            <div className={`flex items-start gap-3 p-3 rounded-xl ${currentThemeMode === 'minimal' ? 'bg-[#eef2f6] shadow-[5px_5px_10px_#d1d9e6,-5px_-5px_10px_#ffffff]' : 'bg-white/20 backdrop-blur-md'}`}>
                                <TokenImg value={characters.find(c => c.id === upcomingAnni.charId)?.avatar} className="w-8 h-8 rounded-full object-cover" />
                                <div className={`text-xs font-medium leading-relaxed italic ${currentThemeMode === 'minimal' ? 'text-slate-500' : 'text-white/90'}`}>
                                    "{upcomingAnni.aiThought || "加载中..."}"
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'quest' && (
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 mb-2 px-1">
                            <div className={`w-2 h-2 rounded-full animate-pulse ${currentThemeMode === 'cyber' ? 'bg-cyan-500' : (currentThemeMode === 'soft' ? 'bg-pink-400' : 'bg-slate-400')}`}></div>
                            <h3 className={`text-xs font-bold uppercase tracking-[0.2em] ${theme.accent}`}>进行中任务</h3>
                        </div>
                        
                        {tasks.filter(t => !t.isCompleted).length === 0 && (
                            <div className={`text-center py-12 border-2 border-dashed rounded-xl ${currentThemeMode === 'cyber' ? 'border-slate-800' : 'border-slate-200'}`}>
                                <div className={theme.textSub}>暂无任务</div>
                            </div>
                        )}

                        {tasks.filter(t => !t.isCompleted).map(task => {
                            const supervisor = characters.find(c => c.id === task.supervisorId);
                            const isProcessing = processingTaskIds.has(task.id);
                            
                            return (
                                <div key={task.id} className={`${theme.card} p-4 flex items-center gap-4 group relative overflow-hidden transition-all duration-300`}>
                                    {/* Supervisor Icon */}
                                    <div className="w-12 h-12 rounded-full overflow-hidden shrink-0 relative border border-white/10">
                                        {supervisor ? <TokenImg value={supervisor.avatar} className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" /> : <span className="text-xs">?</span>}
                                        <div className={`absolute -bottom-0 -right-0 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${currentThemeMode === 'soft' ? 'bg-white text-pink-500' : 'bg-black text-cyan-500'}`}>!</div>
                                    </div>
                                    
                                    <div className="flex-1">
                                        <div className={`${theme.text} font-bold text-sm tracking-wide`}>{task.title}</div>
                                        <div className={`text-[10px] ${theme.textSub} mt-1 font-mono uppercase`}>
                                            监督人: {supervisor?.name || 'Unknown'}
                                        </div>
                                    </div>

                                    {/* Action Button Area */}
                                    {isProcessing ? (
                                        <div className="flex items-center gap-2 px-2 py-2">
                                            <div className={`w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin ${theme.accent}`}></div>
                                            <span className={`text-[10px] font-bold animate-pulse ${theme.accent}`}>验收中...</span>
                                        </div>
                                    ) : (
                                        <button 
                                            onClick={() => handleToggleTask(task)}
                                            className={`px-4 py-2 text-[10px] font-bold uppercase tracking-wider rounded transition-all active:scale-95 ${currentThemeMode === 'minimal' ? 'shadow-[4px_4px_8px_#d1d9e6,-4px_-4px_8px_#ffffff] text-slate-500 active:shadow-[inset_2px_2px_5px_#d1d9e6,inset_-2px_-2px_5px_#ffffff]' : (currentThemeMode === 'soft' ? 'bg-pink-100 text-pink-500' : 'bg-cyan-900/30 text-cyan-400 border border-cyan-800')}`}
                                        >
                                            完成
                                        </button>
                                    )}
                                    
                                    <button onClick={() => handleDeleteTask(task.id)} className="absolute top-2 right-2 text-slate-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity p-1">×</button>
                                </div>
                            );
                        })}

                        {tasks.filter(t => t.isCompleted).length > 0 && (
                            <div className="pt-8 opacity-50">
                                <h3 className={`text-xs font-bold uppercase tracking-[0.2em] px-1 mb-4 ${theme.textSub}`}>已完成</h3>
                                {tasks.filter(t => t.isCompleted).map(task => (
                                    <div key={task.id} className={`flex items-center gap-3 py-2 px-2 border-b ${currentThemeMode === 'cyber' ? 'border-slate-800/50' : 'border-slate-100'}`}>
                                        <div className={`${theme.iconDone} text-xs font-mono`}>[DONE]</div>
                                        <span className={`text-sm line-through ${theme.textSub}`}>{task.title}</span>
                                        <button onClick={() => handleDeleteTask(task.id)} className="ml-auto text-slate-400 hover:text-red-500 text-xs">DEL</button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'server_events' && (
                    <div className={`relative pl-6 space-y-8 before:absolute before:left-2 before:top-2 before:bottom-0 before:w-[1px] ${theme.decoLine}`}>
                        {/* Anniversaries List */}
                        <div>
                             <h3 className={`text-xs font-bold uppercase tracking-widest mb-6 -ml-6 pl-6 ${theme.textSub}`}>时间线事件</h3>
                             <div className="space-y-4">
                                 {anniversaries.map(a => (
                                     <div key={a.id} className="relative group">
                                         <div className={`absolute -left-[20px] top-4 w-2 h-2 rounded-full z-10 ${currentThemeMode === 'cyber' ? 'bg-black border border-purple-500' : 'bg-pink-400'}`}></div>
                                         <div className={`${theme.card} p-4 flex justify-between items-center transition-colors`}>
                                             <div>
                                                 <div className={`text-sm font-bold ${theme.text}`}>{a.title}</div>
                                                 <div className={`text-[10px] ${theme.textSub} font-mono mt-1`}>{a.date} · {characters.find(c => c.id === a.charId)?.name}</div>
                                             </div>
                                             <button onClick={() => handleDeleteAnni(a.id)} className="text-slate-400 hover:text-red-400 p-2 opacity-0 group-hover:opacity-100 transition-opacity">×</button>
                                         </div>
                                     </div>
                                 ))}
                             </div>
                        </div>

                        {/* Completed Tasks History Log */}
                         <div>
                             <h3 className={`text-xs font-bold uppercase tracking-widest mb-6 -ml-6 pl-6 pt-4 ${theme.textSub}`}>完成履历</h3>
                             <div className="space-y-4">
                                 {tasks.filter(t => t.isCompleted).sort((a,b) => (b.completedAt || 0) - (a.completedAt || 0)).map(t => (
                                     <div key={t.id} className="relative">
                                         <div className={`absolute -left-[20px] top-2 w-2 h-2 rounded-full z-10 ${currentThemeMode === 'cyber' ? 'bg-black border border-green-600' : 'bg-slate-300'}`}></div>
                                         <div className={`text-xs ${theme.textSub} font-mono`}>[{new Date(t.completedAt || 0).toLocaleDateString()}] 任务完成</div>
                                         <div className={`text-sm ${theme.text} font-bold mt-1 pl-1 border-l-2 ${theme.decoLine}`}>{t.title}</div>
                                     </div>
                                 ))}
                             </div>
                         </div>
                    </div>
                )}

            </div>

            {/* Task Modal */}
            <Modal isOpen={showTaskModal} title={currentThemeMode === 'cyber' ? "INITIALIZE QUEST" : "新建任务"} onClose={() => setShowTaskModal(false)} footer={<button onClick={handleAddTask} className={`w-full py-3 font-bold transition-all ${theme.buttonPrimary}`}>确认添加</button>}>
                <div className={`space-y-6 ${currentThemeMode === 'minimal' ? 'p-2' : ''}`}>
                    <input autoFocus value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)} placeholder="任务目标 (例如: 背单词)" className={`w-full px-4 py-3 text-sm focus:outline-none ${theme.input}`} />
                    
                    <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block tracking-widest">选择监督人</label>
                        {/* 分组筛选（没建分组时不渲染）。Modal 恒为白底，走浅色配色 */}
                        <CharacterGroupFilterBar characters={characters} groups={characterGroups}
                            value={supervisorGroupId} onChange={setSupervisorGroupId} className="mb-2" />
                        <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
                            {filterCharactersByGroup(characters, characterGroups, supervisorGroupId).map(c => (
                                <button key={c.id} onClick={() => setNewTaskSupervisor(c.id)} className={`flex flex-col items-center gap-2 p-2 rounded-lg border transition-all min-w-[60px] ${newTaskSupervisor === c.id ? `${currentThemeMode === 'minimal' ? 'shadow-[inset_2px_2px_5px_#d1d9e6,inset_-2px_-2px_5px_#ffffff]' : 'border-current'}` : 'border-transparent opacity-50'}`}>
                                    <TokenImg value={c.avatar} className="w-10 h-10 rounded-md object-cover" />
                                    <span className={`text-[10px] font-bold whitespace-nowrap ${theme.text}`}>{c.name}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </Modal>

            {/* Anniversary Modal */}
            <Modal isOpen={showAnniModal} title={currentThemeMode === 'cyber' ? "REGISTER EVENT" : "添加纪念日"} onClose={() => setShowAnniModal(false)} footer={<button onClick={handleAddAnni} className={`w-full py-3 font-bold transition-all ${theme.buttonPrimary}`}>保存记录</button>}>
                <div className={`space-y-4 ${currentThemeMode === 'minimal' ? 'p-2' : ''}`}>
                    <input value={newAnniTitle} onChange={e => setNewAnniTitle(e.target.value)} placeholder="事件名称 (例如: 第一次见面)" className={`w-full px-4 py-3 text-sm focus:outline-none ${theme.input}`} />
                    <input type="date" value={newAnniDate} onChange={e => setNewAnniDate(e.target.value)} className={`w-full px-4 py-3 text-sm focus:outline-none ${theme.input}`} />
                    
                    <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block tracking-widest">关联对象</label>
                        {/* 分组筛选（没建分组时不渲染）。Modal 恒为白底，走浅色配色 */}
                        <CharacterGroupFilterBar characters={characters} groups={characterGroups}
                            value={anniCharGroupId} onChange={setAnniCharGroupId} className="mb-2" />
                        <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
                            {filterCharactersByGroup(characters, characterGroups, anniCharGroupId).map(c => (
                                <button key={c.id} onClick={() => setNewAnniChar(c.id)} className={`flex flex-col items-center gap-2 p-2 rounded-lg border transition-all min-w-[60px] ${newAnniChar === c.id ? `${currentThemeMode === 'minimal' ? 'shadow-[inset_2px_2px_5px_#d1d9e6,inset_-2px_-2px_5px_#ffffff]' : 'border-current'}` : 'border-transparent opacity-50'}`}>
                                    <TokenImg value={c.avatar} className="w-10 h-10 rounded-md object-cover" />
                                    <span className={`text-[10px] font-bold whitespace-nowrap ${theme.text}`}>{c.name}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default ScheduleApp;
import { useAppShortcut } from '../utils/appShortcutLaunch';
import { AppID as ShortcutAppID } from '../types';
