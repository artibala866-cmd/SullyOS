import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CaretDown, Code, DownloadSimple, FloppyDisk, Plus, Sparkle, SpinnerGap, Trash, UploadSimple } from '@phosphor-icons/react';
import type { StoryTheaterPreset } from '../../../types';
import { STORY_TEMPLATE_MAX_LENGTH, validateStoryRegexRule, type StoryRegexResult, type StoryRegexRule } from '../../../utils/storyRegex';
import { compressPhoneAppearanceImage } from '../../../utils/characterPhoneAppearance';
import { runStoryRegex } from '../../../utils/storyRegexRunner';
import { MAX_STORY_REGEX_FILE_BYTES, exportStoryAlchemyRules, mergeStoryRegexImport, parseStoryRegexImport, splitAlchemyTemplateCss, type StoryRegexImportResult } from '../../../utils/storyRegexImport';
import { splitStoryRegexOutput } from '../../../utils/storyRegexDisplay';
import { alchemyRuleTargets, alchemyOfflineScenes, alchemyRuleSection, alchemySubcategory, removeAlchemyRule, removeAlchemyFolderSection, setAlchemyFolderTargets, type AlchemyDomain } from '../../../utils/alchemyRegex';
import AlchemyRuleFolders from '../../alchemy/AlchemyRuleFolders';
import AlchemyHtmlFrame from '../../alchemy/AlchemyHtmlFrame';
import { renderAlchemyTemplatePreview } from '../../../utils/alchemyTemplatePreview';
import { useOS } from '../../../context/OSContext';
import { shareOrDownloadFile } from '../../../utils/shareExport';
import { ALCHEMY_REFERENCE_HTML_PRESETS, ALCHEMY_REFERENCE_REGEX_PRESETS } from '../../../utils/alchemyReferencePresets';

interface Props {
    domain?: AlchemyDomain;
    section?: 'beauty' | 'rules';
    rules: StoryRegexRule[];
    presets: StoryTheaterPreset[];
    onSave: (update: (rules: StoryRegexRule[]) => StoryRegexRule[]) => Promise<void>;
    onBack: () => void;
}

