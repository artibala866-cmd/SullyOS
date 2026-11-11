import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CaretDown, Code, FloppyDisk, Plus, SpinnerGap, Trash, UploadSimple } from '@phosphor-icons/react';
import type { StoryTheaterPreset } from '../../../types';
import { STORY_TEMPLATE_MAX_LENGTH, validateStoryRegexRule, type StoryRegexResult, type StoryRegexRule } from '../../../utils/storyRegex';
import { compressPhoneAppearanceImage } from '../../../utils/characterPhoneAppearance';
import { runStoryRegex } from '../../../utils/storyRegexRunner';
import { MAX_STORY_REGEX_FILE_BYTES, mergeStoryRegexImport, parseStoryRegexImport, type StoryRegexImportResult } from '../../../utils/storyRegexImport';
import { splitStoryRegexOutput } from '../../../utils/storyRegexDisplay';
import { alchemyRuleTargets, alchemyRuleSection, alchemySubcategory, removeAlchemyRule, removeAlchemyFolderSection, setAlchemyFolderTargets, type AlchemyDomain } from '../../../utils/alchemyRegex';
import AlchemyRuleFolders from '../../alchemy/AlchemyRuleFolders';
import { useOS } from '../../../context/OSContext';
import { SafeStoryHtml } from './StoryTheaterSession';

interface Props {
    domain?: AlchemyDomain;
    section?: 'beauty' | 'rules';
    rules: StoryRegexRule[];
    presets: StoryTheaterPreset[];
    onSave: (update: (rules: StoryRegexRule[]) => StoryRegexRule[]) => Promise<void>;
    onBack: () => void;
}

const fieldClass = 'mt-1 w-full min-w-0 rounded-lg border border-neutral-200 bg-white px-2.5 py-2 text-[13px] font-normal text-neutral-800 outline-none focus:border-neutral-400';
const actionClass = 'inline-flex min-h-8 items-center justify-center gap-1 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium disabled:opacity-40';
const primaryClass = 'inline-flex h-9 shrink-0 items-center justify-center gap-1 rounded-full bg-neutral-900 px-3 text-xs font-semibold text-white disabled:opacity-40';
const iconClass = 'grid h-9 w-9 shrink-0 place-items-center rounded-full border border-neutral-200 bg-white disabled:opacity-40';


function createRule(section: 'beauty' | 'rules', domain: AlchemyDomain): StoryRegexRule {
    return {
        id: crypto.randomUUID(), name: '', enabled: true, presetId: '',
        kind: section === 'beauty' ? 'template' : 'filter',
        domain: section === 'beauty' ? 'online' : domain,
        targets: [section === 'beauty' ? 'online' : domain],
        pattern: '', flags: 'g', replacement: '', display: true, history: false, instruction: '',
    };
}

