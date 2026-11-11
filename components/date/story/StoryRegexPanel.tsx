import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CaretRight, FloppyDisk, Plus, SpinnerGap, Trash, UploadSimple } from '@phosphor-icons/react';
import type { StoryTheaterPreset } from '../../../types';
import { STORY_TEMPLATE_MAX_LENGTH, validateStoryRegexRule, type StoryRegexResult, type StoryRegexRule } from '../../../utils/storyRegex';
import { compressPhoneAppearanceImage } from '../../../utils/characterPhoneAppearance';
import { runStoryRegex } from '../../../utils/storyRegexRunner';
import { MAX_STORY_REGEX_FILE_BYTES, mergeStoryRegexImport, parseStoryRegexImport, type StoryRegexImportResult } from '../../../utils/storyRegexImport';
import { splitStoryRegexOutput } from '../../../utils/storyRegexDisplay';
import { alchemyDomain, type AlchemyDomain } from '../../../utils/alchemyRegex';
import { useOS } from '../../../context/OSContext';
import { SafeStoryHtml } from './StoryTheaterSession';

interface Props {
    domain?: AlchemyDomain;
    rules: StoryRegexRule[];
    presets: StoryTheaterPreset[];
    onSave: (update: (rules: StoryRegexRule[]) => StoryRegexRule[]) => Promise<void>;
    onBack: () => void;
}

const fieldClass = 'mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal text-slate-800';
const actionClass = 'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-40';
const primaryClass = 'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full bg-slate-900 px-3 text-xs font-bold text-white disabled:opacity-40';
const iconClass = 'grid w-10 h-10 shrink-0 place-items-center rounded-full border border-slate-200 bg-white disabled:opacity-40';


function createRule(): StoryRegexRule {
    return {
        id: crypto.randomUUID(), name: '', enabled: true, presetId: '', kind: 'filter',
        pattern: '', flags: 'g', replacement: '', display: true, history: false, instruction: '',
    };
}

