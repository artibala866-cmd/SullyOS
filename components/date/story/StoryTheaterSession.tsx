import {meetingAppearance} from '../../../utils/meetingAppearance';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { deleteStoryTheaterFloor, loadStoryActorContext, replaceStoryTheaterReply, STORY_REROLL_INSTRUCTION, updateStoryTheaterFloor } from '../../../utils/storyTheaterReply';
import { squashAdjacentSystemMessages } from '../../../utils/storySillyTavernImport';
import { storyRegexApplies, storyRegexInstruction, type StoryRegexInput, type StoryRegexResult, type StoryRegexRule } from '../../../utils/storyRegex';
import { alchemyRulesFor } from '../../../utils/alchemyRegex';
import { runStoryRegex } from '../../../utils/storyRegexRunner';
import { hideStoryStatusForDisplay, parseStoryRegexDisplay, splitStoryRegexOutput } from '../../../utils/storyRegexDisplay';
import { sanitizeStoryTheaterHtml } from '../../../utils/storyTheaterHtml';
import { storyOpeningReadingText } from '../../../utils/tavernOpeningGreeting';
import { archiveStoryVectorRangeInGeneration, commitStoryArchiveBatch, generateStoryArchiveSummary, storyArchiveFloors } from '../../../utils/storyTheaterArchive';
import { normalizeStoryOutputTokens } from '../../../utils/storyOutputLimits';
import { resolveStoryMemoryApi } from '../../../utils/storyMemoryApi';
import { Archive, ArrowBendDownRight, ArrowClockwise, ArrowDown, ArrowLeft, Broadcast, CaretDown, ChatCircleDots, Clock, Database, DownloadSimple, Eye, EyeSlash, FilmSlate, GearSix, HeartStraight, Key, MapPin, PaperPlaneTilt, PencilSimple, SlidersHorizontal, SpinnerGap, Trash, X } from '@phosphor-icons/react';
import { useOS } from '../../../context/OSContext';
import TokenImg from '../../os/TokenImg';
import type { CharacterProfile, Message, StoryTheaterEntry, StoryTheaterMask, StoryTheaterPreset } from '../../../types';
import { DB } from '../../../utils/db';
import { ContextBuilder } from '../../../utils/context';
import {
    assertStoryApiConfigured,
    appendStoryAffinityInputs,
    appendStoryUserTurn,
    buildBareTheaterActorContext,
    buildStoryAffinityAwarenessReminder,
    buildStoryBackstageAftermathReminder,
    buildStoryActorMemoryEnvelope,
    buildStoryArchiveMemoryEnvelope,
    buildStoryMultiAffinityGuide,
    buildStoryRequestHistory,
    storyArchiveAtFloor,
    storyAffinityInputsFromMessage,
    normalizeAffinityInput,
    getStoryReplyInput,
    buildStoryIdentityGuard,
    buildStoryMiniTheaterReminder,
    buildTheaterPersona,
    compileStoryPreset,
    prepareStoryGenerationSettings,
    reconcileStoryAffinityScores,
    resolveStoryTheaterWorldbooks,
    estimateStoryTokens,
    formatActorRecentMessages,
    formatStoryTheaterExport,
    getActiveStoryMiniTheaterPrompt,
    getPendingStoryRetryInput,
    isStoryUserLastCompatibilityError,
    makeStoryTheaterId,
    makeStoryTheaterFileName,
    createStoryTheaterMirrorMessage,
    looksLikeLegacyTavernStoryOutput,
    REAL_COMPANION_MEMORY_GUARD,
    RELATIONSHIP_TEXTURE_GUIDE,
    resolveStoryTheaterMask,
    hasStoryTheaterParticipant,
    resolveStoryPresetDocument,
    selectStoryArchiveBatch,
    selectStoryArchiveContext,
    storyTheaterMemoryRecipientIds,
    storyTheaterThreadId,
    type StoryAffinityInput,
    type StoryApiMessage,
    type StoryGenerationSettings,
} from '../../../utils/storyTheater';
import {
    getMemoryPalaceHighWaterMark,
    retrieveMemories,
} from '../../../utils/memoryPalace/pipeline';
import { processNewMessagesWithAutoArchive } from '../../../utils/memoryPalace/autoArchive';
import { incrementDigestRound, runCognitiveDigestion } from '../../../utils/memoryPalace';
import StoryQuickPresetPanel from './StoryQuickPresetPanel';
import { StoryAppearanceButton } from './StoryTheaterTheme';
import { loadStoryVectorRecall, selectStoryVectorRecall } from '../../../utils/storyTheaterVectorMemory';
import { getStoryGenerationSnapshot, isStoryGenerationRunning, startStoryBackgroundGeneration, subscribeStoryGeneration, retryUnsavedStoryReply, StoryReplySaveError } from '../../../utils/storyTheaterBackground';
import { readStoryCompletion, type StoryCompletion } from '../../../utils/storyTheaterCompletionIntegrity';
import { shareOrDownloadFile } from '../../../utils/shareExport';
import {
    buildStoryContinueInstruction,
    MEETING_CONTINUE_DISPLAY_TEXT,
} from '../../../utils/meetingContinue';

interface Props {
    entry: StoryTheaterEntry;
    preset: StoryTheaterPreset;
    regexRules?: StoryRegexRule[];
    masks: StoryTheaterMask[];
    onBack: () => void;
    onEdit: () => void;
    onOpenVectorMemory?: () => void;
    onOpenArchives?: () => void;
    onEntryChange: (entry: StoryTheaterEntry) => Promise<void> | void;
    onArchiveCommitted: (entry: StoryTheaterEntry) => void;
}

interface AffinityDraft { delta: number; reason: string; awareness: 'noticed' | 'unnoticed'; }
const EMPTY_AFFINITY_DRAFT: AffinityDraft = { delta: 0, reason: '', awareness: 'unnoticed' };

const storyArchiveGroupKey = (message: Message, entry: StoryTheaterEntry) =>
    storyArchiveAtFloor(entry.archives, message.id)?.id || 'character-memory';

const mirrorArchived = (message: Message, entry: StoryTheaterEntry): boolean => {
    if (storyArchiveAtFloor(entry.archives, message.id)) return true;
    if (!entry.writesToCharacterMemory) return false;
    const mirrorIds = message.metadata?.theaterMirrorIds as Record<string, number> | undefined;
    const recipientIds = Object.keys(mirrorIds || {});
    if (!mirrorIds || recipientIds.length === 0) return false;
    return recipientIds.every(charId => {
        const mirrorId = Number(mirrorIds[charId] || 0);
        return mirrorId > 0 && mirrorId <= getMemoryPalaceHighWaterMark(charId);
    });
};

interface DisplayLine { label?: string; value: string; }

const splitDisplayLines = (text: string): DisplayLine[] => text.split(/\n+/).map(row => row.trim()).filter(Boolean).map(row => {
    const match = row.match(/^([^：]{1,14})：(.*)$/);
    return match ? { label: match[1].trim(), value: match[2].trim() } : { value: row };
});

const LabeledRows: React.FC<{ lines: DisplayLine[] }> = ({ lines }) => <div className='divide-y divide-current/10'>
    {lines.map((line, index) => <div key={index} className='py-2.5 grid grid-cols-[76px_1fr] gap-3 items-start'>
        <span className='text-[9px] tracking-wide font-bold text-slate-400'>{line.label || '记录'}</span>
        <span className='text-[12px] leading-6 whitespace-pre-wrap text-slate-700'>{line.value || '—'}</span>
    </div>)}
</div>;

const AFFINITY_DIMENSIONS = ['信任', '安全感', '占有拉力', '情绪压强', '修复意愿'] as const;

const affinityNumber = (lines: DisplayLine[], labels: string[]): number | undefined => {
    const raw = lines.find(line => line.label && labels.includes(line.label))?.value;
    const value = Number(String(raw || '').match(/-?\d+/)?.[0]);
    return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : undefined;
};

const StoryAffinityGroup: React.FC<{ group: DisplayGroup }> = ({ group }) => {
    const cToU = affinityNumber(group.lines, ['角色对你的温度', '关系温度']);
    const uToC = affinityNumber(group.lines, ['你对角色的温度', '你的关系温度']);
    const dimensions = AFFINITY_DIMENSIONS.map(label => ({ label, value: affinityNumber(group.lines, [label]) })).filter(item => item.value !== undefined);
    const compactLabels = new Set<string>(['角色对你的温度', '关系温度', '你对角色的温度', '你的关系温度', ...AFFINITY_DIMENSIONS]);
    const notes = group.lines.filter(line => !compactLabels.has(line.label || ''));
    return <section className='py-4 first:pt-0'>
        <div className='text-[11px] font-bold text-rose-700'>{group.title || '主要角色'}</div>
        {(cToU !== undefined || uToC !== undefined) && <div className='mt-2 grid grid-cols-2 gap-2'>
            <div className='rounded-xl bg-rose-50 px-3 py-2'><div className='text-[8px] font-bold text-rose-400'>{group.title || '角色'} → 你</div><div className='mt-0.5 text-lg font-serif font-semibold text-rose-700'>{cToU ?? '—'}<span className='ml-1 text-[8px] font-sans text-rose-300'>/ 100</span></div></div>
            <div className='rounded-xl bg-violet-50 px-3 py-2'><div className='text-[8px] font-bold text-violet-400'>你 → {group.title || '角色'}</div><div className='mt-0.5 text-lg font-serif font-semibold text-violet-700'>{uToC ?? '—'}<span className='ml-1 text-[8px] font-sans text-violet-300'>/ 100</span></div></div>
        </div>}
        {dimensions.length > 0 && <div className='mt-3 grid gap-2'>{dimensions.map(item => <div key={item.label} className='grid grid-cols-[56px_1fr_24px] items-center gap-2'><span className='text-[8px] font-bold text-slate-400'>{item.label}</span><span className='h-1.5 rounded-full bg-slate-200 overflow-hidden'><i className='block h-full rounded-full bg-gradient-to-r from-violet-300 to-rose-400' style={{ width: `${item.value}%` }} /></span><span className='text-[8px] text-right tabular-nums text-slate-400'>{item.value}</span></div>)}</div>}
        {notes.length > 0 && <div className='mt-3'><LabeledRows lines={notes} /></div>}
    </section>;
};

interface DisplayGroup { title: string; lines: DisplayLine[]; }

const groupDisplayLines = (lines: DisplayLine[], anchorLabel: string, ignoredLabels: string[] = [], ignoredValues: string[] = []): DisplayGroup[] => {
    const ignoredLabelSet = new Set(ignoredLabels);
    const ignoredValueSet = new Set(ignoredValues);
    const groups: DisplayGroup[] = [];
    let current: DisplayGroup | null = null;
    for (const line of lines) {
        if (line.label === anchorLabel) {
            if (current && (current.title || current.lines.length > 0)) groups.push(current);
            current = { title: line.value, lines: [] };
            continue;
        }
        if (ignoredLabelSet.has(line.label || '') || ignoredValueSet.has(line.value)) continue;
        if (!current) current = { title: '', lines: [] };
        current.lines.push(line);
    }
    if (current && (current.title || current.lines.length > 0)) groups.push(current);
    return groups;
};

const mergeDisplayGroupsByTitle = (groups: DisplayGroup[]): DisplayGroup[] => groups.reduce<DisplayGroup[]>((result, group) => {
    const existing = group.title && result.find(item => item.title === group.title);
    if (existing) existing.lines.push(...group.lines);
    else result.push({ title: group.title, lines: [...group.lines] });
    return result;
}, []);

const StorySceneRelationships: React.FC<{ inputs: StoryAffinityInput[] }> = ({ inputs }) => <div className='mt-4 pt-4 border-t border-violet-100'>
    <div className='flex items-center gap-2 text-[9px] font-bold text-slate-400'><HeartStraight size={13} weight='fill' className='text-rose-400' />本轮 U→C 关系变化</div>
    <div className='mt-2 divide-y divide-rose-100'>{inputs.map((input, index) => {
        const characterName = input.characterName || '当前角色';
        const movement = input.delta > 0 ? '更靠近了一点' : input.delta < 0 ? '退远了一点' : '有了新的变化';
        const noticed = input.awareness === 'noticed';
        return <div key={input.characterId || `${characterName}-${index}`} className='py-2.5 flex items-start gap-3'><div className='min-w-0 flex-1'><div className='text-[10px] font-bold text-slate-600'>你 → {characterName}</div><p className='mt-1 text-[11px] leading-5 text-slate-600'>你{movement}{input.reason ? `：${input.reason}` : '。'}</p></div><div className={`shrink-0 mt-0.5 inline-flex items-center gap-1 text-[8px] font-bold ${noticed ? 'text-violet-600' : 'text-slate-400'}`}>{noticed ? <Eye size={11} weight='fill' /> : <EyeSlash size={11} />}{characterName}【{noticed ? '已察觉！' : '未察觉'}】</div></div>;
    })}</div>
</div>;

// A single parent listener handles all sandboxed story cards. Previously
// every floor registered its own global listener, so each resize/gesture
// message was inspected by hundreds of unrelated frames in long sessions.
const storyFrameMessageHandlers = new Map<MessageEventSource, (event: MessageEvent) => void>();
const dispatchStoryFrameMessage = (event: MessageEvent) => {
    if (event.source) storyFrameMessageHandlers.get(event.source)?.(event);
};
const subscribeStoryFrameMessages = (frame: HTMLIFrameElement, listener: (event: MessageEvent) => void): (() => void) => {
    const source = frame.contentWindow;
    if (!source) return () => {};
    if (storyFrameMessageHandlers.size === 0) window.addEventListener('message', dispatchStoryFrameMessage);
    storyFrameMessageHandlers.set(source, listener);
    return () => {
        if (storyFrameMessageHandlers.get(source) === listener) storyFrameMessageHandlers.delete(source);
        if (storyFrameMessageHandlers.size === 0) window.removeEventListener('message', dispatchStoryFrameMessage);
    };
};

// Saved measurements prevent rich archived cards from restarting at a
// short estimate every time a reader leaves and re-enters the story.
const storyFrameHeightCache = new Map<string, number>();
const storyFrameHeightKey = (source: string): string => {
    let hash = 2166136261;
    for (let i = 0; i < source.length; i++) hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
    return `${Math.round(window.innerWidth)}:${source.length}:${hash >>> 0}`;
};
const storeStoryFrameHeight = (key: string, height: number): void => {
    storyFrameHeightCache.delete(key);
    storyFrameHeightCache.set(key, height);
    if (storyFrameHeightCache.size > 120) {
        const oldest = storyFrameHeightCache.keys().next().value;
        if (oldest) storyFrameHeightCache.delete(oldest);
    }
};

