import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, CaretDown, Copy, DownloadSimple, FloppyDisk, LockSimple, PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import { STORY_MIN_OUTPUT_TOKENS, STORY_MAX_OUTPUT_TOKENS } from '../../../utils/storyOutputLimits';
import type { StoryTheaterPreset, StoryTheaterPresetDocument, StoryTheaterPresetPrompt } from '../../../types';
import {
    applyStoryPresetChoice,
    addStoryPresetGroup,
    renameStoryPresetGroup,
    ungroupStoryPresetGroup,
    moveStoryPresetPromptToGroup,
    downloadStoryPreset,
    duplicateStoryPreset,
    getStoryPresetPromptGroups,
    getStoryTavernAuthorSections,
    selectStoryTavernAuthorOption,
    storyPresetPromptKind,
    isProtectedStoryPrompt,
    isStoryPresetSectionMarker,
    makeStoryTheaterId,
} from '../../../utils/storyTheater';

interface Props {
    preset: StoryTheaterPreset;
    onBack: () => void;
    onSave: (preset: StoryTheaterPreset) => Promise<void> | void;
    onOpenCopy: (preset: StoryTheaterPreset) => Promise<void> | void;
    onDelete?: (preset: StoryTheaterPreset) => Promise<void> | void;
    usedByStoryCount?: number;
}

export interface StoryPresetSimpleChoice {
    label: string;
    hint: string;
    ids: readonly string[];
    options: Array<{ id?: string; label: string }>;
}

export const STORY_PRESET_SIMPLE_CHOICES: StoryPresetSimpleChoice[] = [
    {
        label: '文风', hint: '决定这场故事读起来是什么质感',
        ids: ['nmj-v3-style-custom', 'nmj-v3-style-soda', 'nmj-v3-style-corridor', 'nmj-v3-style-comedy', 'nmj-v3-style-darkcomedy', 'nmj-v3-style-syrup', 'nmj-v3-style-dullknife', 'nmj-v3-style-drama'],
        options: [{ label: '默认质感' }, { id: 'nmj-v3-style-soda', label: '汽水日常' }, { id: 'nmj-v3-style-corridor', label: '潮雨走廊' }, { id: 'nmj-v3-style-comedy', label: '荒诞喜剧' }, { id: 'nmj-v3-style-darkcomedy', label: '黑喜剧' }, { id: 'nmj-v3-style-syrup', label: '直球甜宠' }, { id: 'nmj-v3-style-dullknife', label: '钝刀虐心' }, { id: 'nmj-v3-style-drama', label: '冷峻正剧' }],
    },
    {
        label: '人称', hint: '决定镜头如何称呼你当前执笔的身份',
        ids: ['nmj-v3-pov-second', 'nmj-v3-pov-third'],
        options: [{ id: 'nmj-v3-pov-second', label: '第二人称' }, { id: 'nmj-v3-pov-third', label: '第三人称' }],
    },
    {
        label: '输入转述', hint: '你给出的构想要先拍出来，还是视作已经发生',
        ids: ['nmj-v62-retelling-replay', 'nmj-v62-retelling-direct'],
        options: [{ id: 'nmj-v62-retelling-replay', label: '回放扩写' }, { id: 'nmj-v62-retelling-direct', label: '直接接戏' }],
    },
    {
        label: '你的执笔权', hint: '故事可以替你当前执笔的身份写到什么程度',
        ids: ['nmj-v63-user-agency-locked', 'nmj-v63-user-agency-assist', 'nmj-v63-user-agency-auto'],
        options: [{ id: 'nmj-v63-user-agency-locked', label: '完全不代写' }, { id: 'nmj-v63-user-agency-assist', label: '有限协演' }, { id: 'nmj-v63-user-agency-auto', label: '全自动演绎' }],
    },
    {
        label: '场景张力', hint: '只调整当前故事的情绪压力',
        ids: ['nmj-v64-tension-lowfever-1', 'nmj-v64-tension-lowfever-2', 'nmj-v64-tension-lowfever-3'],
        options: [{ label: '自然' }, { id: 'nmj-v64-tension-lowfever-1', label: '低烧 I' }, { id: 'nmj-v64-tension-lowfever-2', label: '低烧 II' }, { id: 'nmj-v64-tension-lowfever-3', label: '低烧 III' }],
    },
    {
        label: '小剧场', hint: '正文结束后追加一段独立的边角频道',
        ids: ['nmj-v3-theater-ai', 'nmj-v3-theater-user-sim', 'nmj-v3-theater-group', 'nmj-v3-theater-random', 'nmj-v6-side-channel-terminal', 'nmj-v6-side-channel-evidence', 'nmj-v6-side-channel-public', 'nmj-v6-side-channel-wrong-reel', 'nmj-v3-theater-custom'],
        options: [{ label: '关闭' }, { id: 'nmj-v3-theater-ai', label: '角色与你' }, { id: 'nmj-v3-theater-user-sim', label: '你的倒影' }, { id: 'nmj-v3-theater-group', label: '你和角色们' }, { id: 'nmj-v3-theater-random', label: '随机换台' }, { id: 'nmj-v6-side-channel-terminal', label: '终端残响' }, { id: 'nmj-v6-side-channel-evidence', label: '失物与物证' }, { id: 'nmj-v6-side-channel-public', label: '公共频段' }, { id: 'nmj-v6-side-channel-wrong-reel', label: '错卷放映' }],
    },
    {
        label: '语言', hint: '正文使用哪一种中文',
        ids: ['nmj-v3-language-cn', 'nmj-v3-language-tw'],
        options: [{ id: 'nmj-v3-language-cn', label: '简体中文' }, { id: 'nmj-v3-language-tw', label: '繁體中文' }],
    },
    {
        label: '篇幅', hint: '每次续写的大致长度',
        ids: ['nmj-v3-length-short', 'nmj-v3-length-medium', 'nmj-v3-length-long'],
        options: [{ id: 'nmj-v3-length-short', label: '短' }, { id: 'nmj-v3-length-medium', label: '中' }, { id: 'nmj-v3-length-long', label: '长' }],
    },
];

