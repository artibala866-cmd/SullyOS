import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BookmarkSimple, Check, DownloadSimple, LockSimple, SpinnerGap, UploadSimple, UserCircle, X } from '@phosphor-icons/react';
import TokenImg from '../../os/TokenImg';
import type { APIConfig, ApiPreset, CharacterProfile, StoryTheaterEntry, StoryTheaterMask, StoryTheaterPreset, TavernOpeningGreeting, UserProfile, Worldbook } from '../../../types';
import { normalizeStoryMemoryApi, storyMemoryApiFromPreset, storyMemoryApiSharesGateway, storyMemoryApiValidationError } from '../../../utils/storyMemoryApi';
import { normalizeApiPresets } from '../../../utils/apiConfigNormalize';
import { findActivePresetId } from '../../../utils/apiPresetSwitch';
import { adaptTavernOpeningGreeting } from '../../../utils/tavernOpeningGreeting';
import { listCharacterStoryOpenings, type StoryOpeningChoice } from '../../../utils/linkStoryOpenings';
import { sortCustomStoryOpenings, STORY_OPENING_ACCEPT } from '../../../utils/storyOpeningDocumentImport';
import { normalizeStoryOutputTokens, STORY_MIN_OUTPUT_TOKENS, STORY_MAX_OUTPUT_TOKENS } from '../../../utils/storyOutputLimits';
import { resolveStoryTheaterWorldbooks, downloadStoryPreset, estimateStoryTokens, getPresetPromptStats, resolveStoryPresetDocument, resolveStoryTheaterMask, hasStoryTheaterParticipant } from '../../../utils/storyTheater';

interface Props {
    initial: StoryTheaterEntry;
    characters: CharacterProfile[];
    /** Complete global library. Old test fixtures can omit it. */
    worldbooks?: Worldbook[];
    user: UserProfile;
    masks: StoryTheaterMask[];
    maskLocked: boolean;
    presets: StoryTheaterPreset[];
    /** The global preset library is read-only; selecting one copies its three credentials into this story. */
    apiPresets?: ApiPreset[];
    /** Read only: diagnose upstream quota overlap without touching the expensive prose endpoint. */
    mainApi?: Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>;
    onCancel: () => void;
    onSave: (entry: StoryTheaterEntry) => Promise<void> | void;
    onImportPreset: (file: File) => Promise<StoryTheaterPreset | null>;
    onEditPreset: (preset: StoryTheaterPreset, draft: StoryTheaterEntry) => void;
    onOpenMaskBox: (draft: StoryTheaterEntry) => void;
    onChangeGreeting?: (characterId: string, greetingId: string, content: string | null) => Promise<void>;
    onCreateGreeting?: (characterId: string, title: string, content: string) => Promise<TavernOpeningGreeting>;
    onImportGreetings?: (characterId: string, files: File[]) => Promise<{ added: TavernOpeningGreeting[]; skipped: number }>;
}

const Toggle: React.FC<{ value: boolean; onChange: (value: boolean) => void; label?: string }> = ({ value, onChange, label }) => <button type='button' aria-label={label} aria-pressed={value} onClick={() => onChange(!value)} className={`w-11 h-6 shrink-0 rounded-full p-1 transition-colors ${value ? 'bg-violet-600' : 'bg-slate-200'}`}><span className={`block w-4 h-4 rounded-full bg-white transition-transform ${value ? 'translate-x-5' : ''}`} /></button>;

