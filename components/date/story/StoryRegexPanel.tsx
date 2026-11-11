import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Plus, Trash } from '@phosphor-icons/react';
import type { StoryTheaterPreset } from '../../../types';
import { STORY_TEMPLATE_MAX_LENGTH, validateStoryRegexRule, type StoryRegexResult, type StoryRegexRule } from '../../../utils/storyRegex';
import { compressPhoneAppearanceImage } from '../../../utils/characterPhoneAppearance';
import { runStoryRegex } from '../../../utils/storyRegexRunner';
import { SafeStoryHtml } from './StoryTheaterSession';

interface Props {
    rules: StoryRegexRule[];
    presets: StoryTheaterPreset[];
    onSave: (rules: StoryRegexRule[]) => Promise<void>;
    onBack: () => void;
}

const fieldClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm';
const actionClass = 'rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-40';

function createRule(): StoryRegexRule {
    return {
        id: crypto.randomUUID(), name: '', enabled: true, presetId: '', kind: 'filter',
        pattern: '', flags: 'g', replacement: '', display: true, history: false, instruction: '',
    };
}

const StoryRegexPanel: React.FC<Props> = ({ rules, presets, onSave, onBack }) => {
    const [draft, setDraft] = useState<StoryRegexRule | null>(null);
    const [sample, setSample] = useState('');
    const [result, setResult] = useState<StoryRegexResult | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const test = useRef<AbortController | null>(null);
    useEffect(() => () => test.current?.abort(), []);
    const isTemplate = draft?.kind === 'template';
    const previewParts = result?.cards.length
        ? result.text.split(new RegExp('(' + result.cards.map(card => card.token).join('|') + ')', 'g'))
        : [result?.text || ''];

    const open = (rule: StoryRegexRule | null) => {
        setDraft(rule);
        setSample('');
        setResult(null);
        setError('');
        setConfirmDelete(false);
    };
    const patch = (change: Partial<StoryRegexRule>) => {
        setDraft(current => current && { ...current, ...change });
        setResult(null);
        setError('');
        setConfirmDelete(false);
    };
    const save = async (next: StoryRegexRule[], closeEditor: boolean) => {
        setError('');
        setBusy(true);
        try {
            await onSave(next);
            if (closeEditor) open(null);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : '正则规则保存失败');
        } finally {
            setBusy(false);
        }
    };
    const saveDraft = () => {
        if (!draft) return;
        try {
            validateStoryRegexRule(draft);
            const rule = { ...draft, name: draft.name.trim(), instruction: draft.instruction.trim() };
            void save(rules.some(item => item.id === rule.id)
                ? rules.map(item => item.id === rule.id ? rule : item) : [...rules, rule], true);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : '正则规则无效');
        }
    };
    const loadTemplateFile = async (file: File, image: boolean) => {
        if (!draft) return;
        setBusy(true);
        setError('');
        try {
            if (!image && file.size > STORY_TEMPLATE_MAX_LENGTH * 4) throw new Error('HTML 文件过长');
            const replacement = image
                ? [draft.replacement, `<img src="${await compressPhoneAppearanceImage(file)}" alt="界面截图">`].filter(Boolean).join('\n')
                : await file.text();
            if (replacement.length > STORY_TEMPLATE_MAX_LENGTH) throw new Error('模板过长，请缩小截图尺寸或压缩内嵌图片');
            patch({ replacement });
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : '无法读取文件');
        } finally {
            setBusy(false);
        }
    };
    const preview = async () => {
        if (!draft) return;
        setError('');
        setResult(null);
        const controller = new AbortController();
        test.current = controller;
        setBusy(true);
        try {
            validateStoryRegexRule({ ...draft, name: draft.name || '试跑' });
            const [output] = await runStoryRegex([sample], [{ ...draft, enabled: true, display: true }], 'display', controller.signal);
            setResult(output);
        } catch (cause) {
            if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '试跑失败');
        } finally {
            if (!controller.signal.aborted) setBusy(false);
        }
    };

    return <div className='h-full w-full flex flex-col bg-stone-100 text-slate-800'>
        <header className='story-safe-header shrink-0 border-b border-slate-200'>
            <div className='h-16 px-4 flex items-center gap-3'>
                <button type='button' disabled={busy} aria-label='返回' onClick={() => draft ? open(null) : onBack()}
                    className='w-9 h-9 grid place-items-center rounded-full'><ArrowLeft size={20} /></button>
                <h1 className='font-semibold'>{draft ? '编辑正则' : '剧情正则'}</h1>
                {!draft && <button type='button' aria-label='新建正则' disabled={busy} onClick={() => open(createRule())}
                    className='ml-auto w-10 h-10 rounded-full bg-slate-900 text-white grid place-items-center'><Plus size={19} /></button>}
            </div>
        </header>
        <main className='min-h-0 flex-1 overflow-y-auto px-4 py-5'>
            <div className='mx-auto max-w-xl space-y-4 pb-12'>
                {error && <p role='alert' className='rounded-xl bg-rose-50 px-3 py-2.5 text-sm text-rose-800'>{error}</p>}
                {!draft ? <>
                    <p className='text-xs leading-5 text-slate-600'>对剧情中的角色输出套用固定 HTML 模板，或过滤指定内容。规则按列表顺序生效，先过滤文字，再套用模板。</p>
                    {!rules.length && <button type='button' onClick={() => open(createRule())}
                        className='w-full rounded-2xl border border-dashed border-slate-300 py-10 text-sm font-semibold'>新建第一条正则</button>}
                    {rules.map(rule => <div key={rule.id} className='flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3'>
                        <button type='button' disabled={busy} onClick={() => open(rule)} className='min-w-0 flex-1 text-left'>
                            <span className='block break-words text-sm font-semibold'>{rule.name}</span>
                            <span className='mt-1 block text-xs text-slate-500'>{rule.kind === 'template' ? 'HTML 美化' : '文字过滤'} · {rule.presetId
                                ? presets.find(preset => preset.id === rule.presetId)?.name || '预设已移除' : '所有剧情预设'}</span>
                        </button>
                        <button type='button' disabled={busy} aria-pressed={rule.enabled} aria-label={`启用 ${rule.name}`}
                            onClick={() => void save(rules.map(item => item.id === rule.id ? { ...item, enabled: !item.enabled } : item), false)}
                            className={`rounded-full px-3 py-2 text-xs font-semibold ${rule.enabled ? 'bg-violet-100 text-violet-800' : 'bg-slate-100 text-slate-600'}`}>
                            {rule.enabled ? '已启用' : '已停用'}
                        </button>
                    </div>)}
                </> : <fieldset disabled={busy} className='space-y-4 disabled:opacity-70'>
                    <label className='block space-y-1 text-xs font-semibold'>规则名称
                        <input className={fieldClass} value={draft.name} onChange={event => patch({ name: event.target.value })} maxLength={80} />
                    </label>
                    <div className='grid grid-cols-2 gap-3'>
                        <label className='min-w-0 space-y-1 text-xs font-semibold'>用途
                            <select className={fieldClass} value={draft.kind} onChange={event => patch({ kind: event.target.value as StoryRegexRule['kind'] })}>
                                <option value='filter'>文字过滤</option><option value='template'>HTML 美化</option>
                            </select>
                        </label>
                        <label className='min-w-0 space-y-1 text-xs font-semibold'>适用预设
                            <select className={fieldClass} value={draft.presetId} onChange={event => patch({ presetId: event.target.value })}>
                                <option value=''>所有剧情预设</option>
                                {draft.presetId && !presets.some(preset => preset.id === draft.presetId) && <option value={draft.presetId}>预设已移除</option>}
                                {presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                            </select>
                        </label>
                    </div>
                    <div className='grid grid-cols-[minmax(0,1fr)_5.5rem] gap-3'>
                        <label className='space-y-1 text-xs font-semibold'>匹配正则
                            <textarea className={`${fieldClass} font-mono`} rows={2} value={draft.pattern} spellCheck={false}
                                placeholder={isTemplate ? '<app-card>([\\s\\S]*?)</app-card>' : '<think>[\\s\\S]*?</think>'}
                                onChange={event => patch({ pattern: event.target.value })} />
                        </label>
                        <label className='space-y-1 text-xs font-semibold'>修饰符
                            <input className={`${fieldClass} font-mono`} value={draft.flags} spellCheck={false} placeholder='g'
                                onChange={event => patch({ flags: event.target.value })} />
                        </label>
                    </div>
                    <p className='text-xs leading-5 text-slate-500'>支持直接粘贴 <code>/表达式/gi</code>。末尾修饰符会覆盖右侧填写的值。</p>
                    <label className='block space-y-1 text-xs font-semibold'>{isTemplate ? 'HTML 模板' : '替换为'}
                        <textarea className={`${fieldClass} font-mono`} rows={isTemplate ? 7 : 3} value={draft.replacement}
                            maxLength={STORY_TEMPLATE_MAX_LENGTH} spellCheck={false}
                            placeholder={isTemplate ? '<div class="app-card">{{$1}}</div>' : '留空即删除匹配内容'}
                            onChange={event => patch({ replacement: event.target.value })} />
                    </label>
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
                            <p className='text-xs leading-5 text-slate-500'>用 <code>$1</code> 或 <code>{'{{$1}}'}</code> 填入捕获组。支持内嵌 CSS 和 data 图片。</p>
                        </div>
                        <label className='block space-y-1 text-xs font-semibold'>输出格式指令（选填）
                            <textarea className={fieldClass} rows={3} value={draft.instruction} maxLength={4000}
                                placeholder='例如：剧情出现手机通知时，用 <app-card>通知正文</app-card> 输出。'
                                onChange={event => patch({ instruction: event.target.value })} />
                        </label>
                    </> : <div className='space-y-2 text-xs'>
                        <p className='font-semibold'>过滤时机</p>
                        <label className='flex items-center gap-2'><input type='checkbox' checked={draft.display}
                            onChange={event => patch({ display: event.target.checked })} />阅读时</label>
                        <label className='flex items-center gap-2'><input type='checkbox' checked={draft.history}
                            onChange={event => patch({ history: event.target.checked })} />续写读取历史时</label>
                        <p className='text-slate-500'>用 <code>$1</code> 引用捕获组。原始楼层保留，可随时停用规则。</p>
                    </div>}
                    <section className='space-y-3 rounded-2xl border border-slate-200 bg-white p-4'>
                        <label className='block space-y-1 text-xs font-semibold'>测试文本
                            <textarea className={fieldClass} value={sample} rows={3} onChange={event => {
                                setSample(event.target.value);
                                setResult(null);
                            }} placeholder='粘贴一段角色输出' />
                        </label>
                        <button type='button' disabled={!sample} className={actionClass} onClick={() => void preview()}>试跑规则</button>
                        {result && <div className='space-y-2' aria-live='polite'>
                            <p className='text-xs text-slate-500'>匹配 {result.matches} 处</p>
                            {previewParts.map((part, index) => {
                                    const card = result.cards.find(item => item.token === part);
                                    return card ? <SafeStoryHtml key={index} source={card.html} fallback={card.fallback} title={card.title} />
                                        : part ? <p key={index} className='whitespace-pre-wrap break-words text-sm'>{part}</p> : null;
                                })}
                            {!result.text && <p className='text-xs text-slate-500'>过滤后为空</p>}
                        </div>}
                    </section>
                    <div className='flex flex-wrap items-center gap-2'>
                        {rules.some(item => item.id === draft.id) && <button type='button'
                            onClick={() => confirmDelete ? void save(rules.filter(item => item.id !== draft.id), true) : setConfirmDelete(true)}
                            className={`${actionClass} inline-flex items-center gap-1 text-rose-700`}><Trash size={15} />{confirmDelete ? '确认删除' : '删除'}</button>}
                        <button type='button' onClick={saveDraft}
                            className='ml-auto rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-semibold text-white'>保存规则</button>
                    </div>
                </fieldset>}
            </div>
        </main>
    </div>;
};

export default StoryRegexPanel;