const fieldClass = 'mt-1.5 block w-full min-w-0 rounded-xl border border-[#e5e7e5] bg-white px-3 py-2.5 text-[13px] font-normal leading-5 text-neutral-800 outline-none transition-colors focus:border-[#a7aea8] focus:ring-2 focus:ring-[#dfe5df]/60';
const actionClass = 'inline-flex min-h-9 items-center justify-center gap-1 rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 disabled:opacity-40';
const primaryClass = 'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[#292d2a] px-3.5 text-xs font-semibold text-white shadow-sm disabled:opacity-40';
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
    const { registerBackHandler, characters } = useOS();
    const [draft, setDraft] = useState<StoryRegexRule | null>(null);
    const [activeSection, setActiveSection] = useState<'beauty' | 'rules'>(section);
    const [sample, setSample] = useState('');
    const [result, setResult] = useState<StoryRegexResult | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [feedback, setFeedback] = useState('');
    const [imported, setImported] = useState<(StoryRegexImportResult & { filename: string }) | null>(null);
    const [importScope, setImportScope] = useState('');
    const [importScenes, setImportScenes] = useState<Array<'story' | 'meeting'>>(['story', 'meeting']);
    const [previewStage, setPreviewStage] = useState<'display' | 'history'>('display');
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [exportOpen, setExportOpen] = useState(false);
    const [presetsOpen, setPresetsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [bulk, setBulk] = useState(false);
    const [bulkSelected, setBulkSelected] = useState<string[]>([]);
    const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
    const [macroField, setMacroField] = useState<'pattern' | 'replacement' | 'instruction'>('replacement');
    const [exportSelected, setExportSelected] = useState<string[]>([]);
    const test = useRef<AbortController | null>(null);
    const upload = useRef<HTMLInputElement>(null);
    const scrollRef = useRef<HTMLElement>(null);
    const actionLock = useRef(false);
    useEffect(() => () => test.current?.abort(), []);
    const isTemplate = draft?.kind === 'template';
    const scopeDescription = !draft ? '' : draft.kind === 'template' ? '线上' : [
        alchemyRuleTargets(draft).includes('online') ? '线上' : '',
        alchemyRuleTargets(draft).includes('offline')
            ? ['线下', ...alchemyOfflineScenes(draft).map(scene => scene === 'story' ? '剧情' : '见面')].join(' · ')
            : '',
    ].filter(Boolean).join(' + ');
    const templateParts = draft?.kind === 'template'
        ? splitAlchemyTemplateCss(draft.replacement) : null;
    const templateReplacement = (htmlTemplate: string, cssScope = templateParts?.cssScope || '') =>
        cssScope ? '<style>' + cssScope + '</style>\n' + htmlTemplate : htmlTemplate;
    const liveHtml = useMemo(() => draft?.kind === 'template'
        ? renderAlchemyTemplatePreview(draft) : '',
        [draft?.kind, draft?.replacement, draft?.parseMode]);
    const previewParts = result ? splitStoryRegexOutput(result) : [];
    const screen = imported ? 'import' : draft ? 'edit' : 'list';
    const visibleRules = rules.filter(rule => alchemyRuleSection(rule) === activeSection &&
        (!search.trim() || [rule.name,rule.importGroup,rule.subcategory,rule.source?.category]
            .some(value => (value || '').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))));
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
        if (exportOpen) { setExportOpen(false); return; }
        if (bulk) { setBulk(false); setConfirmBulkDelete(false); return; }
        if (presetsOpen) { setPresetsOpen(false); return; }
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
    const addReferencePreset = (preset: unknown) => {
        try {
            const parsed = parseStoryRegexImport(JSON.stringify(preset));
            const selected = parsed.rules.map(rule => ({
                ...rule, importGroup: '糯叽机原版预设', domain: 'online' as const,
                targets: ['online'] as Array<'online'>,
            }));
            if (!selected.length) throw new Error('预设格式无法识别');
            void save(current => {
                const merged = mergeStoryRegexImport(current, selected, '');
                if (merged.added === 0 && !merged.updated) throw new Error('这个预设已经添加');
                return merged.rules;
            });
            setPresetsOpen(false);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : '无法添加预设');
        }
    };

    const insertMacro = (macro: string) => {
        if (!draft) return;
        patch({ [macroField]: (draft[macroField] || '') + macro } as Partial<StoryRegexRule>);
    };

    const exportSelectedRules = () => {
        const selected = rules.filter(rule => exportSelected.includes(rule.id));
        if (!selected.length) { setError('请先选择要导出的规则'); return; }
        if (busy || actionLock.current) return;
        actionLock.current = true;
        setBusy(true);
        void shareOrDownloadFile({
            content: exportStoryAlchemyRules(selected),
            fileName: '炼金术-' + selected.length + '条.json',
            mimeType: 'application/json',
            preferDownloadOnWeb: true,
        }).then(() => {
            setFeedback('已导出 ' + selected.length + ' 条');
            setError('');
            setExportOpen(false);
        }).catch(reason => {
            setError(reason instanceof Error ? reason.message : '正则导出失败');
        }).finally(() => { actionLock.current = false; setBusy(false); });
    };

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
            const name = file.name.replace(/\.html?$/i, '');
            // A standalone HTML file has no regex match tag or aiPrompt.
            // Give it a unique, functioning card tag so saving immediately
            // works and the existing chat completion can automatically emit it.
            const tag = 'alchemy' + crypto.randomUUID().replace(/-/g, '').slice(0, 9);
            const html = { ...createRule('beauty', 'online'),
                name, importGroup: name,
                pattern: '<' + tag + '>([\\s\\S]*?)</' + tag + '>',
                instruction: '当适合使用「' + name + '」卡片展示内容时，以 <' + tag
                    + '>内容</' + tag + '> 输出，不要附加代码块。',
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
        setImportScenes(['story', 'meeting']);
        setImported({ ...parsed, filename: file.name });
    });
    const confirmImport = () => {
        if (!imported?.rules.length) return;
        void perform(async () => {
            let merge = { added: 0, updated: 0, duplicates: 0 };
            await onSave(current => {
                // A story preset restricts story playback only. Meetings have no
                // preset: explicitly persist the selected scenes on import.
                const selected = imported.rules.map(rule =>
                    rule.kind === 'filter' && alchemyRuleTargets(rule).includes('offline')
                        ? { ...rule, offlineScenes: [...importScenes] } : rule);
                // When only meetings are selected, do not persist a stale
                // story preset that was previously picked in this dialog.
                const result = mergeStoryRegexImport(current, selected, importScenes.includes('story') ? importScope : '');
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
        const offline = rule ? alchemyOfflineScenes(rule) : ['story', 'meeting'];
        const storyName = presetId
            ? (presets.find(preset => preset.id === presetId)?.name || (presets.length ? '预设已移除' : '指定预设'))
            : '全部预设';
        return [
            scopes.includes('online') ? '私聊 / 群聊' : '',
            scopes.includes('offline') && offline.includes('story') ? '剧情 · ' + storyName : '',
            scopes.includes('offline') && offline.includes('meeting') ? '见面' : '',
        ].filter(Boolean).join(' + ');
    };
    const scopeOptions = (presetId: string) => <>
        <option value=''>所有剧情预设</option>
        {presetId && !presets.some(preset => preset.id === presetId) && <option value={presetId}>预设已移除</option>}
        {presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
    </>;
    return <div className='flex h-full w-full min-h-0 flex-col bg-[#f8f8f7] text-neutral-800'>
        <header className='story-safe-header shrink-0 border-b border-[#eaeae7] bg-white/95'>
            <div className='flex h-14 items-center gap-2 px-4'>
                <button type='button' disabled={busy} aria-label='返回' onClick={goBack}
                    className='grid h-9 w-9 shrink-0 place-items-center rounded-full'><ArrowLeft size={21} /></button>
                <h1 className='min-w-0 flex-1 truncate text-base font-semibold'>
                    {imported ? '导入正则' : draft ? '编辑正则' : '正则'}
                </h1>
                {screen === 'list' ? <>
                    <button type='button' aria-label='糯叽机原版炼金术预设' title='原版炼金术预设'
                        disabled={busy} onClick={() => { setPresetsOpen(true); setExportOpen(false); }}
                        className={iconClass}><Sparkle size={18}/></button>
                    <button type='button' aria-label='导出炼金术规则' title='导出炼金术规则'
                        disabled={busy || rules.length === 0} onClick={() => {
                            setExportSelected(rules.map(rule => rule.id));
                            setExportOpen(true);
                        }} className={iconClass}><DownloadSimple size={18}/></button>
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
        <main ref={scrollRef} className='story-page-scroll min-h-0 flex-1 overflow-y-auto px-4 pt-5 pb-20'>
            <div className='mx-auto max-w-xl space-y-4'>
                {error && <p role='alert' className='text-xs text-rose-700'>{error}</p>}
                {presetsOpen && screen === 'list' && <section aria-label='糯叽机原版炼金术预设'
                    className='space-y-3 rounded-2xl border border-neutral-200 bg-white p-3.5'>
                    <div className='flex items-center justify-between gap-2'>
                        <span className='text-sm font-medium'>原版预设</span>
                        <button type='button' className={actionClass} onClick={() => setPresetsOpen(false)}>关闭</button>
                    </div>
                    {([
                        ['文字规则', ALCHEMY_REFERENCE_REGEX_PRESETS],
                        ['HTML 美化', ALCHEMY_REFERENCE_HTML_PRESETS],
                    ] as const).map(([label, examples]) => <div key={label} className='space-y-1'>
                        <div className='px-1 py-1 text-[12px] text-neutral-500'>{label}</div>
                        {examples.map(preset => {
                            const already = rules.some(rule => rule.name === preset.name && rule.pattern === preset.pattern);
                            return <div key={preset.name} className='flex min-h-9 items-center justify-between gap-2 rounded-lg px-2'>
                                <span className='min-w-0 flex-1 truncate text-[13px]'>{preset.name}</span>
                                <button type='button' className={actionClass} disabled={busy || already}
                                    onClick={() => addReferencePreset(preset)}>
                                    {already ? '已添加' : '添加'}
                                </button>
                            </div>;
                        })}
                    </div>)}
                </section>}
                {exportOpen && screen === 'list' && <section aria-label='选择导出炼金术规则'
                    className='space-y-3 rounded-2xl border border-neutral-200 bg-white p-3.5'>
                    <div className='flex items-center justify-between gap-2'>
                        <span className='text-sm font-medium'>导出规则 · {exportSelected.length}/{rules.length}</span>
                        <button type='button' aria-label='关闭导出' onClick={() => setExportOpen(false)}
                            className={actionClass}>关闭</button>
                    </div>
                    <div className='flex gap-2'>
                        <button type='button' className={actionClass} onClick={() => setExportSelected(rules.map(rule => rule.id))}>全选</button>
                        <button type='button' className={actionClass} onClick={() => setExportSelected([])}>清空</button>
                    </div>
                    <div className='max-h-56 space-y-1 overflow-y-auto'>
                        {rules.map(rule => <label key={rule.id} className='flex min-h-9 items-center gap-2 rounded-lg px-2 text-[13px]'>
                            <input type='checkbox' checked={exportSelected.includes(rule.id)}
                                onChange={event => setExportSelected(current => event.target.checked
                                    ? [...current, rule.id] : current.filter(id => id !== rule.id))}/>
                            <span className='min-w-0 flex-1 truncate'>{rule.name}</span>
                            {rule.kind === 'template' && <Code size={13} className='text-neutral-400'/>}
                        </label>)}
                    </div>
                    <button type='button' className={primaryClass} onClick={exportSelectedRules}
                        disabled={busy || !exportSelected.length}>
                        <DownloadSimple size={15}/>导出所选
                    </button>
                </section>}

                {screen === 'list' && rules.length > 0 && <section aria-label='搜索和管理炼金术规则'
                    className='space-y-2'>
                    <div className='flex items-center gap-2'>
                        <input type='search' value={search} onChange={event => setSearch(event.target.value)}
                            placeholder='搜索规则' aria-label='搜索规则'
                            className={fieldClass + ' !mt-0 min-w-0 flex-1'}/>
                        <button type='button' disabled={busy} className={actionClass} onClick={() => {
                            setBulk(value => !value); setBulkSelected([]); setConfirmBulkDelete(false);
                        }}>{bulk ? '完成' : '管理'}</button>
                    </div>
                    {bulk && <div className='space-y-2 rounded-xl border border-neutral-200 bg-white p-2.5'>
                        <div className='flex flex-wrap items-center gap-2'>
                            <span className='mr-auto text-xs text-neutral-500'>已选 {bulkSelected.length}</span>
                            <button type='button' className={actionClass}
                                onClick={() => setBulkSelected(visibleRules.map(rule => rule.id))}>全选可见</button>
                            <button type='button' className={actionClass}
                                onClick={() => setBulkSelected([])}>清空</button>
                        </div>
                        <div className='max-h-44 space-y-1 overflow-y-auto'>
                            {visibleRules.map(rule => <label key={rule.id} className='flex min-h-8 items-center gap-2 px-1 text-xs'>
                                <input type='checkbox' checked={bulkSelected.includes(rule.id)}
                                    onChange={event => setBulkSelected(current => event.target.checked
                                        ? [...current,rule.id] : current.filter(id => id !== rule.id))}/>
                                <span className='min-w-0 flex-1 truncate'>{rule.name}</span>
                            </label>)}
                        </div>
                        <div className='flex flex-wrap items-center gap-2'>
                            <button type='button' disabled={busy || !bulkSelected.length} className={actionClass}
                                onClick={() => void save(current => current.map(rule => bulkSelected.includes(rule.id)
                                    ? { ...rule, enabled: true } : rule))}>启用</button>
                            <button type='button' disabled={busy || !bulkSelected.length} className={actionClass}
                                onClick={() => void save(current => current.map(rule => bulkSelected.includes(rule.id)
                                    ? { ...rule, enabled: false } : rule))}>停用</button>
                            <button type='button' disabled={busy || !bulkSelected.length} className={actionClass}
                                onClick={() => {
                                    if (!confirmBulkDelete) { setConfirmBulkDelete(true); return; }
                                    const ids = new Set(bulkSelected);
                                    void save(current => current.filter(rule => !ids.has(rule.id)));
                                    setBulkSelected([]);
                                    setConfirmBulkDelete(false);
                                }}>{confirmBulkDelete ? '确认删除所选' : '删除所选'}</button>
                        </div>
                    </div>}
                </section>}
                {imported ? <>
                    <div className='flex items-center gap-2'>
                        <span className='min-w-0 flex-1 truncate text-sm font-semibold'>{imported.filename}</span>
                        <span className='shrink-0 text-xs text-neutral-500'>{imported.rules.length} 条</span>
                    </div>
                    {imported.rules.some(item => item.kind === 'filter' && alchemyRuleTargets(item).includes('offline')) && <>
                        <div role='group' aria-label='导入线下规则生效位置' className='space-y-2 text-xs text-neutral-600'>
                            <span>线下生效位置</span>
                            <div className='flex items-center gap-2'>
                                {(['story', 'meeting'] as const).map(scene => {
                                    const checked = importScenes.includes(scene);
                                    return <label key={scene} className={'flex cursor-pointer items-center rounded-md border px-3 py-1.5 ' +
                                        (checked ? 'border-neutral-800 bg-neutral-800 text-white' : 'border-neutral-200 bg-white text-neutral-500')}>
                                        <input type='checkbox' className='sr-only'
                                            aria-label={scene === 'story' ? '导入剧情生效' : '导入见面生效'}
                                            checked={checked} disabled={checked && importScenes.length === 1}
                                            onChange={event => setImportScenes(previous => event.target.checked
                                                ? [...previous, scene] : previous.filter(value => value !== scene))}/>
                                        {scene === 'story' ? '剧情' : '见面'}
                                    </label>;
                                })}
                            </div>
                        </div>
                        {importScenes.includes('story') && <label className='block text-xs text-neutral-600'>剧情预设（仅影响剧情，见面不需要预设）
                            <select className={fieldClass} value={importScope}
                                onChange={event => setImportScope(event.target.value)}>{scopeOptions(importScope)}</select>
                        </label>}
                    </>}
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
                </> : <fieldset disabled={busy} className='min-w-0 space-y-5 border-0 p-0 disabled:opacity-60'>
                    <label className='block text-[13px] font-medium text-neutral-700'>名称
                        <input className={fieldClass} maxLength={80} value={draft.name}
                            onChange={event => patch({ name: event.target.value })} placeholder='正则名称'/>
                    </label>
                    {isTemplate && <section aria-label='HTML 实时效果' data-alchemy-live-preview
                        className='min-w-0 rounded-xl border border-neutral-200 bg-white p-2'>
                        {liveHtml ? <AlchemyHtmlFrame html={liveHtml} fallback='' title={draft.name || 'HTML 效果'}/>
                            : <div className='grid h-24 place-items-center text-xs text-neutral-400'>HTML 效果</div>}
                    </section>}
                    {!isTemplate && <div className='grid grid-cols-[minmax(0,1fr)_5rem] gap-3'>
                        <label className='min-w-0 text-[13px] font-medium text-neutral-700'>匹配正则
                            <textarea className={fieldClass + ' resize-y font-mono text-xs'} rows={2}
                                value={draft.pattern} spellCheck={false}
                                onFocus={() => setMacroField('pattern')}
                                placeholder={isTemplate ? '<card>([\\s\\S]*?)</card>' : '<think>[\\s\\S]*?</think>'}
                                onChange={event => patch({ pattern: event.target.value })}/>
                        </label>
                        <label className='min-w-0 text-[13px] font-medium text-neutral-700'>修饰符
                            <input className={fieldClass + ' font-mono text-xs'} value={draft.flags} spellCheck={false}
                                onChange={event => patch({ flags: event.target.value })}/>
                        </label>
                    </div>}
                    <div className='min-w-0 space-y-1.5'>
                        <div className='flex items-center gap-2'>
                            <label htmlFor='alchemy-source' className='min-w-0 flex-1 text-[13px] font-medium text-neutral-700'>
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
                            className={'block w-full min-w-0 resize-y rounded-xl border border-[#e5e7e5] bg-white p-3 font-mono text-[13px] leading-6 text-neutral-800 outline-none transition-colors focus:border-[#a7aea8] focus:ring-2 focus:ring-[#dfe5df]/60 ' +
                                (isTemplate ? 'min-h-[152px]' : 'min-h-[96px]')}
                            rows={isTemplate ? 7 : 3} value={isTemplate ? templateParts?.htmlTemplate || '' : draft.replacement}
                            onFocus={() => setMacroField('replacement')}
                            maxLength={STORY_TEMPLATE_MAX_LENGTH} spellCheck={false}
                            placeholder={isTemplate ? '<div>{{$1}}</div>' : ''}
                            onChange={event => patch({ replacement: isTemplate
                                ? templateReplacement(event.target.value) : event.target.value })}/>
                    </div>
                    {!isTemplate && <div className='grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-[#eaeae7] bg-white px-3.5 py-3 text-[12px] text-neutral-700 sm:grid-cols-3'>
                        <label className='flex cursor-pointer items-center gap-2'><input type='checkbox' checked={draft.display} className='h-4 w-4 accent-[#626e63]'
                            onChange={event => patch({ display: event.target.checked })}/>显示过滤</label>
                        <label className='flex cursor-pointer items-center gap-2'><input type='checkbox' checked={draft.history} className='h-4 w-4 accent-[#626e63]'
                            onChange={event => patch({ history: event.target.checked })}/>请求过滤</label>
                    </div>}
                    <details className='group/extra overflow-hidden rounded-2xl border border-[#e8e9e7] bg-white'>
                        <summary className='flex min-h-11 cursor-pointer list-none items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-medium text-neutral-700'>
                            <CaretDown size={15} className='-rotate-90 shrink-0 text-neutral-400 transition-transform group-open/extra:rotate-0'/>
                            <span className='shrink-0'>更多设置</span>
                            <span className='ml-auto min-w-0 truncate text-right text-[11px] font-normal text-neutral-400'>{scopeDescription}</span>
                        </summary>
                        <div className='space-y-4 border-t border-[#f0f0ee] px-3.5 pb-4 pt-3'>
                            {!isTemplate && <section aria-label='生效场景设置' className='space-y-3'>
                                <div className='flex flex-wrap items-center justify-between gap-2'>
                                    <span className='shrink-0 text-[12px] text-neutral-600'>生效范围</span>
                                    <div role='group' aria-label='规则生效范围' className='inline-flex items-center gap-1 rounded-lg bg-[#f3f4f2] p-0.5'>
                                        {(['online', 'offline'] as const).map(target => {
                                            const selected = alchemyRuleTargets(draft);
                                            const checked = selected.includes(target);
                                            return <label key={target} className={'inline-flex min-h-8 cursor-pointer items-center justify-center rounded-md px-3 text-[12px] transition-colors ' +
                                                (checked ? 'bg-white font-medium text-[#303830] shadow-sm' : 'text-neutral-500')}>
                                                <input type='checkbox' className='sr-only' aria-label={target === 'online' ? '线上' : '线下'}
                                                    checked={checked} disabled={checked && selected.length === 1}
                                                    onChange={event => patch({ targets: event.target.checked
                                                        ? [...selected, target] : selected.filter(value => value !== target) })}/>
                                                {target === 'online' ? '线上' : '线下'}
                                            </label>;
                                        })}
                                    </div>
                                </div>
                                {alchemyRuleTargets(draft).includes('offline') && <div className='flex flex-wrap items-center justify-between gap-2'>
                                    <span className='shrink-0 text-[12px] text-neutral-600'>线下位置</span>
                                    <div role='group' aria-label='线下规则生效位置' className='inline-flex items-center gap-1 rounded-lg bg-[#f3f4f2] p-0.5'>
                                        {(['story', 'meeting'] as const).map(scene => {
                                            const selected = alchemyOfflineScenes(draft);
                                            const checked = selected.includes(scene);
                                            return <label key={scene} className={'inline-flex min-h-8 cursor-pointer items-center justify-center rounded-md px-3 text-[12px] transition-colors ' +
                                                (checked ? 'bg-white font-medium text-[#303830] shadow-sm' : 'text-neutral-500')}>
                                                <input type='checkbox' className='sr-only' aria-label={scene === 'story' ? '剧情生效' : '见面生效'}
                                                    checked={checked} disabled={checked && selected.length === 1}
                                                    onChange={event => patch({ offlineScenes: event.target.checked
                                                        ? [...selected, scene] : selected.filter(value => value !== scene) })}/>
                                                {scene === 'story' ? '剧情' : '见面'}
                                            </label>;
                                        })}
                                    </div>
                                </div>}
                            </section>}

                            {(draft.source?.originalScope === 'character' ||
                                draft.source?.originalScope === 'chat' && !!draft.source.originalCharacterIds?.length) &&
                                <section aria-label='炼金术角色绑定' className='space-y-2'>
                                    <div className='text-[12px] font-medium text-neutral-700'>适用角色 · 当前糯米机</div>
                                    <div className='max-h-36 overflow-y-auto rounded-xl border border-neutral-200 bg-white p-2'>
                                        {characters.map(character => {
                                            const bound = draft.source?.localCharacterIds || [];
                                            return <label key={character.id} className='flex min-h-9 cursor-pointer items-center gap-2 px-1 text-[12px]'>
                                                <input type='checkbox' checked={bound.includes(character.id)}
                                                    onChange={event => patch({ source: {
                                                        ...draft.source,
                                                        localCharacterIds: event.target.checked
                                                            ? [...bound, character.id] : bound.filter(id => id !== character.id),
                                                    } })}/>
                                                <span className='truncate'>{character.name}</span>
                                            </label>;
                                        })}
                                    </div>
                                    {!draft.source?.localCharacterIds?.length &&
                                        <span className='text-[11px] text-neutral-500'>未绑定时不生效</span>}
                                </section>}
                            {isTemplate && <label className='block text-xs text-neutral-600'>HTML CSS 样式
                                <textarea className={fieldClass + ' font-mono text-xs resize-y'} rows={3}
                                    value={templateParts?.cssScope || ''}
                                    onChange={event => patch({ replacement: templateReplacement(
                                        templateParts?.htmlTemplate || '', event.target.value,
                                    ) })}/>
                            </label>}
                            {isTemplate && <div className='grid grid-cols-[minmax(0,1fr)_4rem] gap-2'>
                                <label className='min-w-0 text-xs text-neutral-600'>匹配正则
                                    <textarea className={fieldClass + ' resize-y font-mono text-xs'} rows={2}
                                        value={draft.pattern} spellCheck={false}
                                onFocus={() => setMacroField('pattern')}
                                        onChange={event => patch({ pattern: event.target.value })}/>
                                </label>
                                <label className='min-w-0 text-xs text-neutral-600'>修饰符
                                    <input className={fieldClass + ' font-mono text-xs'} value={draft.flags}
                                        spellCheck={false} onChange={event => patch({ flags: event.target.value })}/>
                                </label>
                            </div>}
                            <div className='grid grid-cols-1 gap-3 min-[420px]:grid-cols-2'>
                                <label className='min-w-0 text-xs text-neutral-600'>分组
                                    <input className={fieldClass} value={draft.importGroup || ''} maxLength={80}
                                        onChange={event => patch({ importGroup: event.target.value })} placeholder='自定义'/>
                                </label>
                                <label className='min-w-0 text-xs text-neutral-600'>小分类
                                    <input className={fieldClass} value={draft.subcategory || ''} maxLength={60}
                                        onChange={event => patch({ subcategory: event.target.value })} placeholder='未分类'/>
                                </label>
                            </div>
                            <div className='grid grid-cols-1 gap-3 min-[420px]:grid-cols-2'>
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
                                    onFocus={() => setMacroField('instruction')}
                                    onChange={event => patch({ instruction: event.target.value })}/>
                            </label>
                            {isTemplate && <label className='flex items-center gap-2 text-xs'>
                                <input type='checkbox' checked={draft.display} onChange={event => patch({ display: event.target.checked })}/>
                                显示 HTML
                            </label>}
                            <details className='rounded-xl bg-[#f5f6f4] px-2.5 py-2'>
                                <summary className='cursor-pointer text-xs text-neutral-600'>原版变量快捷插入</summary>
                                <div className='mt-2 flex flex-wrap gap-1.5'>
                                    {['{{user}}','{{char}}','{{user.gender}}','{{char.gender}}',
                                        '{{user.avatar}}','{{char.avatar}}','{{time}}','{{date}}',
                                        '{{random:a,b,c}}','{{match}}'].map(macro =>
                                        <button key={macro} type='button'
                                            aria-label={'插入变量 ' + macro}
                                            onClick={() => insertMacro(macro)} className={actionClass}>
                                            {macro}
                                        </button>)}
                                </div>
                            </details>
                            <div className='grid grid-cols-1 gap-3 min-[420px]:grid-cols-2'>
                                <label className='flex items-center gap-2 text-[12px] text-neutral-700'>
                                    <input type='checkbox' checked={!!draft.source?.triggerEnabled}
                                        onChange={event => patch({ source: { ...draft.source, triggerEnabled: event.target.checked } })}/>
                                    关键词触发
                                </label>
                                <label className='flex items-center gap-2 text-[12px] text-neutral-700'>
                                    <input type='checkbox' checked={!!draft.source?.trim}
                                        onChange={event => patch({ source: { ...draft.source, trim: event.target.checked } })}/>
                                    修剪空白
                                </label>
                            </div>
                            {!!draft.source?.triggerEnabled && <label className='block text-xs text-neutral-600'>触发关键词
                                <input className={fieldClass} value={(draft.source?.triggerKeywords || []).join('，')}
                                    onChange={event => patch({ source: { ...draft.source,
                                        triggerKeywords: event.target.value.split(/[,，、;；\n]/).map(w => w.trim()).filter(Boolean),
                                    } })}/>
                            </label>}
                            <div className='grid grid-cols-1 gap-3 min-[420px]:grid-cols-2'>
                                <label className='text-xs text-neutral-600'>最小历史深度
                                    <input type='number' min={0} className={fieldClass}
                                        value={draft.source?.minDepth ?? ''}
                                        onChange={event => patch({ source: { ...draft.source,
                                            minDepth: event.target.value === '' ? undefined : Math.max(0, Number(event.target.value)),
                                        } })}/>
                                </label>
                                <label className='text-xs text-neutral-600'>最大历史深度
                                    <input type='number' min={0} className={fieldClass}
                                        value={draft.source?.maxDepth ?? ''}
                                        onChange={event => patch({ source: { ...draft.source,
                                            maxDepth: event.target.value === '' ? undefined : Math.max(0, Number(event.target.value)),
                                        } })}/>
                                </label>
                            </div>
                            <label className='block text-xs text-neutral-600'>替换前移除的字符串
                                <input className={fieldClass} value={(draft.source?.trimStrings || []).join('，')}
                                    onChange={event => patch({ source: { ...draft.source,
                                        trimStrings: event.target.value.split(/[,，、;；\n]/).map(w => w.trim()).filter(Boolean),
                                    } })}/>
                            </label>
                            <div className='grid grid-cols-1 gap-3 min-[420px]:grid-cols-2'>
                                <label className='block text-xs text-neutral-600'>正则变量替换
                                    <select className={fieldClass} value={draft.source?.substituteRegex ?? 1}
                                        onChange={event => patch({ source: { ...draft.source,
                                            substituteRegex: Number(event.target.value) as 0 | 1 | 2,
                                        } })}>
                                        <option value={0}>关闭</option><option value={1}>正常替换</option><option value={2}>转义后替换</option>
                                    </select>
                                </label>
                                {isTemplate && <label className='block text-xs text-neutral-600'>HTML 显示方式
                                    <select className={fieldClass} value={draft.source?.renderMode || 'iframe'}
                                        onChange={event => patch({ source: { ...draft.source,
                                            renderMode: event.target.value as 'inline' | 'iframe',
                                        } })}>
                                        <option value='iframe'>独立卡片</option><option value='inline'>行内布局</option>
                                    </select>
                                </label>}
                            </div>
                            {draft.replacementChoices?.map((value, index) => <label key={index} className='block text-xs'>
                                随机替换 {index + 2}
                                <textarea className={fieldClass + ' font-mono text-xs'} rows={2} value={value}
                                    onChange={event => patch({ replacementChoices: draft.replacementChoices?.map(
                                        (item, position) => position === index ? event.target.value : item) })}/>
                            </label>)}
                        </div>
                    </details>
                    {!isTemplate && <details className='group/test overflow-hidden rounded-2xl border border-[#e8e9e7] bg-white'>
                        <summary className='flex min-h-12 cursor-pointer list-none items-center gap-2.5 px-3.5 py-3 text-[13px] font-medium text-neutral-700'>
                            <CaretDown size={15} className='-rotate-90 text-neutral-400 transition-transform group-open/test:rotate-0'/>测试规则
                        </summary>
                        <div className='space-y-3 border-t border-[#f0f0ee] px-3.5 pb-4 pt-3'>
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
                                    <div key={part.token} className='w-full max-w-[360px]'>
                                        <AlchemyHtmlFrame html={part.html} fallback={part.fallback} title={part.title}/>
                                    </div>)}
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
