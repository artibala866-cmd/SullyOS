import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readShareFile } from '../../../utils/pngShare';
import { Archive, ArrowLeft, Database, DownloadSimple, FilmSlate, Plus, SpinnerGap, Trash, UploadSimple, UsersThree, X } from '@phosphor-icons/react';
import { useOS } from '../../../context/OSContext';
import TokenImg from '../../os/TokenImg';
import type { StoryTheaterEntry, StoryTheaterMask, StoryTheaterMaskSelection, StoryTheaterPreset, TavernOpeningGreeting } from '../../../types';
import { DB } from '../../../utils/db';
import {
    BUILTIN_NIGHT_SCREENING_PRESET,
    createBlankStoryPreset,
    createStoryTheaterDraft,
    downloadStoryPreset,
    normalizeStoryTheater,
    resolveStoryOpeningGreeting,
    storyTheaterMemoryRecipientIds,
    parseStoryTheaterPreset,
    MAX_STORY_PRESET_BYTES,
    resolveStoryTheaterMask,
    storyTheaterThreadId,
    withBuiltInStoryPresets,
} from '../../../utils/storyTheater';
import { readStoryRegexRules, STORY_REGEX_ASSET, type StoryRegexRule } from '../../../utils/storyRegex';
import { ALCHEMY_CHANGED, alchemyDomain } from '../../../utils/alchemyRegex';
import StoryRegexPanel from './StoryRegexPanel';
import StoryMaskBox from './StoryMaskBox';
import StoryPresetMaker from './StoryPresetMaker';
import StoryTheaterEditor from './StoryTheaterEditor';
import StoryTheaterSession from './StoryTheaterSession';
import { isStoryGenerationRunning, observeStoryGenerations } from '../../../utils/storyTheaterBackground';
import StoryVectorMemoryPanel from './StoryVectorMemoryPanel';
import StoryArchivePanel from './StoryArchivePanel';
import { StoryAppearanceButton, StoryTheaterThemeProvider } from './StoryTheaterTheme';
import { deleteStoryTheaterData } from '../../../utils/storyTheaterDeletion';
import { deleteUnusedStoryMask, saveStoryWithOpening } from '../../../utils/storyTheaterPersistence';
import { adaptTavernOpeningGreeting, tavernOpeningBodyKey } from '../../../utils/tavernOpeningGreeting';
import { isLegacyLinkOpening, listCharacterStoryOpenings } from '../../../utils/linkStoryOpenings';
import { readStoryOpeningDocuments } from '../../../utils/storyOpeningDocumentImport';

interface Props {
    onSwitchCompanion: () => void;
    onClose: () => void;
}

type View = 'list' | 'editor' | 'session' | 'preset' | 'masks' | 'vectors' | 'archives' | 'regex';