const STORY_ROLE_LABELS: Record<StoryTheaterPresetPrompt['role'], string> = {
    system: '规则',
    user: '你',
    assistant: '正文',
};

const STORY_GENERATION_FIELDS = [
    ['temperature', '温度', 'Temperature', 0, 2, 0.05, '越低越稳定，越高越自由。Claude 只接受 0–1；预设高于 1 时，Claude 请求会自动按 1 发送。'],
    ['topP', '候选范围', 'Top P', 0, 1, 0.01, '另一种随机度控制。通常保持预设值即可，不建议和温度一起大幅调整。'],
    ['frequencyPenalty', '重复惩罚', 'Frequency penalty', -2, 2, 0.05, '正值会减少重复措辞，负值会允许更多复现。部分 Claude 中转会忽略这项。'],
    ['presencePenalty', '话题惩罚', 'Presence penalty', -2, 2, 0.05, '正值更愿意引入新内容，负值更愿意围绕已有内容继续。部分 Claude 中转会忽略这项。'],
    ['maxTokens', '最大输出', 'Max tokens', STORY_MIN_OUTPUT_TOKENS, STORY_MAX_OUTPUT_TOKENS, 1, '接口输出额度以 tokens 计。正文篇幅由预设的“篇幅”选项决定。'],
] as const;