const StoryRegexPanel: React.FC<Props> = ({ rules, presets, onSave, onBack, domain = 'offline' }) => {
    const { registerBackHandler } = useOS();
    const [draft, setDraft] = useState<StoryRegexRule | null>(null);
    const [sample, setSample] = useState('');
    const [result, setResult] = useState<StoryRegexResult | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [feedback, setFeedback] = useState('');
    const [imported, setImported] = useState<(StoryRegexImportResult & { filename: string }) | null>(null);
    const [importScope, setImportScope] = useState('');
    const [previewStage, setPreviewStage] = useState<'display' | 'history'>('display');
    const [confirmDelete, setConfirmDelete] = useState(false);
    const test = useRef<AbortController | null>(null);
    const upload = useRef<HTMLInputElement>(null);
    const scrollRef = useRef<HTMLElement>(null);
    const actionLock = useRef(false);
    useEffect(() => () => test.current?.abort(), []);
    const isTemplate = draft?.kind === 'template';
    const previewParts = result ? splitStoryRegexOutput(result) : [];
    const screen = imported ? 'import' : draft ? 'edit' : 'list';
    const visibleRules = rules.filter(rule => alchemyDomain(rule) === domain);
    const folders = new Map<string, Map<string, StoryRegexRule[]>>();
    for (const rule of visibleRules) {
        const folder = rule.importGroup || '旧版规则';
        const category = rule.subcategory || rule.source?.category || (rule.kind === 'template' ? '互动卡片' : '文字规则');
        if (!folders.has(folder)) folders.set(folder, new Map());
        const groups = folders.get(folder)!;
        if (!groups.has(category)) groups.set(category, []);
        groups.get(category)!.push(rule);
    }
    useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [screen]);

    const open = (rule: StoryRegexRule | null) => {
        setDraft(rule);
        setSample('');
        setResult(null);
        setError('');
        setConfirmDelete(false);
        setPreviewStage(rule?.kind === 'filter' && !rule.display && rule.history ? 'history' : 'display');
    };
    const goBack = () => {
        if (actionLock.current) return;
        if (imported) { setImported(null); setError(''); }
        else if (draft) open(null);
        else onBack();
    };
    const backRef = useRef(goBack);
    backRef.current = goBack;
    useEffect(() => registerBackHandler?.(() => { backRef.current(); return true; }), [registerBackHandler]);
    const patch = (change: Partial<StoryRegexRule>) => {
        setDraft(current => current && { ...current, ...change });
        setResult(null);
        setError('');
        setConfirmDelete(false);
    };
    const perform = async (task: () => Promise<void>) => {
        if (actionLock.current) return;
        actionLock.current = true;
        setBusy(true);
        setError('');
        try {
            await task();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : '剧情正则操作失败');
        } finally {
            actionLock.current = false;
            setBusy(false);
        }
    };
    const save = (update: (rules: StoryRegexRule[]) => StoryRegexRule[], closeEditor = false) =>
        perform(async () => {
            await onSave(update);
            if (closeEditor) open(null);
        });
    const saveDraft = () => {
        if (!draft) return;
        try {
            validateStoryRegexRule(draft);
            const rule = { ...draft, name: draft.name.trim(), instruction: draft.instruction.trim(), domain: draft.kind === 'template' ? 'online' as const : (draft.domain || domain) };
            const existing = rules.some(item => item.id === rule.id);
            void save(current => {
                if (existing && !current.some(item => item.id === rule.id)) throw new Error('此规则已在另一窗口删除');
                return existing ? current.map(item => item.id === rule.id ? rule : item) : [...current, rule];
            }, true);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : '正则规则无效');
        }
    };
    const readImport = (file: File) => perform(async () => {
        if (file.size > MAX_STORY_REGEX_FILE_BYTES) throw new Error('正则文件超过 4 MB，请分批导出');
        const raw = await file.text();
        const parsed = parseStoryRegexImport(raw);
        const folderName = file.name.replace(/\.(?:json|txt)$/i, '') || '导入的正则';
        parsed.rules = parsed.rules.map(rule => ({
            ...rule,
            // Imported HTML card templates always belong to online beauty.
            domain: rule.kind === 'template' ? 'online' as const : domain,
            importGroup: folderName,
            subcategory: rule.source?.category || (rule.kind === 'template' ? '互动卡片' : '文字规则'),
        }));
        setFeedback('');
        setImportScope('');
        setImported({ ...parsed, filename: file.name });
    });
    const confirmImport = () => {
        if (!imported?.rules.length) return;
        void perform(async () => {
            let merge = { added: 0, updated: 0, duplicates: 0 };
            await onSave(current => {
                const result = mergeStoryRegexImport(current, imported.rules, importScope);
                merge = result;
                return result.rules;
            });
            const counts = [`已导入 ${merge.added} 条`, merge.updated ? `补全旧规则 ${merge.updated} 条` : '', merge.duplicates ? `跳过重复 ${merge.duplicates} 条` : '',
                imported.rejected ? `未转换 ${imported.rejected} 条` : ''].filter(Boolean);
            setFeedback(counts.join(' · '));
            setImported(null);
        });
    };
    const loadTemplateFile = (file: File, image: boolean) => {
        if (!draft) return;
        return perform(async () => {
            if (!image && file.size > STORY_TEMPLATE_MAX_LENGTH * 4) throw new Error('HTML 文件过长');
            const replacement = image
                ? [draft.replacement, `<img src="${await compressPhoneAppearanceImage(file)}" alt="界面截图">`].filter(Boolean).join('\n')
                : await file.text();
            if (replacement.length > STORY_TEMPLATE_MAX_LENGTH) throw new Error('模板过长，请缩小截图尺寸或压缩内嵌图片');
            patch({ replacement });
        });
    };
    const preview = () => {
        if (!draft) return;
        return perform(async () => {
            setResult(null);
            const controller = new AbortController();
            test.current = controller;
            const stage = draft.kind === 'template' || !draft.history ? 'display' : draft.display ? previewStage : 'history';
            const rule = { ...draft, name: draft.name || '试跑', enabled: true, display: stage === 'display', history: stage === 'history' };
            validateStoryRegexRule(rule);
            const [output] = await runStoryRegex([{ text: sample, role: draft.role === 'user' ? 'user' : 'assistant' }],
                [rule], stage, controller.signal, { user: '用户', char: '角色' });
            if (!controller.signal.aborted) setResult(output);
        });
    };
    const scopeName = (presetId: string) => domain === 'online' ? '全部私聊 / 群聊' : presetId
        ? presets.find(preset => preset.id === presetId)?.name || '预设已移除' : '全部剧情 / 见面';
    const scopeOptions = (presetId: string) => <>
        <option value=''>所有剧情预设</option>
        {presetId && !presets.some(preset => preset.id === presetId) && <option value={presetId}>预设已移除</option>}
        {presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
    </>;
    return <div className='h-full w-full flex flex-col bg-stone-100 text-slate-800'>
        <header className='story-safe-header shrink-0 border-b border-slate-200'>
            <div className='h-16 px-4 flex items-center gap-3'>
                <button type='button' disabled={busy} aria-label='返回' onClick={goBack}
                    className='w-9 h-9 shrink-0 grid place-items-center rounded-full'><ArrowLeft size={20} /></button>
                <h1 className='min-w-0 flex-1 truncate font-semibold'>{imported ? '导入正则' : draft ? '编辑正则' : domain === 'online' ? '美化正则 · 线上聊天' : '规则正则 · 剧情见面'}</h1>
                {screen === 'list' ? <>
                    <button type='button' aria-label='导入糯叽机正则' title='导入糯叽机正则' disabled={busy}
                        onClick={() => upload.current?.click()} className={iconClass}>
                        {busy ? <SpinnerGap size={17} className='animate-spin' /> : <UploadSimple size={17} />}
                    </button>
                    <button type='button' aria-label='新建正则' disabled={busy} onClick={() => open(createRule())}
                        className={iconClass}><Plus size={17} /></button>
                    <input type='file' ref={upload} accept='.json,application/json' hidden onChange={event => {
                        const file = event.currentTarget.files?.[0];
                        event.currentTarget.value = '';
                        if (file) void readImport(file);
                    }} />
                </> : draft && <button type='button' disabled={busy} onClick={saveDraft} className={primaryClass}>
                    <FloppyDisk size={15} />保存规则
                </button>}
            </div>
        </header>
        <main ref={scrollRef} className='story-page-scroll min-h-0 flex-1 overflow-y-auto px-5 py-6 pb-24'>
            <div className='mx-auto max-w-2xl space-y-4'>
                {error && <p role='alert' className='rounded-xl border border-rose-200 px-3 py-2.5 text-xs leading-5 text-rose-700'>{error}</p>}
                {imported ? <>
                    <section className='border-b border-slate-200 pb-4'>
                        <h2 className='break-all text-base font-semibold'>{imported.filename}</h2>
                        <p className='mt-2 text-xs leading-5 text-slate-500'>可转换 {imported.rules.length} 条
                            {imported.rejected ? ` · 无法转换 ${imported.rejected} 条` : ''}</p>
                    </section>
                    {domain === 'offline' && imported.rules.length > 0 && <label className='block text-xs font-semibold'>适用预设
                        <select className={fieldClass} disabled={busy} aria-label='适用预设' value={importScope}
                            onChange={event => setImportScope(event.target.value)}>{scopeOptions(importScope)}</select>
                    </label>}
                    {imported.warnings.length > 0 && <section className='rounded-xl border border-amber-200 px-3 py-3 text-xs leading-5 text-amber-700'>
                        <h2 className='font-semibold'>转换提示</h2>
                        <ul className='mt-1 space-y-1 break-words'>{imported.warnings.map((note, index) => <li key={index}>{note}</li>)}</ul>
                    </section>}
                    <div className='divide-y divide-slate-200'>{imported.rules.map(rule => <div key={rule.id}
                        className='flex items-center justify-between gap-3 py-3 text-xs'>
                        <span className='min-w-0 break-words font-semibold'>{rule.name}</span>
                        <span className='shrink-0 text-[11px] text-slate-500'>{rule.domain === 'online' ? '线上美化' : '线下规则'}{rule.enabled ? '' : ' · 停用'}</span>
                    </div>)}</div>
                    <div className='flex justify-end gap-2'>
                        <button type='button' disabled={busy} onClick={goBack} className={actionClass}>取消</button>
                        <button type='button' disabled={busy || !imported.rules.length} onClick={confirmImport} className={primaryClass}>
                            <UploadSimple size={15} />{busy ? '导入中' : '确认导入'}
                        </button>
                    </div>
                </> : !draft ? <>
                    
                    {feedback && <p role='status' className='rounded-xl border border-slate-200 px-3 py-2 text-xs text-violet-700'>{feedback}</p>}
                    {!visibleRules.length && <div className='rounded-3xl border border-dashed border-slate-300 py-9 text-center'>
                        <div className='text-sm font-semibold'>还没有{domain === 'online' ? '美化' : '线下'}正则</div>
                    </div>}
                    <div className='space-y-3'>
                    {Array.from(folders, ([folder, subgroups]) => <details key={folder} className='rounded-xl border border-slate-200 bg-white px-3 py-2' open>
                        <summary className='cursor-pointer text-sm font-semibold'>{folder} · {Array.from(subgroups.values()).reduce((sum, items) => sum + items.length, 0)} 条</summary>
                        {Array.from(subgroups, ([category, items]) => <details key={category} className='ml-2 mt-2 border-l-2 border-slate-100 pl-3' open>
                            <summary className='cursor-pointer text-xs font-semibold text-slate-500'>{category} · {items.length}</summary>
                            {items.map(rule => <div key={rule.id} className='flex items-center gap-3 py-2'>
                        <button type='button' disabled={busy} onClick={() => open(rule)} className='flex min-w-0 flex-1 items-center gap-3 py-2 text-left'>
                            <span className={`h-2 w-2 shrink-0 rounded-full ${rule.enabled ? 'bg-violet-500' : 'bg-slate-300'}`} />
                            <span className='min-w-0 flex-1'>
                                <span className='block break-words text-xs font-semibold'>{rule.name}</span>
                                <span className='mt-1 block truncate text-[11px] text-slate-500'>{rule.kind === 'template' ? 'HTML 美化' : '文字过滤'} · {scopeName(rule.presetId)}</span>
                            </span>
                            <CaretRight size={13} className='shrink-0 text-slate-400' />
                        </button>
                        <button type='button' disabled={busy} aria-pressed={rule.enabled} aria-label={`启用 ${rule.name}`}
                            onClick={() => void save(current => current.map(item => {
                                if (item.id !== rule.id) return item;
                                const next = { ...item, enabled: !item.enabled };
                                if (next.enabled) validateStoryRegexRule(next);
                                return next;
                            }))}
                            className={`${actionClass} shrink-0 ${rule.enabled ? 'text-violet-700' : 'text-slate-500'}`}>
                            {rule.enabled ? '已启用' : '已停用'}
                        </button>
                    </div>)}
                        </details>)}
                    </details>)}
                    </div>
                </> : <fieldset disabled={busy} className='m-0 min-w-0 border-0 p-0 space-y-4 disabled:opacity-70'>
                    <label className='block space-y-1 text-xs font-semibold'>规则名称
                        <input className={fieldClass} value={draft.name} onChange={event => patch({ name: event.target.value })} maxLength={80} />
                    </label>
                    <div className='grid grid-cols-2 gap-2'>
                        <label className='text-xs font-semibold'>导入分组
                            <input className={fieldClass} value={draft.importGroup || ''} maxLength={80}
                                onChange={event => patch({ importGroup: event.target.value })} placeholder='自定义' />
                        </label>
                        <label className='text-xs font-semibold'>小分类
                            <input className={fieldClass} value={draft.subcategory || ''} maxLength={60}
                                onChange={event => patch({ subcategory: event.target.value })} placeholder='未分类' />
                        </label>
                    </div>
                    <label className='block text-xs font-semibold'>生效区域
                        <select className={fieldClass} value={draft.domain || (draft.kind === 'template' ? 'online' : 'offline')}
                            onChange={event => patch({ domain: event.target.value as AlchemyDomain, presetId: '' })}>
                            <option value='online'>美化类 · 私聊 / 群聊</option>
                            {draft.kind !== 'template' && <option value='offline'>规则类 · 剧情 / 见面</option>}
                        </select>
                    </label>
                    {draft.kind === 'filter' && (draft.domain || domain) === 'offline' && <label className='flex items-center gap-2 text-xs'>
                        <input type='checkbox' checked={draft.source?.smartFilter !== false}
                            onChange={event => patch({ source: { ...draft.source, smartFilter: event.target.checked } })} />
                        保护易误删的短词
                    </label>}
                    <div className='grid grid-cols-2 gap-3'>
                        <label className='min-w-0 space-y-1 text-xs font-semibold'>用途
                            <select className={fieldClass} aria-label='用途' value={draft.kind} onChange={event => {
                                const kind = event.target.value as StoryRegexRule['kind'];
                                setPreviewStage('display');
                                patch(kind === 'template' ? { kind, domain: 'online', display: true, presetId: '' } : { kind });
                            }}>
                                <option value='filter'>文字过滤</option><option value='template'>HTML 美化</option>
                            </select>
                        </label>
                        {domain === 'offline' && <label className='min-w-0 space-y-1 text-xs font-semibold'>适用预设
                            <select className={fieldClass} aria-label='适用预设' value={draft.presetId}
                                onChange={event => patch({ presetId: event.target.value })}>{scopeOptions(draft.presetId)}</select>
                        </label>}
                    </div>
                    <div className='grid grid-cols-2 gap-3'>
                        <label className='min-w-0 text-xs font-semibold'>作用对象
                            <select className={fieldClass} aria-label='作用对象' value={draft.role || 'assistant'}
                                onChange={event => patch({ role: event.target.value as StoryRegexRule['role'] })}>
                                <option value='assistant'>角色输出</option><option value='user'>我的推进</option><option value='both'>两者</option>
                            </select>
                        </label>
                        {isTemplate && <label className='min-w-0 text-xs font-semibold'>捕获组格式
                            <select className={fieldClass} aria-label='捕获组格式' value={draft.parseMode || 'text'}
                                onChange={event => patch({ parseMode: event.target.value as StoryRegexRule['parseMode'] })}>
                                <option value='text'>纯文字</option><option value='kv'>键值</option><option value='json'>JSON</option>
                            </select>
                        </label>}
                    </div>
                    <div className='grid grid-cols-[minmax(0,1fr)_4.5rem] gap-3'>
                        <label className='min-w-0 space-y-1 text-xs font-semibold'>匹配正则
                            <textarea className={`${fieldClass} font-mono`} rows={2} value={draft.pattern} spellCheck={false}
                                placeholder={isTemplate ? '<app-card>([\\s\\S]*?)</app-card>' : '<think>[\\s\\S]*?</think>'}
                                onChange={event => patch({ pattern: event.target.value })} />
                        </label>
                        <label className='min-w-0 space-y-1 text-xs font-semibold'>修饰符
                            <input className={`${fieldClass} font-mono`} value={draft.flags} spellCheck={false} placeholder='g'
                                onChange={event => patch({ flags: event.target.value })} />
                        </label>
                    </div>
                    
                    <label className='block space-y-1 text-xs font-semibold'>{isTemplate ? 'HTML 模板' : '替换为'}
                        <textarea className={`${fieldClass} font-mono`} rows={isTemplate ? 7 : 3} value={draft.replacement}
                            maxLength={STORY_TEMPLATE_MAX_LENGTH} spellCheck={false}
                            placeholder={isTemplate ? '<div class="app-card">{{$1}}</div>' : '留空即删除匹配内容'}
                            onChange={event => patch({ replacement: event.target.value })} />
                    </label>
                    {draft.replacementChoices?.map((value, index) => <label key={index} className='block text-xs font-semibold'>
                        随机替换项 {index + 2}
                        <textarea className={`${fieldClass} font-mono`} rows={2} value={value} onChange={event => {
                            patch({ replacementChoices: draft.replacementChoices?.map((item, position) => position === index ? event.target.value : item) });
                        }} />
                    </label>)}
                    {isTemplate ? <>
                        <div className='flex flex-wrap items-center gap-2'>
                            <label className={`${actionClass} cursor-pointer`}>载入 HTML 文件
                                <input type='file' accept='.html,.htm,text/html' className='sr-only' onChange={event => {
                                    const file = event.currentTarget.files?.[0];
                                    event.currentTarget.value = '';
                                    if (file) void loadTemplateFile(file, false);
                                }} />
                            </label>
                            <label className={`${actionClass} cursor-pointer`}>插入截图
                                <input type='file' accept='image/png,image/jpeg,image/webp' className='sr-only' onChange={event => {
                                    const file = event.currentTarget.files?.[0];
                                    event.currentTarget.value = '';
                                    if (file) void loadTemplateFile(file, true);
                                }} />
                            </label>
                        </div>
                        
                        {draft.source && <label className='flex items-center gap-2 text-xs'>
                            <input type='checkbox' checked={draft.display} onChange={event => patch({ display: event.target.checked })} />阅读时显示模板
                        </label>}
                        <label className='block space-y-1 text-xs font-semibold'>输出格式指令（选填）
                            <textarea className={fieldClass} rows={3} value={draft.instruction} maxLength={4000}
                                placeholder='例如：剧情出现手机通知时，用 <app-card>通知正文</app-card> 输出。'
                                onChange={event => patch({ instruction: event.target.value })} />
                        </label>
                    </> : <div className='space-y-2 text-xs'>
                        <p className='font-semibold'>过滤时机</p>
                        <label className='flex items-center gap-2'><input type='checkbox' checked={draft.display}
                            onChange={event => {
                                if (!event.target.checked && draft.history) setPreviewStage('history');
                                patch({ display: event.target.checked });
                            }} />阅读时</label>
                        <label className='flex items-center gap-2'><input type='checkbox' checked={draft.history}
                            onChange={event => {
                                if (!event.target.checked && draft.display) setPreviewStage('display');
                                patch({ history: event.target.checked });
                            }} />续写请求时</label>
                        <p className='text-slate-500'>用 <code>$1</code> 引用捕获组。原始楼层保留，可随时停用规则。</p>
                    </div>}
                    <section className='space-y-3 rounded-2xl border border-slate-200 bg-white p-4'>
                        {!isTemplate && draft.display && draft.history && <label className='block text-xs font-semibold'>试跑时机
                            <select className={fieldClass} aria-label='试跑时机' value={previewStage} onChange={event => {
                                setPreviewStage(event.target.value as 'display' | 'history'); setResult(null);
                            }}><option value='display'>阅读</option><option value='history'>续写请求</option></select>
                        </label>}
                        <label className='block space-y-1 text-xs font-semibold'>测试文本
                            <textarea className={fieldClass} value={sample} rows={3} onChange={event => {
                                setSample(event.target.value);
                                setResult(null);
                            }} placeholder='粘贴一段剧情文本' />
                        </label>
                        <button type='button' disabled={!sample} className={actionClass} onClick={() => void preview()}>试跑规则</button>
                        {result && <div className='space-y-2' aria-live='polite'>
                            <p className='text-xs text-slate-500'>匹配 {result.matches} 处</p>
                            {previewParts.map((part, index) => typeof part === 'string'
                                ? part && <p key={index} className='whitespace-pre-wrap break-words text-sm'>{part}</p>
                                : <SafeStoryHtml key={index} template source={part.html} fallback={part.fallback} title={part.title} />)}
                            {!result.text && <p className='text-xs text-slate-500'>过滤后为空</p>}
                        </div>}
                    </section>
                    <div className='flex flex-wrap items-center gap-2'>
                        {rules.some(item => item.id === draft.id) && <button type='button'
                            onClick={() => confirmDelete ? void save(current => current.filter(item => item.id !== draft.id), true) : setConfirmDelete(true)}
                            className={`${actionClass} inline-flex items-center gap-1 text-rose-700`}><Trash size={15} />{confirmDelete ? '确认删除' : '删除'}</button>}
                        <button type='button' onClick={saveDraft} className={`${primaryClass} ml-auto`}><FloppyDisk size={15} />保存规则</button>
                    </div>
                </fieldset>}
            </div>
        </main>
    </div>;
};

export default StoryRegexPanel;