const StoryTheaterContent: React.FC<Props> = ({ onSwitchCompanion, onClose }) => {
    const { characters, worldbooks, userProfile, apiConfig, apiPresets, addToast, remoteVectorConfig, updateCharacter, importStoryOpeningDocuments } = useOS();
    const [view, setView] = useState<View>('list');
    const viewRef = useRef(view);
    viewRef.current = view;
    const [entries, setEntries] = useState<StoryTheaterEntry[]>([]);
    const [customPresets, setCustomPresets] = useState<StoryTheaterPreset[]>([]);
    const [regexRules, setRegexRules] = useState<StoryRegexRule[]>([]);
    const [regexReady, setRegexReady] = useState(false);
    const [masks, setMasks] = useState<StoryTheaterMask[]>([]);
    const [activeEntry, setActiveEntry] = useState<StoryTheaterEntry | null>(null);
    const [editingPreset, setEditingPreset] = useState<StoryTheaterPreset | null>(null);
    const [maskLocked, setMaskLocked] = useState(false);
    const [deletingEntry, setDeletingEntry] = useState<StoryTheaterEntry | null>(null);
    const [deletingStory, setDeletingStory] = useState(false);
    const importInput = useRef<HTMLInputElement>(null);
    const presetBatchLock = useRef(false);
    const [presetBatchBusy, setPresetBatchBusy] = useState(false);
    const [presetBatchFeedback, setPresetBatchFeedback] = useState('');
    const presets = useMemo(() => withBuiltInStoryPresets(customPresets), [customPresets]);

    const reload = useCallback(async () => {
        const [storedEntries, storedPresets, storedMasks] = await Promise.all([DB.getStoryTheaters(), DB.getStoryTheaterPresets(), DB.getStoryTheaterMasks()]);
        // One malformed story in an imported backup must never hide every other
        // playable story. Keep bad records untouched in IndexedDB for recovery.
        const validEntries = storedEntries.filter(item => item && typeof item.id === 'string' && !!item.id.trim());
        if (validEntries.length !== storedEntries.length) {
            addToast(`备份里有 ${storedEntries.length - validEntries.length} 条剧情记录缺少有效 ID，暂不显示；原始数据没有删除`, 'info');
        }
        setEntries(validEntries.map(normalizeStoryTheater).sort((a, b) => b.updatedAt - a.updatedAt));
        const readable = storedPresets.filter(preset => preset && typeof preset.id === 'string'
            && typeof preset.name === 'string' && Array.isArray(preset.document?.prompts));
        if (readable.length !== storedPresets.length) {
            addToast(`发现 ${storedPresets.length - readable.length} 条旧剧情预设记录不完整，暂不显示，原数据未删除`, 'info');
        }
        setCustomPresets(readable.filter(preset => !preset.builtIn).sort((a, b) => b.updatedAt - a.updatedAt));
        setMasks(storedMasks.sort((a, b) => b.updatedAt - a.updatedAt));
    }, [addToast]);

    useEffect(() => { void reload().catch(error => addToast(error instanceof Error ? `剧情列表读取失败：${error.message}` : '剧情列表读取失败，请检查本地存储', 'error')); }, [reload, addToast]);
    useEffect(() => {
        let mounted = true;
        void DB.getAsset(STORY_REGEX_ASSET).then(raw => {
            if (mounted) setRegexRules(readStoryRegexRules(raw));
        }).catch(error => {
            if (mounted) addToast(`剧情正则读取失败：${error instanceof Error ? error.message : '存储不可用'}`, 'error');
        }).finally(() => {
            if (mounted) setRegexReady(true);
        });
        return () => { mounted = false; };
    }, [addToast]);

    const saveRegexRules = async (update: (current: StoryRegexRule[]) => StoryRegexRule[]) => {
        const stored = await DB.updateAssetRaw(STORY_REGEX_ASSET, raw => {
            if (raw !== null && typeof raw !== 'string') throw new Error('剧情正则数据格式无效');
            return JSON.stringify(update(readStoryRegexRules(raw)));
        });
        setRegexRules(readStoryRegexRules(stored));
        window.dispatchEvent(new Event(ALCHEMY_CHANGED));
    };

    // The submission can finish after the session (or even the whole Meet app)
    // has unmounted. When this parent is visible, refresh from IndexedDB, not
    // from the callback or entry object captured by the old session.
    useEffect(() => observeStoryGenerations(snapshot => {
        if (snapshot.phase === 'running') return;
        void DB.getStoryTheaters().then(rows => {
            const updated = rows.find(row => row.id === snapshot.entryId);
            if (!updated) return;
            const normalized = normalizeStoryTheater(updated);
            setEntries(current => [normalized, ...current.filter(row => row.id !== normalized.id)].sort((a, b) => b.updatedAt - a.updatedAt));
            setActiveEntry(current => current?.id === normalized.id && viewRef.current !== 'editor' ? normalized : current);
        }).catch(error => console.warn('[StoryBackground] failed to refresh story', error));
    }), []);

    const importPreset = useCallback(async (file: File): Promise<StoryTheaterPreset | null> => {
        try {
            const source = await readShareFile(file, 'story', MAX_STORY_PRESET_BYTES);
            let text: string;
            try {
                text = new TextDecoder('utf-8', { fatal: true }).decode(await source.arrayBuffer());
            } catch {
                throw new Error('预设不是有效的 UTF-8 JSON，请重新导出原文件');
            }
            const imported = parseStoryTheaterPreset(text, source.name);
            const result = await DB.importStoryTheaterPreset(imported);
            setCustomPresets(current => [result.preset, ...current.filter(item => item.id !== result.preset.id)]);
            addToast(result.upgraded
                ? `已为「${result.preset.name}」补齐原作者分组，原预设及所有开关未改变`
                : result.duplicate
                    ? `相同剧情预设已存在，已选择「${result.preset.name}」；未重复保存`
                    : `已导入${result.preset.document.sourceFormat === 'sillytavern' ? '酒馆适配' : '糯米机'}剧情预设「${result.preset.name}」`, 'success');
            if (result.preset.document.sourceFormat === 'sillytavern') {
                const warnings = result.preset.document.importWarnings || [];
                const skippedScripts = warnings.some(warning => /启用正则|启用脚本/.test(warning));
                const htmlTheater = warnings.some(warning => warning.includes('酒馆小剧场/HTML'));
                if (skippedScripts || htmlTheater) {
                    addToast(`酒馆兼容提醒：${[
                        skippedScripts ? '正则/脚本不执行' : '',
                        htmlTheater ? '小剧场支持安全 HTML/原生卡片；依赖酒馆正则或脚本的美化不保证一致' : '',
                        '可在预设制作器查看并关闭不适配的指令',
                    ].filter(Boolean).join('；')}`, 'info');
                }
            }
            return result.preset;
        } catch (error: any) {
            addToast(`「${file.name}」导入失败：${error?.message || '无法读取剧情预设'}`, 'error');
            return null;
        }
    }, [addToast]);

    const saveEntry = useCallback(async (next: StoryTheaterEntry) => {
        const normalized = normalizeStoryTheater(next);
        if (isStoryGenerationRunning(normalized.id)) {
            throw new Error('这条剧情正在后台生成，请完成后再保存设置，避免覆盖正在写入的记忆');
        }
        const identity = resolveStoryTheaterMask(normalized.mask, userProfile, characters, masks).name;
        // Existing first-floor text remains the source of truth even if the imported
        // greeting is later changed or removed from the character card.
        // A one-row indexed lookup is enough; long stories may have thousands of floors.
        const started = await DB.getRecentMessagesWithCount(
            storyTheaterThreadId(normalized.id), 1,
            message => message.metadata?.source === 'story_theater',
        );
        const hasStarted = started.messages.length > 0;
        const alreadyInitialized = normalized.openingGreetingInitialized === true;
        const persistedActor = !hasStarted && !alreadyInitialized && normalized.openingGreeting
            ? await DB.getCharacter(normalized.openingGreeting.characterId) : undefined;
        const opening = hasStarted || alreadyInitialized ? null : resolveStoryOpeningGreeting(
            normalized, persistedActor ? [persistedActor] : [], identity, userProfile.name,
        );
        if (!hasStarted && !alreadyInitialized && normalized.openingGreeting && !opening) {
            throw new Error('所选开场白已失效，请重新选择；旧剧情不会改变');
        }
        // Persist the one-time marker in the SAME transaction as the first floor.
        // Re-saving settings after that floor is intentionally deleted must never recreate it.
        const savedEntry = normalized.openingGreeting && (hasStarted || alreadyInitialized || opening)
            ? { ...normalized, openingGreetingInitialized: true } : normalized;
        const requiredRecipients = storyTheaterMemoryRecipientIds(normalized);
        const availableRecipients = requiredRecipients.filter(id => characters.some(character => character.id === id));
        if (normalized.writesToCharacterMemory && requiredRecipients.length !== availableRecipients.length) {
            throw new Error('有参与角色已不存在，无法安全保存角色记忆；请重新选择角色');
        }
        await saveStoryWithOpening(savedEntry, opening, availableRecipients);
        setEntries(current => [savedEntry, ...current.filter(item => item.id !== savedEntry.id)].sort((a, b) => b.updatedAt - a.updatedAt));
        setActiveEntry(savedEntry);
        setView('session');
    }, [characters, masks, userProfile]);

    const changeGreeting = useCallback(async (characterId: string, greetingId: string, content: string | null) => {
        const latest = await DB.getCharacter(characterId);
        if (!latest) throw new Error('角色已不存在，无法修改开场白');
        const nativeLink = (latest.linkGreetings || []).find(row => row.id === greetingId);
        const oldLink = (latest.tavernGreetings || []).find(row =>
            row.id === greetingId && isLegacyLinkOpening(row));
        const selected = listCharacterStoryOpenings(latest, userProfile.name, greetingId).find(row => row.id === greetingId);
        if (!selected) throw new Error('开场白已不存在，请重新选择');
        if (content !== null && (!content.trim() || content.length > 200000))
            throw new Error('开场白正文不能为空或超过 20 万字');

        if (nativeLink || oldLink) {
            // A legacy Link opening saved in tavernGreetings is migrated only
            // when the user edits/deletes it. Never apply Tavern HTML rules.
            const existingLink = latest.linkGreetings || [];
            const nextLinks = content === null
                ? existingLink.filter(row => row.id !== greetingId)
                : nativeLink
                    ? existingLink.map(row => row.id === greetingId ? { ...row, content: content.trim() } : row)
                    : [...existingLink, { ...oldLink!, content: content.trim() }];
            const nextTavern = oldLink
                ? (latest.tavernGreetings || []).filter(row => row !== oldLink)
                : latest.tavernGreetings || [];
            await DB.saveCharacter({ ...latest, linkGreetings: nextLinks, tavernGreetings: nextTavern });
            updateCharacter(characterId, { linkGreetings: nextLinks, tavernGreetings: nextTavern });
            return;
        }

        const greetings = latest.tavernGreetings || [];
        const next = content === null
            ? greetings.filter(greeting => greeting.id !== greetingId)
            : greetings.map(greeting => {
                if (greeting.id !== greetingId) return greeting;
                const previous = adaptTavernOpeningGreeting(greeting);
                const updated = adaptTavernOpeningGreeting({ ...previous, content: content.trim() });
                if (!updated.content.trim()) throw new Error('开场白正文不能只包含标题或简介');
                return updated;
            });
        await DB.saveCharacter({ ...latest, tavernGreetings: next });
        updateCharacter(characterId, { tavernGreetings: next });
    }, [updateCharacter, userProfile.name]);

    const createGreeting = useCallback(async (characterId: string, title: string, content: string): Promise<TavernOpeningGreeting> => {
        const body = content.trim();
        if (!body || body.length > 200000) throw new Error('开场白内容不能为空或超过 20 万字');
        const latest = await DB.getCharacter(characterId);
        if (!latest) throw new Error('参与角色已不存在，请重新选择');
        const greetings = Array.isArray(latest.tavernGreetings) ? latest.tavernGreetings : [];
        const greeting: TavernOpeningGreeting = adaptTavernOpeningGreeting({
            id: `story-custom-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`}`,
            title: title.trim().slice(0, 60) || body.split(/\r?\n/).find(line => line.trim())?.trim().slice(0, 30) || '自定义开场',
            content: body,
        });
        if (!greeting.content.trim()) throw new Error('开场白正文不能只包含标题或简介');
        // A legacy raw metadata header and a clean new opening are identical
        // when they resolve to the same scene. Keep the original stable ID.
        const existing = listCharacterStoryOpenings(latest, userProfile.name)
            .find(item => item.content.trim() === greeting.content.trim() ||
                (item.source !== 'link' && tavernOpeningBodyKey(item) === tavernOpeningBodyKey(greeting)));
        if (existing) return adaptTavernOpeningGreeting(existing);
        const next = [...greetings, greeting];
        await DB.saveCharacter({ ...latest, tavernGreetings: next });
        updateCharacter(characterId, { tavernGreetings: next });
        return greeting;
    }, [updateCharacter, userProfile.name]);

    const importGreetingDocuments = useCallback(async (characterId: string, files: File[]) => {
        // Read and validate the entire batch first. A corrupt DOCX or oversized
        // story must not leave half the user's new opening library imported.
        const documents = await readStoryOpeningDocuments(files);
        if (!documents.length) return { added: [] as TavernOpeningGreeting[], skipped: 0 };
        const { added, skipped } = await importStoryOpeningDocuments(characterId, documents);
        return { added, skipped };
    }, [importStoryOpeningDocuments]);

    const persistEntryInSession = useCallback(async (next: StoryTheaterEntry) => {
        const normalized = normalizeStoryTheater(next);
        if (isStoryGenerationRunning(normalized.id)) throw new Error('剧情正在后台生成，请完成后再修改快捷预设');
        await DB.saveStoryTheater(normalized);
        setActiveEntry(normalized);
        setEntries(current => [normalized, ...current.filter(item => item.id !== normalized.id)].sort((a, b) => b.updatedAt - a.updatedAt));
    }, []);

    const savePreset = useCallback(async (next: StoryTheaterPreset) => {
        if (next.builtIn) return;
        await DB.saveStoryTheaterPreset(next);
        setCustomPresets(current => [next, ...current.filter(item => item.id !== next.id)]);
        setEditingPreset(next);
        addToast('剧情预设已保存', 'success');
    }, [addToast]);

    const copyPreset = useCallback(async (copy: StoryTheaterPreset) => {
        await DB.saveStoryTheaterPreset(copy);
        setCustomPresets(current => [copy, ...current.filter(item => item.id !== copy.id)]);
        setEditingPreset(copy);
        addToast('已复制为可编辑的宝宝狗预设', 'success');
    }, [addToast]);

    const deletePreset = useCallback(async (preset: StoryTheaterPreset) => {
        // Read persistent references, not only the current UI state. Deleting a
        // shared preset used to silently swap every dependent story to default.
        const referenced = (await DB.getStoryTheaters()).filter(item => item.presetId === preset.id);
        if (referenced.length) {
            throw new Error(`这份预设仍被 ${referenced.length} 条剧情使用。请先在这些剧情的设置中换用其他预设，避免之后续写突然变成内置规则。`);
        }
        await DB.deleteStoryTheaterPreset(preset.id);
        setCustomPresets(current => current.filter(item => item.id !== preset.id));
        setEditingPreset(null);
        setView(activeEntry ? 'editor' : 'list');
        addToast('未被使用的预设已删除，其他剧情配置保持不变', 'success');
    }, [activeEntry, addToast]);

    const saveMask = useCallback(async (mask: StoryTheaterMask) => {
        const next = { ...mask, name: mask.name.trim(), updatedAt: Date.now() };
        await DB.saveStoryTheaterMask(next);
        setMasks(current => [next, ...current.filter(item => item.id !== next.id)]);
        addToast('原创身份已放进面具箱', 'success');
    }, [addToast]);

    const deleteMask = useCallback(async (mask: StoryTheaterMask) => {
        // The saved-story reference check and deletion must share a transaction.
        // Otherwise a deleted mask silently changes the identity of an old story.
        await deleteUnusedStoryMask(mask.id);
        setMasks(current => current.filter(item => item.id !== mask.id));
        if (activeEntry?.mask?.type === 'custom' && activeEntry.mask.id === mask.id) {
            // Only an unsaved draft can still reference this mask after the
            // transactional check; do not manufacture an unsaved replacement for
            // an already-started story.
            setActiveEntry(current => current?.mask?.type === 'custom' && current.mask.id === mask.id
                ? { ...current, mask: { type: 'user' }, updatedAt: Date.now() }
                : current);
        }
        addToast('原创身份已移出面具箱', 'info');
    }, [activeEntry, addToast]);

    const confirmDeleteEntry = useCallback(async () => {
        if (!deletingEntry || deletingStory) return;
        if (isStoryGenerationRunning(deletingEntry.id)) {
            addToast('这条剧情正在后台生成，请完成后再删除，避免丢失已付费的生成结果', 'info');
            return;
        }
        setDeletingStory(true);
        try {
            const result = await deleteStoryTheaterData(deletingEntry, remoteVectorConfig);
            setEntries(current => current.filter(item => item.id !== deletingEntry.id));
            if (activeEntry?.id === deletingEntry.id) setActiveEntry(null);
            setDeletingEntry(null);
            setView('list');
            addToast(
                result.remoteVectorDeleteFailures > 0
                    ? `剧情已删除；${result.remoteVectorDeleteFailures} 条远端向量暂未同步，请检查网络`
                    : `整个剧情「${deletingEntry.title}」已删除`,
                result.remoteVectorDeleteFailures > 0 ? 'info' : 'success',
            );
        } catch (error: any) {
            addToast(error?.message || '删除整个剧情失败', 'error');
        } finally {
            setDeletingStory(false);
        }
    }, [activeEntry?.id, addToast, deletingEntry, deletingStory, remoteVectorConfig]);

    const selectMask = useCallback((selection: StoryTheaterMaskSelection) => {
        if (maskLocked) return;
        setActiveEntry(current => {
            if (!current || current.writesToCharacterMemory) return current;
            const characterIds = selection.type === 'character'
                ? current.characterIds.filter(id => id !== selection.id)
                : current.characterIds;

            const characterContextLimits = { ...current.characterContextLimits };
            if (selection.type === 'character') {
                if (characterContextLimits[selection.id] === undefined) characterContextLimits[selection.id] = 100;
            }
            return {
                ...current,
                mask: selection,
                characterIds,
                openingGreeting: current.openingGreeting && characterIds.includes(current.openingGreeting.characterId)
                    ? current.openingGreeting : undefined,
                // Identity changes do not rewrite this story's manual lore selection.
                selectedWorldbookIds: current.selectedWorldbookIds,
                characterContextLimits,
                updatedAt: Date.now(),
            };
        });
    }, [characters, maskLocked]);

    const openEntryEditor = useCallback(async (entry: StoryTheaterEntry) => {
        try {
            const rows = await DB.getMessagesByCharId(storyTheaterThreadId(entry.id), true);
            setMaskLocked(entry.openingGreetingInitialized === true
                || rows.some(message => message.metadata?.source === 'story_theater'));
            setView('editor');
        } catch (error) {
            addToast(error instanceof Error ? `剧情编辑前读取失败：${error.message}` : '剧情读取失败，已保留当前页面', 'error');
        }
    }, [addToast]);

    if (view === 'regex') return <StoryRegexPanel domain='offline' rules={regexRules} presets={presets} onSave={saveRegexRules} onBack={() => setView('list')} />;

    if (view === 'preset' && editingPreset) return <StoryPresetMaker key={editingPreset.id}
        preset={editingPreset}
        usedByStoryCount={entries.filter(item => item.presetId === editingPreset.id).length}
        onBack={() => setView(activeEntry ? 'editor' : 'list')}
        onSave={savePreset}
        onOpenCopy={copyPreset}
        onDelete={editingPreset.builtIn ? undefined : deletePreset}
    />;

    if (view === 'masks' && activeEntry) return <StoryMaskBox
        user={userProfile}
        characters={characters}
        masks={masks}
        selected={activeEntry.mask || { type: 'user' }}
        onSelect={selectMask}
        onSave={saveMask}
        onDelete={deleteMask}
        onBack={() => setView('editor')}
        locked={maskLocked}
    />;

    if (view === 'editor' && activeEntry) return <StoryTheaterEditor key={`${activeEntry.id}:${activeEntry.updatedAt}`}
        initial={activeEntry}
        characters={characters}
        worldbooks={worldbooks}
        user={userProfile}
        masks={masks}
        maskLocked={maskLocked}
        presets={presets}
        apiPresets={apiPresets}
        mainApi={apiConfig}
        onCancel={() => setView(entries.some(item => item.id === activeEntry.id) ? 'session' : 'list')}
        onSave={saveEntry}
        onChangeGreeting={changeGreeting}
        onCreateGreeting={createGreeting}
        onImportGreetings={importGreetingDocuments}
        onImportPreset={importPreset}
        onEditPreset={(preset, draft) => { setActiveEntry(draft); setEditingPreset(preset); setView('preset'); }}
        onOpenMaskBox={draft => { if (maskLocked || draft.writesToCharacterMemory) return; setActiveEntry(draft); setView('masks'); }}
    />;

    if (view === 'vectors' && activeEntry) return <StoryVectorMemoryPanel entry={activeEntry} onBack={() => setView('session')} onUpdated={next => { setActiveEntry(next); setEntries(current => current.map(item => item.id === next.id ? next : item)); }} />;
    if (view === 'archives' && activeEntry) return <StoryArchivePanel entry={activeEntry} masks={masks} onBack={() => setView('session')} onUpdated={next => { setActiveEntry(next); setEntries(current => current.map(item => item.id === next.id ? next : item)); }} />;

    if (view === 'session' && activeEntry) {
        if (!regexReady) return <div className='h-full grid place-items-center bg-stone-100 text-slate-600' role='status'>正在读取剧情正则…</div>;
        const preset = presets.find(item => item.id === activeEntry.presetId) || BUILTIN_NIGHT_SCREENING_PRESET;
        const hasVectorArchive = !activeEntry.writesToCharacterMemory || activeEntry.archives.some(archive => archive.strategy === 'vector');
        return <StoryTheaterSession entry={activeEntry} preset={preset} regexRules={regexRules} masks={masks} onBack={() => { setActiveEntry(null); setView('list'); }} onEdit={() => void openEntryEditor(activeEntry)} onOpenArchives={() => setView('archives')} onOpenVectorMemory={hasVectorArchive ? () => setView('vectors') : undefined} onEntryChange={persistEntryInSession} onArchiveCommitted={next => { setActiveEntry(current => current?.id === next.id && viewRef.current !== 'editor' ? next : current); setEntries(current => [next, ...current.filter(item => item.id !== next.id)].sort((a, b) => b.updatedAt - a.updatedAt)); }} />;
    }

    return <div className='h-full w-full flex flex-col bg-stone-100 text-slate-800'>
        <header className='story-safe-header shrink-0 border-b border-slate-200'>
            <div className='h-16 px-4 flex items-center gap-3'>
                <button onClick={onClose} className='w-9 h-9 rounded-full grid place-items-center'><ArrowLeft size={20} /></button>
                <div><div className='text-[9px] uppercase tracking-[.24em] font-bold text-violet-500'>Meet</div><h1 className='font-semibold'>见面</h1></div>
                <StoryAppearanceButton className='ml-auto bg-white border border-slate-200' />
                <button aria-label='新建剧情' title='新建剧情' onClick={() => { setMaskLocked(false); setActiveEntry({ ...createStoryTheaterDraft(), presetId: presets[0]?.id }); setView('editor'); }} className='w-10 h-10 rounded-full bg-slate-900 text-white grid place-items-center'><Plus size={19} /></button>
            </div>
            <div className='mx-5 mb-4 grid grid-cols-2 p-1 rounded-xl bg-slate-200'>
                <button onClick={onSwitchCompanion} className='py-2 rounded-lg text-xs font-bold text-slate-500'>陪伴</button>
                <button className='py-2 rounded-lg bg-white shadow-sm text-xs font-bold text-violet-700'>剧情</button>
            </div>
        </header>

        <main className='story-page-scroll flex-1 overflow-y-auto px-5 py-6 pb-24'>
            <div className='max-w-2xl mx-auto'>
                <section className='story-cinema-rule pb-6 border-b border-slate-200'>
                    <div className='text-[9px] tracking-[.24em] uppercase font-bold text-violet-500'>Your theaters</div>
                    <div className='mt-2 flex items-end justify-between gap-5'><div><h2 className='text-3xl font-serif font-semibold'>很多条剧情，<br />各自拥有一条时间线。</h2></div><FilmSlate size={48} weight='duotone' className='shrink-0 text-violet-300' /></div>
                </section>

                <section className='py-6'>
                    {entries.length === 0 ? <button onClick={() => { setMaskLocked(false); setActiveEntry({ ...createStoryTheaterDraft(), presetId: presets[0]?.id }); setView('editor'); }} className='w-full py-14 rounded-3xl border border-dashed border-slate-300 text-center'><span className='block text-sm font-semibold'>新增第一条剧情</span></button> : <div className='divide-y divide-slate-200'>{entries.map(item => {
                        const cast = characters.filter(char => item.characterIds.includes(char.id));
                        const mask = resolveStoryTheaterMask(item.mask, userProfile, characters, masks);
                        const youLabel = mask.selection.type === 'user' ? '你' : `你（${mask.name}）`;
                        const vectorEnabled = item.archiveStrategy === 'vector' && !item.writesToCharacterMemory;
                        const hasVectorArchive = vectorEnabled || item.archives.some(archive => archive.strategy === 'vector');
                        return <div key={item.id} className='w-full py-5 flex items-center gap-2'>
                            <button onClick={() => { setActiveEntry(item); setView('session'); }} className='min-w-0 flex-1 flex items-center gap-4 text-left'>
                                <div className='flex -space-x-2'>{mask.avatar ? <TokenImg value={mask.avatar} alt='' className='w-10 h-10 rounded-full object-cover border-2 border-slate-800 relative z-10' /> : <span className='w-10 h-10 rounded-full bg-slate-800 text-white grid place-items-center border-2 border-slate-800 relative z-10 text-xs font-serif'>{mask.name.slice(0, 1)}</span>}{cast.slice(0, 2).map(char => char.avatar
                                    ? <TokenImg key={char.id} value={char.avatar} alt='' className='w-10 h-10 rounded-full object-cover border-2 border-stone-100' />
                                    : <span key={char.id} aria-hidden='true' className='w-10 h-10 rounded-full bg-slate-200 text-slate-600 border-2 border-stone-100 grid place-items-center text-xs font-semibold'>{char.name?.slice(0, 1) || '角'}</span>)}{cast.length === 0 && <span className='w-10 h-10 rounded-full bg-slate-200 grid place-items-center'><UsersThree size={18} /></span>}</div>
                                <div className='min-w-0 flex-1'><h3 className='font-serif font-semibold truncate'>{item.title}</h3><p className='mt-1 text-[10px] text-slate-400 truncate'>{youLabel} · 角色：{cast.map(char => char.name).join('、') || '暂无'} · {item.writesToCharacterMemory ? '进入角色记忆' : vectorEnabled ? '独立向量剧场' : '独立事件盒'}</p>{isStoryGenerationRunning(item.id) && <p role='status' className='mt-1 text-[10px] font-semibold text-violet-600'>正在后台生成 · 完成后自动保存</p>}</div>
                                <time className='text-[9px] text-slate-400'>{new Date(item.updatedAt).toLocaleDateString()}</time>
                            </button>
                            {item.archives.some(archive => archive.strategy === 'summary') && <button onClick={() => { setActiveEntry(item); setView('archives'); }} className='w-10 h-10 shrink-0 rounded-full bg-white border border-slate-200 grid place-items-center text-violet-600' title='查看本剧情事件盒' aria-label='查看本剧情事件盒'><Archive size={17} /></button>}
                            {hasVectorArchive && <button onClick={() => { setActiveEntry(item); setView('vectors'); }} className='w-10 h-10 shrink-0 rounded-full bg-white border border-slate-200 grid place-items-center text-violet-600' title='查看本剧情向量记忆' aria-label='查看本剧情向量记忆'><Database size={17} /></button>}
                            <button onClick={() => setDeletingEntry(item)} className='w-10 h-10 shrink-0 rounded-full grid place-items-center text-rose-400 active:bg-rose-50' title='删除整个剧情' aria-label={`删除剧情 ${item.title}`}><Trash size={17} /></button>
                        </div>;
                    })}</div>}
                </section>

                <section className='pt-6 border-t border-slate-200'>
                    <div className='flex items-center justify-between'><div><div className='text-[9px] tracking-[.22em] uppercase font-bold text-violet-500'>Native presets</div><h2 className='mt-1 text-lg font-semibold'>宝宝狗预设制作器</h2></div><div className='flex gap-2'><button type='button' title='批量导入剧情预设' aria-label='批量导入剧情预设' disabled={presetBatchBusy} onClick={() => importInput.current?.click()} className='w-10 h-10 rounded-full bg-white border border-slate-200 grid place-items-center disabled:opacity-40'>{presetBatchBusy ? <SpinnerGap size={17} className='animate-spin' /> : <UploadSimple size={17} />}</button><button onClick={() => { setEditingPreset(createBlankStoryPreset()); setView('preset'); }} className='w-10 h-10 rounded-full bg-white border border-slate-200 grid place-items-center'><Plus size={17} /></button></div></div>
                    
                    <input ref={importInput} type='file' multiple accept='.json,.png,application/json,image/png' className='hidden' onChange={async event => {
                        const files = Array.from(event.currentTarget.files || []);
                        event.currentTarget.value = '';
                        if (!files.length || presetBatchLock.current) return;
                        presetBatchLock.current = true;
                        setPresetBatchBusy(true);
                        setPresetBatchFeedback(`正在导入 ${files.length} 份预设……`);
                        let succeeded = 0;
                        let failed = 0;
                        try {
                            for (const file of files) {
                                if (await importPreset(file)) succeeded++;
                                else failed++;
                            }
                            setPresetBatchFeedback(`已导入或找到 ${succeeded} 份预设${failed ? `，${failed} 份失败` : ''}。原有剧情没有被自动改动。`);
                        } catch (error) {
                            setPresetBatchFeedback(`导入中断：${error instanceof Error ? error.message : '文件读取失败'}。`);
                        } finally {
                            presetBatchLock.current = false;
                            setPresetBatchBusy(false);
                        }
                    }} />
                    {presetBatchFeedback && <p role='status' className='mt-2 break-words text-[10px] leading-5 text-slate-500'>{presetBatchFeedback}</p>}
                    <div className='mt-4 divide-y divide-slate-200'>{presets.map(preset => <div key={preset.id} className='flex items-center gap-2'><button onClick={() => { setEditingPreset(preset); setView('preset'); }} className='min-w-0 flex-1 py-3 flex items-center gap-3 text-left'><span className={`w-2 h-2 rounded-full ${preset.builtIn ? 'bg-amber-400' : 'bg-violet-500'}`} /><span className='min-w-0 flex-1 text-xs font-semibold truncate'>{preset.name}</span><span className='text-[9px] text-slate-400'>{preset.builtIn ? '内置只读' : `${preset.document.prompts.length} 条`}</span></button><button onClick={() => { void downloadStoryPreset(preset); }} className='w-9 h-9 shrink-0 rounded-full grid place-items-center text-slate-400' title={`导出 ${preset.name}`}><DownloadSimple size={15} /></button></div>)}</div>
                </section>
                <section className='border-t border-slate-200 pt-5'>
                    <button type='button' disabled={!regexReady} onClick={() => setView('regex')}
                        className='w-full flex items-center justify-between gap-3 py-3 text-left disabled:opacity-50'>
                        <span className='min-w-0'><strong className='block text-sm'>剧情正则</strong></span>
                        <span className='shrink-0 text-[11px] font-semibold text-violet-700'>{regexRules.filter(rule => rule.enabled && alchemyDomain(rule) === 'offline').length} 条启用 <span aria-hidden='true'>›</span></span>
                    </button>
                </section>
            </div>
        </main>
        {deletingEntry && <div className='fixed inset-0 z-[95] flex items-end justify-center overflow-y-auto overscroll-contain bg-slate-950/35' onClick={() => !deletingStory && setDeletingEntry(null)} role='presentation'>
            <div className='story-safe-sheet w-full sm:max-w-sm rounded-t-[28px] bg-stone-100 px-5 pt-5 shadow-2xl' onClick={event => event.stopPropagation()} role='dialog' aria-modal='true' aria-labelledby='delete-story-title'>
                <div className='flex items-start gap-4'><div className='min-w-0 flex-1'><div className='text-[9px] uppercase tracking-[.2em] font-bold text-rose-500'>删除确认</div><h2 id='delete-story-title' className='mt-1 text-lg font-semibold'>删除整个剧情？</h2></div><button disabled={deletingStory} onClick={() => setDeletingEntry(null)} className='w-9 h-9 shrink-0 rounded-full bg-white border border-slate-200 grid place-items-center text-slate-400 disabled:opacity-30' aria-label='关闭删除确认'><X size={16} /></button></div>
                <p className='mt-4 text-[11px] leading-6 text-slate-600'>「{deletingEntry.title}」的楼层、事件盒、关系备注和本剧情专属记忆会一起删除。</p>
                {deletingEntry.writesToCharacterMemory && <p className='mt-2 text-[10px] leading-5 text-amber-700'>同步到角色聊天记录里的剧情陪伴记录也会删除；已经被记忆宫殿总结成长期记忆的内容不会受影响。</p>}
                {deletingEntry.archives.some(archive => Object.keys(archive.memoryConversions || {}).length > 0) && <p className='mt-2 text-[10px] leading-5 text-amber-700'>已通过事件盒手动转入记忆宫殿或神经链接的记忆会保留，可到对应角色的记忆页面管理。</p>}
                <p className='mt-2 text-[10px] leading-5 text-slate-400'>其它剧情、普通聊天与角色原有向量记忆不会受影响。删除后无法恢复。</p>
                <div className='mt-5 grid grid-cols-2 gap-3'><button disabled={deletingStory} onClick={() => setDeletingEntry(null)} className='h-12 rounded-2xl border border-slate-200 bg-white text-xs font-bold text-slate-600 disabled:opacity-30'>取消</button><button disabled={deletingStory} onClick={() => void confirmDeleteEntry()} className='h-12 rounded-2xl bg-rose-600 text-white text-xs font-bold disabled:opacity-40'>{deletingStory ? <SpinnerGap size={17} className='mx-auto animate-spin' /> : '删除整个剧情'}</button></div>
            </div>
        </div>}
    </div>;
};

const StoryTheater: React.FC<Props> = props => <StoryTheaterThemeProvider><StoryTheaterContent {...props} /></StoryTheaterThemeProvider>;

export default StoryTheater;