const StoryRegexPanel: React.FC<Props> = ({ rules, presets, onSave, onBack, domain = 'offline', section = 'rules' }) => {
    const { registerBackHandler } = useOS();
    const [draft, setDraft] = useState<StoryRegexRule | null>(null);
    const [activeSection, setActiveSection] = useState<'beauty' | 'rules'>(section);
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
    const visibleRules = rules.filter(rule => alchemyRuleSection(rule) === activeSection);
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
            const rule: StoryRegexRule = {
                ...draft, name: draft.name.trim(), instruction: draft.instruction.trim(),
                domain: draft.kind === 'template' ? 'online' : (draft.domain || domain),
                targets: draft.kind === 'template' ? ['online'] : alchemyRuleTargets(draft),
            };
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
        if (/\.html?$/i.test(file.name)) {
            if (raw.length > STORY_TEMPLATE_MAX_LENGTH) throw new Error('HTML 文件过长');
            const html = { ...createRule('beauty', 'online'),
                name: file.name.replace(/\.html?$/i, ''),
                importGroup: file.name.replace(/\.html?$/i, ''),
                replacement: raw, parseMode: 'text' as const,
            };
            setActiveSection('beauty');
            open(html);
            return;
        }
        const parsed = parseStoryRegexImport(raw);
        const folderName = file.name.replace(/\.(?:json|txt)$/i, '') || '导入的正则';
        parsed.rules = parsed.rules.map(rule => ({
            ...rule,
            // Imported HTML card templates always belong to online beauty.
            domain: rule.kind === 'template' ? 'online' as const : domain,
            targets: rule.kind === 'template' ? ['online'] as AlchemyDomain[] :
                (rule.targets?.length ? rule.targets : [domain]),
            importGroup: folderName,
            subcategory: alchemySubcategory(rule),
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
            setActiveSection(imported.rules.some(rule => rule.kind === 'template') ? 'beauty' : 'rules');
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
    const scopeName = (presetId: string, rule?: StoryRegexRule) => {
        if (rule?.kind === 'template') return '私聊 / 群聊';
        const scopes = alchemyRuleTargets(rule || createRule('rules', domain));
        return [
            scopes.includes('online') ? '私聊 / 群聊' : '',
            scopes.includes('offline') ? (presetId
                ? presets.find(preset => preset.id === presetId)?.name || '预设已移除'
                : '剧情 / 见面') : '',
        ].filter(Boolean).join(' + ');
    };
    const scopeOptions = (presetId: string) => <>
        <option value=''>所有剧情预设</option>
        {presetId && !presets.some(preset => preset.id === presetId) && <option value={presetId}>预设已移除</option>}
        {presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
    </>;
    return <div className='flex h-full w-full min-h-0 flex-col bg-[#f7f7f7] text-neutral-800'>
        <header className='story-safe-header shrink-0 border-b border-neutral-200/70 bg-[#f7f7f7]'>
            <div className='flex h-14 items-center gap-2 px-4'>
                <button type='button' disabled={busy} aria-label='返回' onClick={goBack}
                    className='grid h-9 w-9 shrink-0 place-items-center rounded-full'><ArrowLeft size={21} /></button>
                <h1 className='min-w-0 flex-1 truncate text-base font-semibold'>
                    {imported ? '导入正则' : draft ? '编辑正则' : '正则'}
                </h1>
                {screen === 'list' ? <>
                    <button type='button' aria-label='导入正则或 HTML' title='导入正则或 HTML'
                        disabled={busy} onClick={() => upload.current?.click()} className={iconClass}>
                        {busy ? <SpinnerGap size={18} className='animate-spin'/> : <UploadSimple size={18}/>}
                    </button>
                    <button type='button' aria-label='新建正则' title='新建正则' disabled={busy}
                        onClick={() => open(createRule(activeSection, domain))} className={iconClass}><Plus size={19}/></button>
                    <input type='file' ref={upload} accept='.json,.txt,.html,.htm,application/json,text/html' hidden
                        onChange={event => {
                            const file = event.currentTarget.files?.[0];
                            event.currentTarget.value = '';
                            if (file) void readImport(file);
                        }}/>
                </> : draft ? <button type='button' onClick={saveDraft} disabled={busy}
                    className={primaryClass}><FloppyDisk size={15}/>保存</button> : null}
            </div>
            {screen === 'list' && <nav className='flex gap-2 px-4 pb-3' aria-label='正则分类'>
                {([['beauty', 'HTML 美化'], ['rules', '规则']] as const).map(([value, name]) =>
                    <button key={value} type='button' aria-pressed={activeSection === value}
                        onClick={() => { setActiveSection(value); setFeedback(''); }}
                        className={'flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold ' +
                            (activeSection === value ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-500 border border-neutral-200')}>
                        {value === 'beauty' && <Code size={15}/>}
                        {name}<span className='opacity-60'>{rules.filter(item => alchemyRuleSection(item) === value).length}</span>
                    </button>)}
            </nav>}
        </header>
        <main ref={scrollRef} className='story-page-scroll min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-20'>
            <div className='mx-auto max-w-xl space-y-3'>
                {error && <p role='alert' className='text-xs text-rose-700'>{error}</p>}
                {imported ? <>
                    <div className='flex items-center gap-2'>
                        <span className='min-w-0 flex-1 truncate text-sm font-semibold'>{imported.filename}</span>
                        <span className='shrink-0 text-xs text-neutral-500'>{imported.rules.length} 条</span>
                    </div>
                    {activeSection === 'rules' && domain === 'offline' && imported.rules.some(item => item.kind === 'filter') &&
                        <label className='block text-xs text-neutral-600'>适用预设
                            <select className={fieldClass} value={importScope}
                                onChange={event => setImportScope(event.target.value)}>{scopeOptions(importScope)}</select>
                        </label>}
                    <details className='rounded-lg bg-white px-3 py-2 text-xs' open>
                        <summary className='cursor-pointer font-medium'>导入内容</summary>
                        <div className='mt-2 divide-y divide-neutral-100'>
                            {imported.rules.map(item => <div key={item.id} className='flex gap-2 py-2'>
                                <span className='min-w-0 flex-1 truncate'>{item.name}</span>
                                <span className='shrink-0 text-neutral-400'>{item.kind === 'template' ? 'HTML' : '规则'}</span>
                            </div>)}
                        </div>
                    </details>
                    {!!imported.warnings.length && <details className='text-xs text-neutral-500'>
                        <summary className='cursor-pointer'>转换提示 ({imported.warnings.length})</summary>
                        <div className='mt-1 space-y-1'>{imported.warnings.map((note, index) =>
                            <p key={index}>{note}</p>)}</div>
                    </details>}
                    <div className='flex items-center justify-end gap-2 pt-2'>
                        <button type='button' disabled={busy} onClick={goBack} className={actionClass}>取消</button>
                        <button type='button' disabled={busy || !imported.rules.length} onClick={confirmImport}
                            className={primaryClass}><UploadSimple size={15}/>导入</button>
                    </div>
                </> : !draft ? <>
                    {feedback && <p role='status' className='text-xs text-neutral-500'>{feedback}</p>}
                    {!visibleRules.length && <div className='py-12 text-center text-sm text-neutral-400'>
                        暂无{activeSection === 'beauty' ? ' HTML 美化' : '规则'}
                    </div>}
                    <AlchemyRuleFolders rules={visibleRules} busy={busy} scopeName={scopeName}
                        onOpen={open} onToggle={rule => void save(current => current.map(item => {
                            if (item.id !== rule.id) return item;
                            const next = { ...item, enabled: !item.enabled };
                            if (next.enabled) validateStoryRegexRule(next);
                            return next;
                        }))}
                        onDelete={rule => void save(current => {
                            if (!current.some(item => item.id === rule.id)) throw new Error('此规则已被删除');
                            return removeAlchemyRule(current, rule.id);
                        })}
                        onDeleteFolder={(folder, selected) => void save(current =>
                            removeAlchemyFolderSection(current, folder, activeSection,
                                new Set(selected.map(item => item.id))))}
                        onSetFolderTargets={activeSection === 'rules' ? (folder, selected, targets) =>
                            void save(current => setAlchemyFolderTargets(current, folder,
                                new Set(selected.map(item => item.id)), targets)) : undefined}/>
                </> : <fieldset disabled={busy} className='min-w-0 space-y-3 border-0 p-0 disabled:opacity-60'>
                    <label className='block text-xs font-medium text-neutral-600'>名称
                        <input className={fieldClass} maxLength={80} value={draft.name}
                            onChange={event => patch({ name: event.target.value })} placeholder='正则名称'/>
                    </label>
                    <div className='flex flex-wrap items-center gap-2 text-xs'>
                        {isTemplate ? <span className='rounded-md bg-white px-2 py-1.5 text-neutral-500'>
                            <Code size={14} className='mr-1 inline-block'/>HTML · 线上
                        </span> : <div role='group' aria-label='规则生效范围' className='flex items-center gap-1.5'>
                            {(['online', 'offline'] as const).map(target => {
                                const selected = alchemyRuleTargets(draft);
                                const checked = selected.includes(target);
                                return <label key={target} className={'flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1.5 ' +
                                    (checked ? 'border-neutral-800 bg-neutral-800 text-white' : 'border-neutral-200 bg-white text-neutral-500')}>
                                    <input type='checkbox' className='sr-only' aria-label={target === 'online' ? '线上' : '线下'}
                                        checked={checked} disabled={checked && selected.length === 1}
                                        onChange={event => patch({ targets: event.target.checked
                                            ? [...selected, target] : selected.filter(value => value !== target) })}/>
                                    {target === 'online' ? '线上' : '线下'}
                                </label>;
                            })}
                        </div>}
                    </div>
                    <div className='grid grid-cols-[minmax(0,1fr)_4rem] gap-2'>
                        <label className='min-w-0 text-xs font-medium text-neutral-600'>匹配正则
                            <textarea className={fieldClass + ' resize-y font-mono text-xs'} rows={2}
                                value={draft.pattern} spellCheck={false}
                                placeholder={isTemplate ? '<card>([\\s\\S]*?)</card>' : '<think>[\\s\\S]*?</think>'}
                                onChange={event => patch({ pattern: event.target.value })}/>
                        </label>
                        <label className='min-w-0 text-xs font-medium text-neutral-600'>修饰符
                            <input className={fieldClass + ' font-mono text-xs'} value={draft.flags} spellCheck={false}
                                onChange={event => patch({ flags: event.target.value })}/>
                        </label>
                    </div>
                    <div className='min-w-0 space-y-1'>
                        <div className='flex items-center gap-2'>
                            <label htmlFor='alchemy-source' className='min-w-0 flex-1 text-xs font-semibold text-neutral-600'>
                                {isTemplate ? 'HTML 代码' : '替换内容'}
                            </label>
                            {isTemplate && <>
                                <label className='cursor-pointer text-[11px] font-medium text-neutral-600'>
                                    <UploadSimple size={14} className='mr-1 inline-block'/>导入 HTML
                                    <input type='file' accept='.html,.htm,text/html' className='sr-only' onChange={event => {
                                        const file = event.currentTarget.files?.[0];
                                        event.currentTarget.value = '';
                                        if (file) void loadTemplateFile(file, false);
                                    }}/>
                                </label>
                                <label className='cursor-pointer text-[11px] text-neutral-500'>
                                    插入图片
                                    <input type='file' accept='image/png,image/jpeg,image/webp' className='sr-only' onChange={event => {
                                        const file = event.currentTarget.files?.[0];
                                        event.currentTarget.value = '';
                                        if (file) void loadTemplateFile(file, true);
                                    }}/>
                                </label>
                            </>}
                        </div>
                        <textarea id='alchemy-source'
                            className={'w-full min-w-0 resize-y rounded-lg border border-neutral-200 bg-white p-3 font-mono text-xs leading-5 text-neutral-800 outline-none focus:border-neutral-400 ' +
                                (isTemplate ? 'min-h-[152px]' : 'min-h-[80px]')}
                            rows={isTemplate ? 7 : 4} value={draft.replacement}
                            maxLength={STORY_TEMPLATE_MAX_LENGTH} spellCheck={false}
                            placeholder={isTemplate ? '<div>{{$1}}</div>' : ''}
                            onChange={event => patch({ replacement: event.target.value })}/>
                    </div>
                    {!isTemplate && <div className='flex flex-wrap items-center gap-4 text-xs text-neutral-600'>
                        <label className='flex items-center gap-1.5'><input type='checkbox' checked={draft.display} className='accent-neutral-800'
                            onChange={event => patch({ display: event.target.checked })}/>显示过滤</label>
                        <label className='flex items-center gap-1.5'><input type='checkbox' checked={draft.history} className='accent-neutral-800'
                            onChange={event => patch({ history: event.target.checked })}/>请求过滤</label>
                        <label className='ml-auto flex items-center gap-1.5'>
                            <input type='checkbox' checked={draft.source?.smartFilter !== false} className='accent-neutral-800'
                                onChange={event => patch({ source: { ...draft.source, smartFilter: event.target.checked } })}/>
                            短词保护
                        </label>
                    </div>}
                    <details className='rounded-lg border border-neutral-200 bg-white px-3 py-2.5'>
                        <summary className='cursor-pointer text-xs font-medium text-neutral-600'>更多设置</summary>
                        <div className='mt-3 space-y-3'>
                            <div className='grid grid-cols-2 gap-2'>
                                <label className='min-w-0 text-xs text-neutral-600'>分组
                                    <input className={fieldClass} value={draft.importGroup || ''} maxLength={80}
                                        onChange={event => patch({ importGroup: event.target.value })} placeholder='自定义'/>
                                </label>
                                <label className='min-w-0 text-xs text-neutral-600'>小分类
                                    <input className={fieldClass} value={draft.subcategory || ''} maxLength={60}
                                        onChange={event => patch({ subcategory: event.target.value })} placeholder='未分类'/>
                                </label>
                            </div>
                            <div className='grid grid-cols-2 gap-2'>
                                <label className='min-w-0 text-xs text-neutral-600'>作用对象
                                    <select className={fieldClass} value={draft.role || 'assistant'}
                                        onChange={event => patch({ role: event.target.value as StoryRegexRule['role'] })}>
                                        <option value='assistant'>角色输出</option><option value='user'>我的输入</option><option value='both'>两者</option>
                                    </select>
                                </label>
                                {isTemplate ? <label className='min-w-0 text-xs text-neutral-600'>数据格式
                                    <select className={fieldClass} value={draft.parseMode || 'text'}
                                        onChange={event => patch({ parseMode: event.target.value as StoryRegexRule['parseMode'] })}>
                                        <option value='text'>文字</option><option value='kv'>键值</option><option value='json'>JSON</option>
                                    </select>
                                </label> : alchemyRuleTargets(draft).includes('offline') && presets.length > 0 ?
                                    <label className='min-w-0 text-xs text-neutral-600'>剧情预设
                                        <select className={fieldClass} value={draft.presetId}
                                            onChange={event => patch({ presetId: event.target.value })}>{scopeOptions(draft.presetId)}</select>
                                    </label> : null}
                            </div>
                            {!isTemplate && <label className='block text-xs text-neutral-600'>保留词
                                <input className={fieldClass} value={(draft.source?.protectWords || []).join('，')}
                                    onChange={event => patch({ source: { ...draft.source,
                                        protectWords: event.target.value.split(/[,，、;；\n]/).map(word => word.trim()).filter(Boolean),
                                    } })}/>
                            </label>}
                            <label className='block text-xs text-neutral-600'>{isTemplate ? '格式指令' : '规则指令'}
                                <textarea className={fieldClass + ' font-mono text-xs'} rows={3}
                                    value={draft.instruction} maxLength={4000}
                                    onChange={event => patch({ instruction: event.target.value })}/>
                            </label>
                            {isTemplate && <label className='flex items-center gap-2 text-xs'>
                                <input type='checkbox' checked={draft.display} onChange={event => patch({ display: event.target.checked })}/>
                                显示 HTML
                            </label>}
                            {draft.replacementChoices?.map((value, index) => <label key={index} className='block text-xs'>
                                随机替换 {index + 2}
                                <textarea className={fieldClass + ' font-mono text-xs'} rows={2} value={value}
                                    onChange={event => patch({ replacementChoices: draft.replacementChoices?.map(
                                        (item, position) => position === index ? event.target.value : item) })}/>
                            </label>)}
                        </div>
                    </details>
                    {!isTemplate && <details className='rounded-lg border border-neutral-200 bg-white px-3 py-2.5'>
                        <summary className='cursor-pointer text-xs font-medium text-neutral-600'>测试规则</summary>
                        <div className='mt-3 space-y-2'>
                            {!isTemplate && draft.display && draft.history &&
                                <select className={fieldClass} value={previewStage}
                                    onChange={event => { setPreviewStage(event.target.value as 'display' | 'history'); setResult(null); }}>
                                    <option value='display'>显示</option><option value='history'>请求</option>
                                </select>}
                            <textarea className={fieldClass} rows={3} value={sample}
                                onChange={event => { setSample(event.target.value); setResult(null); }}/>
                            <button type='button' disabled={!sample} onClick={() => void preview()} className={actionClass}>试跑</button>
                            {result && <div aria-live='polite' className='space-y-2 text-xs'>
                                <span className='text-neutral-400'>匹配 {result.matches} 处</span>
                                {previewParts.map((part, index) => typeof part === 'string' ?
                                    part && <p key={index} className='whitespace-pre-wrap break-words'>{part}</p> :
                                    <SafeStoryHtml key={index} template source={part.html} fallback={part.fallback} title={part.title}/>)}
                                {!result.text && <p className='text-neutral-400'>无输出</p>}
                            </div>}
                        </div>
                    </details>}
                    {rules.some(item => item.id === draft.id) && <div className='flex items-center gap-2 pt-1'>
                        {confirmDelete && <button type='button' onClick={() => setConfirmDelete(false)} className={actionClass}>取消</button>}
                        <button type='button' onClick={() => confirmDelete
                            ? void save(current => current.filter(item => item.id !== draft.id), true)
                            : setConfirmDelete(true)}
                            className='inline-flex h-8 items-center gap-1 rounded-full px-2 text-xs text-rose-600'>
                            <Trash size={14}/>{confirmDelete ? '确认删除' : '删除规则'}
                        </button>
                    </div>}
                </fieldset>}
            </div>
        </main>
    </div>;
};

export default StoryRegexPanel;