export const SafeStoryHtml: React.FC<{ source: string; fallback: string; title: string; template?: boolean }> = React.memo(({ source, fallback, title, template = false }) => {
    const safe = useMemo(() => sanitizeStoryTheaterHtml(source, template), [source, template]);
    const frameRef = useRef<HTMLIFrameElement>(null);
    const heightKey = useMemo(() => storyFrameHeightKey(safe.srcDoc), [safe.srcDoc]);
    const [frameHeight, setFrameHeight] = useState(() => storyFrameHeightCache.get(heightKey) ?? safe.estimatedHeight);
    useEffect(() => {
        const cached = storyFrameHeightCache.get(heightKey);
        // On a new template with no measurement, preserve the old height until
        // its iframe reports the real layout rather than flashing an estimate.
        if (cached !== undefined) setFrameHeight(cached);
    }, [heightKey]);
    // Keep the last measured height while a regex/template refresh loads its new srcDoc.
    // Resetting to the initial estimate collapses settled floors for a frame.
    useEffect(() => {
        const receiveFrameMessage = (event: MessageEvent) => {
            // Opaque-origin sandbox: only this exact iframe may change its
            // measured size or forward a swipe to its reading scrollport.
            const frame = frameRef.current;
            if (!frame || event.source !== frame.contentWindow) return;
            if (event.data?.type === 'sully-story-template-height') {
                const height = event.data.height;
                if (typeof height !== 'number' || !Number.isFinite(height)) return;
                // Render the entire card in the outer timeline. A 520/900px
                // capped iframe creates a second vertical scroller that traps
                // Android touch gestures, especially in long saved stories.
                const nextHeight = Math.max(76, Math.min(80000, Math.ceil(height)));
                storeStoryFrameHeight(heightKey, nextHeight);
                setFrameHeight(previous => previous === nextHeight ? previous : nextHeight);
            } else if (event.data?.type === 'sully-story-template-scroll') {
                const delta = event.data.deltaY;
                if (typeof delta !== 'number' || !Number.isFinite(delta)) return;
                let scrollport = frame.closest<HTMLElement>('.story-page-scroll');
                if (!scrollport) {
                    let ancestor = frame.parentElement;
                    while (ancestor) {
                        const overflow = getComputedStyle(ancestor).overflowY;
                        if ((overflow === 'auto' || overflow === 'scroll') && ancestor.scrollHeight > ancestor.clientHeight) {
                            scrollport = ancestor;
                            break;
                        }
                        ancestor = ancestor.parentElement;
                    }
                }
                if (scrollport) {
                    // Forwarded iframe swipes never reach React's outer touch handlers.
                    // Mark them as real reading gestures before moving the scrollport.
                    scrollport.dispatchEvent(new Event('story-reader-gesture'));
                    scrollport.scrollTop += Math.max(-240, Math.min(240, delta));
                }
            }
        };
        const frame = frameRef.current;
        return frame ? subscribeStoryFrameMessages(frame, receiveFrameMessage) : undefined;
    }, [heightKey]);
    if (!safe.hasVisibleContent) {
        return <div className='whitespace-pre-wrap break-words text-xs leading-6 text-slate-500'>
            {fallback || safe.text || '此段仅包含无法安全显示的脚本或样式，未执行任何代码'}
        </div>;
    }
    return <iframe
        ref={frameRef}
        title={title}
        sandbox='allow-scripts'
        referrerPolicy='no-referrer'
        loading='lazy'
        srcDoc={safe.srcDoc}
        className='block w-full rounded-lg border border-violet-100 bg-white'
        style={{ height: frameHeight, minHeight: 76, maxHeight: 'none', maxWidth: '100%', overflow: 'hidden' }}
    />;
});

interface StoryOutputProps {
    content: string; onChoose?: (text: string) => void; affinityInputs: StoryAffinityInput[];
    fromTavern?: boolean; regexResult?: StoryRegexResult;
}

// The live OS provider ticks every second to update the clock. Story floor
// bodies must not subscribe to that global context: React.memo does not
// block context updates, and hundreds of rich saved floors would re-render.
const StoryOutputBody: React.FC<StoryOutputProps & { reading: boolean }> = React.memo(({ content, onChoose, affinityInputs, fromTavern = false, regexResult, reading }) => {
    const blocks = useMemo(() => parseStoryRegexDisplay(regexResult || { text: content, cards: [], matches: 0 }, fromTavern),
        [content, fromTavern, regexResult]);
    const hasProse = blocks.some(block => block.kind === 'story');
    const mainHtml = reading ? blocks.filter(block => block.kind === 'html'
        && (block.regexTemplate || (!hasProse && !block.title?.includes('剧场')))) : [];
    const relationshipSceneIndex = blocks.findIndex(block => block.kind === 'scene');
    const hasScene = relationshipSceneIndex >= 0;
    const relationship = affinityInputs.length > 0 ? <StorySceneRelationships inputs={affinityInputs} /> : null;
    const backstageIndex = blocks.findIndex(block => block.kind === 'backstage');
    const debtIndex = blocks.findIndex(block => block.kind === 'debts');
    const aftermathIndex = backstageIndex < 0 ? debtIndex : debtIndex < 0 ? backstageIndex : Math.min(backstageIndex, debtIndex);
    const backstageLines = backstageIndex >= 0 ? splitDisplayLines(blocks[backstageIndex].text) : [];
    const debtLines = debtIndex >= 0 ? splitDisplayLines(blocks[debtIndex].text) : [];
    const backstageGroups = mergeDisplayGroupsByTitle(groupDisplayLines(backstageLines, '主体', [], ['幕后暗格']));
    const debtGroups = groupDisplayLines(debtLines, '起因', ['镜头债'], ['镜头债', '镜头债 · 后果尚未到账']);
    const hasTrueMonologue = backstageLines.some(line => line.label === '心声' || line.label === '真正的独白');
    const rendered = <div className='space-y-6'>
        {!hasScene && relationship}
        {blocks.map((block, index) => {
            // The reading skin already renders regex cards above. Don't also
            // mount duplicate sandbox frames inside the collapsed extras.
            if (mainHtml.includes(block) || (reading && block.regexTemplate)) return null;
            const lines = splitDisplayLines(block.text);
            if (block.kind === 'thinking' || block.kind === 'tavern-extra') return <details key={index} className='group border-y border-slate-200'>
                <summary className='list-none cursor-pointer py-3.5 flex items-center gap-2 text-[11px] font-semibold text-slate-600'>
                    <CaretDown size={13} className='shrink-0 text-violet-500 transition-transform group-open:rotate-180' />
                    {block.title || (block.kind === 'thinking' ? '思考过程' : '酒馆附录')}
                </summary>
                <div className='pb-4 pl-5 text-[11px] leading-6 text-slate-600'>
                    {block.htmlSource
                        ? <SafeStoryHtml source={block.htmlSource} fallback={block.text} title={block.title || '酒馆附录'} />
                        : <div className='whitespace-pre-wrap break-words'>{block.text}</div>}
                </div>
            </details>;
            if (block.kind === 'html') {
                const layout = <SafeStoryHtml template={block.regexTemplate} source={block.htmlSource || block.text}
                    fallback={block.text} title={block.title || '安全排版'} />;
                return !block.regexTemplate && block.title?.includes('剧场')
                    ? <details key={index} className='group border-y border-violet-200'>
                        <summary className='list-none cursor-pointer py-4 flex items-center gap-3'>
                            <span className='w-8 h-8 rounded-full bg-violet-100 text-violet-600 grid place-items-center'>
                                <ChatCircleDots size={16} weight='fill' />
                            </span>
                            <strong className='min-w-0 flex-1 text-sm text-slate-700'>{block.title}</strong>
                            <CaretDown size={13} className='text-violet-500 transition-transform group-open:rotate-180' />
                        </summary>
                        <div className='pb-5 pl-1'>{layout}</div>
                    </details>
                    : <section key={index} className='py-2'>{layout}</section>;
            }
            if (block.kind === 'story' && reading) return null;
            if (block.kind === 'story') return <p key={index} className='font-serif text-[15px] leading-8 text-slate-800 whitespace-pre-wrap'>{block.text}</p>;
            if (block.kind === 'scene') return <section key={index} className='py-4 border-y border-slate-300'>
                <div className='flex items-center gap-2 text-[9px] tracking-[.22em] uppercase font-bold text-violet-600'><FilmSlate size={14} weight='fill' />{block.title}</div>
                <div className='mt-3 grid grid-cols-2 gap-x-5 gap-y-3'>{lines.map((line, lineIndex) => <div key={lineIndex} className={line.label === '场面' ? 'col-span-2' : ''}><div className='flex items-center gap-1 text-[9px] font-bold text-slate-400'>{line.label === '时间' ? <Clock size={11} /> : line.label === '地点' ? <MapPin size={11} /> : null}{line.label || '场景'}</div><div className='mt-1 text-[12px] leading-5 text-slate-700'>{line.value}</div></div>)}</div>
                {index === relationshipSceneIndex && relationship}
            </section>;
            if (block.kind === 'backstage' || block.kind === 'debts') {
                if (index !== aftermathIndex) return null;
                const countText = [backstageGroups.length > 0 ? `${backstageGroups.length} 位人物` : '', debtGroups.length > 0 ? `${debtGroups.length} 笔余波` : ''].filter(Boolean).join(' · ');
                return <details key={index} className='group border-y border-violet-200'>
                    <summary className='list-none cursor-pointer py-3.5 flex items-center gap-3'><span className='w-8 h-8 rounded-full bg-violet-100 grid place-items-center text-violet-600'><Key size={15} weight='fill' /></span><span className='min-w-0 flex-1'><strong className='block text-xs text-slate-700'>幕后与余波</strong><span className={`block mt-0.5 text-[9px] ${hasTrueMonologue ? 'text-violet-600 font-bold' : 'text-slate-400'}`}>{countText || '本轮没有额外记录'}{hasTrueMonologue ? ' · 真话掉落' : ''}</span></span><CaretDown size={13} className='text-violet-500 transition-transform group-open:rotate-180' /></summary>
                    <div className='pb-4 pl-11'>
                        {backstageGroups.length > 0 && <section><div className='pb-2 text-[9px] tracking-[.16em] font-bold text-violet-500'>幕后暗格</div><div className='divide-y divide-violet-100'>{backstageGroups.map((group, groupIndex) => <div key={`${group.title}-${groupIndex}`} className='py-3 first:pt-1'><div className='text-[10px] font-bold text-slate-700'>{group.title || `人物 ${groupIndex + 1}`}</div><LabeledRows lines={group.lines} /></div>)}</div></section>}
                        {debtGroups.length > 0 && <section className={backstageGroups.length > 0 ? 'mt-3 pt-4 border-t border-amber-200' : ''}><div className='pb-2 text-[9px] tracking-[.16em] font-bold text-amber-600'>尚未到账</div><div className='divide-y divide-amber-100'>{debtGroups.map((group, groupIndex) => <div key={`${group.title}-${groupIndex}`} className='py-3 first:pt-1'><div className='flex items-start gap-2'><span className='mt-0.5 w-4 h-4 shrink-0 rounded-full bg-amber-100 text-amber-700 grid place-items-center text-[8px] font-bold'>{groupIndex + 1}</span><p className='text-[11px] leading-5 font-semibold text-slate-700'>{group.title || '未命名余波'}</p></div><div className='ml-6'><LabeledRows lines={group.lines} /></div></div>)}</div></section>}
                    </div>
                </details>;
            }
            if (block.kind === 'worldline') return <section key={index} className='py-4 border-y border-violet-200'>
                <div className='flex items-center gap-2 text-[10px] font-bold text-violet-700'><Broadcast size={15} weight='fill' />世界线仍在镜头外前进</div>
                <div className='mt-4 ml-1 border-l border-violet-300'>{lines.map((line, lineIndex) => <div key={lineIndex} className='relative pl-5 pb-4 last:pb-0'><span className='absolute -left-1 top-1.5 w-2 h-2 rounded-full bg-violet-500 ring-4 ring-stone-100' /><div className='text-[9px] font-bold text-violet-500'>{line.label || `节点 ${lineIndex + 1}`}</div><div className='mt-1 text-[12px] leading-6 text-slate-700'>{line.value}</div></div>)}</div>
            </section>;
            if (block.kind === 'theater') {
                const theater = block.theater;
                return <details key={index} className='group border-y border-violet-200'>
                    <summary className='list-none cursor-pointer py-4 flex items-center gap-3'><span className='w-8 h-8 rounded-full bg-violet-100 text-violet-600 grid place-items-center'><ChatCircleDots size={16} weight='fill' /></span><span className='min-w-0 flex-1'><span className='block text-[9px] tracking-[.16em] font-bold text-violet-500'>幕间频道</span><strong className='block mt-0.5 truncate text-sm font-semibold text-slate-700'>{theater?.title || block.title || '小剧场'}</strong></span><span className='shrink-0 text-[9px] text-slate-400'>{theater?.messages.length || 0} 条</span><CaretDown size={13} className='text-violet-500 transition-transform group-open:rotate-180' /></summary>
                    <div className='pb-5'>{theater?.system && <div className='ml-11 pl-3 border-l-2 border-violet-200 text-[10px] leading-5 text-slate-500'>{theater.system}</div>}
                    <div className='mt-4 space-y-3'>{(theater?.messages || []).map((message, messageIndex) => <div key={messageIndex} className={`flex ${message.side === 'right' ? 'justify-end' : 'justify-start'}`}><div className='max-w-[86%]'><div className={`mb-1 text-[8px] font-bold text-slate-400 ${message.side === 'right' ? 'text-right' : ''}`}>{message.name}</div><div className={`px-3 py-2 rounded-2xl text-[11px] leading-5 ${message.side === 'right' ? 'bg-violet-100 text-violet-900 rounded-br-sm' : 'bg-white border border-slate-200 text-slate-700 rounded-bl-sm'}`}>{message.text}</div></div></div>)}</div></div>
                </details>;
            }
            if (block.kind === 'choices') {
                const replies = lines.filter(line => line.label === '推进' && line.value).map(line => line.value);
                const options = replies.length > 0 ? replies : lines.filter(line => line.value).map(line => line.value);
                return <section key={index} className='py-4 border-y border-slate-300'><div className='flex items-center gap-2 text-[10px] font-bold text-slate-600'><ArrowBendDownRight size={15} />下一步可以这样写</div><div className='mt-3 divide-y divide-slate-200'>{options.map((option, optionIndex) => <button key={optionIndex} onClick={() => onChoose?.(option)} className='w-full py-3 flex items-start gap-3 text-left'><span className='w-5 h-5 shrink-0 rounded-full bg-violet-100 text-violet-700 grid place-items-center text-[9px] font-bold'>{optionIndex + 1}</span><span className='text-[12px] leading-5 text-slate-700'>{option}</span></button>)}</div></section>;
            }
            if (block.kind === 'affinity') {
                const personGroups = groupDisplayLines(lines, '人物', ['角色 ID']);
                const groups = personGroups.length > 0 ? personGroups : [{ title: '主要角色', lines: lines.filter(line => line.label !== '角色 ID') }];
                const preview = groups.slice(0, 3).map(group => {
                    const cToU = affinityNumber(group.lines, ['角色对你的温度', '关系温度']);
                    const uToC = affinityNumber(group.lines, ['你对角色的温度', '你的关系温度']);
                    return `${group.title}${cToU !== undefined ? `→你 ${cToU}` : ''}${uToC !== undefined ? ` · 你→${group.title} ${uToC}` : ''}`;
                }).join(' · ');
                return <details key={index} className='group border-y border-rose-200'>
                    <summary className='list-none cursor-pointer py-3.5 flex items-center gap-3'><span className='w-8 h-8 rounded-full bg-rose-50 text-rose-500 grid place-items-center'><HeartStraight size={15} weight='fill' /></span><span className='min-w-0 flex-1'><strong className='block text-xs text-rose-700'>双向关系 · {groups.length} 位角色</strong><span className='block mt-0.5 truncate text-[9px] text-slate-400'>{preview || '展开查看逐角色温度与关系维度'}</span></span><CaretDown size={13} className='text-rose-400 transition-transform group-open:rotate-180' /></summary>
                    <div className='pb-3 pl-11 divide-y divide-rose-100'>{groups.map((group, groupIndex) => <StoryAffinityGroup key={`${group.title}-${groupIndex}`} group={group} />)}</div>
                </details>;
            }
            return <section key={index} className='pl-4 border-l-2 border-slate-300'><div className='text-[10px] font-bold text-slate-500'>{block.title || '附加信息'}</div><div className='mt-2'><LabeledRows lines={lines} /></div></section>;
        })}
    </div>;
    if (!reading) return rendered;
    return <div>
        <div className='meeting-prose'>{blocks.map((block, index) => {
            if (block.kind === 'story') return <p key={index}>{block.text}</p>;
            if (!block.regexTemplate) return null;
            return <div className='my-4' key={index}><SafeStoryHtml template source={block.htmlSource || block.text}
                fallback={block.text} title={block.title || '安全排版'} /></div>;
        })}</div>
        {mainHtml.filter(block => !block.regexTemplate).map((block, index) => <SafeStoryHtml key={index} source={block.htmlSource || block.text}
            fallback={block.text} title={block.title || '安全排版'} />)}
        {(blocks.some(block => block.kind !== 'story' && !mainHtml.includes(block) && !block.regexTemplate) || relationship) && <details className='mt-5 text-slate-500'>
            <summary className='cursor-pointer text-xs py-2'>场景与补充</summary>{rendered}
        </details>}
    </div>;
});