const StoryTheaterEditor: React.FC<Props> = ({ initial, characters, worldbooks = [], user, masks, maskLocked, presets, apiPresets = [], mainApi, onCancel, onSave, onImportPreset, onEditPreset, onOpenMaskBox, onChangeGreeting, onCreateGreeting, onImportGreetings }) => {
    const [draft, setDraft] = useState<StoryTheaterEntry>({ ...initial });
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState('');
    const [memoryApiError, setMemoryApiError] = useState('');
    const [worldbookSearch, setWorldbookSearch] = useState('');
    const [greetingSearch, setGreetingSearch] = useState('');
    const [presetSearch, setPresetSearch] = useState('');
    // Restored backups sometimes carry a broken API preset among valid entries.
    // Rendering the story settings must not crash or rewrite the global library.
    const safeApiPresets = useMemo(() => normalizeApiPresets(apiPresets), [apiPresets]);
    const [presetImportBusy, setPresetImportBusy] = useState(false);
    const [presetImportFeedback, setPresetImportFeedback] = useState('');
    const [editingGreeting, setEditingGreeting] = useState(false);
    const [showOpeningInIntro, setShowOpeningInIntro] = useState(!!initial.openingGreeting);
    const saveLock = useRef(false);
    const greetingLock = useRef(false);
    const [greetingText, setGreetingText] = useState('');
    const [greetingBusy, setGreetingBusy] = useState(false);
    const [greetingError, setGreetingError] = useState('');
    const [confirmGreetingDelete, setConfirmGreetingDelete] = useState(false);
    const [createGreetingBusy, setCreateGreetingBusy] = useState(false);
    const [createGreetingError, setCreateGreetingError] = useState('');
    const [chooseGreetingActor, setChooseGreetingActor] = useState(false);
    const [createTargetActor, setCreateTargetActor] = useState('');
    const [recentGreeting, setRecentGreeting] = useState<(StoryOpeningChoice & { characterId: string; characterName: string }) | null>(null);
    const createGreetingLock = useRef(false);
    const importGreetingLock = useRef(false);
    const openingFileInput = useRef<HTMLInputElement>(null);
    const [importGreetingBusy, setImportGreetingBusy] = useState(false);
    const [importGreetingFeedback, setImportGreetingFeedback] = useState<{ error: boolean; text: string } | null>(null);
    const [importTargetActor, setImportTargetActor] = useState('');
    // Keep the authored scene recoverable if the user changes their mind after
    // bookmarking it. Persisted stories still store the scene only once.
    const promotedPremise = useRef<{ characterId: string; greetingId: string; content: string } | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const presetImportLock = useRef(false);
    const titleInput = useRef<HTMLInputElement>(null);
    // An opening may supply a title only until the person edits that title.
    const lastAutoOpeningTitle = useRef<string | null>(null);
    const greetingTextarea = useRef<HTMLTextAreaElement>(null);
    const castSection = useRef<HTMLElement>(null);
    const actors = useMemo(() => characters.filter(char => draft.characterIds.includes(char.id)), [characters, draft.characterIds]);
    const resolvedMask = useMemo(() => resolveStoryTheaterMask(draft.mask, user, characters, masks), [characters, draft.mask, masks, user]);
    const greetingChoices = useMemo(() => {
        const all = actors.flatMap(actor =>
            listCharacterStoryOpenings(actor, user.name,
                draft.openingGreeting?.characterId === actor.id ? draft.openingGreeting.greetingId : undefined).map(greeting => ({
                characterId: actor.id, characterName: actor.name, ...greeting,
            })),
        );
        if (recentGreeting && actors.some(actor => actor.id === recentGreeting.characterId)) {
            const index = all.findIndex(item => item.characterId === recentGreeting.characterId && item.id === recentGreeting.id);
            if (index >= 0) all[index] = recentGreeting;
            else all.push(recentGreeting);
        }
        // Imported custom openings display in file-number order: 1, 2, 10.
        // Keep the original author-controlled Link/Tavern ordering intact.
        return actors.flatMap(actor => sortCustomStoryOpenings(
            all.filter(item => item.characterId === actor.id),
        ));
    }, [actors, recentGreeting, user.name, draft.openingGreeting]);
    useEffect(() => {
        if (!recentGreeting) return;
        const actor = actors.find(item => item.id === recentGreeting.characterId);
        const fresh = actor ? listCharacterStoryOpenings(actor, user.name, recentGreeting.id)
            .find(item => item.id === recentGreeting.id) : undefined;
        // Stop overriding the canonical character card as soon as the OS
        // state catches up with the already-committed IndexedDB write.
        if (fresh && fresh.content === recentGreeting.content) {
            setRecentGreeting(null);
        }
    }, [actors, recentGreeting, user.name]);
    const selectedGreeting = greetingChoices.find(greeting =>
        greeting.characterId === draft.openingGreeting?.characterId && greeting.id === draft.openingGreeting?.greetingId);
    const matchingGreetingChoices = useMemo(() => {
        const query = greetingChoices.length > 12 ? greetingSearch.trim().toLocaleLowerCase('zh-CN') : '';
        if (!query) return greetingChoices;
        const matched = greetingChoices.filter(item =>
            [item.title, item.characterName, item.description || ''].some(value =>
                value.toLocaleLowerCase('zh-CN').includes(query)));
        // Keep the already-selected value as a valid <select> option while searching.
        if (selectedGreeting && !matched.some(item =>
            item.characterId === selectedGreeting.characterId && item.id === selectedGreeting.id)) {
            return [selectedGreeting, ...matched];
        }
        return matched;
    }, [greetingChoices, greetingSearch, selectedGreeting]);
    const storyFirst = !!draft.openingGreeting || draft.openingMode === 'assistant';
    const titleFromOpening = (openingTitle?: string) => {
        const titleBefore = titleInput.current?.value ?? draft.title;
        const previousAuto = lastAutoOpeningTitle.current;
        const canReplace = !titleBefore.trim() || (previousAuto !== null && titleBefore === previousAuto);
        const nextTitle = (openingTitle || '').trim().replace(/\s+/g, ' ').slice(0, 120);
        lastAutoOpeningTitle.current = canReplace && nextTitle ? nextTitle : null;
        // Preserve any concurrent user edit while an opening is being saved.
        return (currentTitle: string) => canReplace && currentTitle === titleBefore ? nextTitle : currentTitle;
    };
    const changeGreeting = async (content: string | null) => {
        if (!selectedGreeting || greetingLock.current) return;
        if (content !== null && !content.trim()) { setGreetingError('开场白不能留空；需要移除请使用删除。'); return; }
        greetingLock.current = true;
        setGreetingBusy(true);
        setGreetingError('');
        try {
            if (!onChangeGreeting) throw new Error('当前页面未连接开场白管理功能');
            await onChangeGreeting(selectedGreeting.characterId, selectedGreeting.id, content);
            const updatedGreeting = content === null ? null
                : selectedGreeting.source === 'link'
                    ? { ...selectedGreeting, content: content.trim() }
                    : { ...adaptTavernOpeningGreeting({ ...selectedGreeting, content: content.trim() }), source: selectedGreeting.source };
            setRecentGreeting(current => content === null
                ? (current?.characterId === selectedGreeting.characterId && current.id === selectedGreeting.id ? null : current)
                : { ...updatedGreeting!, characterId: selectedGreeting.characterId, characterName: selectedGreeting.characterName });
            const updateTitle = titleFromOpening(updatedGreeting?.title);
            // A started story keeps the original link for provenance, even when
            // its character-card source is deleted; only new drafts clear it.
            if (content === null && !maskLocked) {
                setDraft(current => {
                    const promoted = promotedPremise.current;
                    const restore = promoted?.characterId === current.openingGreeting?.characterId
                        && promoted?.greetingId === current.openingGreeting?.greetingId
                        && !current.premise.trim();
                    return {
                        ...current,
                        premise: restore && promoted ? promoted.content : current.premise,
                        title: updateTitle(current.title),
                        openingGreeting: undefined,
                        updatedAt: Date.now(),
                    };
                });
                setShowOpeningInIntro(false);
                setChooseGreetingActor(false);
            } else if (content !== null) {
                if (promotedPremise.current?.characterId === selectedGreeting.characterId
                    && promotedPremise.current?.greetingId === selectedGreeting.id)
                    promotedPremise.current.content = updatedGreeting!.content;
                setDraft(current => ({ ...current, title: updateTitle(current.title), updatedAt: Date.now() }));
            }
            setEditingGreeting(false);
            setConfirmGreetingDelete(false);
        } catch (error) {
            setGreetingError(error instanceof Error ? error.message : '开场白保存失败');
        } finally { greetingLock.current = false; setGreetingBusy(false); }
    };
    const createCustomGreeting = async (targetCharacterId?: string) => {
        if (createGreetingLock.current || importGreetingLock.current || editingGreeting || confirmGreetingDelete || maskLocked) return;
        const content = draft.premise.trim();
        if (!content) {
            setCreateGreetingError('先填写开场内容');
            greetingTextarea.current?.focus();
            return;
        }
        if (content.length > 200000) {
            setCreateGreetingError('开场内容不能超过 20 万字');
            return;
        }
        if (!actors.length) {
            setCreateGreetingError('请先选择参与角色');
            castSection.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
            return;
        }
        if (actors.length > 1 && !targetCharacterId) {
            setCreateTargetActor(actors[0].id);
            setChooseGreetingActor(true);
            setCreateGreetingError('');
            return;
        }
        const actor = actors.find(item => item.id === (targetCharacterId || actors[0].id));
        if (!actor) {
            setCreateGreetingError('目标角色已变化，请重新选择');
            return;
        }
        createGreetingLock.current = true;
        setCreateGreetingBusy(true);
        setCreateGreetingError('');
        try {
            if (!onCreateGreeting) throw new Error('开场库暂时不可用');
            // Use the same metadata adapter as imports; a multiline desc header
            // must not accidentally become the library title.
            const adapted = adaptTavernOpeningGreeting({ id: '', title: '', content });
            const firstLine = adapted.content.split(/\r?\n/).map(line => line.trim()).find(Boolean) || '';
            const title = (adapted.title || firstLine || draft.title.trim() || '自定义开场').slice(0, 30);
            const created = await onCreateGreeting(actor.id, title, content);
            promotedPremise.current = { characterId: actor.id, greetingId: created.id, content: created.content };
            const existingSource = greetingChoices.find(item => item.characterId === actor.id && item.id === created.id)?.source;
            setRecentGreeting({ ...created, source: existingSource || 'custom', characterId: actor.id, characterName: actor.name });
            const updateTitle = titleFromOpening(created.title);
            setDraft(current => ({
                ...current,
                title: updateTitle(current.title),
                premise: current.premise.trim() === content ? '' : current.premise,
                openingMode: 'assistant',
                openingGreeting: { characterId: actor.id, greetingId: created.id },
                updatedAt: Date.now(),
            }));
            setShowOpeningInIntro(true);
            setChooseGreetingActor(false);
            setCreateTargetActor('');
            setSaveError('');
        } catch (error) {
            setCreateGreetingError(error instanceof Error ? error.message : '保存开场失败，请重试');
        } finally {
            createGreetingLock.current = false;
            setCreateGreetingBusy(false);
        }
    };
    const handleOpeningDocumentsSelected = async (files: File[]) => {
        if (!files.length || importGreetingLock.current) return;
        if (maskLocked || editingGreeting || greetingLock.current || createGreetingLock.current) {
            setImportGreetingFeedback({ error: true, text: '请先完成当前开场白的编辑，再导入文件' });
            return;
        }
        const actor = importTargetActor ? actors.find(item => item.id === importTargetActor) : actors[0];
        // If the chosen cast member was removed, never silently import their
        // files into the first remaining character.
        if (importTargetActor && !actor) {
            setImportGreetingFeedback({ error: true, text: '原选定的导入角色已不在当前剧情中，请重新选择归属角色；本批次没有保存。' });
            return;
        }
        if (!actor) {
            setImportGreetingFeedback({ error: true, text: '请先在下方选择参与角色，再导入开场白' });
            return;
        }
        importGreetingLock.current = true;
        setImportGreetingBusy(true);
        setImportGreetingFeedback(null);
        try {
            if (!onImportGreetings) throw new Error('当前页面未连接开场白批量导入');
            const result = await onImportGreetings(actor.id, files);
            setImportGreetingFeedback({
                error: false,
                text: result.added.length
                    ? `已导入 ${result.added.length} 条开场白${result.skipped ? `，跳过重复 ${result.skipped} 条` : ''}；已按名称自然排序`
                    : `没有新增开场白，${result.skipped} 个文件的正文已存在`,
            });
            setSaveError('');
        } catch (error) {
            setImportGreetingFeedback({ error: true,
                text: `本批次未保存任何开场白。请检查失败文件后重新选择：${error instanceof Error ? error.message : '文件读取失败'}` });
        } finally {
            importGreetingLock.current = false;
            setImportGreetingBusy(false);
        }
    };
    const memoryParticipants = useMemo(() => {
        const participantIds = new Set(draft.characterIds);
        if (draft.mask?.type === 'character') participantIds.add(draft.mask.id);
        return characters.filter(char => participantIds.has(char.id));
    }, [characters, draft.characterIds, draft.mask]);
    const books = useMemo(() =>
        resolveStoryTheaterWorldbooks(worldbooks, characters),
        [worldbooks, characters]);
    // Authors often reuse the same title for different IF-line worlds.
    // Give only duplicated names a tiny content preview, so two unrelated
    // books do not look like the same checkbox on a phone.
    const duplicatedWorldbookTitles = useMemo(() => {
        const seen = new Set<string>();
        const repeated = new Set<string>();
        for (const book of books) {
            const label = book.title.trim().toLocaleLowerCase();
            if (seen.has(label)) repeated.add(label);
            seen.add(label);
        }
        return repeated;
    }, [books]);
    const visibleBooks = useMemo(() => books.filter(book =>
        !worldbookSearch.trim()
        || (book.title + ' ' + (book.category || '')).toLocaleLowerCase().includes(worldbookSearch.trim().toLocaleLowerCase())),
        [books, worldbookSearch]);
    const missingSelectedBooks = useMemo(() => {
        const available = new Set(books.map(book => book.id));
        return draft.selectedWorldbookIds.filter(id => !available.has(id));
    }, [draft.selectedWorldbookIds, books]);
    const canStart = hasStoryTheaterParticipant(draft, characters);
    const preset = presets.find(item => item.id === draft.presetId) || presets[0] || null;
    const matchingPresets = useMemo(() => {
        const query = presets.length > 12 ? presetSearch.trim().toLocaleLowerCase('zh-CN') : '';
        if (!query) return presets;
        const results = presets.filter(item => item.name.toLocaleLowerCase('zh-CN').includes(query));
        // Keep the selected value mounted as an option while the list is filtered.
        return preset && !results.some(item => item.id === preset.id) ? [preset, ...results] : results;
    }, [preset, presetSearch, presets]);
    const effectivePreset = preset ? { ...preset, document: resolveStoryPresetDocument(preset, draft.presetOverride) } : null;
    const presetStats = getPresetPromptStats(effectivePreset);
    const sourceDoc = effectivePreset?.document;
    const importedTavern = sourceDoc?.sourceFormat === 'sillytavern';
    const skippedTavernRegex = importedTavern && Boolean(sourceDoc?.importWarnings?.some(note =>
        /启用正则|启用脚本/.test(note)));
    // Detect old already-imported presets too; their stored warnings predate
    // this audit. This notice does not change any user's enabled toggles.
    const htmlTavernTheater = importedTavern && Boolean(sourceDoc?.prompts.some(prompt =>
        prompt.enabled && (
            /<(?:sidestory|randomtheater|writing_interlude|small_theater)\b/i.test(prompt.content)
            || /(?:小剧场[\s\S]{0,200}(?:HTML|CSS)|(?:HTML|CSS)[\s\S]{0,200}小剧场)/i.test(prompt.content)
        )));

    const update = <K extends keyof StoryTheaterEntry>(key: K, value: StoryTheaterEntry[K]) => {
        if (key === 'memorySummaryApi') setMemoryApiError('');
        setDraft(current => ({ ...current, [key]: value, updatedAt: Date.now() }));
    };
    const toggleCharacter = (char: CharacterProfile) => {
        // Once a first story floor exists, changing the cast corrupts its
        // immutable timeline, memory mirrors and selected opening provenance.
        if (maskLocked || createGreetingLock.current || greetingLock.current || importGreetingLock.current) return;
        setSaveError('');
        // A pending target selection is no longer trustworthy once cast changes.
        setChooseGreetingActor(false);
        setCreateTargetActor('');
        setCreateGreetingError('');
        const removedSelectedOpening = draft.characterIds.includes(char.id)
            && draft.openingGreeting?.characterId === char.id;
        const updateTitle = removedSelectedOpening ? titleFromOpening(undefined) : (value: string) => value;
        if (removedSelectedOpening) setShowOpeningInIntro(false);
        setDraft(current => {
        const adding = !current.characterIds.includes(char.id);
        const characterIds = adding ? [...current.characterIds, char.id] : current.characterIds.filter(id => id !== char.id);
        return {
            ...current,
            characterIds,
            title: updateTitle(current.title),
            premise: !adding && current.openingGreeting?.characterId === char.id
                && !current.premise.trim()
                && promotedPremise.current?.characterId === char.id
                && promotedPremise.current?.greetingId === current.openingGreeting.greetingId
                ? promotedPremise.current.content : current.premise,
            openingGreeting: !adding && current.openingGreeting?.characterId === char.id ? undefined : current.openingGreeting,
            // Worldbooks are explicitly chosen for this story. Changing the
            // cast must never silently add or drop an unrelated worldbook.
            selectedWorldbookIds: current.selectedWorldbookIds,
            characterContextLimits: { ...current.characterContextLimits, ...(adding && !current.characterContextLimits[char.id] ? { [char.id]: 100 } : {}) },
            updatedAt: Date.now(),
        };
    });
    };
    const tokenPreview = useMemo(() => {
        const actorText = [resolvedMask.name, resolvedMask.description, resolvedMask.coreInstruction, resolvedMask.worldview, ...actors.map(char => [char.name, char.systemPrompt, char.worldview, draft.carryCharacterMemory ? JSON.stringify(char.memories || []) : ''].join('\n'))].join('\n');
        const bookText = books.filter(book => draft.selectedWorldbookIds.includes(book.id)).map(book => book.content).join('\n');
        const presetText = effectivePreset ? effectivePreset.document.prompts.filter(prompt => prompt.enabled).map(prompt => prompt.content).join('\n') : '';
        const archiveText = draft.archives.map(archive => archive.summary || '').join('\n');
        return { actor: estimateStoryTokens(actorText), book: estimateStoryTokens(bookText), preset: estimateStoryTokens(presetText), archive: estimateStoryTokens(archiveText) };
    }, [actors, books, draft, effectivePreset, resolvedMask]);
    const save = async () => {
        if (saveLock.current) return;
        if (presetImportLock.current) {
            setSaveError('剧情预设还在导入中，请等批量导入完成后再进入剧情，以免保存了错误的预设。');
            return;
        }
        if (greetingLock.current || createGreetingLock.current || importGreetingLock.current) {
            setSaveError('开场白正在保存，请完成后再保存剧情。');
            return;
        }
        if (editingGreeting || confirmGreetingDelete) {
            setSaveError('请先保存或取消当前开场白的修改／删除，再进入剧情。');
            return;
        }
        if (chooseGreetingActor) {
            setSaveError('请先完成或取消开场白收藏，再进入剧情。');
            return;
        }
        if (!draft.title.trim()) {
            setSaveError('请先填写剧情标题；剧情介绍、记忆与预设开关都不是创建必填项。');
            titleInput.current?.focus();
            return;
        }
        if (!canStart) {
            setSaveError(characters.length === 0
                ? '目前没有可参与的角色。请先在角色应用中建立角色，再返回创建剧情；无需开启额外开关。'
                : '请在「让谁参与」选中至少一位角色；或者在虚构剧场的面具箱选择一个已有角色作为自己，开始个人剧情。其他开关均非必需。');
            castSection.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
            return;
        }
        if (draft.memorySummaryApi) {
            const issue = storyMemoryApiValidationError(normalizeStoryMemoryApi(draft.memorySummaryApi)!);
            if (issue) { setSaveError(''); setMemoryApiError(issue + '；本剧情没有保存，主 API 保持不变'); return; }
        }
        setSaveError('');
        saveLock.current = true;
        setSaving(true);
        const archiveAfter = Math.max(2, Math.min(200, Number(draft.archiveAfter) || 40));
        const archiveKeepRecent = Math.max(1, Math.min(archiveAfter - 1, Number(draft.archiveKeepRecent) || 5));
        try { await onSave({ ...draft, outputMaxTokens: draft.outputMaxTokens === undefined
            ? undefined : normalizeStoryOutputTokens(draft.outputMaxTokens), title: draft.title.trim(), premise: draft.premise.trim(), carryCharacterMemory: draft.writesToCharacterMemory || draft.carryCharacterMemory, archiveAfter, archiveKeepRecent, presetId: preset?.id || presets[0]?.id, updatedAt: Date.now() }); }
        catch (error) { setSaveError(error instanceof Error ? `剧情未保存：${error.message}` : '剧情未保存，请检查本地存储后重试'); }
        finally { saveLock.current = false; setSaving(false); }
    };

    return <div className='h-full w-full flex flex-col bg-stone-100 text-slate-800'>
        <header className='story-safe-header shrink-0 border-b border-slate-200'>
            <div className='h-16 px-4 flex items-center gap-3'>
                <button onClick={onCancel} className='w-9 h-9 rounded-full grid place-items-center'><ArrowLeft size={20} /></button>
                <div><div className='text-[9px] tracking-[.24em] uppercase font-bold text-violet-500'>Story setup</div><div className='font-semibold'>{initial.title ? '调整剧情沙盒' : '新增剧情'}</div></div>
                <button onClick={save} disabled={saving} className='story-setup-save ml-auto h-9 px-4 rounded-full bg-slate-900 text-white text-xs font-bold disabled:opacity-30'>{saving ? '保存中' : '保存并进入'}</button>
            </div>
        </header>
        {saveError && <p role='alert' className='shrink-0 px-5 py-2 text-xs text-rose-600 bg-rose-50'>{saveError}</p>}
        {!saveError && (!draft.title.trim() || !canStart) && <p role='status' className='shrink-0 px-5 py-2 text-[11px] text-slate-500 bg-white border-b border-slate-100'>{!draft.title.trim() ? '创建剧情：请填写标题，再选择参与角色。' : characters.length === 0 ? '需要先建立至少一位角色，无需开启其他开关。' : '请在下方选一位参与角色；其余设置均可保持默认。'}</p>}
        <main className='story-page-scroll flex-1 overflow-y-auto px-5 py-6 pb-28'><div className='max-w-2xl mx-auto space-y-8'>
            <section>
                <div className='text-[9px] tracking-[.22em] uppercase font-bold text-violet-500'>01 / Story</div>
                <label className='block mt-2'><span className='text-[10px] font-bold text-slate-500'>标题 · 必填</span><input ref={titleInput} value={draft.title} onChange={event => { lastAutoOpeningTitle.current = null; setSaveError(''); update('title', event.target.value); }} placeholder='剧情名称' className='mt-1 w-full bg-transparent text-3xl font-serif font-semibold outline-none placeholder:text-slate-300' /></label>
                <div className='mt-5'>
                    <div className='flex items-center justify-between gap-2'>
                        <span className='text-[10px] font-bold text-slate-500'>{selectedGreeting && showOpeningInIntro ? '开场白 · 可编辑' : '剧情介绍 · 可选'}</span>
                        <div className='flex shrink-0 items-center gap-1.5'>
                        {selectedGreeting && <div className='flex shrink-0 gap-1 rounded-lg bg-slate-200 p-0.5' aria-label='编辑内容切换'>
                            <button type='button' aria-pressed={!showOpeningInIntro} disabled={editingGreeting || greetingBusy || createGreetingBusy || confirmGreetingDelete}
                                onClick={() => setShowOpeningInIntro(false)} className={`rounded-md px-2 py-1 text-[10px] disabled:opacity-50 ${!showOpeningInIntro ? 'bg-white font-semibold text-slate-800' : 'text-slate-500'}`}>剧情介绍</button>
                            <button type='button' aria-pressed={showOpeningInIntro} disabled={editingGreeting || greetingBusy || confirmGreetingDelete}
                                onClick={() => setShowOpeningInIntro(true)} className={`rounded-md px-2 py-1 text-[10px] disabled:opacity-50 ${showOpeningInIntro ? 'bg-white font-semibold text-slate-800' : 'text-slate-500'}`}>开场白</button>
                        </div>}
                        {(!selectedGreeting || !showOpeningInIntro) && <button type='button' data-story-opening-save='true'
                            aria-label='收藏为可选开场' title='存入已有开场'
                            disabled={createGreetingBusy || importGreetingBusy || maskLocked || editingGreeting || confirmGreetingDelete || !draft.premise.trim()}
                            onClick={() => void createCustomGreeting()}
                            className='grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:border-slate-400 hover:bg-slate-50 active:scale-95 disabled:opacity-35'>
                            {createGreetingBusy ? <SpinnerGap size={17} className='animate-spin' /> : <BookmarkSimple size={17} />}
                        </button>}
                        </div>
                    </div>
                    <textarea ref={greetingTextarea} data-story-opening-editor={selectedGreeting && showOpeningInIntro ? 'true' : undefined}
                        aria-label={selectedGreeting && showOpeningInIntro ? '编辑开场内容' : '剧情介绍'}
                        value={selectedGreeting && showOpeningInIntro ? (editingGreeting ? greetingText : selectedGreeting.content) : draft.premise}
                        onChange={event => {
                            if (selectedGreeting && showOpeningInIntro) {
                                setEditingGreeting(true);
                                setGreetingText(event.target.value);
                                setConfirmGreetingDelete(false);
                                setGreetingError('');
                            } else { setCreateGreetingError(''); update('premise', event.target.value); }
                        }}
                        disabled={createGreetingBusy || importGreetingBusy || (!!selectedGreeting && showOpeningInIntro && (greetingBusy || confirmGreetingDelete))}
                        maxLength={selectedGreeting && showOpeningInIntro ? 200000 : undefined}
                        placeholder={selectedGreeting && showOpeningInIntro ? '在这里修改选中的开场白……' : '不填写也能直接开场；也可以写地点、冲突或必须守住的设定……'}
                        rows={4} className='mt-2 block w-full min-h-28 max-h-64 p-4 rounded-2xl bg-white border border-slate-200 text-sm leading-7 resize-y outline-none disabled:opacity-60' />
                    {chooseGreetingActor && !showOpeningInIntro && <div data-story-opening-target='true' className='mt-2 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 py-2 shadow-sm'>
                        <span className='shrink-0 text-[10px] text-slate-500'>存给</span>
                        <select aria-label='开场归属角色' value={createTargetActor} onChange={event => setCreateTargetActor(event.target.value)} disabled={createGreetingBusy}
                            className='min-w-0 flex-1 bg-transparent text-xs outline-none'>{actors.map(actor => <option key={actor.id} value={actor.id}>{actor.name}</option>)}</select>
                        <button type='button' aria-label='确认收藏开场' disabled={createGreetingBusy} onClick={() => void createCustomGreeting(createTargetActor)} className='grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-900 text-white'><Check size={16}/></button>
                        <button type='button' aria-label='取消收藏开场' disabled={createGreetingBusy} onClick={() => setChooseGreetingActor(false)} className='grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500'><X size={16}/></button>
                    </div>}
                    {createGreetingError && <p role='alert' className='mt-2 text-[10px] text-rose-600'>{createGreetingError}</p>}
                    {selectedGreeting && showOpeningInIntro && <div className='mt-2 flex justify-end gap-4'>
                        {editingGreeting ? <>
                            <button type='button' disabled={greetingBusy} onClick={() => { setEditingGreeting(false); setGreetingText(''); setGreetingError(''); }} className='text-xs text-slate-500'>取消</button>
                            <button type='button' disabled={greetingBusy || !greetingText.trim()} onClick={() => void changeGreeting(greetingText)} className='text-xs font-semibold text-violet-700 disabled:opacity-40'>保存修改</button>
                        </> : <>
                            <button type='button' disabled={greetingBusy || confirmGreetingDelete} onClick={() => { setEditingGreeting(true); setGreetingText(selectedGreeting.content); greetingTextarea.current?.focus(); }} className='text-xs font-semibold text-violet-700'>修改</button>
                            <button type='button' disabled={greetingBusy || confirmGreetingDelete} onClick={() => setConfirmGreetingDelete(true)} className='text-xs font-semibold text-rose-500'>删除</button>
                        </>}
                    </div>}
                    {selectedGreeting && showOpeningInIntro && confirmGreetingDelete && <div className='mt-3 rounded-xl bg-rose-50 p-3 text-xs'><p className='text-rose-700'>从角色的开场库删除？已写出的剧情不会改变。</p><div className='mt-2 flex justify-end gap-3'><button type='button' onClick={() => setConfirmGreetingDelete(false)} className='text-slate-500'>取消</button><button type='button' disabled={greetingBusy} onClick={() => void changeGreeting(null)} className='font-semibold text-rose-700'>确认删除</button></div></div>}
                    {greetingError && <p role='alert' className='mt-2 text-xs text-rose-600'>{greetingError}</p>}
                </div>
                <div className='mt-5' data-story-opening-settings='true'>
                    <div className='text-[10px] font-bold text-slate-500'>谁先落笔</div>
                    <div className='mt-2 grid grid-cols-2 p-1 rounded-xl bg-slate-200'>
                        <button type='button' disabled={maskLocked || greetingBusy || createGreetingBusy || editingGreeting || confirmGreetingDelete}
                            onClick={() => {
                                setShowOpeningInIntro(false);
                                setChooseGreetingActor(false);
                                const updateTitle = titleFromOpening(undefined);
                                setDraft(current => {
                                    const promoted = promotedPremise.current;
                                    const restore = promoted?.characterId === current.openingGreeting?.characterId
                                        && promoted?.greetingId === current.openingGreeting?.greetingId
                                        && !current.premise.trim();
                                    return { ...current, title: updateTitle(current.title), premise: restore && promoted ? promoted.content : current.premise, openingMode: 'user', openingGreeting: undefined, updatedAt: Date.now() };
                                });
                            }}
                            className={`py-2.5 rounded-lg text-[11px] font-bold disabled:opacity-60 ${!storyFirst ? 'bg-white shadow-sm text-violet-700' : 'text-slate-500'}`}>我先写</button>
                        <button type='button' disabled={maskLocked || greetingBusy || createGreetingBusy || editingGreeting || confirmGreetingDelete}
                            onClick={() => update('openingMode', 'assistant')}
                            className={`py-2.5 rounded-lg text-[11px] font-bold disabled:opacity-60 ${storyFirst ? 'bg-white shadow-sm text-violet-700' : 'text-slate-500'}`}>故事先写</button>
                    </div>
                    <div className='mt-3'>
                    <label htmlFor='story-opening-choice' className='text-[10px] font-bold text-slate-500'>已有开场 · 可选</label>
                    {greetingChoices.length > 12 && <div className='mt-2'>
                        <input type='search' aria-label='搜索已有开场白' value={greetingSearch}
                            onChange={event => setGreetingSearch(event.target.value)}
                            placeholder={`搜索开场白名称或角色（共 ${greetingChoices.length} 条）`}
                            className='w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs outline-none' />
                        <p role='status' className='mt-1 text-[10px] text-slate-400'>
                            {greetingSearch.trim() ? `匹配 ${greetingChoices.filter(item => [item.title, item.characterName, item.description || ''].some(value => value.toLocaleLowerCase('zh-CN').includes(greetingSearch.trim().toLocaleLowerCase('zh-CN')))).length} 条；已选的开场会始终保留在列表中` : '支持按名称、角色搜索，不必从几十条开场中慢慢翻找'}
                        </p>
                    </div>}
                    <select id='story-opening-choice' aria-label='选择已有开场' disabled={maskLocked || greetingBusy || createGreetingBusy || importGreetingBusy || editingGreeting || confirmGreetingDelete || chooseGreetingActor || greetingChoices.length === 0}
                        value={selectedGreeting ? `${selectedGreeting.characterId}::${selectedGreeting.id}` : ''}
                        onChange={event => {
                            const selected = greetingChoices.find(item => `${item.characterId}::${item.id}` === event.target.value);
                            const updateTitle = titleFromOpening(selected?.title);
                            setDraft(current => {
                                const promoted = promotedPremise.current;
                                const restore = !selected && !current.premise.trim()
                                    && promoted?.characterId === current.openingGreeting?.characterId
                                    && promoted?.greetingId === current.openingGreeting?.greetingId;
                                return {
                                    ...current,
                                    title: updateTitle(current.title),
                                    premise: restore && promoted ? promoted.content : current.premise,
                                    openingMode: selected ? 'assistant' : current.openingMode,
                                    openingGreeting: selected ? { characterId: selected.characterId, greetingId: selected.id } : undefined,
                                    updatedAt: Date.now(),
                                };
                            });
                            setChooseGreetingActor(false);
                            setEditingGreeting(false); setConfirmGreetingDelete(false); setGreetingError('');
                            setShowOpeningInIntro(!!selected);
                            setGreetingSearch('');
                        }}
                        className='mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs disabled:opacity-60'>
                        <option value=''>{actors.length === 0 ? '先选择参与角色'
                            : greetingChoices.length === 0 ? '暂无可选开场'
                            : storyFirst ? '自动写第一幕' : '选择已有开场'}</option>
                        {matchingGreetingChoices.map(item => <option key={`${item.characterId}::${item.id}`} value={`${item.characterId}::${item.id}`}>[{item.source === 'link' ? 'Link' : item.source === 'custom' ? '自定义' : '酒馆'}] {item.characterName} · {item.title}{item.description ? `｜${item.description.replace(/\s+/g, ' ').slice(0, 32)}` : ''}</option>)}
                    </select>
                    {selectedGreeting && selectedGreeting.content.length > 12000 && <p role='status' className='mt-2 rounded-xl border border-amber-200 px-3 py-2 text-[10px] leading-5 text-amber-700'>
                        这篇开场白有 {selectedGreeting.content.length.toLocaleString()} 字符（约 {estimateStoryTokens(selectedGreeting.content).toLocaleString()} tokens）。作为剧情首楼会影响后续上下文长度，过长时模型可能超限；建议先缩短再推进。
                    </p>}
                    <div data-story-opening-document-import='true' className='mt-3 rounded-2xl border border-slate-200 bg-white/75 px-3 py-3'>
                        <div className='flex flex-wrap items-center justify-between gap-2'>
                            <div className='min-w-0'>
                                <div className='text-[11px] font-semibold text-slate-700'>批量导入开场白</div>
                                <p className='mt-0.5 text-[10px] leading-4 text-slate-400'>TXT / DOCX · 每次最多 200 个 · 文件名按 1、2、10 排序</p>
                                <p className='mt-0.5 text-[9px] leading-4 text-slate-400'>先校验整批，若有损坏文件则整批不保存，避免缺篇；DOCX 只读取文字，不保留图片和原排版</p>
                                <p className='mt-0.5 text-[9px] leading-4 text-slate-400'>导入会保存到选中角色的开场库，其他使用该角色的剧情也能选用；不会覆盖已有剧情正文</p>
                            </div>
                            <button type='button' data-story-opening-import-button='true'
                                disabled={!actors.length || !onImportGreetings || maskLocked || importGreetingBusy || greetingBusy || createGreetingBusy || editingGreeting || confirmGreetingDelete || chooseGreetingActor}
                                onClick={() => openingFileInput.current?.click()}
                                className='inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-700 shadow-sm transition-colors active:bg-slate-100 disabled:opacity-40'>
                                {importGreetingBusy ? <SpinnerGap size={15} className='animate-spin' /> : <UploadSimple size={15} />}
                                {importGreetingBusy ? '导入中…' : '选择文件'}
                            </button>
                        </div>
                        {actors.length > 1 && <div className='mt-3 flex items-center gap-2'>
                            <label htmlFor='story-opening-import-actor' className='shrink-0 text-[10px] text-slate-500'>导入给</label>
                            <select id='story-opening-import-actor' aria-label='导入开场归属角色'
                                value={actors.some(actor => actor.id === importTargetActor) ? importTargetActor : actors[0].id}
                                disabled={importGreetingBusy}
                                onChange={event => setImportTargetActor(event.target.value)}
                                className='min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700'>
                                {actors.map(actor => <option key={actor.id} value={actor.id}>{actor.name}</option>)}
                            </select>
                        </div>}
                        {!actors.length && <p className='mt-2 text-[10px] text-amber-600'>先在下方选择参与角色，导入的开场白才有归属。</p>}
                        <input type='file' ref={openingFileInput} multiple accept={STORY_OPENING_ACCEPT}
                            aria-label='批量选择开场白文件' className='hidden'
                            onChange={event => {
                                const files = Array.from(event.currentTarget.files || []);
                                event.currentTarget.value = '';
                                void handleOpeningDocumentsSelected(files);
                            }} />
                        {importGreetingFeedback && <p role={importGreetingFeedback.error ? 'alert' : 'status'}
                            className={`mt-2 break-words text-[10px] leading-5 ${importGreetingFeedback.error ? 'text-rose-600' : 'text-emerald-700'}`}>
                            {importGreetingFeedback.text}
                        </p>}
                    </div>
                    {actors.length > 0 && greetingChoices.length === 0 && !draft.openingGreeting && <p className='mt-1.5 text-[10px] text-slate-400'>也可在上方写好正文，点书签存为开场。</p>}
                    {draft.openingGreeting && !selectedGreeting && <div className='mt-2 text-[10px] text-amber-700'>
                        {maskLocked ? '已写出的第一幕不受原素材删除影响。' : '原开场已失效，请重新选择。'}
                        {!maskLocked && <button type='button' onClick={() => {
                            const updateTitle = titleFromOpening(undefined);
                            setDraft(current => ({ ...current, title: updateTitle(current.title), openingGreeting: undefined, updatedAt: Date.now() }));
                            setShowOpeningInIntro(false);
                        }} className='ml-2 underline'>清除失效选择</button>}
                    </div>}
                </div>
                    {!selectedGreeting && <p className='mt-2 text-[10px] text-slate-400'>{storyFirst
                        ? '进入后点推进，让故事写下第一幕。'
                        : '进入后由你写下第一句话。'}</p>}
                </div>
            </section>
            <section ref={castSection} className='pt-6 border-t border-slate-200'>
                <div className='text-[9px] tracking-[.22em] uppercase font-bold text-violet-500'>02 / Cast</div><h2 className='mt-1 text-lg font-semibold'>让谁参与</h2>
                <p className='text-[11px] text-slate-500'>先决定你是谁，再一次选好这段剧情里的角色。你选择的身份只由你控制，不会自行行动。扮演已有角色时，可不加其他人直接开始个人剧情。</p>
                <button disabled={maskLocked || draft.writesToCharacterMemory} onClick={() => onOpenMaskBox(draft)} className='mt-4 w-full p-4 rounded-2xl bg-slate-900 text-white flex items-center gap-3 text-left disabled:cursor-not-allowed'>
                    {resolvedMask.avatar ? <TokenImg value={resolvedMask.avatar} alt='' className='w-11 h-11 rounded-full object-cover' /> : <span className='w-11 h-11 rounded-full bg-white/10 grid place-items-center'><UserCircle size={24} /></span>}
                    <span className='min-w-0 flex-1'><span className='block text-[9px] uppercase tracking-[.18em] text-violet-200'>你</span><strong className='block mt-1 text-sm truncate'>{resolvedMask.selection.type === 'user' ? '本人' : resolvedMask.name}</strong><span className='block mt-1 text-[9px] text-slate-300 truncate'>{resolvedMask.selection.type === 'user' ? '以真实的自己进入剧场' : resolvedMask.selection.type === 'character' ? '扮演已有角色' : '扮演原创人物'}</span></span>
                    <span className='text-[10px] font-bold text-violet-200'>{draft.writesToCharacterMemory ? <span className='inline-flex items-center gap-1'><LockSimple size={13} />真实身份</span> : maskLocked ? <span className='inline-flex items-center gap-1'><LockSimple size={13} />剧情中锁定</span> : '面具箱'}</span>
                </button>
                {(maskLocked || draft.writesToCharacterMemory) && <p className='mt-2 text-[10px] leading-5 text-slate-500'>{draft.writesToCharacterMemory ? '真实时间陪伴只能使用真实的你，不能扮演已有角色或原创人物。' : '第一段内容发出后，当前身份会锁定，避免中途更换导致人物记忆与叙事视角错位。'}</p>}
                <div className='mt-4 grid grid-cols-2 gap-2.5'>{characters.map(char => { const selected = draft.characterIds.includes(char.id); const isMask = draft.mask?.type === 'character' && draft.mask.id === char.id; return <button key={char.id} aria-label={char.name} aria-pressed={selected} disabled={isMask || maskLocked} onClick={() => toggleCharacter(char)} className={`flex items-center gap-3 p-3 rounded-2xl border text-left disabled:opacity-45 ${selected ? 'bg-violet-50 border-violet-300' : 'bg-white border-slate-200'}`}>{char.avatar
                    ? <TokenImg value={char.avatar} alt='' className='w-10 h-10 rounded-full object-cover' />
                    : <span aria-hidden='true' className='w-10 h-10 shrink-0 rounded-full bg-slate-200 text-slate-600 grid place-items-center text-xs font-semibold'>{char.name?.slice(0, 1) || '角'}</span>}<span className='min-w-0 flex-1'><span className='block text-sm font-semibold truncate'>{char.name}</span>{isMask && <span className='block text-[9px] text-violet-500'>当前由你扮演</span>}</span><span className={`w-4 h-4 rounded-full border-2 ${selected ? 'bg-violet-600 border-violet-600' : 'border-slate-300'}`} /></button>; })}</div>

            </section>
            <section className='pt-6 border-t border-slate-200'>
                <div className='text-[9px] tracking-[.22em] uppercase font-bold text-violet-500'>03 / Memory</div><h2 className='mt-1 text-lg font-semibold'>这段故事是真的吗</h2>
                <div className='mt-4 grid grid-cols-2 p-1 rounded-xl bg-slate-200'><button disabled={maskLocked} onClick={() => setDraft(current => ({ ...current, mask: { type: 'user' }, writesToCharacterMemory: true, carryCharacterMemory: true, updatedAt: Date.now() }))} className={`py-3 rounded-lg text-[11px] font-bold disabled:opacity-35 ${draft.writesToCharacterMemory ? 'bg-white shadow-sm text-violet-700' : 'text-slate-500'}`}>真实时间陪伴</button><button disabled={maskLocked} onClick={() => setDraft(current => ({ ...current, writesToCharacterMemory: false, carryCharacterMemory: false, updatedAt: Date.now() }))} className={`py-3 rounded-lg text-[11px] font-bold disabled:opacity-35 ${!draft.writesToCharacterMemory ? 'bg-white shadow-sm text-violet-700' : 'text-slate-500'}`}>虚构剧场</button></div>
                {maskLocked && <p className='mt-2 text-[10px] text-slate-400'>故事开始后，真实/虚构模式也会固定；虚构剧场的记忆输入仍可单独调整。</p>}
                {draft.writesToCharacterMemory ? <div className='story-memory-live-card mt-5 p-4 rounded-2xl bg-amber-50 border border-amber-200'>
                    <div className='text-xs font-bold text-amber-800'>记忆输入与输出都会开启</div>
                    <p className='mt-1 text-[10px] leading-5 text-amber-700'>会读取角色既有记忆；你写的内容与故事正文也会分别进入每位角色的正常记忆，作为你们的共同经历。</p>
                    <p className='mt-2 text-[10px] leading-5 text-amber-700'>跟随真实时间：你的输入和角色回复会按各自实际发送的时间记录，无需设置日期。正文中的虚构日期不会改变聊天记录的时间与顺序；如果不希望故事成为共同记忆，请在开始前选择「虚构剧场」。</p>
                    <p className='mt-2 pt-2 border-t border-amber-200 text-[10px] leading-5 font-semibold text-amber-800'>内置真实性保护：角色不能捏造和你的共同记忆，也不能给已有记忆添油加醋。</p>
                </div> : <div className='mt-5 space-y-5'>
                    <div className='py-3 border-y border-slate-200 flex items-center justify-between gap-3'><div><div className='text-sm font-semibold'>自动记忆输出</div><p className='mt-1 text-[10px] leading-5 text-slate-500'>虚构时间与经历不会自动写入角色的正常记忆。需要保留时，可在剧情右上角「事件盒」选择摘要、填写日期，手动转为带剧情来源的记忆。</p></div><span className='shrink-0 px-2 py-1 rounded-full bg-slate-200 text-[9px] font-bold text-slate-500'>关闭</span></div>
                    <div className='flex items-start justify-between gap-5'><div><div className='text-sm font-semibold'>记忆输入</div><p className='mt-1 text-[10px] text-slate-500'>默认关闭；打开后角色会带着既有记忆进入虚构故事。关闭时只读取名字、核心指令和世界观。</p></div><Toggle value={draft.carryCharacterMemory} onChange={value => update('carryCharacterMemory', value)} /></div>
                    {draft.carryCharacterMemory && <div className='space-y-2'>{memoryParticipants.map(char => <label key={char.id} className='flex items-center gap-3 text-xs'><span className='flex-1 truncate'>{char.name}{draft.mask?.type === 'character' && draft.mask.id === char.id ? '（当前身份）' : ''} 最近原文</span><input type='number' min={0} max={500} value={draft.characterContextLimits[char.id] ?? 100} onChange={event => update('characterContextLimits', { ...draft.characterContextLimits, [char.id]: Math.max(0, Math.min(500, Number(event.target.value) || 0)) })} className='w-20 px-3 py-2 rounded-xl bg-white border border-slate-200 text-right' /><span className='text-slate-400'>条</span></label>)}</div>}
                    <div><div className='text-sm font-semibold'>归档方式</div><div className='mt-2 grid grid-cols-2 p-1 rounded-xl bg-slate-200'><button onClick={() => update('archiveStrategy', 'summary')} className={`py-2 rounded-lg text-[11px] font-bold ${draft.archiveStrategy === 'summary' ? 'bg-white shadow-sm' : 'text-slate-500'}`}>事件盒</button><button onClick={() => update('archiveStrategy', 'vector')} className={`py-2 rounded-lg text-[11px] font-bold ${draft.archiveStrategy === 'vector' ? 'bg-white shadow-sm' : 'text-slate-500'}`}>独立向量</button></div></div>
                    <div className='grid grid-cols-2 gap-3'>
                        <label><span className='block mb-2 text-[10px] text-slate-500'>累计多少层后归档</span><input type='number' min={2} max={200} value={draft.archiveAfter} onChange={event => update('archiveAfter', Number(event.target.value))} className='w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-sm' /></label>
                        <label><span className='block mb-2 text-[10px] text-slate-500'>至少保留最近几层</span><input type='number' min={1} max={Math.max(1, Number(draft.archiveAfter) - 1)} value={draft.archiveKeepRecent ?? 5} onChange={event => update('archiveKeepRecent', Number(event.target.value))} className='w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-sm' /></label>
                    </div>
                    <p className='text-[10px] leading-5 text-slate-500'>仅开启下方的自动记忆 API 后，才会按这里的设置归档。默认保留最近 5 层。</p>
                </div>}
                <div className='mt-6 flex items-start justify-between gap-3 border-t border-slate-200 pt-5'>
                    <div className='min-w-0'>
                        <div className='text-sm font-semibold'>自动记忆 API</div>
                        <p className='mt-1 text-[10px] leading-5 text-slate-500'>默认关闭。开启后，本剧情的自动事件盒、向量召回与归档、角色记忆整理可在续写前后额外调用 API，站点可能另计费用。没有设置专用 API 时，部分整理会使用主 API。</p>
                        <p className='mt-1 text-[10px] leading-5 text-slate-500'>关闭时仍可使用已保存的正文和本地记忆。长剧情会继续使用未归档原文，可能增加正文请求的输入量。</p>
                    </div>
                    <Toggle label='启用自动记忆 API' value={draft.automaticMemoryApiEnabled === true}
                        onChange={enabled => update('automaticMemoryApiEnabled', enabled)} />
                </div>
                <div className='mt-6 pt-5 border-t border-slate-200' data-story-memory-api-settings>
                    <div className='flex items-start justify-between gap-3'>
                        <div className='min-w-0'><div className='text-sm font-semibold'>剧情记忆总结副 API</div>
                            <p className='mt-1 text-[10px] leading-5 text-slate-500'>仅本剧情的事件盒自动／手动总结与独立向量归档中的文字提取使用。正文仍走主 API；真实陪伴的共享角色记忆整理、事件盒转角色记忆继续走全局记忆配置，防止副 API 污染其他聊天。</p>
                        </div>
                        <Toggle label='使用剧情记忆副 API' value={!!draft.memorySummaryApi}
                            onChange={enabled => update('memorySummaryApi', enabled ? (draft.memorySummaryApi || { baseUrl: '', apiKey: '', model: '' }) : undefined)} />
                    </div>
                    {draft.memorySummaryApi && <div className='mt-4 space-y-3'>
                        <label className='block'><span className='block mb-2 text-[10px] text-slate-500'>从已保存的 API 预设载入</span>
                            <select aria-label='选择剧情记忆 API 预设' value={findActivePresetId(safeApiPresets, draft.memorySummaryApi) ?? ''} onChange={event => {
                                const preset = safeApiPresets.find(item => item.id === event.target.value);
                                if (preset) update('memorySummaryApi', storyMemoryApiFromPreset(preset));
                            }} className='w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs'>
                                <option value=''>选择预设（不会修改全局 API）</option>
                                {safeApiPresets.map(preset => <option key={preset.id} value={preset.id}>{preset.group ? preset.group + ' · ' : ''}{preset.name} · {preset.config.model || '未填写模型'}</option>)}
                            </select>
                        </label>
                        {safeApiPresets.length === 0 && <p className='text-[10px] text-slate-500'>预设库为空，可以直接填写下方信息。</p>}
                        <label className='block'><span className='block mb-2 text-[10px] text-slate-500'>API 地址（URL）</span>
                            <input aria-label='剧情记忆副 API URL' type='url' value={draft.memorySummaryApi.baseUrl}
                                onChange={event => update('memorySummaryApi', { ...draft.memorySummaryApi!, baseUrl: event.target.value })}
                                placeholder='https://example.com/v1' className='w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs outline-none focus:border-violet-400' />
                        </label>
                        <label className='block'><span className='block mb-2 text-[10px] text-slate-500'>API Key（可留空）</span>
                            <input aria-label='剧情记忆副 API Key' type='password' autoComplete='off' value={draft.memorySummaryApi.apiKey}
                                onChange={event => update('memorySummaryApi', { ...draft.memorySummaryApi!, apiKey: event.target.value })}
                                placeholder='sk-...' className='w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs outline-none focus:border-violet-400' />
                        </label>
                        <label className='block'><span className='block mb-2 text-[10px] text-slate-500'>模型名称（Model）</span>
                            <input aria-label='剧情记忆副 API 模型' type='text' value={draft.memorySummaryApi.model}
                                onChange={event => update('memorySummaryApi', { ...draft.memorySummaryApi!, model: event.target.value })}
                                placeholder='gemini-...' className='w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs outline-none focus:border-violet-400' />
                        </label>
                        <p className='text-[10px] leading-5 text-slate-500'>选择预设只复制当前 URL / Key / Model；之后修改或删除预设也不会让本剧情暗中切换。副 API 不可用时会报错并保留原文，绝不偷偷回退到昂贵主 API。</p>
                        {storyMemoryApiSharesGateway(draft.memorySummaryApi, mainApi) && <p role='status' data-story-memory-gateway-warning className='rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] leading-5 text-amber-800'>副 API 与剧情主 API 使用同一接口站点，即使模型不同，也可能共享站点限流、并发限制和额度。建议使用真正独立的站点与账户；这个设置不会改变主 API 本身。</p>}
                        <p className='text-[10px] leading-5 text-slate-500'>事件盒摘要会代替已归档的旧正文进入后续主模型上下文。便宜模型若记错剧情，会影响续写质量；建议先检查事件盒摘要，错误可在事件盒中重新总结。导入备份后记得核对地址、密钥和模型：本剧情保留配置快照；副 API 需要支持非流式 Chat Completions，不跟随主 API 的流式开关。</p>
                        {memoryApiError && <p role='alert' className='rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-[11px] leading-5 text-rose-700'>{memoryApiError}</p>}
                    </div>}
                </div>
            </section>
            <section className='pt-6 border-t border-slate-200'>
                <div className='text-[9px] tracking-[.22em] uppercase font-bold text-violet-500'>04 / Lore</div><div className='flex items-center justify-between gap-3'><h2 className='mt-1 text-lg font-semibold'>世界书沙盒</h2>{draft.selectedWorldbookIds.length > 0 && <span className='text-[10px] text-slate-500'>已选 {draft.selectedWorldbookIds.length}</span>}</div><p className='text-[10px] text-slate-500'>从全局世界书库选择，仅对本剧情生效，不改变角色挂载。</p>
                {books.length > 8 && <input type='search' aria-label='搜索剧情世界书' value={worldbookSearch} onChange={event => setWorldbookSearch(event.target.value)} placeholder='搜索世界书名称或分类' className='mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs outline-none focus:border-violet-400' />}
                <div role='group' aria-label='剧情世界书列表' className={`mt-3 divide-y divide-slate-100 border-y border-slate-200 ${books.length > 12 ? 'max-h-[44vh] overflow-y-auto overscroll-contain' : ''}`}>{books.length === 0 ? <div className='py-6 text-center text-xs text-slate-400'>全局世界书库暂无可选内容</div> : visibleBooks.length === 0 ? <div className='py-6 text-center text-xs text-slate-400'>没有匹配的世界书</div> : visibleBooks.map(book => { const selected = draft.selectedWorldbookIds.includes(book.id); return <button type='button' key={book.id} aria-pressed={selected} aria-label={`世界书：${book.title}`} onClick={() => setDraft(current => ({ ...current, selectedWorldbookIds: current.selectedWorldbookIds.includes(book.id) ? current.selectedWorldbookIds.filter(id => id !== book.id) : [...current.selectedWorldbookIds, book.id], updatedAt: Date.now() }))} className='w-full py-3 flex items-center gap-3 text-left'><span className={`w-4 h-4 shrink-0 rounded border text-[10px] text-center text-white ${selected ? 'bg-violet-600 border-violet-600' : 'border-slate-300'}`}>{selected ? '✓' : ''}</span><span className='min-w-0'><span className='block text-xs font-semibold truncate'>{book.title}</span><span className='block text-[9px] text-slate-400 truncate'>{book.category || '未分类'}{book.disable ? ' · 已停用' : ''}{duplicatedWorldbookTitles.has(book.title.trim().toLocaleLowerCase()) ? ` · ${book.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 32) || '无正文'}` : ''}</span></span></button>; })}</div>
                {missingSelectedBooks.length > 0 && <div className='mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-amber-700'><span>有 {missingSelectedBooks.length} 条已选世界书暂不可用（已删除或 ID 冲突），不会发送</span><button type='button' onClick={() => setDraft(current => ({ ...current, selectedWorldbookIds: current.selectedWorldbookIds.filter(id => !missingSelectedBooks.includes(id)), updatedAt: Date.now() }))} className='shrink-0 underline underline-offset-2'>清除失效选择</button></div>}
            </section>
            <section className='pt-6 border-t border-slate-200'>
                <div className='text-[9px] tracking-[.22em] uppercase font-bold text-violet-500'>05 / Preset</div><h2 className='mt-1 text-lg font-semibold'>装载剧情预设</h2><p className='text-[10px] text-slate-500'>支持糯米机原生预设和酒馆 Chat Completion JSON；单文件导入自动选中，批量导入只加入预设库，不替换当前剧情。</p>
                {presets.length > 12 && <div className='mt-3'>
                    <input type='search' aria-label='搜索剧情预设' value={presetSearch}
                        onChange={event => setPresetSearch(event.target.value)}
                        placeholder={`搜索预设名称（共 ${presets.length} 份）`}
                        className='w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs outline-none' />
                    <p role='status' className='mt-1 text-[10px] text-slate-400'>
                        {presetSearch.trim() ? `匹配 ${presets.filter(item => item.name.toLocaleLowerCase('zh-CN').includes(presetSearch.trim().toLocaleLowerCase('zh-CN'))).length} 份；当前预设始终保留在下拉列表中` : '可按预设名称搜索；不必逐项翻找'}
                    </p>
                </div>}
                <div className='mt-3 flex gap-2'><select disabled={presetImportBusy} value={preset?.id || ''} onChange={event => { setDraft(current => ({ ...current, presetId: event.target.value, presetOverride: undefined, updatedAt: Date.now() })); setPresetSearch(''); }} className='min-w-0 flex-1 px-3 py-3 rounded-xl bg-white border border-slate-200 text-xs'>{matchingPresets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button type='button' title='导入一个或多个剧情预设' aria-label='导入剧情预设' disabled={presetImportBusy} onClick={() => fileInput.current?.click()} className='w-11 rounded-xl bg-white border border-slate-200 grid place-items-center disabled:opacity-40'>{presetImportBusy ? <SpinnerGap size={18} className='animate-spin' /> : <UploadSimple size={18} />}</button><button disabled={!preset} onClick={() => { if (preset) void downloadStoryPreset(preset); }} className='w-11 rounded-xl bg-white border border-slate-200 grid place-items-center disabled:opacity-30'><DownloadSimple size={18} /></button></div>
                <input ref={fileInput} type='file' multiple accept='.json,.png,application/json,image/png' className='hidden' onChange={async event => {
                    const files = Array.from(event.currentTarget.files || []);
                    event.currentTarget.value = '';
                    if (!files.length || presetImportLock.current) return;
                    presetImportLock.current = true;
                    setPresetImportBusy(true);
                    setPresetImportFeedback(`正在检查 ${files.length} 份剧情预设……`);
                    let importedCount = 0;
                    let failedCount = 0;
                    try {
                        for (const file of files) {
                            const imported = await onImportPreset(file);
                            if (!imported) { failedCount++; continue; }
                            importedCount++;
                            // Multiple imports mean "add to my library", not "replace
                            // the preset of the ongoing story with the last file".
                            if (files.length === 1) {
                                setDraft(current => ({ ...current, presetId: imported.id,
                                    presetOverride: undefined, updatedAt: Date.now() }));
                            }
                        }
                        setPresetImportFeedback(files.length === 1
                            ? importedCount ? '预设导入成功，已选为本剧情预设；保存并进入后生效。' : '预设导入失败，当前剧情配置未改变。'
                            : `已导入或找到 ${importedCount} 份预设${failedCount ? `，${failedCount} 份失败` : ''}；当前剧情预设未改变。请从下拉列表手动选择要使用的预设。`);
                    } catch (error) {
                        setPresetImportFeedback(`预设导入中断：${error instanceof Error ? error.message : '文件读取失败'}。已有结果保留，当前剧情配置不会自动更换。`);
                    } finally {
                        presetImportLock.current = false;
                        setPresetImportBusy(false);
                    }
                }} />
                {presetImportFeedback && <p role='status' className='mt-2 text-[10px] leading-5 text-slate-500'>{presetImportFeedback}</p>}
                {preset && <div className='mt-3 flex items-center justify-between'><span className='text-[10px] text-slate-500'>启用 {presetStats.enabled}/{presetStats.total} 条 · 按当前顺序与插入位置发送</span><button onClick={() => onEditPreset(preset, draft)} className='text-[10px] font-bold text-violet-600'>打开制作器</button></div>}
                {(skippedTavernRegex || htmlTavernTheater) && <p className='mt-2 text-[10px] leading-5 text-amber-700'>
                    {skippedTavernRegex ? '酒馆附带的正则/脚本没有执行。' : ''}
                    {htmlTavernTheater ? '小剧场支持隔离的安全 HTML 排版与原生卡片；酒馆插件特效无法完全复刻。' : ''}
                    如需避免格式冲突，可在制作器检查并关闭相应的酒馆规则；不会自动删除你的预设内容。
                </p>}

                <div className='mt-5 space-y-4 border-t border-slate-200 pt-4'>
                    <label className='flex items-center justify-between gap-4'>
                        <span>
                            <span className='block text-sm font-semibold'>本剧情最大输出</span>
                            <span className='mt-1 block text-[10px] leading-5 text-slate-500'>单位为 tokens，最高 30,000。留空沿用预设（{normalizeStoryOutputTokens(sourceDoc?.generation.maxTokens).toLocaleString('zh-CN')}）。</span>
                        </span>
                        <input type='number' min={STORY_MIN_OUTPUT_TOKENS} max={STORY_MAX_OUTPUT_TOKENS} step={1}
                            value={draft.outputMaxTokens ?? ''} placeholder='沿用预设'
                            onChange={event => update('outputMaxTokens', event.target.value === '' ? undefined : Number(event.target.value))}
                            className='w-24 shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-right text-xs' />
                    </label>
                    <div className='flex items-start justify-between gap-5'>
                        <div><div className='text-sm font-semibold'>长回复流式传输</div><p className='mt-1 text-[10px] leading-5 text-slate-500'>开启后分段接收正文，减少非流式等待整包返回时的断连。关闭时沿用主 API 的流式设置。</p></div>
                        <Toggle label='长回复流式传输' value={draft.streamStoryOutput === true} onChange={value => update('streamStoryOutput', value)} />
                    </div>
                </div>
                <div className='mt-5 pt-4 border-t border-slate-200'>
                    <div className='flex items-start justify-between gap-5'>
                        <div><div className='text-sm font-semibold'>不发送高级采样参数</div><p className='mt-1 text-[10px] leading-5 text-slate-500'>默认关闭。仅当接口不接受这些字段时开启；开启后不发送 top_p、frequency_penalty 和 presence_penalty。</p></div>
                        <Toggle label='不发送高级采样参数' value={draft.omitSamplingParams === true} onChange={value => update('omitSamplingParams', value)} />
                    </div>
                    {draft.omitSamplingParams && <p className='mt-3 border-l-2 border-amber-400 pl-3 text-[10px] leading-5 text-amber-700'>这会忽略当前预设中的三项参数，包括非默认值。正常支持酒馆参数的接口请保持关闭。</p>}
                </div>
                <div className='mt-5 pt-4 border-t border-slate-200'>
                    <div className='flex items-start justify-between gap-5'>
                        <div><div className='text-sm font-semibold'>400 兼容模式</div><p className='mt-1 text-[10px] leading-5 text-slate-500'>仅当接口提示“最后一条消息必须是 user”时开启。</p></div>
                        <Toggle label='400 兼容模式' value={draft.forceUserLastMessage === true} onChange={value => update('forceUserLastMessage', value)} />
                    </div>
                    {draft.forceUserLastMessage && <p className='mt-3 border-l-2 border-amber-400 pl-3 text-[10px] leading-5 text-amber-700'>开启后会用系统指令代替原生助手预填，可能削弱格式与文风效果。优先建议更换支持该预设的模型。</p>}
                </div>
            </section>
            <section className='pt-6 border-t border-slate-200'>
                <div className='text-[9px] tracking-[.22em] uppercase font-bold text-violet-500'>06 / Budget</div>
                <div className='mt-2 flex items-end justify-between gap-4'><div><h2 className='text-lg font-semibold'>静态配置预算</h2><p className='mt-1 text-[10px] leading-5 text-slate-500'>这里只比较角色、世界书、预设与归档；剧场内会按续写实际使用的完整上下文统计历史、召回和本轮输入。</p></div><strong className='text-2xl font-serif'>{Object.values(tokenPreview).reduce((sum, value) => sum + value, 0).toLocaleString()}</strong></div>
                <div className='mt-4 grid grid-cols-4 gap-2'>{Object.entries({ '角色': tokenPreview.actor, '世界书': tokenPreview.book, '预设': tokenPreview.preset, '归档': tokenPreview.archive }).map(([label, value]) => <div key={label} className='py-3 rounded-xl bg-white border border-slate-200 text-center'><div className='text-[9px] text-slate-400'>{label}</div><div className='mt-1 text-xs font-bold'>{value.toLocaleString()}</div></div>)}</div>
            </section>
            <button onClick={save} disabled={saving} className='story-setup-save w-full py-4 rounded-2xl bg-slate-900 text-white text-sm font-bold disabled:opacity-30'>{saving ? '正在保存……' : '保存并进入剧情'}</button>
        </div></main>
    </div>;
};

export default StoryTheaterEditor;