const StoryPresetMaker: React.FC<Props> = ({ preset, onBack, onSave, onOpenCopy, onDelete, usedByStoryCount = 0 }) => {
    const [draft, setDraft] = useState<StoryTheaterPreset>(() => ({
        ...preset,
        document: { ...preset.document, generation: { ...preset.document.generation }, prompts: preset.document.prompts.map(item => ({ ...item })) },
    }));
    const [mode, setMode] = useState<'simple' | 'pro'>('simple');
    const [activeGroupKey, setActiveGroupKey] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState('');
    const [saving, setSaving] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState('');
    const [newGroupName, setNewGroupName] = useState('');
    const [promptQuery, setPromptQuery] = useState('');
    const [expandedAuthorSections, setExpandedAuthorSections] = useState<Record<string, boolean>>({});
    const [inspectedAuthor, setInspectedAuthor] = useState<{ sectionKey: string; promptId: string } | null>(null);
    const [showEmptyEntries, setShowEmptyEntries] = useState(false);
    const mainScrollRef = useRef<HTMLElement>(null);
    const previousListScroll = useRef(0);
    const previousOverviewScroll = useRef(0);
    const pendingScrollRef = useRef<number | null>(null);
    const tabScrollRef = useRef({ simple: 0, pro: 0 });
    const readOnly = preset.builtIn === true;
    const groups = useMemo(() => getStoryPresetPromptGroups(draft.document), [draft.document]);
    const activeGroup = groups.find(group => group.key === activeGroupKey)
        || (selectedId ? groups.find(group => group.promptIds.includes(selectedId)) : undefined) || null;
    const activePrompts = useMemo(() => {
        if (!activeGroup) return [];
        const ids = new Set(activeGroup.promptIds);
        return draft.document.prompts.filter(prompt => ids.has(prompt.id) && !isStoryPresetSectionMarker(prompt));
    }, [activeGroup, draft.document.prompts]);

    const selected = activePrompts.find(prompt => prompt.id === selectedId) || null;
    const tavernBrowse = draft.document.sourceFormat === 'sillytavern';
    const authorSections = useMemo(() => tavernBrowse ? getStoryTavernAuthorSections(draft.document) : [],
        [tavernBrowse, draft.document]);
    const quickEdit = tavernBrowse && Boolean(selected);
    const query = promptQuery.trim().toLocaleLowerCase();
    const allPromptsById = useMemo(() => new Map(draft.document.prompts.map(prompt => [prompt.id, prompt])), [draft.document.prompts]);
    const matchingGroups = useMemo(() => !tavernBrowse || !query ? groups : groups.filter(group =>
        group.label.toLocaleLowerCase().includes(query)
        || group.promptIds.some(id => {
            const prompt = allPromptsById.get(id);
            return prompt && (prompt.name.toLocaleLowerCase().includes(query)
                || prompt.content.toLocaleLowerCase().includes(query));
        }),
    ), [allPromptsById, groups, query, tavernBrowse]);
    const visiblePrompts = useMemo(() => !tavernBrowse || showEmptyEntries ? matchingPrompts
        : matchingPrompts.filter(prompt => ['content', 'connector'].includes(storyPresetPromptKind(prompt))),
    [matchingPrompts, showEmptyEntries, tavernBrowse]);
    const promptIndexes = useMemo(() => new Map(activePrompts.map((prompt, index) => [prompt.id, index])), [activePrompts]);
    const groupCounts = useMemo(() => new Map(groups.map(group => {
        const entries = group.promptIds.map(id => allPromptsById.get(id))
            .filter((item): item is StoryTheaterPresetPrompt => Boolean(item) && !isStoryPresetSectionMarker(item!));
        return [group.key, {
            total: entries.length,
            usable: entries.filter(item => ['content', 'connector'].includes(storyPresetPromptKind(item))).length,
            enabled: entries.filter(item => item.enabled).length,
        }] as const;
    })), [groups, allPromptsById]);
    const inspectedSection = authorSections.find(section => section.key === inspectedAuthor?.sectionKey);
    const inspectedPrompt = draft.document.prompts.find(prompt => prompt.id === inspectedAuthor?.promptId);
    // Restore after React has committed the destination view, not before the
    // list/detail subtree has changed. This also works with concurrent renders.
    useLayoutEffect(() => {
        if (mainScrollRef.current && pendingScrollRef.current !== null) {
            mainScrollRef.current.scrollTop = pendingScrollRef.current;
            pendingScrollRef.current = null;
        }
    }, [mode, activeGroupKey, selectedId]);
    const switchMode = (next: 'simple' | 'pro') => {
        if (next === mode) return;
        tabScrollRef.current[mode] = mainScrollRef.current?.scrollTop || 0;
        pendingScrollRef.current = tabScrollRef.current[next];
        setMode(next);
    };
    const openPrompt = (id: string) => {
        previousListScroll.current = mainScrollRef.current?.scrollTop || 0;
        pendingScrollRef.current = 0;
        setSelectedId(id);
    };
    const closePrompt = () => {
        pendingScrollRef.current = previousListScroll.current;
        setSelectedId('');
    };
    const enterGroup = (key: string) => {
        previousOverviewScroll.current = mainScrollRef.current?.scrollTop || 0;
        pendingScrollRef.current = 0;
        setActiveGroupKey(key);
        setSelectedId('');
    };
    const leaveGroup = () => {
        pendingScrollRef.current = previousOverviewScroll.current;
        setActiveGroupKey(null);
        setSelectedId('');
    };
    const handleBack = () => {
        if (inspectedAuthor) { setInspectedAuthor(null); return; }
        if (mode === 'pro' && quickEdit) { closePrompt(); return; }
        if (mode === 'pro' && activeGroupKey) { leaveGroup(); return; }
        onBack();
    };

    const replaceDocument = (document: StoryTheaterPresetDocument) => setDraft(current => ({ ...current, name: document.name, document, updatedAt: Date.now() }));
    const patchDocument = (patch: Partial<StoryTheaterPresetDocument>) => replaceDocument({ ...draft.document, ...patch });
    const patchPrompt = (id: string, patch: Partial<StoryTheaterPresetPrompt>) => patchDocument({
        prompts: draft.document.prompts.map(prompt => prompt.id === id ? { ...prompt, ...patch } : prompt),
    });
    const selectSimpleChoice = (choice: StoryPresetSimpleChoice, id?: string) => {
        if (readOnly) return;
        replaceDocument(applyStoryPresetChoice(draft.document, choice.ids, id));
    };
    const chooseAuthorOption = (sectionKey: string, optionId: string) => {
        if (readOnly) return;
        replaceDocument(selectStoryTavernAuthorOption(draft.document, sectionKey, optionId));
    };
    const inspectAuthorSection = (sectionKey: string, id: string) => {
        setInspectedAuthor({ sectionKey, promptId: id });
    };
    const moveGroup = (key: string, direction: -1 | 1) => {
        if (readOnly || query) return;
        const ordered = [...groups];
        const index = ordered.findIndex(group => group.key === key);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= ordered.length || ordered[index].autoGrouped || ordered[target].autoGrouped) return;
        [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
        const byId = new Map(draft.document.prompts.map(prompt => [prompt.id, prompt]));
        patchDocument({ prompts: ordered.flatMap(group => group.promptIds.map(id => byId.get(id)).filter((prompt): prompt is StoryTheaterPresetPrompt => Boolean(prompt))) });
    };
    const movePrompt = (id: string, direction: -1 | 1) => {
        const index = activePrompts.findIndex(prompt => prompt.id === id);
        const target = index + direction;
        if (readOnly || index < 0 || target < 0 || target >= activePrompts.length) return;
        const prompts = [...draft.document.prompts];
        const fromIndex = prompts.findIndex(prompt => prompt.id === id);
        const toIndex = prompts.findIndex(prompt => prompt.id === activePrompts[target].id);
        [prompts[fromIndex], prompts[toIndex]] = [prompts[toIndex], prompts[fromIndex]];
        patchDocument({ prompts });
    };
    const addPrompt = () => {
        if (!activeGroup || activeGroup.protected || readOnly) return;
        const next: StoryTheaterPresetPrompt = { id: makeStoryTheaterId(), name: '新提示词', enabled: true, role: 'system', content: '' };
        const prompts = [...draft.document.prompts];
        const last = prompts[activeGroup.endIndex];
        const insertAt = last && isStoryPresetSectionMarker(last) ? activeGroup.endIndex : activeGroup.endIndex + 1;
        prompts.splice(insertAt, 0, next);
        patchDocument({ prompts });
        tavernBrowse ? openPrompt(next.id) : setSelectedId(next.id);
    };
    const addGroup = () => {
        if (readOnly || !newGroupName.trim()) return;
        const document = addStoryPresetGroup(draft.document, newGroupName);
        replaceDocument(document);
        const added = getStoryPresetPromptGroups(document).at(-1);
        pendingScrollRef.current = 0;
        setActiveGroupKey(added?.key || null);
        setSelectedId('');
        setNewGroupName('');
    };
    const removePrompt = (id: string) => {
        const prompt = draft.document.prompts.find(item => item.id === id);
        if (!prompt || readOnly || isProtectedStoryPrompt(prompt)) return;
        patchDocument({ prompts: draft.document.prompts.filter(item => item.id !== id) });
        if (selectedId === id) setSelectedId('');
    };
    const save = async () => {
        if (readOnly) { await onOpenCopy(duplicateStoryPreset(draft)); return; }
        setSaving(true);
        try { await onSave({ ...draft, name: draft.document.name.trim() || '未命名剧情预设', updatedAt: Date.now() }); }
        finally { setSaving(false); }
    };

    const removePreset = async () => {
        if (!onDelete || deleting || usedByStoryCount > 0) return;
        setDeleting(true);
        setDeleteError('');
        try { await onDelete(draft); }
        catch (error) {
            setDeleteError(error instanceof Error ? error.message : '删除失败，请重试');
        } finally {
            setDeleting(false);
        }
    };

    const renderGenerationFields = () => <>
        <div className='mt-5 divide-y divide-slate-200 border-y border-slate-200'>
            {STORY_GENERATION_FIELDS.map(([key, label, technicalLabel, min, max, step, help]) => <label key={key} className='block py-4'>
                <span className='flex items-center gap-4'><span className='min-w-0 flex-1'><strong className='block text-xs text-slate-700'>{label}</strong><span className='mt-0.5 block text-[8px] uppercase tracking-wide text-slate-400'>{technicalLabel}</span></span><input disabled={readOnly} type='number' min={min} max={max} step={step} value={draft.document.generation[key]} onChange={event => patchDocument({ generation: { ...draft.document.generation, [key]: Number(event.target.value) } })} className='w-24 shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-right text-sm font-semibold outline-none disabled:opacity-50' /></span>
                
            </label>)}
        </div>
        {draft.document.generation.temperature > 1 && <p className='mt-2 text-[10px] text-amber-700'>Claude 温度上限为 1.0。</p>}
    </>;

    const renderGeneration = () => <section>
        <button onClick={leaveGroup} className='mb-5 text-[10px] font-bold text-violet-600'>← 返回大分类</button>
        <div className='text-[9px] uppercase tracking-[.22em] font-bold text-violet-500'>Professional</div><h2 className='mt-1 text-2xl font-serif font-semibold'>续写参数</h2>
        
        {renderGenerationFields()}
        <label className='block mt-4'><span className='text-[10px] text-slate-500'>正文起笔</span><textarea disabled={readOnly} value={draft.document.assistantPrefill || ''} onChange={event => patchDocument({ assistantPrefill: event.target.value })} className='mt-1 w-full min-h-24 p-3 rounded-xl bg-white border border-slate-200 font-mono text-[11px] disabled:opacity-50' /></label>
    </section>;

    const renderGroupDetails = () => {
        if (!activeGroup) return null;
        return <section>
            <button onClick={leaveGroup} className='mb-5 text-[10px] font-bold text-violet-600'>← 返回大分类</button>
            <div className='flex items-start justify-between gap-4'><div><div className='text-[9px] uppercase tracking-[.22em] font-bold text-violet-500'>Professional</div><h2 className='mt-1 text-2xl font-serif font-semibold'>{activeGroup.label}</h2></div>{activeGroup.protected && <span className='shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-100 text-[9px] font-bold text-amber-700'><LockSimple size={12} />受保护</span>}</div>
            
            {activeGroup.customSectionId && !readOnly && <div className='mt-5 space-y-3'>
                <label className='block text-xs text-slate-500'>分组名称<input aria-label='分组名称' value={activeGroup.label} onChange={event => replaceDocument(renameStoryPresetGroup(draft.document, activeGroup.customSectionId!, event.target.value))} onBlur={event => replaceDocument(renameStoryPresetGroup(draft.document, activeGroup.customSectionId!, event.target.value.trim() || '自定义分组'))} className='mt-2 w-full p-3 rounded-xl bg-white border border-slate-200 text-slate-800' /></label>
                <button onClick={() => { replaceDocument(ungroupStoryPresetGroup(draft.document, activeGroup.customSectionId!)); leaveGroup(); }} className='text-xs text-slate-500 underline'>取消分组，保留所有条目</button>
            </div>}
            {tavernBrowse && !quickEdit && <div className='mt-5'>
                <input aria-label='搜索组内提示词' value={promptQuery} onChange={event => setPromptQuery(event.target.value)}
                    placeholder='搜索本组提示词名称或内容' className='w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs outline-none focus:border-violet-300' />
                <p className='mt-2 text-[10px] text-slate-500'>显示 {visiblePrompts.length}/{activePrompts.length} 条 · 原文、开关和顺序不变</p>
            </div>}
            {!quickEdit && tavernBrowse && <div className='mt-3 flex items-center justify-between'>
                <span className='text-[10px] text-slate-400'>空白／结构占位默认收起</span>
                <button type='button' aria-pressed={showEmptyEntries} onClick={() => setShowEmptyEntries(value => !value)} className='text-[10px] font-semibold text-violet-600'>{showEmptyEntries ? '隐藏空条目' : '显示空条目'}</button>
            </div>}
            {!quickEdit && <div className='mt-4 border-y border-slate-200 divide-y divide-slate-200'>
                {visiblePrompts.map(prompt => { const index = promptIndexes.get(prompt.id) ?? 0; const locked = activeGroup.protected || isProtectedStoryPrompt(prompt); const kind = storyPresetPromptKind(prompt); return <div key={prompt.id} className={`flex items-center gap-2 py-3 ${selectedId === prompt.id ? 'text-violet-700' : ''}`}>
                    <button disabled={readOnly || (locked && !(draft.document.sourceFormat === 'sillytavern' && prompt.id.startsWith('st-') && prompt.marker))} onClick={() => patchPrompt(prompt.id, { enabled: !prompt.enabled })} className={`w-9 shrink-0 text-[9px] font-bold disabled:opacity-50 ${prompt.enabled ? 'text-emerald-600' : 'text-slate-300'}`}>{prompt.enabled ? 'ON' : 'OFF'}</button>
                    <button onClick={() => tavernBrowse ? openPrompt(prompt.id) : setSelectedId(prompt.id)} className='min-w-0 flex-1 text-left'><span className='block text-xs font-semibold truncate'>{index + 1}. {prompt.name}</span><span className='block mt-1 text-[9px] text-slate-400'>{kind === 'empty' ? '空白条目' : kind === 'placeholder' ? '无效占位' : kind === 'structure' ? '结构边界' : locked ? '系统连接位 · 内容锁定' : STORY_ROLE_LABELS[prompt.role]}</span></button>
                    {!readOnly && <span className='flex shrink-0'><button disabled={Boolean(tavernBrowse && query) || index === 0} onClick={() => movePrompt(prompt.id, -1)} className='p-1.5 text-slate-400 disabled:opacity-20'><ArrowUp size={14} /></button><button disabled={Boolean(tavernBrowse && query) || index === activePrompts.length - 1} onClick={() => movePrompt(prompt.id, 1)} className='p-1.5 text-slate-400 disabled:opacity-20'><ArrowDown size={14} /></button>{!locked && <button onClick={() => removePrompt(prompt.id)} className='p-1.5 text-rose-400'><Trash size={14} /></button>}</span>}
                </div>; })}
                {visiblePrompts.length === 0 && <p className='py-7 text-center text-xs text-slate-400'>此分组没有有效正文。{!showEmptyEntries && '可点「显示空条目」检查原始内容。'}</p>}
            </div>}
            {!quickEdit && !activeGroup.protected && !readOnly && <button onClick={addPrompt} className='mt-4 h-10 px-4 rounded-xl bg-white border border-slate-200 text-xs font-bold flex items-center gap-1'><Plus size={14} />在本区新增提示词</button>}
            {selected && <div className={quickEdit ? 'mt-5 pt-5 border-t border-slate-200' : 'mt-7 pt-6 border-t border-slate-200'}>
                {quickEdit && <button onClick={closePrompt} className='mb-5 text-xs font-semibold text-violet-600'>← 返回提示词列表</button>}
                {quickEdit && <div className='mb-4 text-xs font-semibold text-slate-700 break-words'>{selected.name}</div>}
                {activeGroup.protected || isProtectedStoryPrompt(selected) ? <div className='py-8 text-center'><LockSimple size={28} className='mx-auto text-amber-400' /><div className='mt-2 text-xs font-bold'>系统连接内容已锁定</div><p className='mt-1 text-[10px] text-slate-400'>你仍可以在上方调整它与其他连接位的顺序。</p></div> : <>
                    <div className='grid grid-cols-2 gap-3'><label><span className='text-[10px] text-slate-500'>名称</span><input disabled={readOnly} value={selected.name} onChange={event => patchPrompt(selected.id, { name: event.target.value })} className='mt-1 w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-xs' /></label><label><span className='text-[10px] text-slate-500'>消息位置</span><select disabled={readOnly} value={selected.role} onChange={event => patchPrompt(selected.id, { role: event.target.value as StoryTheaterPresetPrompt['role'] })} className='mt-1 w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-xs'><option value='system'>规则</option><option value='user'>你</option><option value='assistant'>正文</option></select></label></div>
                    <textarea disabled={readOnly} value={selected.content} onChange={event => patchPrompt(selected.id, { content: event.target.value })} className='mt-3 w-full min-h-64 p-4 rounded-2xl bg-white border border-slate-200 font-mono text-[11px] leading-6 resize-y' placeholder='支持 {{user}} / {{char}} / {{group}}' />
                    {!readOnly && groups.some(group => !group.protected && !group.autoGrouped && group.key !== activeGroup.key) && <label className='mt-3 block text-xs text-slate-500'>移动到分组<select aria-label='移动到分组' value='' onChange={event => { const target = event.target.value; if (!target) return; replaceDocument(moveStoryPresetPromptToGroup(draft.document, selected.id, target)); setActiveGroupKey(target); }} className='mt-2 w-full p-3 rounded-xl bg-white border border-slate-200'><option value=''>选择目标分组</option>{groups.filter(group => !group.protected && !group.autoGrouped && group.key !== activeGroup.key).map(group => <option key={group.key} value={group.key}>{group.label}</option>)}</select></label>}
                </>}
            </div>}
        </section>;
    };

    return <div className='relative h-full w-full flex flex-col bg-stone-100 text-slate-800'>
        <header className='story-safe-header shrink-0 border-b border-slate-200'>
            <div className='h-16 px-4 flex items-center gap-3'>
                <button onClick={handleBack} className='w-9 h-9 rounded-full grid place-items-center' aria-label='返回上一级'><ArrowLeft size={20} /></button>
                <div className='min-w-0 flex-1'><div className='text-[9px] uppercase tracking-[.24em] font-bold text-violet-500'>Preset maker</div><div className='font-semibold truncate'>预设制作器</div></div>
                {readOnly && <span className='hidden sm:inline-flex text-[9px] px-2 py-1 rounded-full bg-amber-100 text-amber-700 font-bold'>内置只读</span>}
                <button onClick={() => { void downloadStoryPreset(draft); }} className='w-9 h-9 shrink-0 rounded-full bg-white border border-slate-200 grid place-items-center' title='导出宝宝狗原生预设'><DownloadSimple size={16} /></button>
                <button onClick={save} className='h-9 px-3 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center gap-1.5'>{readOnly ? <Copy size={14} /> : <FloppyDisk size={14} />}{readOnly ? '复制调整' : saving ? '保存中' : '保存'}</button>
            </div>
            <div className='mx-5 mb-4 grid grid-cols-2 p-1 rounded-xl bg-slate-200'>
                <button onClick={() => switchMode('simple')} className={`py-2 rounded-lg text-xs font-bold ${mode === 'simple' ? 'bg-white shadow-sm text-violet-700' : 'text-slate-500'}`}>默认版</button>
                <button onClick={() => switchMode('pro')} className={`py-2 rounded-lg text-xs font-bold ${mode === 'pro' ? 'bg-white shadow-sm text-violet-700' : 'text-slate-500'}`}>专业版</button>
            </div>
        </header>

        <main ref={mainScrollRef} className='story-page-scroll flex-1 overflow-y-auto px-5 py-6 pb-24'>
            <div className='max-w-2xl mx-auto'>
                {!readOnly && usedByStoryCount > 0 && <section role='status' className='mb-5 rounded-xl border border-amber-200 px-3 py-3 text-[10px] leading-5 text-amber-800'>
                    这份预设正在被 {usedByStoryCount} 条剧情使用。直接保存修改，会改变这些剧情之后的续写规则。
                    <button type='button' disabled={saving} onClick={() => void onOpenCopy(duplicateStoryPreset(draft))}
                        className='mt-2 block font-semibold underline underline-offset-2'>复制为独立预设（不影响原剧情）</button>
                </section>}
                {mode === 'simple' ? <>
                    <section className='pb-5 border-b border-slate-200'>
                        <div className='text-[9px] uppercase tracking-[.22em] font-bold text-violet-500'>Easy controls</div>
                        <h1 className='mt-1 text-[25px] font-serif font-semibold'>{tavernBrowse ? '原作选择' : '只调看得懂的部分'}</h1>
                        <p className='mt-3 text-[11px] leading-6 text-slate-500'>{tavernBrowse
                            ? '按原作者的选项切换真实规则；需要调整完整内容时，可打开专业版。'
                            : '角色、世界书、历史注入和底层发送结构由宝宝狗照管。这里的选择不会修改角色档案。'}</p>
                        {readOnly && <p className='mt-3 text-[10px] text-amber-700'>这是内置原版。点右上角“复制调整”后即可保存你的选择。</p>}
                    </section>
                    {tavernBrowse ? <div className='pt-4 space-y-2.5'>
                        {authorSections.length ? authorSections.map((section, index) => {
                            const on = section.options.filter(option => option.enabled);
                            const expanded = expandedAuthorSections[section.key] ?? (index === 0 && section.options.length <= 10);
                            const current = on.length
                                ? on.slice(0, 2).map(option => option.label).join('、') + (on.length > 2 ? ' 等' : '')
                                : '未启用';
                            return <section key={section.key} className='overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_2px_9px_rgba(15,23,42,0.025)]'>
                                <button type='button' aria-expanded={expanded}
                                    aria-label={`展开或收起${section.label}`}
                                    onClick={() => setExpandedAuthorSections(state => ({ ...state, [section.key]: !expanded }))}
                                    className='flex w-full items-center gap-3 px-4 pt-3.5 pb-2 text-left'>
                                    <span className='min-w-0 flex-1 text-[13px] font-bold leading-5 text-slate-800 break-words'>{section.label}</span>
                                    <span className='shrink-0 text-[10px] tabular-nums text-slate-400'>
                                        {section.single ? '单选' : `${on.length} 项启用`}
                                    </span>
                                    <CaretDown size={14} className={`shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                                </button>
                                <p className='px-4 pb-3 text-[11px] leading-4 text-slate-500 line-clamp-1' title={current}>{current}</p>
                                {expanded && <div className='border-t border-slate-100 px-3 pt-3 pb-2.5'>
                                    <div className='flex flex-wrap gap-2'>{section.options.map(option =>
                                        <button key={option.id} type='button' disabled={readOnly}
                                            aria-pressed={option.enabled}
                                            aria-label={`${section.label}：${option.label}${option.enabled ? '（已启用）' : '（未启用）'}`}
                                            title={option.name}
                                            onClick={() => chooseAuthorOption(section.key, option.id)}
                                            className={`min-h-9 max-w-full rounded-xl border px-3 py-2 text-left text-[11px] font-semibold leading-4 transition-colors disabled:opacity-60 ${option.enabled
                                                ? 'border-slate-900 bg-slate-900 text-white'
                                                : 'border-slate-200 bg-slate-50 text-slate-700 active:bg-slate-100'}`}>
                                            <span className='block break-words [overflow-wrap:anywhere]'>{option.label}</span>
                                            {option.preview && <span className={`mt-0.5 block text-[10px] font-normal ${option.enabled ? 'text-slate-300' : 'text-slate-500'}`}>{option.preview}</span>}
                                        </button>,
                                    )}</div>
                                    <div className='mt-3 flex justify-end border-t border-slate-100 pt-2.5'>
                                        <button type='button' onClick={() => inspectAuthorSection(section.key, (on[0] || section.options[0]).id)}
                                            className='shrink-0 rounded-lg px-1.5 py-1 text-[10px] font-semibold text-slate-600 underline decoration-slate-300 underline-offset-4'>
                                            查看原文
                                        </button>
                                    </div>
                                </div>}
                            </section>;
                        }) : <p className='py-6 text-xs text-slate-400'>无可选分组</p>}
                    </div> : <div className='divide-y divide-slate-200'>{STORY_PRESET_SIMPLE_CHOICES.filter(choice =>
                        choice.ids.some(id => draft.document.prompts.some(prompt => prompt.id === id))).map(choice => {
                        const nativeActive = choice.ids.find(id => draft.document.prompts.find(prompt => prompt.id === id)?.enabled);
                        return <section key={choice.label} className='py-6'><h2 className='text-sm font-bold'>{choice.label}</h2>
                            <div className='mt-3 flex flex-wrap gap-2'>{choice.options.map(option => {
                                const selectedOption = option.id ? nativeActive === option.id : !nativeActive;
                                return <button key={option.id || 'default'} disabled={readOnly} onClick={() => selectSimpleChoice(choice, option.id)}
                                    className={`px-3 py-2 rounded-full border text-[11px] font-semibold disabled:opacity-60 ${selectedOption ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-200 text-slate-600'}`}>{option.label}</button>;
                            })}</div></section>;
                    })}</div>}
                    <section className='py-6 border-t border-slate-200'><h2 className='text-sm font-bold'>续写参数</h2>{renderGenerationFields()}</section>
                    {!readOnly && <section className='pt-5 border-t border-slate-200'><label><span className='text-[10px] font-bold text-slate-500'>预设名称</span><input value={draft.document.name} onChange={event => patchDocument({ name: event.target.value })} className='mt-2 w-full px-3 py-3 rounded-xl bg-white border border-slate-200 text-sm' /></label></section>}
                </> : activeGroupKey === '__generation__' ? renderGeneration() : activeGroup ? renderGroupDetails() : <>
                    <section className='pb-5 border-b border-slate-200'><div className='text-[9px] uppercase tracking-[.22em] font-bold text-violet-500'>Professional</div><h1 className='mt-1 text-3xl font-serif font-semibold'>先选大区，再看细节</h1></section>
                    {tavernBrowse && <div className='mt-4 flex items-center justify-between'><span className='text-[10px] text-slate-400'>有效正文和动态槽位单独计数</span><button type='button' aria-pressed={showEmptyEntries} onClick={() => setShowEmptyEntries(value => !value)} className='text-[10px] font-semibold text-violet-600'>{showEmptyEntries ? '隐藏空条目' : '显示空条目'}</button></div>}
                    {!readOnly && <div className='flex gap-2 py-4'><input aria-label='新分组名称' value={newGroupName} onChange={event => setNewGroupName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') addGroup(); }} placeholder='新分组名称' className='min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs' /><button disabled={!newGroupName.trim()} onClick={addGroup} className='shrink-0 flex items-center gap-1 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-40'><Plus size={14} />新增分组</button></div>}
                    {tavernBrowse && <div className='mb-3'>
                        <input aria-label='搜索酒馆预设提示词' value={promptQuery} onChange={event => setPromptQuery(event.target.value)}
                            placeholder='搜索分类或全部提示词…' className='w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs outline-none focus:border-violet-300' />
                        
                    </div>}
                    <div className='divide-y divide-slate-200'>{matchingGroups.map(group => {
                        const index = groups.findIndex(item => item.key === group.key);
                        const counts = groupCounts.get(group.key) || { total: 0, usable: 0, enabled: 0 };
                        return <div key={group.key} className='py-4 flex items-center gap-3'><button onClick={() => enterGroup(group.key)} className='min-w-0 flex-1 text-left'><span className='flex items-center gap-2'><strong className='text-sm'>{group.label}</strong>{group.protected && <LockSimple size={13} className='text-amber-500' />}</span><span className='block mt-1 text-[9px] text-violet-500'>{tavernBrowse ? `${counts.usable} 条有效 · ${counts.total - counts.usable} 条占位／空白` : `${counts.enabled}/${counts.total} 条启用`}</span></button>{!readOnly && !group.autoGrouped && <span className='flex shrink-0'><button disabled={Boolean(query) || group.autoGrouped || index === 0 || groups[index - 1]?.autoGrouped} onClick={() => moveGroup(group.key, -1)} className='p-2 text-slate-400 disabled:opacity-20'><ArrowUp size={15} /></button><button disabled={Boolean(query) || group.autoGrouped || index === groups.length - 1 || groups[index + 1]?.autoGrouped} onClick={() => moveGroup(group.key, 1)} className='p-2 text-slate-400 disabled:opacity-20'><ArrowDown size={15} /></button></span>}</div>;
                    })}<button onClick={() => enterGroup('__generation__')} className='w-full py-5 text-left'><strong className='text-sm'>续写参数</strong></button></div>
                    {!readOnly && <section className='pt-6 border-t border-slate-200 grid gap-3 sm:grid-cols-2'><label><span className='text-[10px] font-bold text-slate-500'>预设名称</span><input value={draft.document.name} onChange={event => patchDocument({ name: event.target.value })} className='mt-1 w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-sm' /></label><label><span className='text-[10px] font-bold text-slate-500'>说明</span><input value={draft.document.description || ''} onChange={event => patchDocument({ description: event.target.value })} className='mt-1 w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-sm' /></label></section>}
                    {!readOnly && onDelete && <section className='mt-8 border-t border-slate-200 pt-4'>
                        {!confirmDelete ? <button type='button' onClick={() => { setConfirmDelete(true); setDeleteError(''); }}
                            className='w-full py-3 text-xs font-bold text-rose-500'>删除这个预设</button> : <div className='rounded-xl border border-rose-200 px-3 py-3'>
                            <p className='text-xs font-semibold text-rose-700'>确认删除「{draft.name}」？</p>
                            <p className='mt-2 text-[10px] text-slate-500'>{usedByStoryCount > 0 ? `仍有 ${usedByStoryCount} 条剧情在使用` : '删除后无法撤销'}</p>
                            <div className='mt-3 flex gap-2'>
                                <button type='button' disabled={deleting} onClick={() => setConfirmDelete(false)}
                                    className='min-h-10 flex-1 rounded-lg border border-slate-200 bg-white text-xs'>取消</button>
                                <button type='button' disabled={deleting || usedByStoryCount > 0} onClick={() => void removePreset()}
                                    className='min-h-10 flex-1 rounded-lg bg-rose-600 text-white text-xs font-semibold disabled:opacity-40'>
                                    {deleting ? '正在删除…' : '确认删除'}</button>
                            </div>
                            {deleteError && <p role='alert' className='mt-2 text-[10px] leading-5 text-rose-600'>{deleteError}</p>}
                        </div>}
                    </section>}
                </>}
            </div>
        </main>
        {inspectedAuthor && inspectedSection && <section role='dialog' aria-modal='true' aria-label='查看原作者原文'
            className='absolute inset-0 z-50 flex flex-col bg-stone-100 text-slate-800'>
            <header className='story-safe-header shrink-0 border-b border-slate-200 bg-stone-100'>
                <div className='h-16 px-4 flex items-center gap-3'>
                    <button type='button' onClick={() => setInspectedAuthor(null)} className='w-9 h-9 rounded-full grid place-items-center' aria-label='返回原作选择'><ArrowLeft size={20} /></button>
                    <div className='min-w-0 flex-1'><div className='text-[9px] uppercase tracking-[.2em] text-violet-500'>Original text</div><div className='truncate text-sm font-semibold'>{inspectedSection.label}</div></div>
                    <span className='text-[10px] text-slate-400'>{inspectedSection.options.length} 条</span>
                </div>
            </header>
            <div className='flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-5 pb-24'>
                <div className='mx-auto max-w-2xl'>
                    <div className='flex flex-wrap gap-2 pb-4 border-b border-slate-200'>
                        {inspectedSection.options.map(option => <button key={option.id} type='button'
                            aria-pressed={inspectedAuthor.promptId === option.id}
                            onClick={() => setInspectedAuthor({ sectionKey: inspectedSection.key, promptId: option.id })}
                            className={`rounded-xl border px-3 py-2 text-[11px] font-semibold break-words ${inspectedAuthor.promptId === option.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>{option.label}</button>)}
                    </div>
                    <h2 className='mt-5 text-sm font-semibold break-words'>{inspectedPrompt?.name || ''}</h2>
                    <div className='mt-1 text-[10px] text-slate-400'>{inspectedPrompt?.enabled ? '已启用' : '未启用'} · 仅查看，不修改原文</div>
                    <pre className='mt-4 min-h-52 whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-2xl border border-slate-200 bg-white p-4 font-mono text-[11px] leading-6 text-slate-700'>{inspectedPrompt?.content || '（空条目）'}</pre>
                </div>
            </div>
        </section>}
    </div>;
};

export default StoryPresetMaker;