export const StoryOutput: React.FC<StoryOutputProps> = props => {
    const { theme } = useOS();
    return <StoryOutputBody {...props} reading={meetingAppearance(theme.storyAppearance).id !== 'none'} />;
};

const StoryUserOutput: React.FC<{ content: string; regexResult?: StoryRegexResult; className: string }> = React.memo(({ content, regexResult, className }) => {
    if (!regexResult?.cards.length) return <p className={className}>{regexResult?.text ?? content}</p>;
    return <div className={className}>{splitStoryRegexOutput(regexResult).map((part, index) => typeof part === 'string'
        ? <p key={index}>{part}</p> : <SafeStoryHtml key={index} template source={part.html} fallback={part.fallback} title={part.title} />)}</div>;
});

const EMPTY_REGEX_RULES: StoryRegexRule[] = [];
const EMPTY_AFFINITY_INPUTS: StoryAffinityInput[] = [];
const PENDING_STORY_REGEX_RESULT: StoryRegexResult = { text: '', cards: [], matches: 0 };
const storyReadingSource = (message: Message): string => {
    const greeting = message.metadata?.theaterOpeningGreeting;
    return greeting ? storyOpeningReadingText(message.content, greeting.greetingId, greeting.source) : message.content;
};

const StoryTheaterSession: React.FC<Props> = ({ entry, preset, regexRules = EMPTY_REGEX_RULES, masks, onBack, onEdit, onOpenVectorMemory, onOpenArchives, onEntryChange, onArchiveCommitted }) => {
    const { characters, worldbooks, userProfile, apiConfig, memoryPalaceConfig, remoteVectorConfig, theme, updateCharacter, addToast } = useOS();
    const threadId = storyTheaterThreadId(entry.id);
    const entryRef = useRef(entry);
    entryRef.current = entry;
    // Only story-enabled offline rules enter saved-floor display, prompt
    // history and generation. A meeting-only rule must never leak here.
    const activeRegexRules = useMemo(() => alchemyRulesFor(regexRules, 'offline', preset.id),
        [regexRules, preset.id]);
    const actors = useMemo(() => characters.filter(char => entry.characterIds.includes(char.id)), [characters, entry.characterIds]);
    const memoryActors = useMemo(() => {
        const recipientIds = new Set(storyTheaterMemoryRecipientIds(entry));
        return characters.filter(char => recipientIds.has(char.id));
    }, [characters, entry]);
    const mask = useMemo(() => resolveStoryTheaterMask(entry.mask, userProfile, characters, masks), [characters, entry.mask, masks, userProfile]);
    const youLabel = mask.selection.type === 'user' ? '你' : `你（${mask.name}）`;
    // A refreshed character array can contain the same names. Key the display
    // regex context by its actual macro values, not array object identity.
    // Otherwise previously rendered floors temporarily become empty again.
    const actorDisplayNames = actors.map(actor => actor.name).join('、');
    const regexContext = useMemo(() => ({ user: mask.name, char: actorDisplayNames }), [mask.name, actorDisplayNames]);
    const storyReadingActive = meetingAppearance(theme.storyAppearance).id !== 'none';
    const promptIdentityName = mask.name.trim() && mask.name.trim() !== '你' ? mask.name.trim() : '当前用户侧角色';
    const effectivePreset = useMemo<StoryTheaterPreset>(() => ({
        ...preset,
        document: resolveStoryPresetDocument(preset, entry.presetOverride),
    }), [entry.presetOverride, preset]);
    const activeMiniTheater = useMemo(() => getActiveStoryMiniTheaterPrompt(effectivePreset.document), [effectivePreset.document]);
    const affinityEnabled = useMemo(() => effectivePreset.document.prompts.some(prompt => prompt.id === 'nmj-v65-affinity-control' && prompt.enabled), [effectivePreset.document]);
    // Same global + legacy-mount library as the editor, independent of cast.
    // Only explicitly selected IDs are supplied to this story's AI context.
    const selectedBooks = useMemo(() => {
        const ids = new Set(entry.selectedWorldbookIds);
        return resolveStoryTheaterWorldbooks(worldbooks, characters).filter(book => ids.has(book.id));
    }, [worldbooks, characters, entry.selectedWorldbookIds]);
    const canStart = hasStoryTheaterParticipant(entry, characters);
    const readingBatchSize = Math.max(10, Math.min(100, Math.round(Number(entry.readingBatchSize) || 20)));
    const [loadedFloorCount, setLoadedFloorCount] = useState(readingBatchSize);
    const [totalFloorCount, setTotalFloorCount] = useState(0);
    const [loadingOlder, setLoadingOlder] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [historyLoaded, setHistoryLoaded] = useState(false);
    const [initialReadingDisplayed, setInitialReadingDisplayed] = useState(false);
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const [backgroundTask, setBackgroundTask] = useState(() => getStoryGenerationSnapshot(entry.id));
    const [memoryStatus, setMemoryStatus] = useState('');
    const [contextTokens, setContextTokens] = useState(0);
    const [contextTokensExact, setContextTokensExact] = useState(false);
    const [showAffinityInput, setShowAffinityInput] = useState(false);
    const [affinityDrafts, setAffinityDrafts] = useState<Record<string, AffinityDraft>>({});
    const [selectedAffinityActorId, setSelectedAffinityActorId] = useState('');
    const [visibleFloor, setVisibleFloor] = useState(0);
    const [atReadingEnd, setAtReadingEnd] = useState(true);
    const [expandedArchivedIds, setExpandedArchivedIds] = useState<Set<number>>(() => new Set());
    // Only metadata remains resident for collapsed archives. Full original
    // bodies exist solely while their archive group has been expanded.
    const [archiveBodies, setArchiveBodies] = useState<Map<number, Message>>(() => new Map());
    const [archiveReadErrors, setArchiveReadErrors] = useState<Set<number>>(() => new Set());
    const [exporting, setExporting] = useState(false);
    const [showQuickPreset, setShowQuickPreset] = useState(false);
    const [rerollingId, setRerollingId] = useState<number | null>(null);
    const [messageMenu, setMessageMenu] = useState<Message | null>(null);
    const [editingMessage, setEditingMessage] = useState<Message | null>(null);
    const [deletingMessage, setDeletingMessage] = useState<Message | null>(null);
    const [editDraft, setEditDraft] = useState('');
    const [mutatingMessage, setMutatingMessage] = useState(false);
    // React state does not update synchronously. A rapid double tap can enter send()
    // twice before `sending` re-renders the disabled button, creating two billable
    // completions. Keep the state for UI only and use this ref as the real mutex.
    const sendLock = useRef(false);
    const archiveLock = useRef(false);
    // Count failed archive attempts so the same send never retries a broken
    // summary endpoint both before and after the expensive prose completion.
    const archiveErrorSeq = useRef(0);
    const readingScrollRef = useRef<HTMLElement>(null);
    const readingContentRef = useRef<HTMLDivElement>(null);
    const followLatestRef = useRef(true);
    const readingScrollFrameRef = useRef<number | null>(null);
    const readingScrollFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastReadMessageIdRef = useRef<number | null>(null);
    const initialReadingPendingRef = useRef(true);
    const initialReadingGestureRef = useRef(false);
    const loadSequenceRef = useRef(0);
    const loadingOlderRef = useRef(false);
    const archiveWantedRef = useRef(new Set<number>());
    // Each open/close invalidates older asynchronous archive reads.
    const archiveReadVersionRef = useRef(new Map<number, number>());
    const olderAnchorRef = useRef<{ key: string; top: number } | null>(null);
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const longPressOrigin = useRef<{ x: number; y: number } | null>(null);

    // The reading view fetches a bounded window. Generation, archiving and
    // export request full snapshots separately only when they actually need one.
    const loadMessages = useCallback(async () => {
        const requestId = ++loadSequenceRef.current;
        try {
            const { messages: rows, totalCount } = await DB.getRecentMessagesWithCount(
                threadId, loadedFloorCount, message => message.metadata?.source === 'story_theater',
            );
            if (requestId !== loadSequenceRef.current) return;
            const savedEntry = entryRef.current;
            setMessages(rows.map(row => mirrorArchived(row, savedEntry)
                ? { ...row, content: '' } : row));
            setTotalFloorCount(totalCount);
            setHistoryLoaded(true);
        } finally {
            if (requestId === loadSequenceRef.current) {
                loadingOlderRef.current = false;
                setLoadingOlder(false);
            }
        }
    }, [threadId, loadedFloorCount]);

    useEffect(() => {
        void loadMessages().catch(error => {
            setHistoryLoaded(true);
            console.error('[StoryTheater] initial history load failed', error);
            addToast(error instanceof Error ? `剧情历史读取失败：${error.message}` : '剧情历史读取失败，请重试', 'error');
        });
    }, [loadMessages, addToast]);
    useEffect(() => subscribeStoryGeneration(entry.id, snapshot => {
        setBackgroundTask(snapshot);
        // A different StoryTheaterSession instance may have submitted the task.
        // Re-read IndexedDB on completion instead of relying on an unmounted
        // session's local setState or using its stale in-memory message list.
        if (snapshot.phase === 'completed' || snapshot.phase === 'failed') {
            void loadMessages().catch(error => console.warn('[StoryBackground] refresh failed', error));
        }
    }), [entry.id, loadMessages]);
    useEffect(() => {
        setContextTokens(0);
        setContextTokensExact(false);
        setShowAffinityInput(false);
        setAffinityDrafts({});
        setSelectedAffinityActorId('');
        setExpandedArchivedIds(new Set());
        setArchiveBodies(new Map());
        setArchiveReadErrors(new Set());
        archiveWantedRef.current.clear();
        archiveReadVersionRef.current.clear();
        olderAnchorRef.current = null;
        loadingOlderRef.current = false;
        setLoadingOlder(false);
        setLoadedFloorCount(readingBatchSize);
        setTotalFloorCount(0);
        setMessages([]);
        setHistoryLoaded(false);
        setInitialReadingDisplayed(false);
        followLatestRef.current = true;
        lastReadMessageIdRef.current = null;
        initialReadingPendingRef.current = true;
        initialReadingGestureRef.current = false;
        setVisibleFloor(0);
        setAtReadingEnd(true);
        setMessageMenu(null);
        setEditingMessage(null);
        setDeletingMessage(null);
    }, [entry.id, readingBatchSize]);
    const patchAffinityDraft = useCallback((characterId: string, patch: Partial<AffinityDraft>) => {
        setAffinityDrafts(current => ({
            ...current,
            [characterId]: { ...(current[characterId] || EMPTY_AFFINITY_DRAFT), ...patch },
        }));
    }, []);
    const cancelLongPress = useCallback(() => {
        if (longPressTimer.current) clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
        longPressOrigin.current = null;
    }, []);
    useEffect(() => () => cancelLongPress(), [cancelLongPress]);
    const beginLongPress = useCallback((message: Message, event: React.PointerEvent<HTMLElement>) => {
        if ((event.target as HTMLElement).closest('button, a, input, textarea, select, summary')) return;
        cancelLongPress();
        longPressOrigin.current = { x: event.clientX, y: event.clientY };
        longPressTimer.current = setTimeout(() => {
            // Normal touch-scroll is not an edit attempt. Only show the
            // background-generation notice on an intentional long press.
            if (isStoryGenerationRunning(entry.id)) {
                addToast('剧情正在后台生成，请完成后再修改楼层', 'info');
            } else {
                setMessageMenu(message);
            }
            longPressTimer.current = null;
            longPressOrigin.current = null;
        }, 520);
    }, [addToast, cancelLongPress, entry.id]);
    const moveLongPress = useCallback((event: React.PointerEvent<HTMLElement>) => {
        const origin = longPressOrigin.current;
        if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10) cancelLongPress();
    }, [cancelLongPress]);
    const openMessageMenu = useCallback((message: Message, event?: React.MouseEvent<HTMLElement>) => {
        event?.preventDefault();
        if (isStoryGenerationRunning(entry.id)) { addToast('剧情正在后台生成，请完成后再修改楼层', 'info'); return; }
        if (event && (event.target as HTMLElement).closest('button, a, input, textarea, select, summary')) return;
        cancelLongPress();
        setMessageMenu(message);
    }, [addToast, cancelLongPress, entry.id]);
    const pressHandlersFor = (message: Message) => ({
        onPointerDown: (event: React.PointerEvent<HTMLElement>) => beginLongPress(message, event),
        onPointerMove: moveLongPress,
        onPointerUp: cancelLongPress,
        onPointerCancel: cancelLongPress,
        onPointerLeave: cancelLongPress,
        onContextMenu: (event: React.MouseEvent<HTMLElement>) => openMessageMenu(message, event),
    });

    const saveMessageEdit = useCallback(async () => {
        if (!editingMessage || !editDraft.trim() || mutatingMessage) return;
        if (isStoryGenerationRunning(entry.id)) { addToast('剧情后台生成中，请完成后再编辑楼层', 'info'); return; }
        setMutatingMessage(true);
        try {
            await updateStoryTheaterFloor(editingMessage, editDraft.trim());
            await loadMessages();
            setEditingMessage(null);
            setEditDraft('');
            addToast(entry.writesToCharacterMemory ? '这一层和角色侧镜像记忆已同步修改' : '这一层已修改', 'success');
        } catch (error: any) {
            addToast(`修改失败：${error?.message || error}`, 'error');
        } finally {
            setMutatingMessage(false);
        }
    }, [addToast, editDraft, editingMessage, entry.id, entry.writesToCharacterMemory, loadMessages, mutatingMessage]);
    const deleteStoryMessage = useCallback(async () => {
        if (!deletingMessage || mutatingMessage) return;
        if (isStoryGenerationRunning(entry.id)) { addToast('剧情后台生成中，请完成后再删除楼层', 'info'); return; }
        setMutatingMessage(true);
        try {
            await deleteStoryTheaterFloor(deletingMessage);
            await loadMessages();
            setDeletingMessage(null);
            addToast(entry.writesToCharacterMemory ? '这一层和角色侧镜像记忆已同步删除' : '这一层已删除', 'success');
        } catch (error: any) {
            addToast(`删除失败：${error?.message || error}`, 'error');
        } finally {
            setMutatingMessage(false);
        }
    }, [addToast, deletingMessage, entry.id, entry.writesToCharacterMemory, loadMessages, mutatingMessage]);
    // Only an actual new floor or an explicit jump may move the reader.
    // Late images, fonts and display-regex batches can resize hundreds of old
    // floors; snapping on every ResizeObserver notification fights the user's
    // swipe and makes long stories bounce between positions.
    const updateVisibleFloor = useCallback(() => {
        const viewport = readingScrollRef.current;
        if (!viewport) return;
        const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
        const nearBottom = distanceFromBottom <= 96;
        setAtReadingEnd(current => current === nearBottom ? current : nearBottom);
        let floor = messages.length > 0 ? Math.max(1, totalFloorCount - messages.length + 1) : 0;
        if (nearBottom) {
            floor = totalFloorCount;
        } else {
            const readingLine = viewport.getBoundingClientRect().top + Math.min(120, viewport.clientHeight * 0.24);
            const floorNodes = viewport.querySelectorAll<HTMLElement>('[data-story-floor]');
            // O(log n) geometry checks even when a story contains many floors.
            let low = 0;
            let high = floorNodes.length - 1;
            while (low <= high) {
                const middle = Math.floor((low + high) / 2);
                const element = floorNodes[middle];
                if (element.getBoundingClientRect().top > readingLine) {
                    high = middle - 1;
                } else {
                    floor = Number(element.dataset.storyFloor) || floor;
                    low = middle + 1;
                }
            }
        }
        setVisibleFloor(current => current === floor ? current : floor);
    }, [messages.length, totalFloorCount]);
    // Scroll events can fire many times per frame on a long reading page.
    // Update the header at most once per paint instead of re-rendering every
    // floor repeatedly during a fast swipe.
    const scheduleVisibleFloor = useCallback(() => {
        if (readingScrollFrameRef.current !== null) return;
        const flush = () => {
            if (readingScrollFrameRef.current === null) return;
            readingScrollFrameRef.current = null;
            if (readingScrollFallbackRef.current !== null) {
                clearTimeout(readingScrollFallbackRef.current);
                readingScrollFallbackRef.current = null;
            }
            updateVisibleFloor();
        };
        readingScrollFrameRef.current = requestAnimationFrame(flush);
        // Android WebView and headless/occluded browsers can suspend RAF
        // while the scrollport has already moved. Keep the floor indicator and
        // latest-jump button accurate without forcing any additional scrolling.
        readingScrollFallbackRef.current = setTimeout(() => {
            if (readingScrollFrameRef.current !== null) {
                cancelAnimationFrame(readingScrollFrameRef.current);
                flush();
            }
        }, 96);
    }, [updateVisibleFloor]);
    useEffect(() => () => {
        if (readingScrollFrameRef.current !== null) cancelAnimationFrame(readingScrollFrameRef.current);
        if (readingScrollFallbackRef.current !== null) clearTimeout(readingScrollFallbackRef.current);
    }, []);
    const handleReadingScroll = useCallback(() => {
        const viewport = readingScrollRef.current;
        if (!viewport) return;
        // Auto-follow is for readers actually at the end, not merely browsing
        // within the final floor. This must not run from layout observers.
        // Layout reflows also emit scroll events. They must not turn off
        // follow-latest without an actual reading gesture.
        if (viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 32) {
            followLatestRef.current = true;
        }
        scheduleVisibleFloor();
    }, [scheduleVisibleFloor]);
    const pauseFollowingForReading = useCallback((event: React.UIEvent<HTMLElement>) => {
        // Tapping the latest-floor actions should still follow their new reply;
        // only a reading gesture, not an action button, disables auto-follow.
        if (event.type === 'touchstart'
            && (event.target as HTMLElement).closest('button, a, input, textarea, select, summary')) return;
        // A wheel/touch gesture can begin before its first scroll event.
        initialReadingGestureRef.current = true;
        followLatestRef.current = false;
        // A reading gesture can precede the browser's native scroll event,
        // especially after nested iframe motion or a direct jump. Recheck
        // the visible floor after the gesture to keep the jump control current.
        scheduleVisibleFloor();
    }, [scheduleVisibleFloor]);
    const scrollReadingToLatest = useCallback((behavior: ScrollBehavior = 'auto') => {
        const viewport = readingScrollRef.current;
        if (!viewport) return;
        followLatestRef.current = true;
        viewport.scrollTo({ top: viewport.scrollHeight, behavior });
        if (behavior === 'auto') updateVisibleFloor();
    }, [updateVisibleFloor]);

    const loadOlderFloors = useCallback(() => {
        if (loadingOlderRef.current || messages.length >= totalFloorCount) return;
        loadingOlderRef.current = true;
        setLoadingOlder(true);
        const viewport = readingScrollRef.current;
        const anchor = viewport?.querySelector<HTMLElement>('[data-story-anchor]');
        olderAnchorRef.current = anchor?.dataset.storyAnchor
            ? { key: anchor.dataset.storyAnchor, top: anchor.getBoundingClientRect().top } : null;
        followLatestRef.current = false;
        initialReadingGestureRef.current = true;
        setLoadedFloorCount(count => Math.min(totalFloorCount, count + readingBatchSize));
    }, [messages.length, readingBatchSize, totalFloorCount]);
    useLayoutEffect(() => {
        const saved = olderAnchorRef.current;
        if (!saved) return;
        const viewport = readingScrollRef.current;
        const anchor = [...(viewport?.querySelectorAll<HTMLElement>('[data-story-anchor]') || [])]
            .find(node => node.dataset.storyAnchor === saved.key);
        if (viewport && anchor) {
            // Correct by actual geometry; native scroll anchoring may have
            // already compensated part or all of the inserted height.
            viewport.scrollTop += anchor.getBoundingClientRect().top - saved.top;
        }
        olderAnchorRef.current = null;
    }, [messages]);
    useEffect(() => {
        const content = readingContentRef.current;
        if (!content) return;
        // On first entry, older iframe cards often finish measuring after the
        // initial jump to the latest floor. Keep the actual latest content
        // anchored until the user really starts reading elsewhere; never
        // re-anchor while they are swiping through older floors.
        const syncLayout = () => {
            if (!initialReadingPendingRef.current && followLatestRef.current) {
                const viewport = readingScrollRef.current;
                if (viewport) viewport.scrollTop = viewport.scrollHeight;
            }
            scheduleVisibleFloor();
        };
        const stopFollowingOnFrameSwipe = () => {
            initialReadingGestureRef.current = true;
            followLatestRef.current = false;
        };
        const viewport = readingScrollRef.current;
        viewport?.addEventListener('story-reader-gesture', stopFollowingOnFrameSwipe);
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncLayout) : null;
        observer?.observe(content);
        let mounted = true;
        if (document.fonts?.ready) {
            void document.fonts.ready.then(() => {
                if (mounted) syncLayout();
            }).catch(() => {});
        }
        return () => {
            mounted = false;
            viewport?.removeEventListener('story-reader-gesture', stopFollowingOnFrameSwipe);
            observer?.disconnect();
        };
    }, [scheduleVisibleFloor]);
    useLayoutEffect(() => {
        // Do not jump on the raw, not-yet-rendered timeline. The one initial
        // positioning pass runs only after history and display regex settle.
        if (initialReadingPendingRef.current) return;
        const latestId = messages[messages.length - 1]?.id ?? null;
        const previousId = lastReadMessageIdRef.current;
        lastReadMessageIdRef.current = latestId;
        // Re-fetching, editing, deleting or changing an archive does not add
        // a new floor. Don't scroll just because component state changed.
        if (latestId !== null && (previousId === null || latestId > previousId) && followLatestRef.current) {
            scrollReadingToLatest();
        } else {
            updateVisibleFloor();
        }
    }, [messages, scrollReadingToLatest, updateVisibleFloor]);
    const setArchiveExpanded = useCallback((messageIds: number[], open: boolean) => {
        followLatestRef.current = false;
        // A second toggle event for the same already-open/closed group is not
        // another user decision and must never restart all IndexedDB reads.
        if (messageIds.every(id => archiveWantedRef.current.has(id) === open)) return;
        const versions = new Map<number, number>();
        messageIds.forEach(id => {
            const version = (archiveReadVersionRef.current.get(id) || 0) + 1;
            archiveReadVersionRef.current.set(id, version);
            versions.set(id, version);
            if (open) archiveWantedRef.current.add(id);
            else archiveWantedRef.current.delete(id);
        });
        const isCurrent = (id: number) => archiveWantedRef.current.has(id)
            && archiveReadVersionRef.current.get(id) === versions.get(id);
        setExpandedArchivedIds(current => {
            if (messageIds.every(id => current.has(id) === open)) return current;
            const next = new Set(current);
            messageIds.forEach(id => { if (open) next.add(id); else next.delete(id); });
            return next;
        });
        if (!open) {
            setArchiveBodies(current => {
                if (!messageIds.some(id => current.has(id))) return current;
                const next = new Map(current);
                messageIds.forEach(id => next.delete(id));
                return next;
            });
            setArchiveReadErrors(current => {
                if (!messageIds.some(id => current.has(id))) return current;
                const next = new Set(current);
                messageIds.forEach(id => next.delete(id));
                return next;
            });
            return;
        }
        // A single corrupt/missing archived row must not reject the entire
        // group of otherwise readable old floors. Keep per-message results.
        void Promise.allSettled(messageIds.map(id => DB.getMessageById(id))).then(results => {
            const fresh: Message[] = [];
            const missing: number[] = [];
            let readError: unknown;
            results.forEach((result, index) => {
                const id = messageIds[index];
                if (!isCurrent(id)) return;
                if (result.status === 'rejected') {
                    missing.push(id);
                    readError ??= result.reason;
                    return;
                }
                const row = result.value;
                if (!row || row.id !== id || row.charId !== threadId
                    || row.metadata?.source !== 'story_theater') {
                    missing.push(id);
                    return;
                }
                fresh.push(row);
            });
            if (fresh.length) setArchiveBodies(current => {
                const next = new Map(current);
                fresh.forEach(row => next.set(row.id, row));
                return next;
            });
            if (missing.length) setArchiveReadErrors(current => new Set([...current, ...missing]));
            // A closed or re-opened group invalidates the old read tokens, so
            // those responses cannot replace newer originals or emit toasts.
            if (readError && missing.length) {
                addToast(`部分归档原文读取失败：${readError instanceof Error ? readError.message : String(readError)}`, 'error');
            }
        });
    }, [addToast, threadId]);
    const storedTokenInfo = useMemo(() => {
        const source = [...messages].reverse().find(message => Number(message.metadata?.theaterPromptTokens) > 0);
        return source ? {
            count: Number(source.metadata.theaterPromptTokens),
            exact: source.metadata.theaterPromptTokensExact === true,
        } : { count: 0, exact: false };
    }, [messages]);
    const displayedTokenInfo = contextTokens > 0 ? { count: contextTokens, exact: contextTokensExact } : storedTokenInfo;

    const exportStory = useCallback(async () => {
        if (messages.length === 0 || exporting) {
            if (messages.length === 0) addToast('暂无可导出的剧情原文', 'info');
            return;
        }
        setExporting(true);
        try {
            const allMessages = (await DB.getMessagesByCharId(threadId, true))
                .filter(message => message.metadata?.source === 'story_theater').sort((a, b) => a.id - b.id);
            const result = await shareOrDownloadFile({
                content: formatStoryTheaterExport(entry, mask.name, actors.map(actor => actor.name), allMessages),
                fileName: makeStoryTheaterFileName(entry.title),
                mimeType: 'text/plain;charset=utf-8',
                preferDownloadOnWeb: true,
                shareTitle: `${entry.title || '未命名剧情'}的完整原文`,
            });
            addToast(result === 'shared' ? '已打开分享面板' : '剧情原文已导出', 'success');
        } catch (error: any) {
            console.error('[StoryTheater] export failed', error);
            addToast(`剧情原文导出失败：${error?.message || error}`, 'error');
        } finally {
            setExporting(false);
        }
    }, [actors, addToast, entry, exporting, mask.name, messages.length, threadId]);

    const callCompletion = useCallback(async (payload: Array<{ role: string; content: string }>, settings?: Partial<StoryGenerationSettings>, onPromptTokens?: (tokens: number) => void): Promise<StoryCompletion> => {
        assertStoryApiConfigured(apiConfig);
        const generationSettings = prepareStoryGenerationSettings(settings, entry.omitSamplingParams === true, apiConfig.model);
        const maxTokens = normalizeStoryOutputTokens(entry.outputMaxTokens ?? generationSettings.max_tokens);
        const stream = entry.streamStoryOutput === true || apiConfig.stream === true;
        // Non-streaming providers can wait until the whole reply is generated
        // before sending headers. An elapsed timer is not a transport failure.
        let response: Response;
        try {
            response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({ model: apiConfig.model, messages: payload, stream,
                    ...(stream ? { stream_options: { include_usage: true } } : {}), ...generationSettings, max_tokens: maxTokens }),
                __sullySkipStreamUpgrade: true,
                __sullyMeta: { appId: 'date', appName: '见面', purpose: '剧情见面生成' },
            } as RequestInit & { __sullySkipStreamUpgrade: boolean; __sullyMeta: { appId: string; appName: string; purpose: string } });
        } catch (error) {
            const detail = error instanceof Error ? error.message || error.name : String(error);
            const streamHint = stream ? '' : '。如果中转支持流式，可在本剧情设置中开启「长回复流式传输」';
            throw new Error(`浏览器未收到可读取的 HTTP 响应（${detail}）。连接、网关超时或跨域限制均可能导致此问题，请先对照站点调用记录${streamHint}`);
        }
        return readStoryCompletion(response, effectivePreset.document.sourceFormat === 'sillytavern', maxTokens, onPromptTokens);
    }, [apiConfig, effectivePreset.document.sourceFormat, entry.omitSamplingParams, entry.outputMaxTokens, entry.streamStoryOutput]);

    const saveCentralAndMirrors = useCallback(async (role: 'user' | 'assistant', content: string, centralMetadata: Record<string, unknown> = {}): Promise<number> => {
        const now = Date.now();
        return DB.saveStoryTheaterTurn(
            { charId: threadId, role, type: 'text', content, timestamp: now,
                metadata: { source: 'story_theater', theaterId: entry.id, ...centralMetadata } },
            centralId => entry.writesToCharacterMemory
                ? memoryActors.map(actor => createStoryTheaterMirrorMessage(
                    entry, actor.id, { id: centralId, role, content, timestamp: now },
                ))
                : [],
        );
    }, [entry, memoryActors, threadId]);

    const buildActorContexts = useCallback(async (query: string): Promise<string> => {
        const allBookIds = new Set(actors.flatMap(actor => (actor.mountedWorldbooks || []).map(book => book.id)));
        const blocks: string[] = [];
        for (const actor of actors) {
            if (!entry.carryCharacterMemory) {
                blocks.push(buildBareTheaterActorContext(actor, effectivePreset.document.sourceFormat === 'sillytavern'));
                continue;
            }
            const limit = Math.max(0, Math.min(500, entry.characterContextLimits[actor.id] ?? 100));
            const recent = await loadStoryActorContext(actor, entry.id, limit);
            let recalled = '';
            const embedding = memoryPalaceConfig.embedding;
            if (entry.automaticMemoryApiEnabled === true && actor.memoryPalaceEnabled && embedding?.baseUrl && embedding?.apiKey) {
                const rawRecall = await retrieveMemories(recent, actor.id, embedding, actor.activeBuffs?.[0]?.name, actor.personalityStyle || 'emotional', actor.ruminationTendency ?? 0.3, query, userProfile.name, remoteVectorConfig, actor.name);
                recalled = buildStoryActorMemoryEnvelope(actor.name, rawRecall, userProfile.name, mask.name);
            }
            const theaterActor = { ...actor, memoryPalaceInjection: recalled };
            const core = (await ContextBuilder.buildCoreContext(theaterActor, userProfile, true, recalled, {
                skipUserProfile: true,
                skipWorldbookIds: allBookIds,
                headerOverride: `[剧情角色：${actor.name}]`,
            }, { skipTimeAwareness: true }));
            blocks.push(`${core}\n${formatActorRecentMessages(actor, recent, userProfile.name, mask.name)}`.trim());
        }
        return blocks.join('\n\n---\n\n');
    }, [actors, effectivePreset.document.sourceFormat, entry.id, entry.carryCharacterMemory, entry.automaticMemoryApiEnabled, entry.characterContextLimits, mask.name, memoryPalaceConfig.embedding, remoteVectorConfig, userProfile]);

    const buildMaskMemoryContext = useCallback(async (query: string): Promise<string> => {
        if (!entry.carryCharacterMemory || !mask.characterId) return '';
        const maskCharacter = characters.find(char => char.id === mask.characterId);
        if (!maskCharacter) return '';
        const limit = Math.max(0, Math.min(500, entry.characterContextLimits[maskCharacter.id] ?? 100));
        const recent = await loadStoryActorContext(maskCharacter, entry.id, limit);
        let recalled = '';
        const embedding = memoryPalaceConfig.embedding;
        if (entry.automaticMemoryApiEnabled === true && maskCharacter.memoryPalaceEnabled && embedding?.baseUrl && embedding?.apiKey) {
            const rawRecall = await retrieveMemories(recent, maskCharacter.id, embedding, maskCharacter.activeBuffs?.[0]?.name, maskCharacter.personalityStyle || 'emotional', maskCharacter.ruminationTendency ?? 0.3, query, userProfile.name, remoteVectorConfig, maskCharacter.name);
            recalled = buildStoryActorMemoryEnvelope(maskCharacter.name, rawRecall, userProfile.name, mask.name);
        }
        const skipWorldbookIds = new Set([
            ...(maskCharacter.mountedWorldbooks || []).map(book => book.id),
            ...actors.flatMap(actor => (actor.mountedWorldbooks || []).map(book => book.id)),
        ]);
        const core = (await ContextBuilder.buildCoreContext({ ...maskCharacter, memoryPalaceInjection: recalled }, userProfile, true, recalled, {
            skipUserProfile: true,
            skipWorldbookIds,
            headerOverride: `[你当前身份的既有记忆：${maskCharacter.name}]`,
        }, { skipTimeAwareness: true }));
        return `${core}\n${formatActorRecentMessages(maskCharacter, recent, userProfile.name, mask.name)}`.trim();
    }, [actors, characters, entry.id, entry.carryCharacterMemory, entry.automaticMemoryApiEnabled, entry.characterContextLimits, mask.characterId, mask.name, memoryPalaceConfig.embedding, remoteVectorConfig, userProfile]);

    const applyActorMemoryPipeline = useCallback(async () => {
        if (!entry.writesToCharacterMemory || entry.automaticMemoryApiEnabled !== true) return;
        const embedding = memoryPalaceConfig.embedding;
        // Role memories are shared by private chat, calls and other apps.
        // The story-only cheap API MUST NOT extract or digest global character memory.
        // Preserve the original palace LightLLM (or the existing global fallback).
        const light = memoryPalaceConfig.lightLLM?.baseUrl ? memoryPalaceConfig.lightLLM : { baseUrl: apiConfig.baseUrl, apiKey: apiConfig.apiKey, model: apiConfig.model };
        if (!embedding?.baseUrl || !embedding?.apiKey || !light.baseUrl) return;
        for (const actor of memoryActors) {
            if (!actor.memoryPalaceEnabled) continue;
            try {
                setMemoryStatus(`${actor.name}正在整理这段相处……`);
                const recent = await DB.getRecentMessagesByCharId(actor.id, 50);
                await processNewMessagesWithAutoArchive(recent, actor.id, actor.name, embedding, light, mask.name, false, setMemoryStatus);
                if (incrementDigestRound(actor.id)) {
                    await runCognitiveDigestion(actor.id, actor.name, [actor.systemPrompt, actor.worldview].filter(Boolean).join('\n'), light, false, mask.name, embedding);
                }
            } catch (error: any) {
                console.warn('[StoryTheater] actor memory pipeline failed', actor.id, error?.message || error);
            }
        }
        setMemoryStatus('');
        await loadMessages();
    }, [apiConfig, characters, entry.writesToCharacterMemory, entry.automaticMemoryApiEnabled, loadMessages, mask.name, memoryActors, memoryPalaceConfig, updateCharacter]);

    const archiveIfNeeded = useCallback(async (archiveEntry = entry): Promise<StoryTheaterEntry | null> => {
        if (archiveEntry.automaticMemoryApiEnabled !== true || archiveEntry.writesToCharacterMemory || archiveLock.current) return null;
        archiveLock.current = true;
        try {
            const rows = storyArchiveFloors(await DB.getMessagesByCharId(threadId, true), archiveEntry.id);
            const batch = selectStoryArchiveBatch(rows, archiveEntry.archiveAfter, archiveEntry.archiveKeepRecent ?? 5, row =>
                row.metadata?.theaterSkipAutoArchive === true || !!storyArchiveAtFloor(archiveEntry.archives, row.id));
            if (batch.length === 0) return null;
            const first = batch[0];
            const last = batch[batch.length - 1];
            let next: StoryTheaterEntry;
            if (archiveEntry.archiveStrategy === 'summary') {
                setMemoryStatus('正在把 ' + batch.length + ' 条正文压成事件盒……');
                const summary = await generateStoryArchiveSummary(archiveEntry.title, batch, resolveStoryMemoryApi(archiveEntry, apiConfig), {
                    storyOnlyProvider: !!archiveEntry.memorySummaryApi, firstFloor: rows.indexOf(first) + 1,
                });
                next = await commitStoryArchiveBatch(archiveEntry, batch, {
                    id: makeStoryTheaterId(), strategy: 'summary', fromMessageId: first.id,
                    toMessageId: last.id, messageCount: batch.length, summary, createdAt: Date.now(),
                });
            } else {
                setMemoryStatus('正在整理独立向量归档……');
                next = await archiveStoryVectorRangeInGeneration(archiveEntry.id, batch, apiConfig, {
                    embedding: memoryPalaceConfig.embedding,
                    remote: remoteVectorConfig,
                    fallbackApi: memoryPalaceConfig.lightLLM?.baseUrl ? {
                        ...memoryPalaceConfig.lightLLM, apiKey: memoryPalaceConfig.lightLLM.apiKey ?? '',
                    } : undefined,
                });
            }

            // Already durably committed in the same IndexedDB transaction as the floor flags.
            // State must update without writing a stale duplicate snapshot over another tab.
            onArchiveCommitted(next);
            await loadMessages();
            addToast(archiveEntry.archiveStrategy === 'summary' ? '旧正文已收进事件盒' : '旧正文已写入独立向量分区', 'success');
            return next;
        } catch (error: any) {
            console.error('[StoryTheater] archive failed', error);
            archiveErrorSeq.current += 1;
            addToast(`剧情归档失败：${error?.message || error}`, 'error');
            return null;
        } finally {
            archiveLock.current = false;
            setMemoryStatus('');
        }
    }, [addToast, apiConfig, entry, loadMessages, memoryPalaceConfig, remoteVectorConfig, onArchiveCommitted, threadId]);

    const send = useCallback((rerollTarget?: Message, continueRequested = false) => {
        // Imported greeting is a fixed first floor, not an AI-generated reply.
        // Re-rolling it would erase the player's selected story starting point.
        if (rerollTarget?.metadata?.theaterOpeningGreeting) return;
        if (sendLock.current || !canStart) return;
        // A session can unmount when navigating to another page; the per-story
        // singleton still owns the billable API request and its DB commit.
        if (isStoryGenerationRunning(entry.id) || getStoryGenerationSnapshot(entry.id)?.unsavedReply) return;
        sendLock.current = true;
        setSending(true);
        setRerollingId(rerollTarget?.id || null);
        const started = startStoryBackgroundGeneration(entry.id, async reportStage => {
        try {
            reportStage('正在读取剧情并准备上下文…');
            const before = (await DB.getMessagesByCharId(threadId, true))
                .filter(message => message.metadata?.source === 'story_theater')
                .sort((a, b) => a.id - b.id);
            const latest = before[before.length - 1];
            const isReroll = Boolean(rerollTarget && latest?.id === rerollTarget.id && latest.role === 'assistant' && !mirrorArchived(latest, entry));
            if (rerollTarget && !isReroll) return;
            const openingPrompt = `请直接写出「${entry.title}」的第一幕。${entry.premise ? `剧情介绍：${entry.premise}` : '没有额外剧情介绍，请根据角色、世界与预设自然建立场景。'}直接开始，不要求补充信息，也不要替当前由你执笔的身份做重大决定。`;
            const typedText = input.trim();
            const previousUser = rerollTarget && latest ? getStoryReplyInput(before, latest) : undefined;
            const assistantOpening = isReroll
                ? before.length === 1 && !previousUser
                : !continueRequested && before.length === 0 && entry.openingMode === 'assistant' && !typedText;
            const rerollWithoutInput = isReroll && !previousUser && !assistantOpening;
            const pendingInput = getPendingStoryRetryInput(before, entry.archives);
            const text = isReroll
                ? previousUser?.content.trim() || (assistantOpening ? openingPrompt : MEETING_CONTINUE_DISPLAY_TEXT)
                : continueRequested ? MEETING_CONTINUE_DISPLAY_TEXT : typedText || pendingInput || (assistantOpening ? openingPrompt : '');
            if (!text) return;
            // Fail before persisting a new user turn if there is no valid director endpoint.
            assertStoryApiConfigured(apiConfig);
            const retry = !isReroll && latest?.role === 'user' && pendingInput === text
                && (!continueRequested || latest.metadata?.theaterContinue === true);
            // A continuation is a control action. Only the display placeholder is persisted.
            const isContinueTurn = isReroll
                ? rerollWithoutInput || previousUser?.metadata?.theaterContinue === true
                : continueRequested || (retry && latest?.metadata?.theaterContinue === true);
            let modelText = isContinueTurn ? buildStoryContinueInstruction(promptIdentityName) : text;
            const currentUserInput = { text, role: 'user' as const, depth: 0 };
            if (!isContinueTurn && !assistantOpening && activeRegexRules.some(rule => storyRegexApplies(rule, 'history', currentUserInput))) {
                const [filtered] = await runStoryRegex([currentUserInput], activeRegexRules, 'history', undefined, regexContext);
                modelText = filtered.text;
                if (!modelText.trim()) throw new Error('本轮输入被剧情正则过滤为空，请调整规则或补充内容');
            }
            const draftAffinityInputs = affinityEnabled ? actors.map(actor => {
                const draft = affinityDrafts[actor.id] || EMPTY_AFFINITY_DRAFT;
                return normalizeAffinityInput({ ...draft, characterId: actor.id, characterName: actor.name }, actor);
            }).filter((value): value is StoryAffinityInput => Boolean(value)) : [];
            const savedAffinityInputs = storyAffinityInputsFromMessage(isReroll ? previousUser : retry ? latest : undefined, actors);
            const rerollAffinityInputs = isReroll ? storyAffinityInputsFromMessage(rerollTarget, actors) : [];
            const affinityInputs = savedAffinityInputs.length > 0 ? savedAffinityInputs : rerollAffinityInputs.length > 0 ? rerollAffinityInputs : draftAffinityInputs;
            const userMessageId = isReroll
                ? (previousUser?.id || 0)
                : assistantOpening
                    ? 0
                    : retry
                        ? latest.id
                        : await saveCentralAndMirrors('user', text, {
                            ...(affinityInputs.length > 0 ? { theaterAffinityInputs: affinityInputs } : {}),
                            ...(isContinueTurn ? { theaterContinue: true } : {}),
                        });
            if (!isReroll && !assistantOpening) await loadMessages();

            // 归档不能只放在成功生成之后：一旦会话已经碰到上游上下文上限，正文永远生成
            // 不出来，后置归档也就永远没有机会执行。重试已有 user 楼层时先归档，窗口可自愈。
            const automaticMemoryApiEnabled = entry.automaticMemoryApiEnabled === true;
            if (automaticMemoryApiEnabled && !entry.writesToCharacterMemory) reportStage('正在检查旧剧情归档…');
            const previousArchiveErrors = archiveErrorSeq.current;
            const archiveBeforeProse = automaticMemoryApiEnabled ? await archiveIfNeeded() : null;
            const promptEntry = archiveBeforeProse || entry;
            const failedArchiveBeforeProse = archiveErrorSeq.current !== previousArchiveErrors;

            const current = (await DB.getMessagesByCharId(threadId, true))
                .filter(message => message.metadata?.source === 'story_theater')
                .sort((a, b) => a.id - b.id);
            const turnBoundary = userMessageId || rerollTarget?.id || Infinity;
            const vectorSource = await loadStoryVectorRecall(promptEntry, turnBoundary)
                .then(source => selectStoryVectorRecall(source, modelText, automaticMemoryApiEnabled ? memoryPalaceConfig.embedding : undefined))
                .catch(error => {
                    console.warn('[StoryTheater] vector memory unavailable, reading original floors', error);
                    return { text: '', archiveIds: new Set<string>() };
                });
            let requestHistory = buildStoryRequestHistory(current, turnBoundary, message => {
                const box = storyArchiveAtFloor(promptEntry.archives, message.id);
                // Do not fall back to entire archived originals when vector recall misses.
                return box ? box.toMessageId < turnBoundary : mirrorArchived(message, promptEntry);
            });
            const historySlots = effectivePreset.document.prompts.filter(prompt => prompt.marker === 'history' && !prompt.section);
            const appendUnslottedHistory = historySlots.length === 0;
            const sendsHistory = appendUnslottedHistory || historySlots.some(prompt => prompt.enabled);
            if (sendsHistory && activeRegexRules.some(rule => storyRegexApplies(rule, 'history'))) {
                const floors = requestHistory.flatMap(({ row, message }, index) => {
                    if (row.metadata?.theaterContinue) return [];
                    const role = message.role === 'user' ? 'user' : 'assistant';
                    const input: StoryRegexInput = { role, text: role === 'user' ? row.content : message.content,
                        depth: requestHistory.length - index - 1 };
                    return activeRegexRules.some(rule => storyRegexApplies(rule, 'history', input)) ? [{ row, message, input }] : [];
                });
                const filtered = await runStoryRegex(floors.map(({ input }) => input), activeRegexRules, 'history', undefined, regexContext);
                const removed = new Set<StoryApiMessage>();
                floors.forEach(({ row, message, input }, index) => {
                    if (!filtered[index].text.trim()) removed.add(message);
                    else message.content = input.role === 'user'
                        ? appendStoryAffinityInputs(filtered[index].text, storyAffinityInputsFromMessage(row)) : filtered[index].text;
                });
                requestHistory = requestHistory.filter(({ message }) => !removed.has(message));
            }
            const latestAssistant = requestHistory[requestHistory.map(item => item.message.role).lastIndexOf('assistant')];
            const precedingFloor = requestHistory.at(-1);
            const turnFloor = current.findIndex(message => message.id === turnBoundary) + 1 || current.length + 1;

            reportStage('正在整理角色与剧情记忆…');
            const [actorContext, maskMemoryContext] = await Promise.all([
                buildActorContexts(modelText),
                buildMaskMemoryContext(modelText),
            ]);
            const vectorRecall = vectorSource.text;
            const floorNumbers = new Map(current.map((message, index) => [message.id, index + 1]));
            const summaries = selectStoryArchiveContext(promptEntry.archives, turnBoundary)
                .map((archive, index) => {
                    const first = floorNumbers.get(archive.fromMessageId), last = floorNumbers.get(archive.toMessageId);
                    const range = first && last ? '（第 ' + first + '–' + last + ' 楼）' : '';
                    return '事件盒 ' + (index + 1) + range + '：' + archive.summary;
                }).join('\n\n');
            const scenario = [
                `### 当前剧情\n标题：${entry.title}\n前提：${entry.premise || '沿用已经发生的正文自然继续。'}`,
            ].filter(Boolean).join('\n\n');
            const miniTheaterReminder = buildStoryMiniTheaterReminder(effectivePreset.document, promptIdentityName, actors.map(actor => actor.name));
            const backstageAftermathReminder = buildStoryBackstageAftermathReminder(effectivePreset.document);
            const multiAffinityGuide = affinityEnabled ? buildStoryMultiAffinityGuide(actors.map(actor => ({ id: actor.id, name: actor.name }))) : '';
            const affinityAwarenessReminder = affinityInputs.map(item => buildStoryAffinityAwarenessReminder(item, item.characterName || '当前角色')).filter(Boolean).join('\n\n');
            const identityGuard = buildStoryIdentityGuard(effectivePreset.document, promptIdentityName, actors.map(actor => actor.name));
            const modelInput = appendStoryAffinityInputs(modelText, affinityInputs);
            const historyMessages = requestHistory.map(({ message }) => message);
            const floorLabels = new Map<StoryApiMessage, string>(requestHistory.map(({ row, floor, message }) => [
                message,
                `第 ${floor} 楼 · ${message.role === 'user'
                    ? row.metadata?.theaterContinue ? '历史续写操作，无新增用户行动' : `${promptIdentityName}的历史推进`
                    : message === latestAssistant?.message ? '最近一段剧场正文' : '较早的剧场正文'}`,
            ]));
            const pendingTurn = { role: 'user' as const, content: modelInput };
            floorLabels.set(pendingTurn, isContinueTurn
                ? `本轮续写操作 · 第 ${turnFloor} 楼 · 无新增用户行动`
                : assistantOpening ? '开场生成指令 · 尚无用户行动' : `第 ${turnFloor} 楼 · 本轮用户推进`);
            const continuity = [
                '按楼号区分已发生的历史与本轮指令。角色记忆、事件盒、向量回忆、示例和附录用于补充背景。历史好感增减已经发生，不得重复计入本轮；标注未告知角色的数值和原因仍是幕后记录。',
                ...(summaries ? ['事件盒记录该楼段结束时的状态。关系、设定和场景若已在后续楼层变化，以较新的正文为准。旧约定和伏笔仅在仍未解决时继续承接。'] : []),
                ...(sendsHistory && latestAssistant ? [`第 ${latestAssistant.floor} 楼是生成位置之前最新的剧场正文，从其结尾承接当前场景与因果。`] : []),
                ...(sendsHistory && precedingFloor?.message.role === 'user' && !precedingFloor.row.metadata?.theaterContinue
                    ? [`第 ${precedingFloor.floor} 楼是本轮之前已有的用户推进，按楼号顺序一并承接。`] : []),
                isContinueTurn || assistantOpening
                    ? '执行本轮指令推进剧情，保留用户执笔权。'
                    : `直接回应第 ${turnFloor} 楼本轮用户推进，旧楼里的行动和对白按已发生的历史处理。`,
            ].join('\n');
            const regexInstructions = activeRegexRules.map(rule => storyRegexInstruction(rule, regexContext,
                [...requestHistory.slice(-6).map(({ message }) => message.content), modelText].join('\n'))).filter(Boolean);
            let compiled!: ReturnType<typeof compileStoryPreset>;
            const payload = ContextBuilder.buildWorldbookRequest<StoryApiMessage>({
                books: selectedBooks, userName: promptIdentityName, charName: actors.map(actor => actor.name).join('、'),
                history: [...(sendsHistory ? historyMessages : []), pendingTurn],
                render: slots => {
                    compiled = compileStoryPreset({
                        preset: effectivePreset, userName: promptIdentityName, characterNames: actors.map(actor => actor.name),
                        historyMessages,
                        currentInput: modelInput,
                        currentInputIsNewUserMessage: !isContinueTurn && !assistantOpening,
                        modelName: apiConfig.model,
                        continueRequested: isContinueTurn,
                        slots: {
                            actors: actorContext,
                            persona: [buildTheaterPersona(mask), maskMemoryContext].filter(Boolean).join('\n\n'),
                            scenario, worldBefore: slots.before, worldAfter: slots.after, history: '',
                            tavernDescription: entry.carryCharacterMemory ? actorContext
                                : actors.map(actor => `### ${actor.name}\n${actor.description || ''}`).join('\n\n'),
                            tavernPersonality: actors.map(actor => `### ${actor.name}\n${actor.systemPrompt || ''}\n${actor.worldview || ''}`).join('\n\n'),
                        },
                    });
                    const payloadBeforeTurn = [
                    ...compiled.messages,
                    // Story-owned archive context must work even with imported presets
                    // that have no enabled scenario slot or scenario macro.
                    ...(summaries ? [{ role: 'system' as const, content: '### 常驻事件盒\n' + summaries }] : []),
                    ...(vectorRecall ? [{ role: 'system' as const, content: buildStoryArchiveMemoryEnvelope(vectorRecall) }] : []),
                    ...(appendUnslottedHistory ? historyMessages : []),
                    ...(compiled.continueNudge ? [compiled.continueNudge] : []),
                    ...(compiled.nativeOverrideMessages || []),
                    ...(promptEntry.writesToCharacterMemory ? [{ role: 'system' as const, content: REAL_COMPANION_MEMORY_GUARD }] : []),
                    ...(backstageAftermathReminder ? [{ role: 'system' as const, content: backstageAftermathReminder }] : []),
                    ...(miniTheaterReminder ? [{ role: 'system' as const, content: miniTheaterReminder }] : []),
                    ...(multiAffinityGuide ? [{ role: 'system' as const, content: multiAffinityGuide }] : []),
                    ...(affinityEnabled ? [{ role: 'system' as const, content: RELATIONSHIP_TEXTURE_GUIDE }] : []),
                    ...(affinityAwarenessReminder ? [{ role: 'system' as const, content: affinityAwarenessReminder }] : []),
                    ...regexInstructions.map(content => ({ role: 'system' as const, content })),
                    { role: 'system' as const, content: identityGuard },
                    { role: 'system' as const, content: continuity },
                    ...(isReroll ? [{ role: 'system' as const, content: STORY_REROLL_INSTRUCTION }] : []),
                ];
                    // appendStoryUserTurn 保留预填充/兼容规则，再替换本轮消息为公共管线认识的引用。
                    const assembled = appendStoryUserTurn(payloadBeforeTurn, modelInput, compiled.assistantPrefill, promptEntry.forceUserLastMessage === true);
                    const pendingIndex = compiled.assistantPrefill && !promptEntry.forceUserLastMessage ? assembled.length - 2 : assembled.length - 1;
                    assembled[pendingIndex] = pendingTurn;
                    if (compiled.afterLatestUser?.length) {
                        // Depth 0 follows the current user turn in SillyTavern. For strict
                        // user-last APIs, place it immediately before the user instead.
                        assembled.splice(promptEntry.forceUserLastMessage ? pendingIndex : pendingIndex + 1, 0, ...compiled.afterLatestUser);
                    }
                    return effectivePreset.document.sourceFormat === 'sillytavern' && effectivePreset.document.squashSystemMessages
                        ? squashAdjacentSystemMessages(assembled)
                        : assembled;

                    },
            });
            if (promptEntry.forceUserLastMessage && payload.at(-1) !== pendingTurn) {
                // Depth-0 worldbook entries can follow the pending turn. Keep the
                // actual input last instead of adding a second, generic user turn.
                payload.splice(payload.indexOf(pendingTurn), 1);
                payload.push(pendingTurn);
            }
            const labeledPayload = payload.map(message => {
                // Match by identity after macros and worldbook activation consume the original text.
                const label = floorLabels.get(message);
                return label ? { ...message, content: `[${label}]\n${message.content}` } : message;
            });
            let promptTokenCount = estimateStoryTokens(labeledPayload.map(message => `${message.role}\n${message.content}`).join('\n'));
            let promptTokenCountExact = false;
            setContextTokens(promptTokenCount);
            setContextTokensExact(false);
            reportStage('正在后台生成剧情正文…');
            const { content: generated, interruption } = await callCompletion(labeledPayload, compiled.settings, reported => {
                promptTokenCount = reported;
                promptTokenCountExact = true;
                setContextTokens(reported);
                setContextTokensExact(true);
            });
            const prefill = !promptEntry.forceUserLastMessage && compiled.assistantPrefill && payload.includes(compiled.assistantPrefill)
                ? compiled.assistantPrefill.content : '';
            const rawContent = prefill && !generated.startsWith(prefill) ? `${prefill}${generated}` : generated;
            // 关系绝对值要承接最近一轮，即使那轮刚被折叠进事件盒，也不能回退到 50。
            const previousAssistantContent = latestAssistant?.row.content || '';
            const content = affinityEnabled && !interruption
                ? reconcileStoryAffinityScores(
                    rawContent,
                    previousAssistantContent,
                    affinityInputs,
                    actors.map(actor => ({ id: actor.id, name: actor.name })),
                )
                : rawContent;
            reportStage(interruption ? '正在保存已收到的剧情正文…' : '正在保存剧情正文…');
            const replyMetadata = {
                ...(effectivePreset.document.sourceFormat === 'sillytavern' ? { theaterSourceFormat: 'sillytavern' } : {}),
                theaterReplyToUserId: userMessageId,
                theaterInterruption: interruption,
                theaterInterruptedRewrite: undefined,
                theaterPromptTokens: promptTokenCount,
                theaterPromptTokensExact: promptTokenCountExact,
                ...(affinityInputs.length > 0 ? { theaterAffinityInputs: affinityInputs } : {}),
            };
            const fromTavern = effectivePreset.document.sourceFormat === 'sillytavern';
            const commit = async () => {
                if (isReroll && rerollTarget) {
                    if (mirrorArchived(rerollTarget, promptEntry)) throw new Error('这条回复已进入记忆归档，请刷新后查看');
                    if (interruption) {
                        await DB.updateMessageMetadata(rerollTarget.id, previous => ({
                            ...previous,
                            theaterInterruptedRewrite: { content, interruption, fromTavern },
                        }));
                    } else {
                        await replaceStoryTheaterReply(rerollTarget, content, replyMetadata);
                    }
                } else {
                    await saveCentralAndMirrors('assistant', content, replyMetadata);
                }
            };
            try { await commit(); }
            catch (error) { throw new StoryReplySaveError({ content, fromTavern, commit }, error); }
            if (!isReroll && !isContinueTurn) setInput('');
            setAffinityDrafts({});
            setShowAffinityInput(false);
            await loadMessages().catch(error => addToast(`正文已保存，页面读取失败：${error?.message || error}`, 'error'));
            if (interruption || !automaticMemoryApiEnabled) return;
            reportStage('剧情正文已保存，正在整理后续记忆…');
            if (entry.writesToCharacterMemory) {
                await applyActorMemoryPipeline().catch(error => addToast(`正文已保存，角色记忆整理失败：${error?.message || error}`, 'error'));
            }
            // A failed preflight can already have billed the secondary provider.
            // Do not issue a second summary request for the same source batch
            // merely because the expensive prose generation has now succeeded.
            else if (!archiveBeforeProse && !failedArchiveBeforeProse) await archiveIfNeeded(promptEntry);
        } catch (error: any) {
            const message = String(error?.message || error);
            console.error('[StoryTheater] send failed', message);
            const hint = message.includes('API Error 400') && isStoryUserLastCompatibilityError(message) && !entry.forceUserLastMessage
                ? '。可在右上角设置开启“400 兼容模式”'
                : '';
            addToast(error instanceof StoryReplySaveError ? message : `剧情续写失败：${message}${hint}`, 'error');
            // The registry stores failures so a remounted screen can show
            // a retry state even after the original toast/owner unmounted.
            throw error;
        }
        }, () => {
            sendLock.current = false;
            setSending(false);
            setRerollingId(null);
        });
        if (!started) {
            sendLock.current = false;
            setSending(false);
            setRerollingId(null);
        }
    }, [canStart, activeRegexRules, actors, addToast, affinityDrafts, affinityEnabled, apiConfig, applyActorMemoryPipeline, archiveIfNeeded, buildActorContexts, buildMaskMemoryContext, callCompletion, effectivePreset, entry, input, loadMessages, mask, memoryPalaceConfig.embedding, promptIdentityName, regexContext, saveCentralAndMirrors, selectedBooks, threadId]);

    const generationBusy = sending || backgroundTask?.phase === 'running';
    const unsavedReply = backgroundTask?.unsavedReply;
    const regexSources = useMemo(() => {
        const sources = new Map<string, StoryRegexInput>();
        const add = (key: string, input: StoryRegexInput) => {
            if (activeRegexRules.some(rule => storyRegexApplies(rule, 'display', input))) sources.set(key, input);
        };
        for (const [index, message] of messages.entries()) {
            if (message.role !== 'assistant' && message.role !== 'user' || message.metadata?.theaterContinue) continue;
            const depth = messages.length - index - 1;
            const archived = mirrorArchived(message, entry);
            if (archived && !expandedArchivedIds.has(message.id)) continue;
            const original = archived ? archiveBodies.get(message.id) : message;
            if (!original) continue;
            const role = message.role;
            add(String(message.id), { text: archived ? storyReadingSource(original) : original.content, role, depth });
            const interrupted = message.metadata?.theaterInterruptedRewrite?.content;
            if (interrupted && !archived) add(`${message.id}:rewrite`, { text: interrupted, role: 'assistant', depth });
        }
        if (unsavedReply) add('unsaved', { text: unsavedReply.content, role: 'assistant', depth: 0 });
        return sources;
    }, [activeRegexRules, archiveBodies, entry, expandedArchivedIds, messages, unsavedReply]);
    const [regexDisplay, setRegexDisplay] = useState<{
        rules: StoryRegexRule[]; context: typeof regexContext;
        results: Map<string, { input: StoryRegexInput; result: StoryRegexResult }>;
    }>();
    const regexDisplayRef = useRef(regexDisplay);
    regexDisplayRef.current = regexDisplay;
    useEffect(() => {
        if (!regexSources.size) return;
        const controller = new AbortController();
        const previous = regexDisplayRef.current;
        const reuse = previous?.rules === activeRegexRules && previous.context === regexContext;
        const depthSensitive = activeRegexRules.some(rule => rule.source?.minDepth !== undefined || rule.source?.maxDepth !== undefined);
        const results = new Map<string, { input: StoryRegexInput; result: StoryRegexResult }>();
        const pending = [...regexSources].filter(([key, input]) => {
            const cached = reuse ? previous?.results.get(key) : undefined;
            if (cached && cached.input.text === input.text && (!depthSensitive || cached.input.depth === input.depth)) {
                results.set(key, { input, result: cached.result });
                return false;
            }
            return true;
        });
        const commit = () => {
            if (!controller.signal.aborted) setRegexDisplay({ rules: activeRegexRules, context: regexContext, results: new Map(results) });
        };
        void (async () => {
            try {
                for (let offset = 0; offset < pending.length && !controller.signal.aborted; offset += 24) {
                    const batch = pending.slice(offset, offset + 24);
                    const converted = await runStoryRegex(batch.map(([, input]) => input), activeRegexRules, 'display', controller.signal, regexContext);
                    batch.forEach(([key, input], index) => results.set(key, { input, result: converted[index] }));
                    // Partial commits expand older floors in waves and make the viewport flicker.
                    if (offset + 24 >= pending.length) commit();
                }
                if (!pending.length && reuse && previous?.results.size !== results.size) commit();
            } catch (error) {
                if (controller.signal.aborted) return;
                for (const [key, input] of pending) {
                    if (!results.has(key)) results.set(key, { input, result: { text: input.text, cards: [], matches: 0 } });
                }
                commit();
                addToast(`剧情正则显示失败，已显示受影响楼层的原文：${error instanceof Error ? error.message : '正则处理失败'}`, 'error');
            }
        })();
        return () => controller.abort();
    }, [activeRegexRules, addToast, regexContext, regexSources]);
    const regexResultFor = (key: string) => {
        const input = regexSources.get(key);
        if (!input) return undefined;
        // Keep an already-filtered floor visible while a refreshed macro
        // context is calculated. Never replace the old content with an empty
        // placeholder after it was displayed; doing so flashes every floor.
        const cached = regexDisplay?.rules === activeRegexRules
            ? regexDisplay.results.get(key) : undefined;
        if (cached?.input.text === input.text && (cached.input.depth === input.depth
            || !activeRegexRules.some(rule => rule.source?.minDepth !== undefined || rule.source?.maxDepth !== undefined))) return cached.result;
        // On first paint, wait for the new filter; never show unfiltered text.
        return PENDING_STORY_REGEX_RESULT;
    };

    const initialReadingReady = useMemo(() => {
        if (!regexSources.size) return true;
        if (regexDisplay?.rules !== activeRegexRules || regexDisplay.context !== regexContext) return false;
        const depthSensitive = activeRegexRules.some(rule => rule.source?.minDepth !== undefined || rule.source?.maxDepth !== undefined);
        return [...regexSources].every(([key, input]) => {
            const displayed = regexDisplay.results.get(key);
            return displayed?.input.text === input.text && (!depthSensitive || displayed.input.depth === input.depth);
        });
    }, [activeRegexRules, regexContext, regexDisplay, regexSources]);
    // Mount the reading floors only once the complete initial history and
    // display-regex results exist. Otherwise hundreds of empty/temporary
    // floors and sandbox frames are painted, resized and replaced in waves.
    // Once mounted, never hide them again during edits or later regex updates.
    const readingContentReady = initialReadingDisplayed || (historyLoaded && initialReadingReady);
    useLayoutEffect(() => {
        if (!readingContentReady || !initialReadingPendingRef.current) return;
        initialReadingPendingRef.current = false;
        // Only one initial jump, after the real floor heights have mounted.
        if (messages.length && !initialReadingGestureRef.current) scrollReadingToLatest();
        setInitialReadingDisplayed(true);
    }, [readingContentReady, messages.length, scrollReadingToLatest]);

    const generationBlocked = generationBusy || !!unsavedReply;
    const floorIndexOffset = Math.max(0, totalFloorCount - messages.length);
    const archivedCount = messages.filter(message => mirrorArchived(message, entry)).length;
    const pendingRetryInput = getPendingStoryRetryInput(messages, entry.archives);
    const canWriteOpening = messages.length === 0 && entry.openingMode === 'assistant';
    const filledAffinityActorIds = actors.filter(actor => {
        const draft = affinityDrafts[actor.id];
        return Boolean(draft && (draft.delta !== 0 || draft.reason.trim()));
    }).map(actor => actor.id);
    const selectedAffinityActor = actors.find(actor => actor.id === selectedAffinityActorId) || actors[0];
    const selectedAffinityDraft = selectedAffinityActor ? (affinityDrafts[selectedAffinityActor.id] || EMPTY_AFFINITY_DRAFT) : EMPTY_AFFINITY_DRAFT;
    // Scrolling changes the header's visibleFloor state many times per second.
    // Keep the expensive story body and its iframe props referentially stable.
    // Normalizing the actors array on a global clock update must not allocate
    // new affinity props for every old floor. Only ID/name affect this display.
    const actorIdentityKey = actors.map(actor => actor.id + ':' + actor.name).join('|');
    const affinityInputsByMessageId = useMemo(() => new Map(messages.filter(message => message.role === 'assistant')
        .map(message => [message.id, storyAffinityInputsFromMessage(message, actors)] as const)), [messages, actorIdentityKey]);

    return <div className='relative h-full w-full flex flex-col bg-stone-100 text-slate-800'>
        <header className='story-safe-header shrink-0 bg-stone-100/95 backdrop-blur border-b border-slate-200 z-10'>
            <div className='h-16 px-4 flex items-center gap-3'>
                <button onClick={onBack} className='w-9 h-9 rounded-full grid place-items-center'><ArrowLeft size={20} /></button>
                <div className='min-w-0 flex-1'><div className='text-[9px] tracking-[.24em] uppercase font-bold text-violet-500'>Story theater</div><h1 className='font-serif font-semibold truncate'>{entry.title}</h1></div>
                {onOpenArchives && <button disabled={generationBusy || !!memoryStatus} onClick={onOpenArchives} className='w-9 h-9 rounded-full grid place-items-center text-violet-600 disabled:opacity-30' title='本剧情事件盒' aria-label='本剧情事件盒'><Archive size={18} /></button>}
                {onOpenVectorMemory && <button onClick={onOpenVectorMemory} className='w-9 h-9 rounded-full grid place-items-center text-violet-600' title='本剧情向量记忆' aria-label='本剧情向量记忆'><Database size={18} /></button>}
                <button disabled={exporting || messages.length === 0} onClick={() => void exportStory()} className='w-9 h-9 rounded-full grid place-items-center text-violet-600 disabled:opacity-30' title='导出全部剧情原文' aria-label='导出全部剧情原文'>{exporting ? <SpinnerGap size={18} className='animate-spin' /> : <DownloadSimple size={18} />}</button>
                <StoryAppearanceButton />
                <button onClick={onEdit} className='w-9 h-9 rounded-full grid place-items-center'><GearSix size={19} /></button>
            </div>
            <div className='flex items-start gap-1 px-4 pb-3'>
            <details className='group min-w-0 flex-1'>
                <summary className='list-none cursor-pointer px-1 flex items-center gap-3'>
                    <span className='flex -space-x-1.5 shrink-0'>{mask.avatar ? <TokenImg value={mask.avatar} alt='' className='w-7 h-7 rounded-full object-cover border-2 border-stone-100 relative z-10' /> : <span className='w-7 h-7 rounded-full bg-violet-100 text-violet-700 border-2 border-stone-100 grid place-items-center text-[9px] font-bold relative z-10'>{mask.name.slice(0, 1)}</span>}{actors.slice(0, 2).map(actor => actor.avatar
                        ? <TokenImg key={actor.id} value={actor.avatar} alt='' className='w-7 h-7 rounded-full object-cover border-2 border-stone-100' />
                        : <span key={actor.id} aria-hidden='true' className='w-7 h-7 rounded-full bg-slate-200 text-slate-600 border-2 border-stone-100 grid place-items-center text-[9px] font-semibold'>{actor.name?.slice(0, 1) || '角'}</span>)}</span>
                    <span className='min-w-0 flex-1'><strong className='block truncate text-[11px] text-slate-700'>{youLabel} · 角色：{actors.map(actor => actor.name).join('、')}</strong><span className='block mt-0.5 truncate text-[9px] text-slate-400'>{entry.writesToCharacterMemory ? '真实时间陪伴' : '虚构剧场'}{activeMiniTheater ? ` · ${activeMiniTheater.name.replace(/^\S+小剧场[｜·]?\s*/, '')}` : ''}</span></span>
                    <span className='shrink-0 text-right leading-tight'>
                        <span className='block text-[9px] font-bold text-slate-400' title={displayedTokenInfo.exact ? '本轮实际使用的完整上下文' : '按本轮完整上下文估算'}>{displayedTokenInfo.count > 0 ? `${(displayedTokenInfo.count / 1000).toFixed(displayedTokenInfo.count >= 10000 ? 0 : 1)}k` : '—'}</span>
                        {messages.length > 0 && <span aria-label={`当前第 ${visibleFloor || 1} 楼，共 ${totalFloorCount} 楼`} className='mt-1 block whitespace-nowrap text-[9px] font-medium tabular-nums text-slate-400'>第 {visibleFloor || 1}/{totalFloorCount} 楼</span>}
                    </span>
                    <CaretDown size={13} className='shrink-0 text-slate-400 transition-transform group-open:rotate-180' />
                </summary>
                <div className='mx-5 mb-3 pt-3 border-t border-slate-200 grid grid-cols-2 gap-x-6 gap-y-3 text-[10px]'>
                    <div><span className='block text-[8px] font-bold text-slate-400'>你</span><span className='block mt-1 truncate text-slate-600'>{mask.selection.type === 'user' ? '本人' : mask.name}</span></div>
                    <div><span className='block text-[8px] font-bold text-slate-400'>记忆方式</span><span className='block mt-1 truncate text-slate-600'>{entry.writesToCharacterMemory ? '写入角色记忆' : entry.archiveStrategy === 'summary' ? '独立事件盒' : '独立向量分区'}</span></div>
                    <div><span className='block text-[8px] font-bold text-slate-400'>结尾模块</span><span className='block mt-1 truncate text-slate-600'>{activeMiniTheater?.name || '未启用小剧场'}</span></div>
                    <div><span className='block text-[8px] font-bold text-slate-400'>完整上下文</span><span className='block mt-1 truncate text-slate-600'>{displayedTokenInfo.count > 0 ? `${generationBusy ? '本轮' : '上轮'}${displayedTokenInfo.exact ? '使用' : '估算'} ${displayedTokenInfo.count.toLocaleString()} tokens` : '推进时统计全部内容'}</span></div>
                    <div><span className='block text-[8px] font-bold text-slate-400'>API 兼容</span><span className={`block mt-1 truncate ${entry.forceUserLastMessage ? 'font-semibold text-amber-700' : 'text-slate-600'}`}>{entry.forceUserLastMessage ? '400 兼容模式' : '原生预填（推荐）'}</span></div>
                    <div><span className='block text-[8px] font-bold text-slate-400'>采样参数</span><span className={`block mt-1 truncate ${entry.omitSamplingParams ? 'font-semibold text-amber-700' : 'text-slate-600'}`}>{entry.omitSamplingParams ? '不发送高级参数' : '完整发送预设参数'}</span></div>
                </div>
            </details>
            <button type='button' onClick={() => setShowQuickPreset(true)} className='grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 active:bg-slate-200' title='本剧情快速预设' aria-label='本剧情快速预设'><SlidersHorizontal size={16} /></button>
            {messages.length > 0 && !atReadingEnd && <button type='button' onClick={() => scrollReadingToLatest('auto')} className='grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 active:bg-slate-200' aria-label='回到最新楼层' title='回到最新楼层'><ArrowDown size={16} /></button>}
            </div>
        </header>

        <main ref={readingScrollRef} onScroll={handleReadingScroll} onWheel={pauseFollowingForReading} onTouchStart={pauseFollowingForReading} className='meeting-reading-page story-page-scroll min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-7' style={{ scrollBehavior: 'auto', scrollSnapType: 'none', touchAction: 'pan-y', overflowAnchor: 'auto' }}>
            <div ref={readingContentRef} className='max-w-2xl mx-auto'>
                {!readingContentReady ? <div role='status' className='py-10 text-center text-xs text-slate-400'>正在恢复剧情…</div> : <>
                {messages.length === 0 ? <section className='py-10 border-y border-slate-200'>
                    <div className='text-[9px] tracking-[.25em] uppercase font-bold text-violet-500'>Opening note</div>
                    <h2 className='mt-3 text-3xl font-serif font-semibold leading-tight'>{entry.title}</h2>
                    <p className='mt-5 text-sm leading-7 text-slate-600 whitespace-pre-wrap'>{entry.premise || (canWriteOpening ? '人物与世界已经就位，可以让故事先写下第一幕。' : '写下第一句话，让人物走进这座只属于本条剧情的剧场。')}</p>
                    <p className='mt-6 text-[10px] text-slate-400'>{canWriteOpening ? '输入框留空，点击推进即可开场' : '这一幕由你先落笔'}</p>
                </section> : entry.writesToCharacterMemory && <div className='mb-8 py-3 border-y border-amber-200 text-center text-[11px] text-amber-700'>和朋友们已经分别相处了一段时间……</div>}

                {messages.length < totalFloorCount && <div className='story-load-more mb-8 flex items-center justify-center'>
                    <button type='button' data-story-load-more='true' onClick={loadOlderFloors} disabled={loadingOlder}
                        className='story-load-more-button shrink-0 rounded-full px-3 py-2 text-[11px] font-medium tracking-[.06em] text-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50'>
                        {loadingOlder ? '加载中…' : `加载更早 ${Math.min(readingBatchSize, totalFloorCount - messages.length)} 层`}
                    </button>
                </div>}

                <div className='divide-y divide-slate-200'>
                    {messages.map((message, floorIndex) => {
                        const archived = mirrorArchived(message, entry);
                        const floorHeading = <div className='mb-5 flex items-baseline gap-2.5 text-[10px] tracking-[.08em] text-slate-400'>
                            <span className='font-semibold tabular-nums text-slate-500'>{String(floorIndexOffset + floorIndex + 1).padStart(2, '0')}</span>
                            <span aria-hidden='true' className='text-slate-300'>/</span>
                            <span>{message.role === 'user' ? '你的推进' : '剧场正文'}</span>
                        </div>;
                        if (archived) {
                            const groupKey = storyArchiveGroupKey(message, entry);
                            const previous = messages[floorIndex - 1];
                            if (previous && mirrorArchived(previous, entry)
                                && storyArchiveGroupKey(previous, entry) === groupKey) return null;
                            let nextIndex = floorIndex + 1;
                            while (nextIndex < messages.length
                                && mirrorArchived(messages[nextIndex], entry)
                                && storyArchiveGroupKey(messages[nextIndex], entry) === groupKey) nextIndex++;
                            const archivedRows = messages.slice(floorIndex, nextIndex);
                            const groupAnchor = `archive:${groupKey}:${archivedRows[archivedRows.length - 1].id}`;
                            const isExpanded = archivedRows.some(row => expandedArchivedIds.has(row.id));
                            const box = storyArchiveAtFloor(entry.archives, message.id);
                            const archiveLabel = box?.strategy === 'vector'
                                ? '独立向量归档' : box ? '事件盒归档' : '角色记忆归档';
                            return <div key={groupAnchor} data-story-floor={floorIndexOffset + floorIndex + 1}
                                data-story-anchor={groupAnchor} className='story-reading-floor story-archive-range scroll-mt-16 py-7'>
                                <details open={isExpanded}
                                    onToggle={event => setArchiveExpanded(archivedRows.map(row => row.id), event.currentTarget.open)}
                                    className='group'>
                                    <summary className='story-archive-summary flex min-h-12 cursor-pointer list-none items-center justify-center gap-2.5 py-3 text-[11px] font-medium tracking-[.04em] text-slate-500 [&::-webkit-details-marker]:hidden'>
                                        <Archive size={13} className='shrink-0 opacity-60' />
                                        <span className='shrink-0 tabular-nums'>第 {floorIndexOffset + floorIndex + 1}–{floorIndexOffset + nextIndex} 楼</span>
                                        <span className='shrink-0 text-slate-400' title={archiveLabel}>已归档</span>
                                        <CaretDown size={13} className='shrink-0 opacity-60 group-open:rotate-180' />
                                    </summary>
                                    {isExpanded && <div className='story-archive-content mt-3 px-1 sm:px-3'>
                                        {archivedRows.map((row, index) => {
                                            const original = archiveBodies.get(row.id);
                                            return <section key={row.id} className='border-b border-slate-100 py-5 last:border-0'>
                                                <div className='mb-3 text-[10px] text-slate-400'>第 {floorIndexOffset + floorIndex + index + 1} 楼 · {row.role === 'user' ? '你的推进' : '剧场正文'}</div>
                                                {!original ? <p className='py-3 text-xs text-slate-400'>{archiveReadErrors.has(row.id) ? '原文暂不可读取' : '正在读取原文…'}</p>
                                                    : original.role === 'user'
                                                        ? <StoryUserOutput className='whitespace-pre-wrap break-words text-sm leading-7 text-slate-600' content={original.content} regexResult={regexResultFor(String(original.id))} />
                                                        : <StoryOutputBody reading={storyReadingActive} content={storyReadingSource(original)} regexResult={regexResultFor(String(original.id))} fromTavern={original.metadata?.theaterSourceFormat === 'sillytavern' || (!original.metadata?.theaterSourceFormat && looksLikeLegacyTavernStoryOutput(original.content))} affinityInputs={affinityInputsByMessageId.get(original.id) || EMPTY_AFFINITY_INPUTS} />}
                                            </section>;
                                        })}
                                    </div>}
                                </details>
                            </div>;
                        }
                        const floorBody = (() => {
                        if (message.role === 'user') return <section {...pressHandlersFor(message)} className='meeting-user-turn pl-4 border-l-2 border-violet-300'><div className='meeting-user-label text-[9px] tracking-[.16em] font-bold text-violet-500'>你写下</div><StoryUserOutput className='meeting-prose mt-2 text-sm leading-7 text-slate-600 whitespace-pre-wrap' content={message.content} regexResult={regexResultFor(String(message.id))} /></section>;
                        const isLatest = message.id === messages[messages.length - 1]?.id;
                        const interruptedRewrite = message.metadata?.theaterInterruptedRewrite;
                        return <article {...pressHandlersFor(message)}>
                            {message.metadata?.theaterInterruption && <p className='mb-3 text-xs leading-5 text-amber-700'>已保留收到的正文。{message.metadata.theaterInterruption}。可点击「继续」接着写。</p>}
                            <StoryOutputBody reading={storyReadingActive} content={message.content} regexResult={regexResultFor(String(message.id))} fromTavern={message.metadata?.theaterSourceFormat === 'sillytavern' || (!message.metadata?.theaterSourceFormat && looksLikeLegacyTavernStoryOutput(message.content))} onChoose={setInput} affinityInputs={affinityInputsByMessageId.get(message.id) || EMPTY_AFFINITY_INPUTS} />
                            {interruptedRewrite && <details className='mt-3 text-xs leading-5 text-amber-700'>
                                <summary>查看未写完的改写稿 · 原楼层已保留</summary>
                                <p className='my-2'>{interruptedRewrite.interruption}</p>
                                <StoryOutputBody reading={storyReadingActive} content={interruptedRewrite.content} regexResult={regexResultFor(`${message.id}:rewrite`)} fromTavern={interruptedRewrite.fromTavern} affinityInputs={[]} />
                            </details>}
                            {isLatest && !message.metadata?.theaterOpeningGreeting && <div className='mt-4 flex items-center justify-end gap-2'><span className='w-1.5 h-1.5 rounded-full bg-violet-400' /><button disabled={generationBlocked} onClick={() => void send(message)} className='inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-200 bg-white text-[10px] font-bold text-slate-500 disabled:opacity-40'>{rerollingId === message.id ? <SpinnerGap size={12} className='animate-spin' /> : <ArrowClockwise size={12} />}换一种写法</button></div>}</article>;
                        })();
                        return <div key={message.id} data-story-anchor={`floor:${message.id}`} data-story-floor={floorIndexOffset + floorIndex + 1} className='story-reading-floor scroll-mt-16 py-8 first:pt-0 last:pb-0'>
                            {floorHeading}
                            {floorBody}
                        </div>;
                    })}
                </div>
                {unsavedReply && <section className='mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4'>
                    <p role='status' className='mb-2 text-xs text-amber-800'>已收到的正文暂存在此页面，请先复制或重试本地保存。</p>
                    <StoryOutputBody reading={storyReadingActive} content={unsavedReply.content} regexResult={regexResultFor('unsaved')} fromTavern={unsavedReply.fromTavern} affinityInputs={[]} />
                    <div className='mt-3 flex gap-3 text-xs font-semibold text-violet-700'>
                        <button onClick={() => Promise.resolve().then(() => navigator.clipboard.writeText(unsavedReply.content))
                            .then(() => addToast('已复制正文', 'success'))
                            .catch(error => addToast(`复制失败：${error?.message || error}`, 'error'))}>复制正文</button>
                        <button disabled={generationBusy} onClick={() => retryUnsavedStoryReply(entry.id)}>重试本地保存</button>
                    </div>
                </section>}
                {archivedCount > 0 && <div className='mt-10 flex items-center justify-center gap-2 text-[9px] text-slate-400'><Archive size={13} />{archivedCount} 条旧内容已归档，可展开查看</div>}
                <div className='h-6' />
                </>}
            </div>
        </main>

        <footer className='story-safe-footer shrink-0 px-4 pt-3 bg-stone-100/95 backdrop-blur border-t border-slate-200'>
            <div className='max-w-2xl mx-auto'>
                {memoryStatus && <div className='mb-2 flex items-center gap-2 text-[10px] text-violet-600'><SpinnerGap size={13} className='animate-spin' />{memoryStatus}</div>}
                {backgroundTask?.phase === 'running' && <div role='status' className='mb-2 flex items-center gap-2 text-[10px] text-violet-600'><SpinnerGap size={13} className='animate-spin' />{backgroundTask.stage} · 可切换到其他页面，完成后自动保存</div>}
                {backgroundTask?.phase === 'failed' && <div role='alert' className='mb-2 text-[10px] text-rose-600'>上次剧情未完成：{backgroundTask.error || '请求异常'}。{unsavedReply ? '可以重试本地保存。' : '原推进已保留。糯米机未自动重发。'}</div>}
                {!generationBlocked && !memoryStatus && !input.trim() && pendingRetryInput && <div className='mb-2 text-[10px] text-violet-600'>上次续写可能中断了，点击推进即可继续</div>}
                {!generationBusy && !memoryStatus && canWriteOpening && <div className='mb-2 text-[10px] text-violet-600'>准备好了，点击推进让故事写下第一幕</div>}
                {affinityEnabled && <div className='mb-2 overflow-hidden rounded-2xl border border-rose-200 bg-rose-50/70'>
                    <button type='button' aria-expanded={showAffinityInput} onClick={() => setShowAffinityInput(value => !value)} className='w-full px-3 py-2.5 flex items-center gap-2 text-left'>
                        <HeartStraight size={15} weight={filledAffinityActorIds.length > 0 ? 'fill' : 'regular'} className='text-rose-500' />
                        <span className='min-w-0 flex-1'><strong className='block text-[10px] text-rose-800'>这轮关系备注 · 可选</strong><span className='block mt-0.5 truncate text-[9px] text-rose-500'>{filledAffinityActorIds.length > 0 ? `已填写 ${filledAffinityActorIds.length} 位：${actors.filter(actor => filledAffinityActorIds.includes(actor.id)).map(actor => actor.name).join('、')}` : '先选择角色，再分别填写你对 TA 的变化'}</span></span>
                        <span className='text-[9px] font-bold text-rose-500'>{showAffinityInput ? '收起' : '填写'}</span>
                    </button>
                    {showAffinityInput && <div className='px-3 pb-3 border-t border-rose-200/70'>
                        <div className='pt-3 flex gap-2 overflow-x-auto'>{actors.map(actor => { const filled = filledAffinityActorIds.includes(actor.id); const selected = selectedAffinityActor?.id === actor.id; return <button key={actor.id} type='button' onClick={() => setSelectedAffinityActorId(actor.id)} className={`shrink-0 px-2.5 py-2 rounded-xl flex items-center gap-2 border text-[10px] font-bold ${selected ? 'bg-white border-rose-300 text-rose-700' : 'border-transparent text-slate-500'}`}><TokenImg value={actor.avatar} alt='' className='w-6 h-6 rounded-full object-cover' /><span>{actor.name}</span><span className={`w-1.5 h-1.5 rounded-full ${filled ? 'bg-rose-500' : 'bg-slate-200'}`} /></button>; })}</div>
                        {selectedAffinityActor && <div className='mt-3 pt-3 border-t border-rose-200/70'>
                            <div className='flex items-center justify-between gap-3'><div><span className='block text-[9px] font-bold text-rose-700'>你 → {selectedAffinityActor.name}</span><span className='block mt-0.5 text-[8px] text-slate-400'>这一栏只改变你和这位角色的关系</span></div><button type='button' onClick={() => setAffinityDrafts(current => { const next = { ...current }; delete next[selectedAffinityActor.id]; return next; })} className='text-[9px] font-bold text-slate-400'>清空这位</button></div>
                            <div className='mt-3 flex items-center gap-3'><span className='text-[9px] font-bold text-rose-600'>变化</span><input disabled={generationBlocked} type='range' min={-10} max={10} step={1} value={selectedAffinityDraft.delta} onChange={event => patchAffinityDraft(selectedAffinityActor.id, { delta: Number(event.target.value) })} className='min-w-0 flex-1 accent-rose-500' /><strong className={`w-8 text-right text-xs ${selectedAffinityDraft.delta > 0 ? 'text-rose-600' : selectedAffinityDraft.delta < 0 ? 'text-slate-600' : 'text-slate-400'}`}>{selectedAffinityDraft.delta >= 0 ? '+' : ''}{selectedAffinityDraft.delta}</strong></div>
                            <input disabled={generationBlocked} maxLength={200} value={selectedAffinityDraft.reason} onChange={event => patchAffinityDraft(selectedAffinityActor.id, { reason: event.target.value })} placeholder={`为什么你对 ${selectedAffinityActor.name} 有这点变化？`} className='mt-2 w-full px-3 py-2.5 rounded-xl bg-white border border-rose-200 text-xs outline-none placeholder:text-slate-300' />
                            <div className='mt-2 grid grid-cols-2 p-1 rounded-xl bg-white border border-rose-200'><button type='button' disabled={generationBlocked} onClick={() => patchAffinityDraft(selectedAffinityActor.id, { awareness: 'unnoticed' })} className={`py-2 rounded-lg text-[9px] font-bold ${selectedAffinityDraft.awareness === 'unnoticed' ? 'bg-slate-100 text-slate-700' : 'text-slate-400'}`}><span className='inline-flex items-center gap-1'><EyeSlash size={12} />未察觉 · 只变氛围</span></button><button type='button' disabled={generationBlocked} onClick={() => patchAffinityDraft(selectedAffinityActor.id, { awareness: 'noticed' })} className={`py-2 rounded-lg text-[9px] font-bold ${selectedAffinityDraft.awareness === 'noticed' ? 'bg-violet-100 text-violet-700' : 'text-slate-400'}`}><span className='inline-flex items-center gap-1'><Eye size={12} />已察觉 · 完全透视</span></button></div>
                            <div className='mt-2 text-[9px] leading-4 text-rose-500'>可以继续点另一位角色填写；没有填写的角色本轮保持原关系。</div>
                        </div>}
                    </div>}
                </div>}
                <div className='flex items-end gap-2 p-2 rounded-2xl bg-white border border-slate-200 shadow-sm'>
                    <button type='button' onClick={() => void send(undefined, true)} disabled={generationBlocked || !canStart} className='self-end h-11 shrink-0 px-3 rounded-xl border border-violet-200 bg-violet-50 text-violet-700 text-xs font-bold active:scale-95 transition-transform disabled:opacity-30' title='本轮不主动行动，让剧情按当前预设继续' aria-label='继续当前剧情'>继续</button>
                    <textarea value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void send(); } }} disabled={generationBlocked} rows={2} placeholder={pendingRetryInput ? '留空并点击推进，可继续上次中断' : canWriteOpening ? '也可以先写一句；留空推进则由故事开场' : '写下动作、对白、时间跳转，或你希望故事发生的事……'} className='min-w-0 min-h-12 max-h-36 flex-1 px-2 py-2 bg-transparent text-sm leading-6 resize-none outline-none disabled:opacity-50' />
                    <button onClick={() => void send()} disabled={generationBlocked || (!input.trim() && !pendingRetryInput && !canWriteOpening)} title={!input.trim() && pendingRetryInput ? '继续上次中断' : canWriteOpening && !input.trim() ? '让故事先开场' : '推进'} className='story-send-button self-end w-11 h-11 shrink-0 rounded-xl bg-slate-900 text-white grid place-items-center disabled:opacity-30'>{generationBusy ? <SpinnerGap size={18} className='animate-spin' /> : <PaperPlaneTilt size={18} weight='fill' />}</button>
                </div>
                <div className='mt-2 text-center text-[9px] text-slate-400'>Ctrl / ⌘ + Enter 推进 · 长按楼层可编辑或删除</div>
            </div>
        </footer>
        {showQuickPreset && <StoryQuickPresetPanel
            document={effectivePreset.document}
            hasOverride={Boolean(entry.presetOverride)}
            onApply={async document => { await onEntryChange({ ...entry, presetOverride: document, updatedAt: Date.now() }); addToast('快捷预设已应用到本剧情', 'success'); }}
            onReset={async () => { await onEntryChange({ ...entry, presetOverride: undefined, updatedAt: Date.now() }); addToast('已恢复本剧情的原预设', 'info'); }}
            onClose={() => setShowQuickPreset(false)}
        />}
        {messageMenu && <div className='fixed inset-0 z-[70] flex items-end bg-slate-900/25' onClick={() => setMessageMenu(null)}>
            <div className='story-safe-sheet w-full rounded-t-3xl bg-stone-100 px-5 pt-4 shadow-2xl' onClick={event => event.stopPropagation()}>
                <div className='mx-auto mb-4 h-1 w-9 rounded-full bg-slate-300' />
                <div className='flex items-start justify-between gap-4'><div><div className='text-[9px] tracking-[.18em] font-bold text-violet-500'>{messageMenu.role === 'user' ? '你的推进' : '剧场正文'}</div><p className='mt-1 max-w-[75vw] truncate text-xs text-slate-500'>{hideStoryStatusForDisplay(messageMenu.content).replace(/<[^>]+>/g, ' ').trim()}</p></div><button onClick={() => setMessageMenu(null)} className='w-8 h-8 rounded-full grid place-items-center text-slate-400'><X size={16} /></button></div>
                <div className='mt-5 divide-y divide-slate-200 border-y border-slate-200'><button onClick={() => { setEditingMessage(messageMenu); setEditDraft(messageMenu.content); setMessageMenu(null); }} className='w-full py-4 flex items-center gap-3 text-left'><PencilSimple size={17} className='text-violet-600' /><span><strong className='block text-xs text-slate-700'>编辑这一层</strong><span className='block mt-0.5 text-[9px] text-slate-400'>{entry.writesToCharacterMemory ? '同步修改每位角色收到的镜像内容' : '只修改本剧情沙盒'}</span></span></button><button onClick={() => { setDeletingMessage(messageMenu); setMessageMenu(null); }} className='w-full py-4 flex items-center gap-3 text-left'><Trash size={17} className='text-rose-500' /><span><strong className='block text-xs text-rose-600'>删除这一层</strong><span className='block mt-0.5 text-[9px] text-slate-400'>不会自动删除相邻的推进或正文</span></span></button></div>
            </div>
        </div>}
        {editingMessage && <div className='fixed inset-0 z-[75] flex items-end overflow-y-auto overscroll-contain bg-slate-900/30' onClick={() => !mutatingMessage && setEditingMessage(null)}>
            <div className='story-safe-sheet story-keyboard-sheet flex max-h-full w-full flex-col overflow-y-auto overscroll-contain rounded-t-3xl bg-stone-100 px-5 pt-5 shadow-2xl' onClick={event => event.stopPropagation()}>
                <div className='flex items-center justify-between'><div><div className='text-[9px] tracking-[.18em] font-bold text-violet-500'>编辑楼层</div><h2 className='mt-1 text-base font-semibold'>{editingMessage.role === 'user' ? '修改这次推进' : '修改这段正文'}</h2></div><button disabled={mutatingMessage} onClick={() => setEditingMessage(null)} className='w-9 h-9 rounded-full grid place-items-center text-slate-400 disabled:opacity-30'><X size={17} /></button></div>
                {editingMessage.role === 'assistant' && <p className='mt-3 text-[9px] leading-4 text-amber-700'>正文中的结构标签负责折叠区渲染；可以修改内容，删改成对标签可能会让该区退化为纯文字。</p>}
                <textarea autoFocus value={editDraft} onChange={event => setEditDraft(event.target.value)} className='mt-4 w-full min-h-48 max-h-[48vh] overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-4 text-xs leading-6 outline-none resize-y' />
                <button disabled={mutatingMessage || !editDraft.trim()} onClick={() => void saveMessageEdit()} className='mt-3 w-full h-12 rounded-2xl bg-slate-900 text-white text-xs font-bold disabled:opacity-30'>{mutatingMessage ? '正在同步…' : '保存这一层'}</button>
            </div>
        </div>}
        {deletingMessage && <div className='fixed inset-0 z-[75] flex items-end bg-slate-900/30' onClick={() => !mutatingMessage && setDeletingMessage(null)}>
            <div className='story-safe-sheet w-full rounded-t-3xl bg-stone-100 px-5 pt-5 shadow-2xl' onClick={event => event.stopPropagation()}>
                <div className='text-[9px] tracking-[.18em] font-bold text-rose-500'>删除楼层</div><h2 className='mt-1 text-lg font-semibold'>只删除选中的这一层？</h2><p className='mt-3 text-[10px] leading-5 text-slate-500'>相邻楼层会保留。{entry.writesToCharacterMemory ? '尚未归档的角色侧镜像会一并删除；已经被总结进长期记忆的旧内容不会被反向改写。' : '本剧情的既有事件盒或向量归档不会被反向改写。'}</p>
                <div className='mt-5 grid grid-cols-2 gap-3'><button disabled={mutatingMessage} onClick={() => setDeletingMessage(null)} className='h-12 rounded-2xl border border-slate-200 bg-white text-xs font-bold text-slate-600 disabled:opacity-30'>取消</button><button disabled={mutatingMessage} onClick={() => void deleteStoryMessage()} className='h-12 rounded-2xl bg-rose-600 text-white text-xs font-bold disabled:opacity-30'>{mutatingMessage ? '正在删除…' : '确认删除'}</button></div>
            </div>
        </div>}
    </div>;
};

export default StoryTheaterSession;
