import { adaptTavernOpeningGreeting, storyOpeningReadingText } from './tavernOpeningGreeting';
import { adaptTavernWritingInterlude, hasStoryHtmlLayout } from './storyTheaterHtml';
import { listCharacterStoryOpenings } from './linkStoryOpenings';
import type {
    CharacterProfile,
    Message,
    MountedWorldbook,
    Worldbook,
    StoryTheaterArchive,
    StoryTheaterEntry,
    StoryTheaterMask,
    StoryTheaterMaskSelection,
    StoryTheaterPreset,
    StoryTheaterPresetDocument,
    StoryTheaterPresetPrompt,
    StoryTavernChoiceKey,
    UserProfile,
} from '../types';
import nightScreeningV627 from '../assets/presets/night-screening-v6.14.sully.json';
import { normalizeStoryOutputTokens, STORY_DEFAULT_OUTPUT_TOKENS } from './storyOutputLimits';
import { normalizeStoryMemoryApi } from './storyMemoryApi';
import {
    type WorldbookScanMessage,
} from './worldbook';
import { shareOrDownloadFile } from './shareExport';
import { convertSillyTavernChatPreset, detectTavernNativeControls, expandSillyTavernContextMacros, expandSillyTavernPromptText, isSillyTavernChatPreset, normalizeTavernPresetOptions } from './storySillyTavernImport';

export type StoryApiRole = 'system' | 'user' | 'assistant';
export function hasStoryTheaterParticipant(entry: StoryTheaterEntry, characters: CharacterProfile[]): boolean {
    return characters.some(char => entry.characterIds.includes(char.id)
        || (!entry.writesToCharacterMemory && entry.mask?.type === 'character' && entry.mask.id === char.id));
}

export interface StoryApiMessage { role: StoryApiRole; content: string; }

export interface StoryPromptSlots {
    actors: string;
    persona: string;
    scenario: string;
    worldBefore: string;
    worldAfter: string;
    examples?: string;
    history?: string;
    /** Actual actor fields for Tavern-specific card macros, not native markers. */
    tavernDescription?: string;
    tavernPersonality?: string;
}

/** Exact built-in options allowed for user-initiated Tavern overrides.
 * Never allow arbitrary imported IDs to pick an unrelated native directive.
 */
const TAVERN_NATIVE_CONTROL_IDS: Record<StoryTavernChoiceKey, readonly string[]> = {
    style: ['nmj-v3-style-soda', 'nmj-v3-style-corridor', 'nmj-v3-style-comedy',
        'nmj-v3-style-darkcomedy', 'nmj-v3-style-syrup', 'nmj-v3-style-dullknife', 'nmj-v3-style-drama'],
    pov: ['nmj-v3-pov-second', 'nmj-v3-pov-third'],
    retelling: ['nmj-v62-retelling-replay', 'nmj-v62-retelling-direct'],
    agency: ['nmj-v63-user-agency-locked', 'nmj-v63-user-agency-assist', 'nmj-v63-user-agency-auto'],
    tension: ['nmj-v64-tension-lowfever-1', 'nmj-v64-tension-lowfever-2', 'nmj-v64-tension-lowfever-3'],
    theater: ['nmj-v3-theater-ai', 'nmj-v3-theater-user-sim', 'nmj-v3-theater-group',
        'nmj-v3-theater-random', 'nmj-v6-side-channel-terminal', 'nmj-v6-side-channel-evidence',
        'nmj-v6-side-channel-public', 'nmj-v6-side-channel-wrong-reel'],
    language: ['nmj-v3-language-cn', 'nmj-v3-language-tw'],
    length: ['nmj-v3-length-short', 'nmj-v3-length-medium', 'nmj-v3-length-long'],
};
export const isAllowedTavernNativeOverride = (key: string, choice: unknown): boolean =>
    (choice === null || ((key === 'theater' || key === 'tension') && choice === '')
        || (typeof choice === 'string'
            && Object.prototype.hasOwnProperty.call(TAVERN_NATIVE_CONTROL_IDS, key)
            && TAVERN_NATIVE_CONTROL_IDS[key as StoryTavernChoiceKey].includes(choice)));

export interface StoryGenerationSettings {
    temperature?: number;
    top_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    max_tokens: number;
}

/**
 * 默认完整发送酒馆预设中的采样参数。只有用户为当前剧情显式开启兼容开关时，才省略
 * top_p / frequency_penalty / presence_penalty；不能用少数中转的兼容问题牺牲正常预设效果。
 */
export const prepareStoryGenerationSettings = (
    settings?: Partial<StoryGenerationSettings>,
    omitSamplingParams = false,
    modelName = '',
): Partial<StoryGenerationSettings> => {
    if (!settings) return {};
    // Claude-compatible APIs commonly reject temperature above 1. Other
    // models keep the preset's original value unchanged.
    const modelAdjusted = /claude|anthropic/i.test(modelName) && typeof settings.temperature === 'number'
        ? { ...settings, temperature: Math.max(0, Math.min(1, settings.temperature)) }
        : { ...settings };
    if (!omitSamplingParams) return modelAdjusted;
    const {
        top_p: _topP,
        frequency_penalty: _frequencyPenalty,
        presence_penalty: _presencePenalty,
        ...compatible
    } = modelAdjusted;
    return compatible;
};

/** Validate the story's global API before saving a pending user turn.
 * Story theater is a multi-character director: it intentionally does not
 * borrow a single actor's private-chat API configuration.
 */
export const assertStoryApiConfigured = (api: { baseUrl?: string; model?: string }): void => {
    const baseUrl = String(api.baseUrl || '').trim();
    if (!baseUrl) throw new Error('剧情使用全局主 API，请先在设置中填写主 API 地址');
    if (!String(api.model || '').trim()) throw new Error('剧情使用全局主 API，请先在设置中选择主 API 模型');
    try {
        const url = new URL(baseUrl);
        if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
            throw new Error('invalid protocol');
        }
    } catch {
        throw new Error('剧情主 API 地址无效，请填写完整的 http:// 或 https:// API 地址');
    }
};

export interface StoryAffinityInput {
    characterId?: string;
    characterName?: string;
    delta: number;
    reason: string;
    awareness?: 'noticed' | 'unnoticed';
}

export interface ResolvedStoryTheaterMask {
    selection: StoryTheaterMaskSelection;
    name: string;
    avatar?: string;
    description: string;
    coreInstruction?: string;
    worldview?: string;
    characterId?: string;
}

export type StoryDisplayBlockKind = 'story' | 'scene' | 'backstage' | 'worldline' | 'debts' | 'theater' | 'choices' | 'affinity' | 'thinking' | 'tavern-extra' | 'html' | 'other';
export interface StoryDisplayBlock {
    kind: StoryDisplayBlockKind;
    title?: string;
    text: string;
    theater?: StoryMiniTheaterDisplay;
    /** Rendered only by the sandboxed, filtered Tavern HTML viewer. */
    htmlSource?: string;
}

export interface StoryMiniTheaterDisplayMessage {
    side: 'left' | 'right';
    name: string;
    text: string;
}

export interface StoryMiniTheaterDisplay {
    title: string;
    system?: string;
    messages: StoryMiniTheaterDisplayMessage[];
}

export const REAL_COMPANION_MEMORY_GUARD = [
    '### 真实陪伴 · 共同记忆真实性（不可覆盖）',
    '- 只能把本上下文、角色已有真实记忆或本条真实陪伴中明确发生过的事件，当作角色与用户的共同记忆。',
    '- 不得捏造两人曾经发生过的经历，不得把推测、梦境、预设示例或虚构剧场内容说成真实记忆。',
    '- 引用共同记忆时不得添油加醋、补写不存在的细节、篡改因果或夸大情感；不确定时必须明确表现为不确定。',
    '- 可以自然遗忘或记错角色确实可能记错的细枝末节，但不得借此创造对用户不利或未经用户确认的共同历史。',
].join('\n');

export const RELATIONSHIP_TEXTURE_GUIDE = [
    '### 关系温度 · 高位不等于静止',
    '- 关系温度是长期底座，不是每轮必须变化的进度条。尤其达到 95—100 后，没有真正改变关系的新事实就保持原值与 +0，不为制造新鲜感反复涨跌。',
    '- 数值稳定时，变化应落在关系质地：默契如何落地、边界是否被尊重、哪件小事仍然刺手、彼此依赖的方式、刚形成的共同习惯、未说开的分歧或本轮完成的一次修复。',
    '- <relation_note> 每轮只写一句最能概括此刻质地的关系天气，避免连续复用“甜蜜、亲密、信任加深”等空泛同义句。',
    '- 在 <relation_note> 之后可追加 1—3 条 <relation_fragment>关系碎片</relation_fragment>；每条是一句基于本轮具体事实的短观察。维度按事实轮换，不写散乱 Markdown，不复述分数，不预测结局。',
    '- 若本轮确实没有值得记录的新纹理，可以不输出 relation_fragment；不要硬编碎念。',
].join('\n');

const NATIVE_MARKERS: Array<NonNullable<StoryTheaterPresetPrompt['marker']>> = [
    'characters', 'world_before', 'user', 'world_after', 'scenario', 'examples', 'history',
];

const clampNumber = (value: unknown, min: number, max: number, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

const normalizeRole = (role: unknown): StoryApiRole => {
    if (role === 'assistant' || role === 2) return 'assistant';
    if (role === 'user' || role === 1) return 'user';
    return 'system';
};

export const makeStoryTheaterId = (): string => (
    globalThis.crypto?.randomUUID?.() || `story_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
);

export const storyTheaterThreadId = (entryId: string): string => `story-theater:${entryId}`;

const formatStoryExportTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) return '未知时间';
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

/** 把一条剧情的完整中央线程导出为便于长期保存与检索的纯文字原文。 */
export const formatStoryTheaterExport = (
    entry: Pick<StoryTheaterEntry, 'title' | 'premise' | 'writesToCharacterMemory'>,
    identityName: string,
    actorNames: string[],
    messages: Message[],
    exportedAt: number = Date.now(),
): string => {
    const title = entry.title.trim() || '未命名剧情';
    const userLabel = identityName.trim() || '你';
    const lines = [
        `剧情记录 · ${title}`,
        `模式：${entry.writesToCharacterMemory ? '真实时间陪伴' : '虚构剧场'}`,
        `你：${userLabel}`,
        `角色：${actorNames.filter(Boolean).join('、') || '暂无'}`,
        `导出时间：${formatStoryExportTime(exportedAt)}`,
    ];
    if (entry.premise.trim()) lines.push(`剧情简介：${entry.premise.trim()}`);
    lines.push('', '===== 完整原文 =====');

    for (const message of [...messages].sort((a, b) => a.id - b.id)) {
        const speaker = message.role === 'user' ? userLabel : message.role === 'assistant' ? '剧场正文' : '系统';
        lines.push('', `[${formatStoryExportTime(message.timestamp)}] ${speaker}`, message.content?.trim() || '（无内容）');
    }
    return `\uFEFF${lines.join('\n')}`;
};

export const makeStoryTheaterFileName = (title: string, now: number = Date.now()): string => {
    const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_').trim() || '未命名剧情';
    return `${safeTitle}_剧情记录_${formatStoryExportTime(now).slice(0, 10)}.txt`;
};

export const createStoryTheaterDraft = (now: number = Date.now()): StoryTheaterEntry => ({
    id: makeStoryTheaterId(),
    title: '',
    premise: '',
    openingMode: 'user',
    mask: { type: 'user' },
    characterIds: [],
    writesToCharacterMemory: false,
    characterMemoryDates: {},
    carryCharacterMemory: false,
    characterContextLimits: {},
    readingBatchSize: 20,
    archiveAfter: 40,
    archiveKeepRecent: 5,
    archiveStrategy: 'summary',
    archives: [],
    selectedWorldbookIds: [],
    forceUserLastMessage: false,
    omitSamplingParams: false,
    createdAt: now,
    updatedAt: now,
});

/** 老数据/手改 JSON 的温和补全；不改变已经选择的沙盒开关。 */
export const normalizeStoryTheater = (entry: StoryTheaterEntry): StoryTheaterEntry => {
    const archiveAfter = Math.round(clampNumber(entry.archiveAfter, 2, 200, 40));
    const archiveKeepRecent = Math.round(clampNumber(entry.archiveKeepRecent, 1, Math.max(1, archiveAfter - 1), Math.min(5, archiveAfter - 1)));
    const normalized: StoryTheaterEntry = {
        ...entry,
        title: String(entry.title || '未命名剧情'),
        premise: String(entry.premise || ''),
        openingMode: entry.openingMode === 'assistant' ? 'assistant' : 'user',
        openingGreeting: entry.openingGreeting && typeof entry.openingGreeting.characterId === 'string'
            && typeof entry.openingGreeting.greetingId === 'string'
            && Array.isArray(entry.characterIds) && entry.characterIds.includes(entry.openingGreeting.characterId)
            ? { characterId: entry.openingGreeting.characterId, greetingId: entry.openingGreeting.greetingId }
            : undefined,
        mask: entry.writesToCharacterMemory ? { type: 'user' } : entry.mask?.type === 'character' && entry.mask.id
            ? { type: 'character', id: entry.mask.id }
            : entry.mask?.type === 'custom' && entry.mask.id
                ? { type: 'custom', id: entry.mask.id }
                : { type: 'user' },
        characterIds: Array.isArray(entry.characterIds) ? entry.characterIds.filter(Boolean) : [],
        writesToCharacterMemory: entry.writesToCharacterMemory === true,
        characterMemoryDates: entry.characterMemoryDates || {},
        carryCharacterMemory: entry.writesToCharacterMemory ? true : entry.carryCharacterMemory !== false,
        characterContextLimits: entry.characterContextLimits || {},
        readingBatchSize: Math.round(clampNumber(entry.readingBatchSize, 10, 100, 20)),
        archiveAfter,
        archiveKeepRecent,
        archiveStrategy: entry.archiveStrategy === 'vector' ? 'vector' : 'summary',
        archives: Array.isArray(entry.archives) ? entry.archives : [],
        automaticMemoryApiEnabled: entry.automaticMemoryApiEnabled === true,
        memorySummaryApi: normalizeStoryMemoryApi(entry.memorySummaryApi),
        // Imported/older backups can contain duplicate or invalid IDs.
        // Preserve legitimate IDs, but never count one selected book twice.
        selectedWorldbookIds: Array.isArray(entry.selectedWorldbookIds)
            ? Array.from(new Set(entry.selectedWorldbookIds.filter(
                (id): id is string => typeof id === 'string' && !!id.trim())))
            : [],
        presetId: /^builtin-night-screening-v\d/i.test(String(entry.presetId || '')) ? 'builtin-night-screening' : entry.presetId,
        presetOverride: entry.presetOverride?.schema === 'sullyos.story-preset' && Array.isArray(entry.presetOverride.prompts) ? entry.presetOverride : undefined,
        forceUserLastMessage: entry.forceUserLastMessage === true,
        omitSamplingParams: entry.omitSamplingParams === true,
        streamStoryOutput: entry.streamStoryOutput === true,
        createdAt: Number(entry.createdAt) || Date.now(),
        updatedAt: Number(entry.updatedAt) || Number(entry.createdAt) || Date.now(),
    };
    // Older stories stored an overriding 30000-token limit. The active preset is now authoritative.
    delete normalized.outputMaxTokens;
    return normalized;
};

/** The range stored on the story owns the archive; orphaned floor flags are legacy metadata. */
export const storyArchiveAtFloor = (archives: StoryTheaterArchive[], messageId: number) =>
    archives.find(box => box.fromMessageId <= messageId && messageId <= box.toMessageId);

/** Old original prose stays archived. Only a bounded set of recent event boxes
 * is sent automatically; earlier boxes remain available for explicit review
 * and the independent vector-recall pipeline. */
export const selectStoryArchiveContext = (
    archives: StoryTheaterArchive[], beforeId: number, budget = 6000,
): StoryTheaterArchive[] => {
    const eligible = archives.filter(box => box.toMessageId < beforeId && !!box.summary?.trim())
        .sort((a, b) => b.toMessageId - a.toMessageId);
    const selected: StoryTheaterArchive[] = [];
    let used = 0;
    for (const box of eligible) {
        const summaryLength = box.summary?.length ?? 0;
        if (selected.length >= 8 || (selected.length > 0 && used + summaryLength > budget)) break;
        selected.push(box);
        used += summaryLength;
    }
    return selected.reverse();
};

/**
 * Surface older author corrections separately when their event boxes have fallen
 * outside the limited recent-story window. Never re-inject the old scenes.
 * Keep records intact and bounded; do not clip an instruction mid-sentence.
 */
export const selectStoryArchiveAuthorInstructions = (
    archives: StoryTheaterArchive[], beforeId: number, recent: StoryTheaterArchive[], budget = 1600,
): string => {
    const recentIds = new Set(recent.map(box => box.id));
    const marker = '用户协助指令：';
    const selected: string[] = [];
    const seen = new Set<string>();
    let used = 0;
    for (const box of archives
        .filter(item => item.strategy === 'summary' && item.toMessageId < beforeId
            && !recentIds.has(item.id) && !!item.summary?.trim())
        .sort((a, b) => b.toMessageId - a.toMessageId)) {
        const content = box.summary ?? '';
        const sectionAt = content.lastIndexOf('【未解决事项与续写落点】');
        if (sectionAt < 0) continue;
        const section = content.slice(sectionAt + '【未解决事项与续写落点】'.length);
        const instructionAt = section.indexOf(marker);
        if (instructionAt < 0) continue;
        const instruction = section.slice(instructionAt + marker.length).trim();
        if (!instruction || instruction === '原文未交代' || seen.has(instruction)) continue;
        const line = marker + instruction;
        if (used + line.length + (selected.length ? 1 : 0) > budget) continue;
        selected.push(line);
        seen.add(instruction);
        used += line.length + (selected.length > 1 ? 1 : 0);
    }
    return selected.reverse().join('\n');
};

/**
 * 达到水位线后只归档最旧部分，并至少保留最近若干楼。
 * 如果切点正好落在“你的推进 / 剧场正文”之间，宁可多留一楼，也不拆散这一轮。
 */
export const selectStoryArchiveBatch = (
    rows: Message[],
    archiveAfter: number,
    keepRecent: number,
    isArchived: (row: Message) => boolean = row => row.metadata?.theaterArchived === true,
): Message[] => {
    const threshold = Math.max(2, Math.round(archiveAfter) || 40);
    const active = rows.filter(row => !isArchived(row));
    if (active.length < threshold) return [];
    const keep = Math.max(1, Math.min(threshold - 1, Math.round(keepRecent) || 5));
    // A pending turn needs the preceding reply. A completed turn can be rerolled
    // and needs the reply preceding it as well, even with keepRecent set to 1.
    const anchor = active.slice(0, -1).map(row => row.role).lastIndexOf('assistant');
    const batch = active.slice(0, Math.min(active.length - keep, anchor < 0 ? active.length : anchor));
    // A manual box may sit between two unarchived segments. Never produce an
    // automatic range spanning that box just because the active list skipped it.
    const start = rows.indexOf(batch[0]);
    const gap = batch.findIndex((row, index) => rows[start + index] !== row);
    if (gap >= 0) batch.splice(gap);
    const next = rows[start + batch.length];
    if (batch.at(-1)?.role === 'user' && next?.role === 'assistant' && !isArchived(next)) {
        batch.pop();
    }
    return batch;
};

export const createStoryTheaterMaskDraft = (now: number = Date.now()): StoryTheaterMask => ({
    id: makeStoryTheaterId(),
    name: '',
    description: '',
    coreInstruction: '',
    worldview: '',
    createdAt: now,
    updatedAt: now,
});

export const resolveStoryTheaterMask = (
    selection: StoryTheaterMaskSelection | undefined,
    user: UserProfile,
    characters: CharacterProfile[],
    masks: StoryTheaterMask[],
): ResolvedStoryTheaterMask => {
    if (selection?.type === 'character') {
        const char = characters.find(item => item.id === selection.id);
        if (char) return {
            selection,
            name: char.name,
            avatar: char.avatar,
            description: char.description || '',
            coreInstruction: char.systemPrompt || '',
            worldview: char.worldview || '',
            characterId: char.id,
        };
    }
    if (selection?.type === 'custom') {
        const mask = masks.find(item => item.id === selection.id);
        if (mask) return {
            selection,
            name: mask.name,
            avatar: mask.avatar,
            description: mask.description,
            coreInstruction: mask.coreInstruction,
            worldview: mask.worldview,
        };
    }
    return { selection: { type: 'user' }, name: user.name || '你', avatar: user.avatar, description: user.bio || '' };
};

const normalizeDocument = (value: any, fallbackName: string): StoryTheaterPresetDocument => {
    if (!value || value.schema !== 'sullyos.story-preset' || value.version !== 1 || !Array.isArray(value.prompts)) {
        throw new Error('不是受支持的糯米机剧情预设');
    }
    const ids = new Set<string>();
    const prompts: StoryTheaterPresetPrompt[] = value.prompts.map((prompt: any, index: number) => {
        if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt)
            || (prompt.id != null && !['string', 'number'].includes(typeof prompt.id))
            || (prompt.content != null && typeof prompt.content !== 'string')
            || (prompt.enabled != null && typeof prompt.enabled !== 'boolean')
            || (prompt.role != null && !['system', 'user', 'assistant', 0, 1, 2].includes(prompt.role))) {
            throw new Error(`剧情预设第 ${index + 1} 条提示词格式无效，请检查原文件`);
        }
        const id = String(prompt.id ?? `prompt_${index + 1}`);
        if (!id.trim() || ids.has(id)) throw new Error(`剧情预设第 ${index + 1} 条提示词标识为空或重复`);
        ids.add(id);
        return {
            id,
            name: String(prompt?.name || `提示词 ${index + 1}`),
            enabled: prompt?.enabled !== false,
            role: normalizeRole(prompt?.role),
            content: String(prompt?.content || ''),
            ...(prompt?.section?.id && ['start', 'end'].includes(prompt.section.edge) ? {
                section: { id: String(prompt.section.id), name: String(prompt.section.name || '自定义分组'), edge: prompt.section.edge },
            } : {}),
            ...(NATIVE_MARKERS.includes(prompt?.marker) ? { marker: prompt.marker } : {}),
            ...(prompt?.injection?.position === 'chat' ? { injection: {
                position: 'chat' as const,
                depth: Math.round(clampNumber(prompt.injection.depth, 0, 10000, 4)),
                order: clampNumber(prompt.injection.order, -100000, 100000, 100),
            } } : {}),
        };
    });
    if (prompts.length === 0) throw new Error('预设中没有提示词条目');
    return {
        schema: 'sullyos.story-preset',
        version: 1,
        name: String(value.name || fallbackName || '未命名剧情预设'),
        description: String(value.description || ''),
        generation: {
            temperature: clampNumber(value.generation?.temperature, 0, 2, 0.9),
            topP: clampNumber(value.generation?.topP, 0, 1, 1),
            frequencyPenalty: clampNumber(value.generation?.frequencyPenalty, -2, 2, 0),
            presencePenalty: clampNumber(value.generation?.presencePenalty, -2, 2, 0),
            maxTokens: normalizeStoryOutputTokens(value.generation?.maxTokens),
        },
        prompts,
        assistantPrefill: String(value.assistantPrefill || ''),
        ...(value.sourceFormat === 'sillytavern' ? {
            sourceFormat: 'sillytavern' as const,
            // Recalculate detection from the actual enabled text whenever a
            // saved preset is reopened; keep deliberate user changes separate.
            tavernControls: {
                ...detectTavernNativeControls(prompts),
                overrides: Object.fromEntries(
                    Object.entries(value.tavernControls?.overrides || {})
                        .filter(([key, choice]) => isAllowedTavernNativeOverride(key, choice)),
                ),
            },
        } : {}),
        ...(value.squashSystemMessages === true ? { squashSystemMessages: true } : {}),
        ...(value.sourceFormat === 'sillytavern' && value.tavernFormats && typeof value.tavernFormats === 'object'
            ? { tavernFormats: Object.fromEntries(
                ['worldInfo', 'scenario', 'personality', 'newChat', 'newExampleChat', 'continueNudge']
                    .filter(key => typeof value.tavernFormats[key] === 'string')
                    .map(key => [key, String(value.tavernFormats[key]).slice(0, 65536)]),
            ) } : {}),
        ...(value.sourceFormat === 'sillytavern' && Array.isArray(value.tavernEntryGroups)
            ? { tavernEntryGroups: value.tavernEntryGroups.filter((group: any) =>
                group && typeof group.id === 'string' && typeof group.name === 'string')
                .slice(0, 120).map((group: any) => ({
                    id: group.id.slice(0, 120), name: group.name.slice(0, 100),
                    ...(Array.isArray(group.memberIdentifiers) ? { memberIdentifiers: group.memberIdentifiers
                        .filter((id: unknown): id is string => typeof id === 'string').slice(0, 600) } : {}),
                    ...(typeof group.startIdentifier === 'string' ? { startIdentifier: group.startIdentifier.slice(0, 120) } : {}),
                    ...(typeof group.endIdentifier === 'string' ? { endIdentifier: group.endIdentifier.slice(0, 120) } : {}),
                })) } : {}),
        ...(value.sourceFormat === 'sillytavern' && value.tavernOptions && typeof value.tavernOptions === 'object'
            && !Array.isArray(value.tavernOptions) ? { tavernOptions: normalizeTavernPresetOptions(value.tavernOptions) } : {}),
        ...(Array.isArray(value.importWarnings) ? { importWarnings: value.importWarnings.filter((warning: unknown): warning is string => typeof warning === 'string').slice(0, 32) } : {}),
        ...(value.sourceFormat === 'sillytavern' && value.tavernImportAudit
            && typeof value.tavernImportAudit === 'object'
            ? { tavernImportAudit: Object.fromEntries(
                ['sourceEntries', 'importedEntries', 'enabledEntries', 'unlistedEntries',
                    'orderTableCount', 'skippedRegexCount', 'skippedScriptCount']
                    .map(key => [key, Math.max(0, Math.floor(clampNumber(value.tavernImportAudit[key], 0, 1000000, 0)))]),
            ) as NonNullable<StoryTheaterPresetDocument['tavernImportAudit']> } : {}),
    };
};

const NATIVE_MULTI_AFFINITY_PROMPT = [
    '启用本条时，在每次回复末尾输出一个“多角色双向关系温度”面板。每位参与角色都拥有彼此隔离的 C→U、U→C 与五维关系混音；禁止把多人压成单一“当前 C”，也不得共享或平均任何数值。',
    '',
    '【逐角色双向记账】',
    '- 从最近一次 <affinity_panel> 按 character_id 读取每位角色自己的完整记录；首次出现且没有旧记录时，C→U 与 U→C 均从 50 开始，五个维度依据角色卡与已经发生的共同经历建立。',
    '- C→U 是该角色对用户侧角色的总体关系温度，只随已经落地且属于这两人的关系事实变化。普通回合约 -3 至 +3，重大事实可至 -8 至 +8；没有新事实时保持原值并记 +0。',
    '- trust、security、possessive_pull、emotional_pressure、repair_will 都是 0—100 的独立维度，记录力量怎样运作，不直接命令角色采取行为。高占有与真心同时存在时应形成对向拉扯，不把二者相加成更强的控制。',
    '- 最新用户消息可能包含 <u_affinity_updates>；只按 character_id 更新匹配角色的 U→C。某角色没有本轮更新时保持原值，delta 为 +0，原因写“本轮未填写”；不得依据正文替用户自行升降。',
    '- awareness 只决定对应角色是否明确知道用户→自己的准确数值变化与原因；其他角色不得共享这份透视。C→U 与五维状态仍由该角色自己的事实、能力、处境与情绪潮线决定。',
    '- U→C 向下时，把 reason 当作执笔人的阅读体验灯号：回到角色动机与现场因果中寻找符合人物的修复入口，但不把角色写成讨好数值的攻略对象。',
    '',
    '【正文权限】',
    '- 数值只作为连续性底座，不能覆盖角色卡、世界事实、执笔权、同意边界或人物原有目标；95—100 后仍通过关系天气、维度消长、选择代价与关系碎片表现变化。',
    '- 未察觉的 U→C 更新只作为低权重叙事背景；已察觉时由对应角色在本轮作出符合性格与现场节拍的反应，但不照念 XML 或系统数字。',
    '',
    '【输出】',
    '用一个 <affinity_panel> 包住全部参与角色，并严格按角色资料顺序为每人输出：',
    '<affinity_person>',
    '<character_id>角色 ID</character_id>',
    '<character_name>角色名</character_name>',
    '<c_to_u_score>50</c_to_u_score>',
    '<c_to_u_delta>+0</c_to_u_delta>',
    '<c_to_u_note>改变该角色 C→U 的本轮事实；没有则写“本轮无新事实”</c_to_u_note>',
    '<u_to_c_score>50</u_to_c_score>',
    '<u_to_c_delta>+0</u_to_c_delta>',
    '<u_to_c_note>用户填写的原因；没有则写“本轮未填写”</u_to_c_note>',
    '<awareness_state>已察觉或未察觉</awareness_state>',
    '<trust>50</trust>',
    '<security>50</security>',
    '<possessive_pull>50</possessive_pull>',
    '<emotional_pressure>50</emotional_pressure>',
    '<repair_will>50</repair_will>',
    '<state_note>本轮最明显的内部拉扯、选择代价或修复动作</state_note>',
    '<relation_note>这一段关系当前的具体质地</relation_note>',
    '<relation_fragment>可选的一条短关系碎片</relation_fragment>',
    '</affinity_person>',
    '按角色继续排列，最后闭合 </affinity_panel>。每位角色必须恰好一段；不输出旧版根级 c_score / u_score 单槽字段。',
].join('\n');

/**
 * V6.14 原稿把幕后暗格与镜头债拆成两个开关。糯米机把它们视为同一个
 * “幕后与余波”模块：提示词在同一位置发送，两个协议块连续输出，界面也只
 * 展示一个折叠区。保留原 id 作为关闭的迁移占位，旧沙盒覆盖仍可被运行时提醒兼容。
 */
const replacePromptLine = (content: string, startsWith: string, replacement: string): string => content
    .split('\n')
    .map(line => line.startsWith(startsWith) ? replacement : line)
    .join('\n');

const mergeNightScreeningBackstageAndDebts = (document: StoryTheaterPresetDocument): StoryTheaterPresetDocument => {
    const backstage = document.prompts.find(prompt => prompt.id === 'nmj-v48-backstage');
    const debts = document.prompts.find(prompt => prompt.id === 'nmj-v61-shot-debts');
    if (!backstage || !debts) return document;
    const orderedPrompts = [...document.prompts];
    const startupStartIndex = orderedPrompts.findIndex(prompt => prompt.id === 'nmj-v64-section-startup-start');
    const firstStartupPromptIndex = orderedPrompts.findIndex(prompt => prompt.id === 'nmj-v3-user-shell');
    if (startupStartIndex > firstStartupPromptIndex && firstStartupPromptIndex >= 0) {
        const [sectionStart] = orderedPrompts.splice(startupStartIndex, 1);
        orderedPrompts.splice(firstStartupPromptIndex, 0, sectionStart);
    }
    const debtContent = debts.content.replace(
        /^在正文、(?:幕后)?暗格和世界线后，/,
        '紧接 </backstage> 后，',
    );
    return {
        ...document,
        prompts: orderedPrompts.map(originalPrompt => {
            const prompt = {
                ...originalPrompt,
                name: originalPrompt.name.replace(/双向(?:好感|温度)/g, '多角色双向关系温度'),
                content: originalPrompt.content.replace(/双向(?:好感|温度)/g, '多角色双向关系温度'),
            };
            if (prompt.id === 'nmj-v65-affinity-control') return {
                ...prompt,
                name: '💗多角色双向关系温度｜逐人五维｜默认开启',
                content: NATIVE_MULTI_AFFINITY_PROMPT,
            };
            if (prompt.id === backstage.id) return {
                ...prompt,
                name: '🗝️幕后与余波｜心境·秘密·真话·镜头债｜默认开启',
                content: `${backstage.content}\n\n# 同一折叠模块：镜头债\n${debtContent}`,
            };
            if (prompt.id === debts.id) return {
                ...prompt,
                name: '↳ 镜头债已并入「幕后与余波」',
                enabled: false,
                content: '',
            };
            if (prompt.id === 'nsfw' || prompt.id === 'jailbreak') return {
                ...prompt,
                name: `${prompt.name}｜空连接位已停用`,
                enabled: false,
            };
            if (prompt.id === 'nmj-v3-scene-header') return {
                ...prompt,
                content: replacePromptLine(
                    prompt.content,
                    '正文结束后，依次输出',
                    '正文结束后，依次输出已启用的“幕后与余波”（幕后暗格后紧接镜头债）、世界线、小剧场、回复选项和多角色双向关系温度。',
                ),
            };
            if (prompt.id === 'nmj-v616-silent-preflight') return {
                ...prompt,
                name: '🎬开拍前｜静默排片检查｜常驻',
                content: replacePromptLine(
                    replacePromptLine(
                        prompt.content,
                        '正文前完成一次排片思考。',
                        '正文前静默完成一次排片检查；只把结论落实到成品，不输出分析、检查过程或隐藏推理。',
                    ),
                    '6. 关系侧表：',
                    '6. 关系侧表：按 character_id 逐人续接 C→U、U→C 与五维关系混音；每位角色只读取自己的事实和用户对自己的更新。高温度与高占有形成选择拉扯，不放大成控制；U→C 向下时为对应角色寻找符合人物的修复入口；',
                ).replace('导演层理解执笔灯号，角色层只接触故事内信号；', '生成规则读取执笔灯号，故事人物只接触其可知的故事内信号；'),
            };
            if (prompt.id === 'nmj-v3-exit-check') return {
                ...prompt,
                content: replacePromptLine(
                    replacePromptLine(
                        prompt.content,
                        '- 人物行动来自生活线、情绪潮线与关系侧表的合力；',
                        '- 人物行动来自生活线、情绪潮线与逐角色关系侧表的合力；每位角色按 character_id 独立续接 C→U、U→C 与五维状态，角色之间没有共享数值或察觉状态。C→U 只随该角色亲历的关系事实变化，U→C 只读取用户对该角色的最新更新；高真心与高占有形成对向选择代价，不共同放大控制；U→C 向下时，正文已有符合该角色自身动机的修复入口；',
                    ),
                    '- 正文后的材料已按散场分流',
                    '- 正文后的材料已按散场分流进入唯一且最贴近的片盒：幕后与余波收人物内层材料及未到账后果，世界线收镜头外实变，小剧场收非正篇折射，多角色双向关系温度逐人记账；各区提供新材料。输出顺序为：场景条 → 正文 → 幕后与余波（幕后暗格 → 镜头债）→ 世界线 → 已启用的小剧场 → 已启用的回复选项 → 已启用的多角色双向关系温度；',
                ),
            };
            if (prompt.id === 'nmj-v64-section-output-start') return {
                ...prompt,
                name: '🧩↓附加输出｜格式／场景条／幕后与余波／世界线',
            };
            if (prompt.id === 'nmj-v3-theater-ai') return {
                ...prompt,
                name: '💬小剧场｜角色与你聊天',
                content: [
                    '在 </story_text> 之后追加一段非正篇聊天：让当前最合适的角色与你以当前身份对话，可以求助、争辩、投诉或一本正经地问错问题。写 4—8 个短气泡，让你和角色至少发生一次理解错位。默认不改变正篇事实。',
                    '',
                    '严格使用：',
                    '<mini_theater>',
                    '<mt_title>小剧场标题</mt_title>',
                    '<mt_system>很短的界面提示，可省略</mt_system>',
                    '<mt_ai><name>你的名字</name><text>你的消息</text></mt_ai>',
                    '<mt_user><name>角色名</name><text>角色消息</text></mt_user>',
                    '按需要继续排列。',
                    '</mini_theater>',
                ].join('\n'),
            };
            if (prompt.id === 'nmj-v3-theater-user-sim') return {
                ...prompt,
                name: '🪞小剧场｜角色与你的倒影私聊',
                content: [
                    '在 </story_text> 之后追加一段非正篇聊天：某个角色与你的虚构倒影交谈。这道倒影必须标为“{{user}}的倒影”；它不是实际的你，不代表你的真实思想、决定或未来行为。趣味来自角色如何试探这道倒影，又怎样被自己的错误假设反噬。写 4—8 个气泡。',
                    '',
                    '严格使用：',
                    '<mini_theater>',
                    '<mt_title>小剧场标题</mt_title>',
                    '<mt_system>倒影只依据角色提供的信息回应</mt_system>',
                    '<mt_ai><name>{{user}}的倒影</name><text>倒影消息</text></mt_ai>',
                    '<mt_user><name>角色名</name><text>角色消息</text></mt_user>',
                    '按需要继续排列。',
                    '</mini_theater>',
                ].join('\n'),
            };
            if (prompt.id === 'nmj-v3-theater-group') return {
                ...prompt,
                name: '👥小剧场｜你和角色们群聊',
                content: [
                    '在 </story_text> 之后追加一段非正篇群聊。选择 2—4 个当前合适的角色，再让你以当前身份加入。写 5—10 个短气泡，让不同打字习惯互相撞坏一次正题。默认不改变正篇事实。',
                    '',
                    '严格使用：',
                    '<mini_theater>',
                    '<mt_title>群聊名称</mt_title>',
                    '<mt_system>群聊提示，可省略</mt_system>',
                    '<mt_ai><name>你的名字或角色名</name><text>消息</text></mt_ai>',
                    '<mt_user><name>角色名或你的名字</name><text>消息</text></mt_user>',
                    '按需要继续排列。',
                    '</mini_theater>',
                ].join('\n'),
            };
            return prompt;
        }),
    };
};

export const BUILTIN_NIGHT_SCREENING_PRESET: StoryTheaterPreset = {
    id: 'builtin-night-screening',
    name: '糯米鸡｜夜班放映室 V6.27',
    format: 'sullyos-story-preset',
    document: mergeNightScreeningBackstageAndDebts(normalizeDocument(nightScreeningV627, '糯米鸡｜夜班放映室 V6.27')),
    builtIn: true,
    createdAt: 0,
    updatedAt: 0,
};

export const withBuiltInStoryPresets = (presets: StoryTheaterPreset[]): StoryTheaterPreset[] => [
    BUILTIN_NIGHT_SCREENING_PRESET,
    ...presets.filter(preset => preset && typeof preset.id === 'string'
        && typeof preset.name === 'string' && Array.isArray(preset.document?.prompts)
        && !preset.id.startsWith('builtin-night-screening')),
];

/**
 * 快捷设置历史上保存的是整份内置文档。升级内置预设时只继承同 ID 条目的
 * 开关选择，正文与新增模块始终使用最新版；自建预设仍完整保留用户内容。
 */
export const resolveStoryPresetDocument = (
    preset: StoryTheaterPreset,
    override?: StoryTheaterPresetDocument,
): StoryTheaterPresetDocument => {
    if (!override) return preset.document;
    // Quick preset changes story prompt choices, not the saved preset's output budget.
    if (!preset.builtIn) return { ...override, generation: preset.document.generation };
    const enabledById = new Map(override.prompts.map(prompt => [prompt.id, prompt.enabled]));
    return {
        ...preset.document,
        prompts: preset.document.prompts.map(prompt => enabledById.has(prompt.id)
            ? { ...prompt, enabled: enabledById.get(prompt.id) === true }
            : prompt),
    };
};

export const MAX_STORY_PRESET_BYTES = 5 * 1024 * 1024;

export const parseStoryTheaterPreset = (rawText: string, sourceFileName: string, now: number = Date.now()): StoryTheaterPreset => {
    if (rawText.length > MAX_STORY_PRESET_BYTES) throw new Error('预设超过 5 MB，请先移除内嵌素材或脚本数据');
    let data: Record<string, any>;
    try { data = JSON.parse(rawText.replace(/^\uFEFF/, '')); } catch { throw new Error('不是有效的 JSON 预设'); }
    const fileBase = sourceFileName.replace(/\.(json|png)$/i, '').trim() || '导入预设';
    const document = data?.schema === 'sullyos.story-preset'
        ? normalizeDocument(data, fileBase)
        : isSillyTavernChatPreset(data)
            ? normalizeDocument(convertSillyTavernChatPreset(data, fileBase), fileBase)
            : (() => {
                const looksLikeTextCompletionTemplate = data && typeof data === 'object'
                    && (typeof data.input_sequence === 'string' || typeof data.output_sequence === 'string'
                        || typeof data.story_string === 'string');
                if (looksLikeTextCompletionTemplate) {
                    throw new Error('这是酒馆 Instruct／Context 文本补全模板，不是 Chat Completion 预设；为避免错误套用已拒绝导入，原文件不会被修改');
                }
                throw new Error('只接受糯米机剧情预设或酒馆 Chat Completion 预设');
            })();
    return { id: makeStoryTheaterId(), name: document.name, sourceFileName, format: 'sullyos-story-preset', document, createdAt: now, updatedAt: now };
};

/** An import never changes existing presets or the stories referencing their IDs.
 * Exact repeats select the saved record; edited/same-name files get a distinct
 * name and a new ID instead of silently overwriting user customizations.
 */
export type StoryPresetImportDecision = 'keep' | 'replace' | 'copy';

/** Import identity is content-only, never inferred from metadata generated by
 * different importer versions. Deliberate user overrides still count. */
const storyImportContent = (document: StoryTheaterPresetDocument): string => {
    const { importWarnings: _warnings, tavernEntryGroups: _groups,
        tavernControls: _controls, tavernImportAudit: _audit, ...content } = document;
    const overrides = document.tavernControls?.overrides || {};
    return JSON.stringify({ ...content, name: '', description: content.description || '',
        ...(Object.keys(overrides).length ? { authorOverrides: overrides } : {}) });
};

/** Only a matching source filename or strong stable-ID overlap is a candidate.
 * Never match a hand-created copy with no source file or a built-in preset. */
export const findStoryPresetImportConflict = (
    imported: StoryTheaterPreset,
    savedPresets: readonly StoryTheaterPreset[],
): { existing: StoryTheaterPreset; exact: boolean } | null => {
    if (!imported.sourceFileName) return null;
    const sourceName = imported.sourceFileName.normalize('NFC').trim().toLocaleLowerCase();
    const sourceIds = new Set(imported.document.prompts.map(p => p.id).filter(id => id.startsWith('st-')));
    const candidates = savedPresets.filter(saved => {
        if (!saved || saved.builtIn || !saved.sourceFileName || !saved.document?.prompts) return false;
        if (saved.sourceFileName.normalize('NFC').trim().toLocaleLowerCase() === sourceName) return true;
        if (imported.document.sourceFormat !== 'sillytavern'
            || saved.document.sourceFormat !== 'sillytavern' || sourceIds.size < 12) return false;
        const oldIds = saved.document.prompts.filter(p => p.id.startsWith('st-'));
        if (oldIds.length < 12
            || Math.min(oldIds.length, sourceIds.size) / Math.max(oldIds.length, sourceIds.size) < 0.75) return false;
        return oldIds.filter(p => sourceIds.has(p.id)).length
            / Math.max(oldIds.length, sourceIds.size) >= 0.8;
    }).sort((a, b) => b.updatedAt - a.updatedAt);
    if (!candidates.length) return null;
    const fingerprint = storyImportContent(imported.document);
    const exact = candidates.find(saved => storyImportContent(saved.document) === fingerprint);
    return { existing: exact || candidates[0], exact: Boolean(exact) };
};

export interface StoryPresetImportResult {
    preset: StoryTheaterPreset;
    duplicate: boolean;
    upgraded?: boolean;
    overwritten?: boolean;
    skipped?: boolean;
}

/** The default retains the previous non-destructive import behavior.
 * Overwriting an existing ID requires a conscious user decision. */
export const resolveStoryPresetImport = (
    imported: StoryTheaterPreset,
    savedPresets: readonly StoryTheaterPreset[],
    decision: StoryPresetImportDecision = 'copy',
    targetId?: string,
): StoryPresetImportResult => {
    const conflict = findStoryPresetImportConflict(imported, savedPresets);
    if (targetId && (!conflict || conflict.existing.id !== targetId))
        throw new Error('预设库在确认期间发生变化，没有覆盖旧版；请重新导入确认');
    if (conflict?.exact) {
        const existing = conflict.existing;
        const sourceGroups = imported.document.tavernEntryGroups || [];
        const groupUpgrade = sourceGroups.length > 0
            && JSON.stringify(existing.document.tavernEntryGroups || []) !== JSON.stringify(sourceGroups);
        const auditUpgrade = !existing.document.tavernImportAudit && Boolean(imported.document.tavernImportAudit);
        if (groupUpgrade || auditUpgrade) {
            return {
                preset: { ...existing, document: {
                    ...existing.document,
                    ...(groupUpgrade ? { tavernEntryGroups: sourceGroups } : {}),
                    ...(auditUpgrade ? {
                        tavernImportAudit: imported.document.tavernImportAudit,
                        importWarnings: imported.document.importWarnings || [],
                    } : {}),
                } }, duplicate: true, upgraded: true,
            };
        }
        return { preset: existing, duplicate: true };
    }
    if (conflict && decision === 'keep')
        return { preset: conflict.existing, duplicate: true, skipped: true };
    if (conflict && decision === 'replace') {
        const original = conflict.existing;
        // An existing story's presetId stays valid; all changed prompt content
        // is deliberately replaced, never silently merged or partially copied.
        return { preset: {
            ...imported, id: original.id, name: original.name,
            sourceFileName: imported.sourceFileName, createdAt: original.createdAt,
            updatedAt: imported.updatedAt,
            document: { ...imported.document, name: original.document.name },
        }, duplicate: false, overwritten: true };
    }
    const usedNames = new Set(savedPresets.filter(p => p && typeof p.name === 'string').map(p => p.name));
    if (!usedNames.has(imported.name)) return { preset: imported, duplicate: false };
    let suffix = 2;
    while (usedNames.has(`${imported.name}（导入 ${suffix}）`)) suffix++;
    const name = `${imported.name}（导入 ${suffix}）`;
    return { preset: { ...imported, name, document: { ...imported.document, name } },
        duplicate: false };
};

export const createBlankStoryPreset = (name = '新剧情预设', now = Date.now()): StoryTheaterPreset => ({
    id: makeStoryTheaterId(), name, format: 'sullyos-story-preset', createdAt: now, updatedAt: now,
    document: {
        schema: 'sullyos.story-preset', version: 1, name,
        generation: { temperature: 0.9, topP: 1, frequencyPenalty: 0, presencePenalty: 0, maxTokens: STORY_DEFAULT_OUTPUT_TOKENS },
        prompts: [
            { id: makeStoryTheaterId(), name: '主叙事规则', enabled: true, role: 'system', content: '直接续写连续的第三人称故事，让人物保持独立动机与知识边界。' },
            { id: makeStoryTheaterId(), name: '世界书 · 角色设定前', enabled: true, role: 'system', content: '', marker: 'world_before' },
            { id: makeStoryTheaterId(), name: '角色资料', enabled: true, role: 'system', content: '', marker: 'characters' },
            { id: makeStoryTheaterId(), name: '世界书', enabled: true, role: 'system', content: '', marker: 'world_after' },
            { id: makeStoryTheaterId(), name: '剧情设定', enabled: true, role: 'system', content: '', marker: 'scenario' },
            { id: makeStoryTheaterId(), name: '聊天历史', enabled: true, role: 'system', content: '', marker: 'history' },
        ],
    },
});

export const duplicateStoryPreset = (preset: StoryTheaterPreset, now = Date.now()): StoryTheaterPreset => {
    const name = `${preset.name} · 副本`;
    return { ...preset, id: makeStoryTheaterId(), name, builtIn: false, sourceFileName: undefined, document: { ...preset.document, name, prompts: preset.document.prompts.map(prompt => ({ ...prompt })) }, createdAt: now, updatedAt: now };
};

export const getPresetPromptStats = (preset?: StoryTheaterPreset | null): { total: number; enabled: number; scripts: number } => {
    if (!preset) return { total: 0, enabled: 0, scripts: 0 };
    return { total: preset.document.prompts.length, enabled: preset.document.prompts.filter(prompt => prompt.enabled).length, scripts: 0 };
};

export interface StoryPresetPromptGroup {
    key: string;
    label: string;
    description: string;
    promptIds: string[];
    startIndex: number;
    endIndex: number;
    protected: boolean;
    customSectionId?: string;
    /** Browsing-only author grouping; never persisted into prompt records. */
    autoGrouped?: boolean;
}

const STORY_PRESET_GROUP_SPECS = [
    { key: 'startup', label: '顶部启动框架', description: '破甲、虚构框架、续航与主叙事底座', start: 'nmj-v64-section-startup-start', end: 'nmj-v64-section-startup-end' },
    { key: 'input', label: '输入处理', description: '长片意识、转述、回放与即时接戏', start: 'nmj-v64-section-input-start', end: 'nmj-v64-section-input-end' },
    { key: 'sources', label: '角色与世界', description: '角色卡、世界书、你的身份、场景、示例与历史', start: 'nmj-v64-section-sources-start', end: 'nmj-v64-section-sources-end', protected: true },
    { key: 'story', label: '人物与剧情', description: '人物发动机、证据门、推进、对白与纠偏', start: 'nmj-v64-section-story-start', end: 'nmj-v64-section-story-end' },
    { key: 'tone', label: '文风与张力', description: '文风、场景张力、亲密镜头与叠加仲裁', start: 'nmj-v64-section-style-start', end: 'nmj-v64-section-arbitration-end' },
    { key: 'camera', label: '镜头与关系', description: '人称、执笔权与多角色 U→C 关系温度', start: 'nmj-v64-section-camera-start', end: 'nmj-v65-section-affinity-end' },
    { key: 'output', label: '语言与输出', description: '语言、篇幅、场景条、幕后与余波、世界线', start: 'nmj-v64-section-language-start', end: 'nmj-v64-section-output-end' },
    { key: 'extras', label: '幕间与选项', description: '小剧场、边角频道与回复方向', start: 'nmj-v64-section-theater-start', end: 'nmj-v64-section-choices-end' },
    { key: 'exit', label: '出口与收尾', description: '出口检查、核心续写与定义增强', start: 'nmj-v64-section-exit-start', end: 'enhanceDefinitions' },
] as const;

export const isStoryPresetSectionMarker = (prompt: StoryTheaterPresetPrompt): boolean => Boolean(prompt.section) || /^nmj-v6[45]-section-.+-(start|end)$/.test(prompt.id);

export const isProtectedStoryPrompt = (prompt: StoryTheaterPresetPrompt): boolean => Boolean(
    prompt.marker || prompt.id === 'nmj-v64-section-sources-start' || prompt.id === 'nmj-v64-section-sources-end'
    || ['charDescription', 'charPersonality', 'worldInfoBefore', 'personaDescription', 'worldInfoAfter', 'scenario', 'dialogueExamples', 'chatHistory'].includes(prompt.id)
);


/** Normalize *display labels* for decorative Tavern headers only.
 * Source names, contents and switches remain byte-for-byte unchanged. */
export const storyTavernHeadingTitle = (raw: string): string => {
    const original = raw.trim();
    if (!original) return '';
    const decorated = /[━─═┏┗╔╚┌└╭╰▣◈▾▿▴▵▼▲☆★✦✧⬇⬆]|^[#*~_+=|—-]{2,}|[#*~_+=|—-]{2,}$/u.test(original)
        || /\p{Extended_Pictographic}/u.test(original);
    if (!decorated) return original;
    const plain = original.replace(/[\uFE0F\u200d]|\p{Extended_Pictographic}|[\u2500-\u259f\u25a0-\u25ff\u2b00-\u2bff]/gu, '');
    const framed = /【([^【】]{1,90})】/u.exec(plain);
    // 【...】 is commonly the actual author title; only unwrap it when
    // everything around it is graphical decoration, not other meaningful text.
    const content = framed && !/[\p{L}\p{N}]/u.test(plain.replace(framed[0], ''))
        ? framed[1] : plain;
    const leadingTrimmed = content.replace(/^[^\p{L}\p{N}]+/u, '');
    const cutoff = leadingTrimmed.replace(/[^\p{L}\p{N}]+$/u, '');
    // Keep author-written (选一) / [可叠加] suffixes when they are balanced.
    // A closing bracket is not part of the decorative frame in that case.
    const closers: Record<string, string> = { ')': '(', '）': '（', ']': '[', '］': '［',
        '】': '【', '」': '「', '』': '『', '》': '《' };
    const closing = /([)）\]］】」』》])[^\p{L}\p{N}]*$/u.exec(leadingTrimmed)?.[1];
    const kept = closing && cutoff.includes(closers[closing]) ? cutoff + closing : cutoff;
    const title = kept.replace(/\s{2,}/gu, ' ').trim();
    return /[\p{L}\p{N}]/u.test(title) ? title : '';
};

/**
 * Only explicit editorial separators count as headings; blank content alone
 * never does. Some actual Tavern headings carry nonempty prompt content.
 * Grouping is view-only and cannot change source order, roles or enabled flags.
 */
const recognizeTavernPromptHeadingRaw = (
    prompt: StoryTheaterPresetPrompt,
): { label: string; edge: 'start' | 'end' | 'divider' } | undefined => {
    if (prompt.marker || prompt.section) return undefined;
    const name = prompt.name.trim();
    if (!name || name.length > 450) return undefined;
    // Some real author presets delimit a whole adjustable section with
    // ┏╔标题╗┓ ... ┗╚标题╝┛. These are browse boundaries, not choices.
    const corner = /^[┏┗]?[╔╚](.{2,75})[╗╝][┓┛]?$/.exec(name);
    if (corner) return { label: corner[1].trim(), edge: /[┗╚╝┛]/.test(name) ? 'end' : 'start' };
    // Structural banners only: never inspect prompt bodies to decide sections.
    const pipe = /^[|｜]\s*[—─━=-]+\s*(.{1,72}?)\s*[—─━=-]+\s*[|｜](?:\s+.*)?$/u.exec(name);
    if (pipe) return { label: pipe[1].trim(), edge: 'divider' };
    if (/^[▾▿▼▽⏷\s]{2,}(?:选一|单选|择一)[▾▿▼▽⏷\s]{2,}$/u.test(name))
        return { label: '选一', edge: 'start' };
    if (/^[▴▵▲△⏶\s]{2,}(?:选一|单选|择一)[▴▵▲△⏶\s]{2,}$/u.test(name))
        return { label: '选一', edge: 'end' };
    // MoM and Phantasm author headings do not always use paired arrows.
    // They are visual boundaries, not selectable prompt entries.
    const tabHeading = /^▍\s*(.{2,72})$/u.exec(name);
    if (tabHeading) return { label: tabHeading[1].trim(), edge: 'start' };
    const openBox = /^┌\s*(.{2,72}?)\s*┐(?:\s*.*)?$/u.exec(name);
    if (openBox) return { label: openBox[1].trim(), edge: 'start' };
    const closeBox = /^└\s*(.{2,72}?)\s*┘$/u.exec(name);
    if (closeBox) return { label: closeBox[1].trim(), edge: 'end' };
    const centered = /^✧─\s*(.{2,72}?)\s*─✧$/u.exec(name);
    if (centered) return { label: centered[1].trim(), edge: 'divider' };
    // Generic paired decorative headings (author titles need not include
    // any native keyword or use a known author emoji).
    const pairedHeader = /^[╭╔┌┏]\s*[─═-]*\s*(.{2,78}?)\s*[─═-]*\s*[╮╗┐┓]$/u.exec(name);
    if (pairedHeader) return { label: pairedHeader[1].trim(), edge: 'start' };
    const pairedFooter = /^[╰╚└┗]\s*[─═-]*\s*(.{2,78}?)\s*[─═-]*\s*[╯╝┘┛]$/u.exec(name);
    if (pairedFooter) return { label: pairedFooter[1].trim(), edge: 'end' };
    const bracket = /^<==(.{2,68}?)==>$/.exec(name);
    if (bracket && /[▣◈◀▶]/u.test(bracket[1])) {
        return { label: bracket[1].trim(), edge: 'start' };
    }
    const hasArrow = /[⬇⬆↓↑]/u.test(name) && /(?:={2,}|—|📌)/u.test(name);
    if (hasArrow) {
        const up = /[⬆↑]/u.test(name) && !/[⬇↓]/u.test(name);
        const hit = /[⬇⬆↓↑]\uFE0F?\s*(.{2,55}?)\s*[⬇⬆↓↑]/u.exec(name);
        const label = (hit?.[1] || '').trim();
        if (label) return { label, edge: up ? 'end' : 'start' };
    }
    // Mur/Janus short-dash separators; the slash and "结束" close a section.
    const dash = /^[-—]{3,}\s*(.{2,75}?)\s*[-—]{2,}$/u.exec(name)
        || /^-{4,}\s*(Think\s*(?:开始|结束))\s*$/iu.exec(name);
    if (dash) {
        const value = dash[1].trim();
        if (!value || /^[-—]+$/u.test(value)) return undefined;
        return { label: value.replace(/^\/\s*/u, '').trim(),
            edge: /^\/|结束|尾部/u.test(value) ? 'end' : 'divider' };
    }
    // Ako uses paired decorative em-dash separators, even with content.
    const em = /^—{2,}\s*(.{2,65}?)\s*—{2,}$/u.exec(name);
    if (em) {
        const value = em[1].trim();
        if (value) return { label: value, edge: /结束|尾部/u.test(value) ? 'end' : 'divider' };
    }
    if (/^[╓╙]/u.test(name) && name.length <= 45) {
        return { label: name.slice(1).trim(), edge: name.startsWith('╙') ? 'end' : 'start' };
    }
    return undefined;
};

/** Structural display recognition. Decoration counts as a boundary only when
 * there is a readable central title and framing on both sides. */
export const recognizeTavernPromptHeading = (
    prompt: StoryTheaterPresetPrompt,
): { label: string; edge: 'start' | 'end' | 'divider' } | undefined => {
    const source = recognizeTavernPromptHeadingRaw(prompt);
    if (source) {
        const label = storyTavernHeadingTitle(source.label);
        return label ? { ...source, label } : undefined;
    }
    if (prompt.marker || prompt.section) return undefined;
    const name = prompt.name.trim();
    if (!name || name.length > 450) return undefined;
    const prefix = name.match(/^[^\p{L}\p{N}]*/u)?.[0].replace(/\s/g, '') || '';
    const suffix = name.match(/[^\p{L}\p{N}]*$/u)?.[0].replace(/\s/g, '') || '';
    if (prefix.length < 3 || suffix.length < 3
        || !/[═━─—\-☆★✦✧#*~_=┏┗╔╚┌└╭╰]/u.test(prefix + suffix)) return undefined;
    const label = storyTavernHeadingTitle(name);
    if (!label || label.length > 80) return undefined;
    const end = /^[┗╚└╰]|[┛╝┘╯]$/u.test(name) || /[⬆↑]/u.test(prefix + suffix);
    const start = /^[┏╔┌╭]/u.test(name) || /[⬇↓]/u.test(prefix + suffix);
    return { label, edge: end ? 'end' : start ? 'start' : 'divider' };
};

/** Browse-only show/hide decision. Author headers with meaningful bodies are
 * inspectable, while empty markers, comments and XML-only shells stay hidden. */
export const isStoryPresetBrowseVisible = (prompt: StoryTheaterPresetPrompt): boolean => {
    const kind = storyPresetPromptKind(prompt);
    if (kind === 'content' || kind === 'connector') return true;
    if (kind !== 'structure' || !recognizeTavernPromptHeading(prompt)) return false;
    const body = prompt.content.replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\{\{\s*\/\/[\s\S]*?\}\}/g, '').trim();
    if (!body || !/[\p{L}\p{N}]/u.test(body)) return false;
    if (/^<\/?[\w:-]+(?:\s+[^<>]*)?\s*\/?>$/u.test(body)) return false;
    if (/^<([\w:-]+)(?:\s+[^<>]*)?>\s*<\/\1>$/u.test(body)) return false;
    return true;
};

/** Browse-only classification. Never delete or rewrite original author entries.
 * XML envelopes and runtime slots must not be mistaken for empty prompts. */
export const storyPresetPromptKind = (
    prompt: StoryTheaterPresetPrompt,
): 'content' | 'connector' | 'structure' | 'empty' | 'placeholder' => {
    if (prompt.marker) return 'connector';
    if (isStoryPresetSectionMarker(prompt)) return 'structure';
    const visible = prompt.content
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\{\{\s*\/\/[\s\S]*?\}\}/g, '').trim();
    // Only entire, explicit edition-not-included notices are placeholders.
    // Keep arbitrary author prose, setvar macros, and content containing tags.
    if (/^[\[【(（]?\s*(?:Lite|精简版|轻量版)\s*(?:未包含|不包含|没有)\s*(?:此|该)?(?:扩展|模块|功能)\s*[.!。！]?\s*[\]】)）]?$/iu.test(visible)) return 'placeholder';
    // A decorated heading may itself contain actual author instructions.
    // Keep the instructions visible in the professional list, while still
    // recognizing the heading as a section boundary for grouping.
    const isBoundaryTag = /^<\/?[\w:-]+(?:\s+[^<>]*)?\s*\/?>$/u.test(visible);
    if (recognizeTavernPromptHeading(prompt) && (!visible || isBoundaryTag)) return 'structure';
    if (!visible) return 'empty';
    if (!/[\p{L}\p{N}]/u.test(visible)) return 'structure';
    if (isBoundaryTag) return 'structure';
    return 'content';
};

const tavernVisualGroups = (
    prompts: StoryTheaterPresetPrompt[], start: number, end: number,
): StoryPresetPromptGroup[] => {
    const result: StoryPresetPromptGroup[] = [];
    let from = start;
    let title = '';
    let sectionActive = false;
    const emit = (last: number) => {
        if (last < from) return;
        const slice = prompts.slice(from, last + 1);
        result.push({
            key: 'tavern:' + slice[0].id,
            label: title || (from === 0 ? '预设开头' : '其他条目'),
            description: '酒馆浏览分类 · 原顺序第 ' + (from + 1) + '–' + (last + 1) + ' 条（不改变提示词）',
            promptIds: slice.map(prompt => prompt.id),
            startIndex: from, endIndex: last, protected: false, autoGrouped: true,
        });
    };
    for (let i = start; i <= end; i += 1) {
        const heading = recognizeTavernPromptHeading(prompts[i]);
        if (!heading) continue;
        if (heading.edge === 'start' || heading.edge === 'divider') {
            // A repeated decorative divider often terminates the prior block.
            if (heading.edge === 'divider' && title && sectionActive && heading.label === title) {
                emit(i);
                from = i + 1; title = ''; sectionActive = false;
                continue;
            }
            emit(i - 1);
            from = i; title = heading.label; sectionActive = true;
        } else if (sectionActive) {
            emit(i);
            from = i + 1; title = ''; sectionActive = false;
        }
    }
    emit(end);
    return result;
};

/** Keep original prompt order while browsing static SillyTavern entryGrouping.
 * Overlapping and noncontiguous metadata becomes contiguous display-only runs. */
const tavernMetadataVisualGroups = (
    document: StoryTheaterPresetDocument,
    prompts: StoryTheaterPresetPrompt[],
    start: number,
    end: number,
): StoryPresetPromptGroup[] => {
    const byId = new Map(prompts.map((prompt, index) => [prompt.id, index]));
    const owned = new Map<number, { id: string; name: string }>();
    for (const meta of document.tavernEntryGroups || []) {
        const indexes: number[] = [];
        if (meta.memberIdentifiers?.length) {
            for (const identifier of meta.memberIdentifiers) {
                const index = byId.get('st-' + identifier);
                if (index !== undefined) indexes.push(index);
            }
        } else if (meta.startIdentifier && meta.endIdentifier) {
            const first = byId.get('st-' + meta.startIdentifier);
            const last = byId.get('st-' + meta.endIdentifier);
            if (first !== undefined && last !== undefined && first <= last) {
                for (let index = first; index <= last; index++) indexes.push(index);
            }
        }
        const owner = { id: meta.id, name: storyTavernHeadingTitle(meta.name) || meta.name };
        for (const index of indexes) {
            if (index >= start && index <= end && !owned.has(index)) {
                owned.set(index, owner);
            }
        }
    }
    if (!owned.size) return tavernVisualGroups(prompts, start, end);
    const result: StoryPresetPromptGroup[] = [];
    let cursor = start;
    while (cursor <= end) {
        const owner = owned.get(cursor);
        let next = cursor + 1;
        while (next <= end && owned.get(next) === owner) next += 1;
        if (!owner) {
            result.push(...tavernVisualGroups(prompts, cursor, next - 1));
        } else {
            const slice = prompts.slice(cursor, next);
            result.push({
                key: 'tavern-meta:' + owner.id + ':' + slice[0].id,
                label: owner.name,
                description: '原作者分组 · 保留原始顺序',
                promptIds: slice.map(prompt => prompt.id),
                startIndex: cursor,
                endIndex: next - 1,
                protected: false,
                autoGrouped: true,
            });
        }
        cursor = next;
    }
    return result;
};

export const getStoryPresetPromptGroups = (document: StoryTheaterPresetDocument): StoryPresetPromptGroup[] => {
    const prompts = document.prompts;
    const claimed = new Set<number>();
    const groups: StoryPresetPromptGroup[] = [];
    for (const spec of STORY_PRESET_GROUP_SPECS) {
        const startIndex = prompts.findIndex(prompt => prompt.id === spec.start);
        const endIndex = prompts.findIndex(prompt => prompt.id === spec.end);
        if (startIndex < 0 || endIndex < startIndex || claimed.has(startIndex) || claimed.has(endIndex)) continue;
        const indexes = Array.from({ length: endIndex - startIndex + 1 }, (_, offset) => startIndex + offset);
        indexes.forEach(index => claimed.add(index));
        groups.push({
            key: spec.key,
            label: spec.label,
            description: spec.description,
            promptIds: indexes.map(index => prompts[index].id),
            startIndex,
            endIndex,
            protected: 'protected' in spec && spec.protected === true,
        });
    }
    for (let startIndex = 0; startIndex < prompts.length; startIndex++) {
        const section = prompts[startIndex].section;
        if (section?.edge !== 'start' || claimed.has(startIndex)) continue;
        const endIndex = prompts.findIndex((prompt, index) => index > startIndex && prompt.section?.id === section.id && prompt.section.edge === 'end');
        if (endIndex < 0 || prompts.slice(startIndex + 1, endIndex).some(prompt => prompt.section) || Array.from({ length: endIndex - startIndex + 1 }, (_, offset) => startIndex + offset).some(index => claimed.has(index))) continue;
        const indexes = Array.from({ length: endIndex - startIndex + 1 }, (_, offset) => startIndex + offset);
        indexes.forEach(index => claimed.add(index));
        groups.push({ key: `section:${section.id}`, label: section.name, description: '自定义分组 · 可添加提示词、调整顺序', promptIds: indexes.map(index => prompts[index].id), startIndex, endIndex, protected: false, customSectionId: section.id });
    }
    let cursor = 0;
    while (cursor < prompts.length) {
        if (claimed.has(cursor)) { cursor += 1; continue; }
        const startIndex = cursor;
        while (cursor + 1 < prompts.length && !claimed.has(cursor + 1)) cursor += 1;
        const endIndex = cursor;
        if (document.sourceFormat === 'sillytavern') {
            groups.push(...tavernMetadataVisualGroups(document, prompts, startIndex, endIndex));
        } else {
        groups.push({
                key: `custom:${prompts[startIndex]?.id || startIndex}`,
                label: '自定义条目',
                description: '没有归入内置区间的自定义提示词',
                promptIds: prompts.slice(startIndex, endIndex + 1).map(prompt => prompt.id),
                startIndex,
                endIndex,
                protected: false,
            });
        }
        cursor += 1;
    }
    return groups.sort((a, b) => a.startIndex - b.startIndex);
};


/**
 * Imported Tavern presets have THEIR OWN choices, not native Night Screening
 * styles/lengths. Derive a browse-only control surface from the author's
 * original entries, retaining every prompt in its original order.
 */
export interface StoryTavernAuthorOption {
    id: string;
    label: string;
    enabled: boolean;
    cluster: string;
    /** Show an explicit, non-destructive jump to the original prompt. */
    name: string;
    /** A literal author value such as 800–1500字, never a native tier guess. */
    preview?: string;
}
export interface StoryTavernAuthorSection {
    key: string;
    label: string;
    description: string;
    options: StoryTavernAuthorOption[];
    /** Author explicitly says pick one, or the source is a known tier group. */
    single: boolean;
}

const tavernAuthorChoiceName = (name: string): string => name
    .replace(/^[\s▢▣◈❍╋╬⭐🌟✅🟢💚💛🩵🎵📩👻✍️📢🎦🆖🆓]+/gu, '')
    .replace(/[\s📩⭐✨▢▣◈❍]+$/gu, '')
    .trim() || name.trim();


const tavernAuthorValuePreview = (prompt: StoryTheaterPresetPrompt): string | undefined => {
    const source = prompt.content;
    // Show any author's explicit local variable value, never infer a
    // built-in label. Omit long HTML/instruction bodies from compact chips.
    const literal = /\{\{\s*setvar\s*::\s*[^:{}\n]{1,65}\s*::\s*([^{}\n]{1,64})\}\}/i.exec(source)?.[1]?.trim();
    if (literal && !/[<>]/.test(literal)) return literal;
    const chineseRange = /(\d{2,5}\s*(?:-|—|–|~|～|至|到)\s*\d{2,5}\s*(?:个)?字)/u.exec(source)?.[1];
    if (chineseRange) return chineseRange;
    const exact = /(?:字数要求|正文.*?字数)\s*[：:]?\s*(\d{2,5}\s*(?:个)?字)/u.exec(source)?.[1];
    if (exact) return exact;
    const words = /(\d{2,5}\s*(?:-|—|–|~|～|to)\s*[\d,]{2,7}\s*[- ]?(?:word|words)\b)/i.exec(source)?.[1];
    if (words) return words + '（英文计数）';
    const budget = /Word_budget\s*:\s*(\d{2,5}\s*(?:-|—|–|~|～)\s*\d{2,5})/i.exec(source)?.[1];
    if (budget) return budget + '（作者单位）';
    return undefined;
};

const tavernChoiceCluster = (prompt: StoryTheaterPresetPrompt): string => {
    const namedRule = /<rule\b[^>]*\bname=["']([^"']+)["']/i.exec(prompt.content)?.[1] || '';
    if (namedRule) {
        const root = namedRule.split(/[·｜|]/)[0].trim().replace(/(?:[一二三四五六七八九十\d]+档.*)$/u, '');
        if (/^语言$/.test(root)) return /对话/.test(namedRule) ? 'rule:语言·对话' : 'rule:语言·叙事';
        if (root) return 'rule:' + root.toLocaleLowerCase();
    }
    if (/<writing_style\s*:/i.test(prompt.content)) return 'author:writing_style';
    if (/<(?:pov|multi_perspective_pov)\b/i.test(prompt.content)) return 'author:pov';
    const globalSet = /\{\{\s*setglobalvar\s*::\s*([^:{}]+?)\s*::/i.exec(prompt.content)?.[1];
    if (globalSet) return 'global:' + globalSet.trim();
    const localAssignments = [...prompt.content.matchAll(/\{\{\s*setvar\s*::\s*([^:{}]+?)\s*::/gi)];
    if (localAssignments.length === 1) return 'local:' + localAssignments[0][1].trim();
    const shortName = tavernAuthorChoiceName(prompt.name);
    if (/可叠加|叠加使用/.test(shortName)) return '';
    if (/(?:[2-9]|[二三四五六七八九])选1|选一/i.test(shortName) && /小剧场/.test(shortName)) return 'author:theater-choice';
    if (/小剧场/.test(shortName)) return 'author:theater-format';
    if (/^(?:✅)?(?:主文风|文风[-：:]|拖：)/.test(shortName) || /⌨️.*文风/.test(prompt.name)) return 'author:style';
    if (/人称|视角/.test(prompt.name)) return 'author:pov';
    if (/抢话|不抢话/.test(prompt.name)) return 'author:agency';
    if (/复述|转述/.test(prompt.name)) return 'author:retell';
    return '';
};

/** Structural hints work even when the author uses an unknown language,
 * invented section title or custom variable name. These never change
 * authored prompt content; they only organize real source prompt switches. */
const tavernOneOf = (value: string): boolean =>
    /(?:选\s*(?:一|1|①)|择一|单选|任选其一|(?:[2-9]|[二三四五六七八九])\s*选\s*(?:一|1)|one[\s-]*of|choose\s+one|mutually\s+exclusive|每.{0,3}(?:仅|限|只)(?:选|留|开)?(?:一|1)|只留(?:一个|一条|一种))/iu.test(value);

const tavernOptionalModule = (value: string): boolean =>
    /(?:可选|选修|任意开关|多选|可叠加|叠加|optional|toggle|enable|disable)/iu.test(value);

const tavernMandatoryName = (value: string): boolean =>
    /^(?:必开|必须开启|别动|不要关|请勿关闭|核心规则|系统核心|原作者声明|免责声明|版权声明|作者声明|启动核心|不可关闭|勿关闭|set-不要关|教程|使用教程|使用说明|免责|^main$)/iu.test(
        tavernAuthorChoiceName(value));

const tavernGroupIsRuntimeCore = (name: string): boolean =>
    /(?:预设头部|预设底部|预设尾部|预设信息|教学基石|缄默法则|运行核心|角色连接|历史连接|系统骨架|剧情规范|请勿关闭)/iu.test(name);

/** Stable same-source choice identity; never infer a category from a fixed
 * set of native preset names. A shared setvar key or authored name prefix
 * supplies the actual category, whatever the author calls it. */
const tavernStructuralFamily = (prompt: StoryTheaterPresetPrompt): string => {
    const cluster = tavernChoiceCluster(prompt);
    if (/^(?:rule:|local:|global:)/.test(cluster)) return cluster;
    const name = tavernAuthorChoiceName(prompt.name).replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+/gu, '');
    // Some newer formats mark a one-of-N family in the entry name itself.
    const authoredChoice = /[（(]\s*(?:选一|单选|择一)\s*[）)]\s*(.{2,35}?)[-—:：]/u.exec(name);
    if (authoredChoice) return 'author-choice:' + authoredChoice[1].trim().toLocaleLowerCase();
    const prefixed = /^(.{2,35}?)[：:·｜|／/]\s*(.{1,80})$/u.exec(name);
    if (prefixed && !/^(?:系统|说明|规则|注意|配置|章节|模块|代码)$/u.test(prefixed[1]))
        return 'author-prefix:' + prefixed[1].trim().toLocaleLowerCase();
    return '';
};

const tavernAuthorTopic = (name: string): string | undefined => {
    // Only map CATEGORY names. Never map an imported author's choices onto
    // fixed native style IDs or make up a missing author option.
    if (/文风|写作风格|叙事风格|author.style/i.test(name)) return '文风';
    if (/人称|视角|pov/i.test(name)) return '人称与视角';
    if (/抢话|代写|执笔权|演绎权限/i.test(name)) return '抢话与执笔权';
    if (/复述|转述|回放扩写|回复处理/i.test(name)) return '转述与接戏';
    if (/小剧场|side.?theater|sidestory|幕间/i.test(name)) return '小剧场';
    if (/语言|译文|翻译|zh[-_](?:CN|TW)/i.test(name)) return '语言与翻译';
    if (/篇幅|字数|段落长短|word.budget/i.test(name)) return '篇幅与段落';
    return undefined;
};

export const getStoryTavernAuthorSections = (
    document: StoryTheaterPresetDocument,
): StoryTavernAuthorSection[] => {
    if (document.sourceFormat !== 'sillytavern') return [];
    const groups = getStoryPresetPromptGroups(document);
    const seen = new Set<string>();
    const out: StoryTavernAuthorSection[] = [];
    const eligible = (p: StoryTheaterPresetPrompt): boolean =>
        storyPresetPromptKind(p) === 'content'
        && !recognizeTavernPromptHeading(p)
        && !tavernMandatoryName(p.name)
        && !/^(?:说明|使用教程|免责|注意事项)/.test(tavernAuthorChoiceName(p.name));
    const makeOptions = (items: StoryTheaterPresetPrompt[]): StoryTavernAuthorOption[] => items
        .filter(eligible)
        .map(p => ({
            id: p.id, label: tavernAuthorChoiceName(p.name),
            name: p.name, enabled: p.enabled, cluster: tavernChoiceCluster(p),
            preview: tavernAuthorValuePreview(p),
        }));
    // Newer MoM presets ship a static entryGrouping index. Its names and
    // members are the author's categories, not borrowed native options.
    // This metadata is independent of scripts and must not change send order.
    const byId = new Map(document.prompts.map((prompt, i) => [prompt.id, i]));
    // Entry-group names are arbitrary author data. Never require a
    // known native category: inspect the *members*, then exclude only
    // clearly protected infrastructure or non-selectable explanations.
    const metadataShown = (name: string, options: StoryTavernAuthorOption[]): boolean => {
        const explicit = tavernOneOf(name) || tavernOptionalModule(name)
            || options.some(option => tavernOneOf(option.name) || tavernOptionalModule(option.name));
        if (tavernGroupIsRuntimeCore(name) && !explicit) return false;
        // Metadata existence is stable across toggle/save/reopen. Do NOT base
        // visibility on whether this option happens to be off right now.
        return options.length >= 1;
    };
    for (const meta of document.tavernEntryGroups || []) {
        const identifiers = new Set((meta.memberIdentifiers || []).map(id => 'st-' + id));
        if (!identifiers.size && meta.startIdentifier && meta.endIdentifier) {
            const start = byId.get('st-' + meta.startIdentifier);
            const end = byId.get('st-' + meta.endIdentifier);
            if (start !== undefined && end !== undefined && start <= end) {
                for (const prompt of document.prompts.slice(start, end + 1)) identifiers.add(prompt.id);
            }
        }
        const members = document.prompts.filter(prompt => identifiers.has(prompt.id) && !seen.has(prompt.id));
        const options = makeOptions(members).filter(option =>
            !/^(?:┌|└|╔|╚|┏|┗|—{2,}|[-—]{3,}|✧─|═|——|\/)/u.test(option.label)
            && !/^(?:不要关|必开|别动|开始|结束|说明|获取变量|set-)/i.test(option.label));
        if (!metadataShown(meta.name, options)) continue;
        // Group labels can say "one of" even when additional author choices
        // are stackable. Never close explicit overlays as collateral damage.
        const isOverlay = (value: string): boolean => /可叠加|叠加使用|overlay|stackable/iu.test(value);
        // Author one-of notices may be written on a decorative opening
        // delimiter rather than the extension's category display name.
        const groupSingle = tavernOneOf(meta.name) || members.some(prompt =>
            Boolean(recognizeTavernPromptHeading(prompt)) && tavernOneOf(prompt.name));
        const personallyLabeled = options.filter(option => tavernOneOf(option.name) && !isOverlay(option.name));
        const exclusiveOptions = groupSingle
            ? options.filter(option => !isOverlay(option.name))
            : personallyLabeled.length >= 2 ? personallyLabeled : [];
        const independentOptions = groupSingle
            ? options.filter(option => isOverlay(option.name))
            : options.filter(option => !exclusiveOptions.some(one => one.id === option.id));
        const label = storyTavernHeadingTitle(meta.name) || meta.name.trim();
        if (exclusiveOptions.length && independentOptions.length) {
            out.push({ key: 'entry:' + meta.id + ':single', label: label + ' · 单选',
                description: '仅对原作者明确标注的互斥条目生效',
                options: exclusiveOptions, single: true });
            out.push({ key: 'entry:' + meta.id + ':independent', label: label + ' · 独立开关',
                description: '可叠加条目不会被单选操作关闭',
                options: independentOptions, single: false });
        } else {
            out.push({ key: 'entry:' + meta.id, label,
                description: exclusiveOptions.length ? '原作者明确标注单选' : '未明确互斥关系，保留独立开关',
                options, single: exclusiveOptions.length > 0 });
        }
        options.forEach(option => seen.add(option.id));
    }
    for (const group of groups) {
        const named = group.autoGrouped && !/^(?:预设开头|其他条目)$/.test(group.label);
        if (!named) continue;
        const items = document.prompts.filter(p => group.promptIds.includes(p.id));
        const options = makeOptions(items.filter(prompt => !seen.has(prompt.id)));
        // A novel writer can call the section absolutely anything. Paired
        // decorative headings + real enabled/disabled choice entries count.
        const explicit = tavernOneOf(group.label) || tavernOptionalModule(group.label);
        if (!options.length || (tavernGroupIsRuntimeCore(group.label) && !explicit)
            || (options.length < 2 && !explicit)) continue;
        // A named source section is an author's real module, even when its
        // title is not one of the native eight (e.g. 结尾落点/剧情节奏).
        const key = 'source:' + group.key;
        // Phantasm uses one titled block for three different SOURCE
        // subchapters. A "择一" primary style must never make overlays or
        // rhetoric exclusive. Split only at the author's actual headings.
        const overlayIndex = /文风.*择一/.test(group.label)
            ? options.findIndex(option => /可叠加/.test(option.label)) : -1;
        const rhetoricIndex = overlayIndex > 0
            ? options.findIndex((option, i) => i > overlayIndex && /表现.*修辞手法/.test(option.label))
            : -1;
        if (overlayIndex > 0) {
            const primary = options.slice(0, overlayIndex);
            const overlays = options.slice(overlayIndex, rhetoricIndex > overlayIndex ? rhetoricIndex : undefined);
            const rhetoric = rhetoricIndex > overlayIndex ? options.slice(rhetoricIndex + 1) : [];
            out.push({ key: key + ':primary', label: group.label.trim(),
                description: '', options: primary, single: true });
            if (overlays.length) out.push({ key: key + ':overlay', label: '可叠加文体',
                description: '', options: overlays, single: false });
            if (rhetoric.length) out.push({ key: key + ':rhetoric',
                label: options[rhetoricIndex].label, description: '',
                options: rhetoric, single: false });
            options.forEach(option => seen.add(option.id));
            continue;
        }
        out.push({
            key, label: group.label.replace(/[▣◈▶◀︎◌]/gu, '').replace(/\s+/g, ' ').trim(),
            description: '原作者分组 · 切换原始条目，不附加内置规则',
            options, single: tavernOneOf(group.label)
                && !options.some(option => /可叠加|修辞手法|表现&修辞/.test(option.label)),
        });
        options.forEach(p => seen.add(p.id));
    }
    // Generic last resort for presets with NO entryGrouping or recognized
    // heading: consecutive alternate setvar/getvar choices or a repeated
    // literal name prefix form a real section, even with an invented name.
    const structural = new Map<string, StoryTheaterPresetPrompt[]>();
    for (const prompt of document.prompts) {
        if (seen.has(prompt.id) || !eligible(prompt)) continue;
        const family = tavernStructuralFamily(prompt);
        if (!family) continue;
        const items = structural.get(family) || [];
        items.push(prompt);
        structural.set(family, items);
    }
    for (const [family, items] of structural) {
        if (items.length < 2) continue;
        // Avoid merging unrelated distant chapters that happen to reuse
        // "mode" or "tone" as a variable name.
        const indexes = items.map(item => byId.get(item.id) ?? 0);
        if (Math.max(...indexes) - Math.min(...indexes) > 50) continue;
        const options = makeOptions(items);
        const groupLabel = family.replace(/^(?:author-choice:|author-prefix:|rule:|local:|global:)/, '');
        out.push({
            key: 'structure:' + family, label: groupLabel,
            description: '', options,
            single: family.startsWith('author-choice:') && items.every(item => tavernOneOf(item.name)),
        });
        options.forEach(option => seen.add(option.id));
    }
    // Single uncategorized prompts remain in the professional editor, where
    // users can inspect them without risking a core-rule toggle.
    const fallback = new Map<string, StoryTheaterPresetPrompt[]>();
    for (const prompt of document.prompts) {
        if (seen.has(prompt.id) || !eligible(prompt)) continue;
        const topic = tavernAuthorTopic(prompt.name);
        if (!topic) continue;
        const list = fallback.get(topic) || [];
        list.push(prompt);
        fallback.set(topic, list);
    }
    for (const [topic, items] of fallback) {
        const options = makeOptions(items);
        if (!options.length) continue;
        out.push({
            key: 'author:' + topic, label: topic,
            description: '按原作者条目归类 · 名称与内容均不改写',
            options,
            single: false,
        });
    }
    // Keep the author's effective prompt order, not arbitrary plugin JSON
    // array ordering, even when the metadata lists sections out of order.
    const firstIndex = (section: StoryTavernAuthorSection): number => Math.min(
        ...section.options.map(option => byId.get(option.id) ?? document.prompts.length));
    out.sort((a, b) => firstIndex(a) - firstIndex(b));
    return out;
};

/** Toggle the SOURCE prompt, never an approximated built-in directive.
 * When an author explicitly groups a one-of-N choice, disable its siblings.
 * Independent rules (e.g. 必开叙事中文 vs 对话语言) are left untouched.
 */
export const selectStoryTavernAuthorOption = (
    document: StoryTheaterPresetDocument,
    sectionKey: string,
    optionId: string,
): StoryTheaterPresetDocument => {
    if (document.sourceFormat !== 'sillytavern') return document;
    const section = getStoryTavernAuthorSections(document).find(s => s.key === sectionKey);
    const selected = section?.options.find(o => o.id === optionId);
    if (!section || !selected) return document;
    // No inferred exclusivity from current enabled count or prompt content.
    // A numbered N选1 label only affects peers with the same N选1 marker.
    const explicitCount = (name: string): string | undefined =>
        /(?:[2-9]|[二三四五六七八九])\s*选\s*(?:一|1)/u.exec(name)?.[0]
            .replace(/\s+/g, '').replace(/一$/, '1');
    const selectedCount = explicitCount(selected.name);
    const numberedPeers = selectedCount
        ? section.options.filter(option => option.id !== optionId && explicitCount(option.name) === selectedCount)
        : [];
    const byId = new Map(document.prompts.map(prompt => [prompt.id, prompt]));
    const tierPattern = /<rule\b[^>]*\bname=["'][^"']+[·｜|]\s*[一二三四五六七八九十\d]+\s*档["']/i;
    const tier = tierPattern.test(byId.get(optionId)?.content || '');
    // These XML attributes declare a shared choice slot. Only switch peers
    // in the same slot; unrelated prompts are always left alone.
    const scoped = selected.cluster === 'rule:语言·对话';
    const structuralPeers = tier || scoped
        ? section.options.filter(option => option.id !== optionId
            && option.cluster === selected.cluster
            && (tier ? tierPattern.test(byId.get(option.id)?.content || '') : true))
        : [];
    // Explicit dialogue-language rule slots are alternate author languages.
    // They do not affect the separate always-on narration language.
    const explicitTiers = (tier || scoped) && structuralPeers.length > 0;
    const siblings = section.single
        ? section.options.filter(option => option.id !== optionId)
        : numberedPeers.length ? numberedPeers : explicitTiers ? structuralPeers : [];
    const exclusive = section.single || numberedPeers.length > 0 || explicitTiers;
    // Imported authors can have several "one-of" entries already enabled.
    // Do not rewrite those states on import; a click on ANY active entry is
    // the user's deliberate request to keep that entry and close its peers.
    if (selected.enabled && exclusive && !siblings.some(option => option.enabled)) return document;
    const newEnabled = exclusive ? true : !selected.enabled;
    const off = newEnabled ? new Set(siblings.map(option => option.id)) : new Set<string>();
    const requiredWrappers = new Set<string>();
    // Authors sometimes disable an entire XML-wrapped block until one of its
    // child choices is selected (e.g. 宝宝我是char's <theater> ... </theater>).
    // Activating the child must activate BOTH wrappers without rewriting text.
    if (newEnabled) {
        // Unknown authors may describe XML source envelopes in static
        // entryGrouping metadata, or via decorated boundary prompts.
        const index = document.prompts.findIndex(prompt => prompt.id === optionId);
        const entryGroup = sectionKey.startsWith('entry:')
            ? document.tavernEntryGroups?.find(group => 'entry:' + group.id === sectionKey
                || sectionKey.startsWith('entry:' + group.id + ':'))
            : undefined;
        const enclosing = (start: number, end: number): void => {
            if (start < 0 || end <= index || start >= index) return;
            const open = /^\s*<([A-Za-z][\w:-]*)>/.exec(document.prompts[start].content)?.[1];
            const close = document.prompts[end]?.content || '';
            if (open && new RegExp('^\\s*<\\/' + open + '\\s*>\\s*$', 'i').test(close)) {
                requiredWrappers.add(document.prompts[start].id);
                requiredWrappers.add(document.prompts[end].id);
            }
        };
        if (entryGroup?.startIdentifier && entryGroup.endIdentifier) {
            enclosing(
                document.prompts.findIndex(prompt => prompt.id === 'st-' + entryGroup.startIdentifier),
                document.prompts.findIndex(prompt => prompt.id === 'st-' + entryGroup.endIdentifier),
            );
        }
        if (!requiredWrappers.size && index > 0) {
            const lower = Math.max(0, index - 80);
            const upper = Math.min(document.prompts.length - 1, index + 80);
            for (let start = index - 1; start >= lower; start--) {
                const open = /^\s*<([A-Za-z][\w:-]*)>/.exec(document.prompts[start].content)?.[1];
                if (!open) continue;
                const end = document.prompts.findIndex((prompt, at) =>
                    at > index && at <= upper
                    && new RegExp('^\\s*<\\/' + open + '\\s*>\\s*$', 'i').test(prompt.content));
                if (end > index) { enclosing(start, end); break; }
            }
        }
    }
    return {
        ...document,
        prompts: document.prompts.map(p =>
            p.id === optionId ? { ...p, enabled: newEnabled }
                : off.has(p.id) ? { ...p, enabled: false }
                    : requiredWrappers.has(p.id) ? { ...p, enabled: true } : p),
    };
};

export const addStoryPresetGroup = (document: StoryTheaterPresetDocument, name: string): StoryTheaterPresetDocument => {
    const id = makeStoryTheaterId();
    return { ...document, prompts: [...document.prompts, ...(['start', 'end'] as const).map(edge => ({
        id: makeStoryTheaterId(), name: name.trim() || '自定义分组', enabled: false, role: 'system' as const, content: '',
        section: { id, name: name.trim() || '自定义分组', edge },
    }))] };
};

export const renameStoryPresetGroup = (document: StoryTheaterPresetDocument, sectionId: string, name: string): StoryTheaterPresetDocument => ({
    ...document, prompts: document.prompts.map(prompt => prompt.section?.id === sectionId
        ? { ...prompt, section: { ...prompt.section, name } } : prompt),
});

export const ungroupStoryPresetGroup = (document: StoryTheaterPresetDocument, sectionId: string): StoryTheaterPresetDocument => ({
    ...document, prompts: document.prompts.filter(prompt => prompt.section?.id !== sectionId),
});

export const moveStoryPresetPromptToGroup = (document: StoryTheaterPresetDocument, promptId: string, groupKey: string): StoryTheaterPresetDocument => {
    const groups = getStoryPresetPromptGroups(document);
    const source = groups.find(group => group.promptIds.includes(promptId));
    const target = groups.find(group => group.key === groupKey);
    const prompt = document.prompts.find(item => item.id === promptId);
    if (!prompt || !target || target.protected || target.autoGrouped || source?.protected || source?.key === target.key || isProtectedStoryPrompt(prompt) || isStoryPresetSectionMarker(prompt)) return document;
    const next = { ...document, prompts: document.prompts.filter(item => item.id !== promptId) };
    const destination = getStoryPresetPromptGroups(next).find(group => group.key === groupKey);
    if (!destination) return document;
    const last = next.prompts[destination.endIndex];
    next.prompts.splice(isStoryPresetSectionMarker(last) ? destination.endIndex : destination.endIndex + 1, 0, prompt);
    return next;
};

export const applyStoryPresetChoice = (
    document: StoryTheaterPresetDocument,
    optionIds: readonly string[],
    selectedId?: string,
): StoryTheaterPresetDocument => ({
    ...document,
    prompts: document.prompts.map(prompt => optionIds.includes(prompt.id) ? { ...prompt, enabled: prompt.id === selectedId } : prompt),
});

/** Runtime binding for user/character names. Never bake identity names into an imported preset. */
const macroReplace = (text: string, userName: string, characterNames: string[]): string => {
    const user = userName || '你';
    const char = characterNames.join('、') || '角色';
    const inGroup = characterNames.length > 1;
    const values: Record<string, string> = {
        user, char, group: char, groupnotmuted: char,
        charifnotgroup: inGroup ? '' : char,
        notchar: inGroup ? char : user,
    };
    return text
        .replace(/\{\{\s*(user|char|group|groupnotmuted|charifnotgroup|notchar)\s*\}\}/gi,
            (raw, name: string) => values[name.toLowerCase()] ?? raw)
        .replace(/<(USER|BOT|CHAR|GROUP|CHARIFNOTGROUP)>/g, (raw, name: string) => ({
            USER: user, BOT: char, CHAR: char, GROUP: char,
            CHARIFNOTGROUP: inGroup ? '' : char,
        }[name.toUpperCase()] ?? raw));
};

/** Both native Link and Tavern stored openings enter only the Story first floor,
 * never the private chat prompt or dialogue history. Each format was normalized
 * by its own importer before reaching this common story-only selector.
 */
export const resolveStoryOpeningGreeting = (
    entry: Pick<StoryTheaterEntry, 'characterIds' | 'openingGreeting'>,
    characters: CharacterProfile[],
    identityName: string,
    userName = identityName,
): { characterId: string; greetingId: string; content: string; source: 'link' | 'tavern' | 'custom'; authorNote?: string } | null => {
    const selection = entry.openingGreeting;
    if (!selection || !entry.characterIds.includes(selection.characterId)) return null;
    const actor = characters.find(character => character.id === selection.characterId);
    if (!actor) return null;
    const greeting = listCharacterStoryOpenings(actor, userName, selection.greetingId).find(item => item.id === selection.greetingId);
    if (!greeting?.content.trim()) return null;
    return {
        characterId: actor.id,
        greetingId: greeting.id,
        source: greeting.source,
        // Imported wrapped notes are not promoted to hidden model instructions:
        // the author requested story prose outside imported wrappers only.
        content: macroReplace(greeting.content.trim(), identityName, [actor.name]),
    };
};

export const STORY_MINI_THEATER_PROMPT_IDS = [
    'nmj-v3-theater-ai',
    'nmj-v3-theater-user-sim',
    'nmj-v3-theater-group',
    'nmj-v3-theater-random',
    'nmj-v6-side-channel-terminal',
    'nmj-v6-side-channel-evidence',
    'nmj-v6-side-channel-public',
    'nmj-v6-side-channel-wrong-reel',
    'nmj-v3-theater-custom',
] as const;

export const getActiveStoryMiniTheaterPrompt = (document: StoryTheaterPresetDocument): StoryTheaterPresetPrompt | undefined => {
    const ids = new Set<string>(STORY_MINI_THEATER_PROMPT_IDS);
    return document.prompts.find(prompt => prompt.enabled && ids.has(prompt.id));
};

/** 将当前沙盒启用的小剧场规则重复放到本轮输入前，避免被较后的输出协议忽略。 */
export const buildStoryMiniTheaterReminder = (
    document: StoryTheaterPresetDocument,
    userName: string,
    characterNames: string[],
): string => {
    const prompt = getActiveStoryMiniTheaterPrompt(document);
    if (!prompt?.content.trim()) return '';
    return [
        `### 本轮结尾模块：${prompt.name}`,
        '这一模块已经由用户在本剧情的快捷预设中启用。本轮必须在主正文之后完整执行，不得因其它输出规则而省略。',
        '格式守门：每个 <mt_ai> / <mt_user> 内都必须同时写出一组完整的 <name> 与 <text>，闭合所有标签；不得把“… / ... / 按需要继续排列”等示例占位符当成实际消息输出。',
        macroReplace(prompt.content, userName, characterNames),
        '无论上方条目是完整模板还是简写说明，最终都必须使用这个可渲染外壳：',
        '<mini_theater>',
        '<mt_title>本轮实际标题</mt_title>',
        '<mt_system>可省略的短界面提示</mt_system>',
        '<mt_ai><name>左侧显示名</name><text>完整消息</text></mt_ai>',
        '<mt_user><name>右侧显示名</name><text>完整消息</text></mt_user>',
        '</mini_theater>',
    ].join('\n');
};

/** 兼容旧沙盒覆盖：只要暗格或镜头债任一开关仍在，就统一为连续的组合模块。 */
export const buildStoryBackstageAftermathReminder = (document: StoryTheaterPresetDocument): string => {
    const backstage = document.prompts.find(prompt => prompt.id === 'nmj-v48-backstage');
    const legacyDebts = document.prompts.find(prompt => prompt.id === 'nmj-v61-shot-debts');
    const backstageEnabled = backstage?.enabled === true;
    const debtsEnabled = legacyDebts?.enabled === true || Boolean(backstageEnabled && backstage?.content.includes('<shot_debts>'));
    if (!backstageEnabled && !debtsEnabled) return '';
    return [
        '### 本轮组合模块：幕后与余波',
        '幕后暗格与镜头债在糯米机中属于同一个折叠模块，不得拆成相隔很远的两个结尾区，也不得重复生成。',
        backstageEnabled ? '- 正文结束后输出一组完整且闭合的 <backstage>；心境、秘密与稀有真话都按已启用预设执行。' : '',
        debtsEnabled ? '- 紧接 </backstage>（若暗格关闭则紧接正文）输出一组完整且闭合的 <shot_debts>；之后才输出世界线、小剧场、选项和关系温度。' : '',
        '- 两组原始标签仍分别保留用于稳定解析，但界面只显示一个“幕后与余波”折叠区。',
    ].filter(Boolean).join('\n');
};

export const normalizeAffinityInput = (value: any, actor?: CharacterProfile): StoryAffinityInput | undefined => {
    if (!value || typeof value !== 'object') return undefined;
    const delta = Math.max(-100, Math.min(100, Math.round(Number(value.delta) || 0)));
    const reason = String(value.reason || '').trim().slice(0, 200);
    const awareness = value.awareness === 'noticed' ? 'noticed' : 'unnoticed';
    return delta !== 0 || reason ? {
        characterId: String(value.characterId || actor?.id || ''),
        characterName: String(value.characterName || actor?.name || '当前角色'),
        delta,
        reason,
        awareness,
    } : undefined;
};

export const storyAffinityInputsFromMessage = (message: Message | undefined, actors: CharacterProfile[] = []): StoryAffinityInput[] => {
    const values = message?.metadata?.theaterAffinityInputs;
    if (Array.isArray(values)) return values
        .map(value => normalizeAffinityInput(value, actors.find(actor => actor.id === value?.characterId)))
        .filter((value): value is StoryAffinityInput => Boolean(value));
    const legacy = normalizeAffinityInput(message?.metadata?.theaterAffinityInput, actors[0]);
    return legacy ? [legacy] : [];
};

const escapeStoryXml = (value: string): string => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/** 关系备注只随本轮用户输入送入模型，不混进可见正文。 */
export const appendStoryAffinityInput = (content: string, input?: StoryAffinityInput): string => {
    if (!input) return content;
    const delta = Math.max(-100, Math.min(100, Math.round(Number(input.delta) || 0)));
    const reason = String(input.reason || '').trim().slice(0, 200);
    if (delta === 0 && !reason) return content;
    const signed = delta >= 0 ? `+${delta}` : String(delta);
    const awareness = input.awareness === 'noticed' ? 'noticed' : 'unnoticed';
    return `${content}\n\n<u_affinity>\n<delta>${signed}</delta>\n<reason>${escapeStoryXml(reason || '未填写原因')}</reason>\n<awareness>${awareness}</awareness>\n</u_affinity>`;
};

/** 多人剧场使用带角色身份的独立 U→C 更新，禁止把几位角色共用成一个槽。 */
export const appendStoryAffinityInputs = (content: string, inputs: StoryAffinityInput[]): string => {
    const rows = inputs.map(input => {
        const delta = Math.max(-100, Math.min(100, Math.round(Number(input.delta) || 0)));
        const reason = String(input.reason || '').trim().slice(0, 200);
        if (delta === 0 && !reason) return '';
        const signed = delta >= 0 ? `+${delta}` : String(delta);
        const awareness = input.awareness === 'noticed' ? 'noticed' : 'unnoticed';
        return [
            '<u_affinity>',
            `<character_id>${escapeStoryXml(String(input.characterId || ''))}</character_id>`,
            `<character_name>${escapeStoryXml(String(input.characterName || '当前角色'))}</character_name>`,
            `<delta>${signed}</delta>`,
            `<reason>${escapeStoryXml(reason || '未填写原因')}</reason>`,
            `<awareness>${awareness}</awareness>`,
            '</u_affinity>',
        ].join('\n');
    }).filter(Boolean);
    if (rows.length === 0) return content;
    return `${content}\n\n<u_affinity_updates>\n${rows.join('\n')}\n</u_affinity_updates>`;
};

interface StoryAffinityScoreState {
    cToU: number;
    uToC: number;
}

const affinityTagValue = (source: string, tag: string): string => (
    new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, 'i').exec(source)?.[1]?.replace(/<[^>]+>/g, '').trim() || ''
);

const affinityInteger = (value: unknown, fallback: number): number => {
    const parsed = Number(String(value ?? '').replace(/[^+\d.-]/g, ''));
    return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
};

const clampAffinityScore = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));
const clampAffinityDelta = (value: number): number => Math.max(-100, Math.min(100, Math.round(value)));
const affinityIdentityKey = (value: string): string => value.trim().toLocaleLowerCase().normalize('NFKC');

const setAffinityTagValue = (source: string, tag: string, value: string): string => {
    const pattern = new RegExp(`(<${tag}\\b[^>]*>)[\\s\\S]*?(<\\/${tag}\\s*>)`, 'i');
    if (pattern.test(source)) return source.replace(pattern, `$1${value}$2`);
    return `${source.trimEnd()}\n<${tag}>${value}</${tag}>`;
};

const readAffinityScoreStates = (
    content: string,
    actors: Array<{ id: string; name: string }>,
): Map<string, StoryAffinityScoreState> => {
    const states = new Map<string, StoryAffinityScoreState>();
    const personPattern = /<affinity_person\b[^>]*>([\s\S]*?)<\/affinity_person\s*>/gi;
    for (const match of content.matchAll(personPattern)) {
        const body = match[1];
        const state = {
            cToU: clampAffinityScore(affinityInteger(affinityTagValue(body, 'c_to_u_score'), 50)),
            uToC: clampAffinityScore(affinityInteger(affinityTagValue(body, 'u_to_c_score'), 50)),
        };
        const id = affinityIdentityKey(affinityTagValue(body, 'character_id'));
        const name = affinityIdentityKey(affinityTagValue(body, 'character_name'));
        if (id) states.set(`id:${id}`, state);
        if (name) states.set(`name:${name}`, state);
    }
    // 兼容升级前的单角色根级面板；多人时绝不猜这一个旧槽属于谁。
    if (states.size === 0 && actors.length === 1) {
        const cScore = affinityTagValue(content, 'c_score');
        const uScore = affinityTagValue(content, 'u_score');
        if (cScore || uScore) {
            const state = {
                cToU: clampAffinityScore(affinityInteger(cScore, 50)),
                uToC: clampAffinityScore(affinityInteger(uScore, 50)),
            };
            states.set(`id:${affinityIdentityKey(actors[0].id)}`, state);
            states.set(`name:${affinityIdentityKey(actors[0].name)}`, state);
        }
    }
    return states;
};

/**
 * 模型只决定“本轮变化多少”，绝对值由前端按上一轮 + delta 复算。
 * 这样 U→C 的用户输入与 C→U 的模型变化都不会再依赖 LLM 心算。
 */
export const reconcileStoryAffinityScores = (
    generated: string,
    previousAssistantContent: string,
    inputs: StoryAffinityInput[],
    actors: Array<{ id: string; name: string }>,
): string => {
    const previous = readAffinityScoreStates(previousAssistantContent, actors);
    const actorById = new Map(actors.map(actor => [affinityIdentityKey(actor.id), actor]));
    const actorByName = new Map(actors.map(actor => [affinityIdentityKey(actor.name), actor]));
    const inputById = new Map(inputs.filter(input => input.characterId).map(input => [affinityIdentityKey(input.characterId || ''), input]));
    const inputByName = new Map(inputs.filter(input => input.characterName).map(input => [affinityIdentityKey(input.characterName || ''), input]));
    const personPattern = /(<affinity_person\b[^>]*>)([\s\S]*?)(<\/affinity_person\s*>)/gi;

    return generated.replace(personPattern, (_whole, opening: string, rawBody: string, closing: string) => {
        const rawId = affinityIdentityKey(affinityTagValue(rawBody, 'character_id'));
        const rawName = affinityIdentityKey(affinityTagValue(rawBody, 'character_name'));
        const actor = actorById.get(rawId) || actorByName.get(rawName);
        const id = affinityIdentityKey(actor?.id || rawId);
        const name = affinityIdentityKey(actor?.name || rawName);
        const prior = previous.get(`id:${id}`) || previous.get(`name:${name}`) || { cToU: 50, uToC: 50 };
        const input = inputById.get(id) || inputByName.get(name);
        const cDelta = clampAffinityDelta(affinityInteger(affinityTagValue(rawBody, 'c_to_u_delta'), 0));
        const uDelta = clampAffinityDelta(input?.delta == null ? 0 : affinityInteger(input.delta, 0));
        const cScore = clampAffinityScore(prior.cToU + cDelta);
        const uScore = clampAffinityScore(prior.uToC + uDelta);
        let body = rawBody;
        body = setAffinityTagValue(body, 'c_to_u_score', String(cScore));
        body = setAffinityTagValue(body, 'c_to_u_delta', cDelta >= 0 ? `+${cDelta}` : String(cDelta));
        body = setAffinityTagValue(body, 'u_to_c_score', String(uScore));
        body = setAffinityTagValue(body, 'u_to_c_delta', uDelta >= 0 ? `+${uDelta}` : String(uDelta));
        return `${opening}${body}${closing}`;
    });
};

export const buildStoryMultiAffinityGuide = (characters: Array<{ id: string; name: string }>): string => {
    if (characters.length === 0) return '';
    const cast = characters.map(character => `- ${character.id}：${character.name}`).join('\n');
    return [
        '### 糯米机多人双向关系温度（覆盖旧的单一“当前 C”槽）',
        '本剧场为每一位角色分别记录 C→U、U→C、五维关系混音、察觉状态与关系质地。禁止共享数值、串用事实、平均多人状态或只输出第一位角色。',
        '当前需要逐一维护的角色：',
        cast,
        '',
        '【更新】',
        '- 从最近一次多人 <affinity_panel> 中按 character_id 读取各自完整状态；没有旧记录时，该角色的 C→U、U→C 从 50 开始，五维依据角色卡与共同经历建立。旧历史只有单人面板时，只能迁移给姓名明确匹配的角色。',
        '- C→U 与 trust、security、possessive_pull、emotional_pressure、repair_will 只读取对应角色的亲历事实、性格、处境与后果；不得用某个角色的变化影响另一位角色。',
        '- 最新 <u_affinity_updates> 只出现本轮由用户填写变化的角色。某角色没有对应更新时，其 U→C 绝对值保持不变，delta 记 +0，原因写“本轮未填写”。',
        '- U→C 新值 = 该角色上一轮 U→C + 对应 delta，并限制在 0—100。',
        '- 你只需正确决定每个 delta；前端会依据上一轮绝对值复算 C→U 与 U→C score，防止心算错误。',
        '- 察觉规则只作用于同一条 u_affinity 指向的角色；其他角色不会因为同伴被选择为“已察觉”而共享透视。',
        '',
        '【输出】',
        '用一个 <affinity_panel> 包住全部角色，并严格按当前角色名单顺序为每人输出一段：',
        '<affinity_person>',
        '<character_id>角色 ID</character_id>',
        '<character_name>角色名</character_name>',
        '<c_to_u_score>50</c_to_u_score>',
        '<c_to_u_delta>+0</c_to_u_delta>',
        '<c_to_u_note>改变角色 C→U 的本轮事实</c_to_u_note>',
        '<u_to_c_score>50</u_to_c_score>',
        '<u_to_c_delta>+0</u_to_c_delta>',
        '<u_to_c_note>用户填写的原因；没有则写“本轮未填写”</u_to_c_note>',
        '<awareness_state>已察觉或未察觉</awareness_state>',
        '<trust>50</trust><security>50</security><possessive_pull>50</possessive_pull>',
        '<emotional_pressure>50</emotional_pressure><repair_will>50</repair_will>',
        '<state_note>最明显的内部拉扯、选择代价或修复动作</state_note>',
        '<relation_note>这一段双向关系当前的质地</relation_note>',
        '<relation_fragment>可选的一条具体关系碎片</relation_fragment>',
        '</affinity_person>',
        '按角色继续排列 affinity_person，最后闭合 </affinity_panel>。不要再输出旧版根级 c_score / u_score 单槽字段。',
    ].join('\n');
};

/** 用户对本轮关系变化的知情边界拥有最终决定权。 */
export const buildStoryAffinityAwarenessReminder = (input: StoryAffinityInput | undefined, primaryCharacterName: string): string => {
    if (!input || (Number(input.delta) === 0 && !String(input.reason || '').trim())) return '';
    if (input.awareness === 'noticed') return [
        '### 本轮 U→C 关系变化 · 角色完全透视（用户明确指定，覆盖常规感知档）',
        `- ${primaryCharacterName || '当前主要角色'}明确知道用户→自己的关系温度发生了数值层面的变化；这是直接、确定的透视信息，不是观察气氛、猜测态度或只知道“似乎有变化”。`,
        '- 角色完整知道最新 delta 的正负、准确幅度、更新后的 U→C 绝对值，以及 <reason> 表达的原因；不得把它降级成模糊感应。',
        '- 本轮正文必须给出一次符合人物性格、现场节拍与边界的明确反应；可以克制或隐藏，但行为、判断或内心必须真实接住这项已知变化。',
        '- 角色拥有数值层面的知识，但默认将其自然翻译为人物认知，不照念 XML 标签或系统面板；世界观本来存在数值界面时才可直接谈具体数字。',
        '- 这项用户选择只覆盖本轮的察觉边界，不授权角色逼问、控制、越界亲密或抢走原剧情主线。',
    ].join('\n');
    return [
        '### 本轮 U→C 关系变化 · 角色未察觉（用户明确指定）',
        `- ${primaryCharacterName || '对应角色'}不能读取用户→自己的这条 <u_affinity> 的 delta、reason 或准确方向，也不能凭空表演成已经知道；这条限制不覆盖用户对其他角色单独设置的察觉状态。`,
        '- 其他角色更不能借此读取不属于自己的关系数值；多人之间不得共享这条变化。',
        '- 这次变化只作为模型维持关系连续性与叙事氛围的低权重背景，不强制制造角色反应。',
        '- 若用户正文另有真实可见的台词或动作，角色仍可只依据那些现场证据正常推断。',
    ].join('\n');
};

export type StoryNarrationMode = 'second' | 'third' | 'custom';

export const resolveStoryNarrationMode = (document: StoryTheaterPresetDocument): StoryNarrationMode => {
    if (document.sourceFormat === 'sillytavern') {
        // Legacy imported-native overrides are no longer applied. The
        // selected AUTHOR prompt is now the one authoritative POV source.
        const pov = detectTavernNativeControls(document.prompts).inferred.pov;
        if (pov === 'nmj-v3-pov-third') return 'third';
        if (pov === 'nmj-v3-pov-second') return 'second';
        return 'custom';
    }
    const third = document.prompts.some(prompt => prompt.id === 'nmj-v3-pov-third' && prompt.enabled);
    if (third) return 'third';
    const second = document.prompts.some(prompt => prompt.id === 'nmj-v3-pov-second' && prompt.enabled);
    return second ? 'second' : 'custom';
};

/** 最后贴近用户输入发送，消除系统指令里的“你”与故事用户侧身份之间的歧义。 */
export const buildStoryIdentityGuard = (
    document: StoryTheaterPresetDocument,
    identityName: string,
    characterNames: string[],
): string => {
    const identity = identityName.trim() && identityName.trim() !== '你' ? identityName.trim() : '当前用户侧角色（未命名）';
    const cast = characterNames.filter(Boolean).join('、') || '暂无其他角色';
    const mode = resolveStoryNarrationMode(document);
    const narrationTag = document.sourceFormat === 'sillytavern' ? '<content>' : '<story_text>';
    const perspectiveRule = document.sourceFormat === 'sillytavern'
        ? mode === 'third'
            ? `- 当前酒馆原预设指定第三人称。${narrationTag} 的旁白中用户侧身份是「${identity}」；保持作者原有的全知／有限、多线叙事与代写权限，不额外强制成内置“第三人称有限”。`
            : mode === 'second'
                ? `- 当前酒馆原预设指定用户侧第二人称。${narrationTag} 中“你／你的”指「${identity}」；其他角色的人称及叙事视角仍服从作者原文，不强制改写为内置有限视角。`
                : '- 酒馆原预设使用作者自定义／混合视角；不得强改成内置第二或第三人称有限，只固定用户侧身份与角色的对应关系。'
        : mode === 'third'
            ? `- 当前启用第三人称有限。${narrationTag} 的旁白必须用「${identity}」已确立的姓名、称谓、合适代词或自然省略主语；旁白中的“你／你的”必须改掉。角色对白里对「${identity}」说“你”是正常称呼，不要误改。`
            : mode === 'second'
                ? `- 当前启用第二人称有限。${narrationTag} 旁白中的“你／你的”固定指「${identity}」，绝不指生成回复的一方或任一其他角色。`
                : '- 当前预设使用自定义人称；服从预设明确写出的叙述规则，但仍遵守下面的身份绑定。';
    return [
        '### 糯米机运行时身份与人称锚点（覆盖旧楼层的写法，不覆盖角色卡事实）',
        `- 用户侧剧情身份：${identity}。本轮参与角色：${cast}。关系协议中的 U 只指「${identity}」，C 才指名单中的各个角色。`,
        '- 生成回复的一方不属于故事人物。系统指令为方便表达而出现的“你”，只是执行语法，不能据此把生成端写进故事，也不能把故事里的“你”解释成生成端自己。',
        document.sourceFormat === 'sillytavern'
            ? '- 最新用户输入按实际句法辨认说话人与受话人；剧情旁白的“我／你／他”由当前启用的原作者人称条目决定，不得用糯米机内置有限视角覆盖它。关系字段中的 U 仍只表示用户侧身份。'
            : '- 用户最新输入仍按实际句法辨认说话人与受话人；但在最终输出的叙事旁白、场景条和关系面板中，未另行点名的“你／你的”只允许指用户侧剧情身份。',
        perspectiveRule,
        '- 历史助手回复只是已经发生的旧剧情：继承事实，不继承它过去使用的第一、第二或第三人称。当前启用的人称模式是本轮唯一标准。',
    ].join('\n');
};

/** Old imports may still contain legacy native-option metadata. Retain it
 * when loading/exporting for recovery, but never send copied Night Screening
 * prompts over the original Tavern author rules.
 */
export const buildTavernNativeOverrideMessages = (
    _document: StoryTheaterPresetDocument,
    _userName: string,
    _characterNames: string[],
): StoryApiMessage[] => [];

const slotForMarker = (marker: StoryTheaterPresetPrompt['marker'], slots: StoryPromptSlots): string => {
    switch (marker) {
        case 'characters': return slots.actors;
        case 'world_before': return slots.worldBefore;
        case 'user': return slots.persona;
        case 'world_after': return slots.worldAfter;
        case 'scenario': return slots.scenario;
        case 'examples': return slots.examples || '';
        case 'history': return slots.history || '';
        default: return '';
    }
};

const pushPromptMessage = (messages: StoryApiMessage[], role: StoryApiRole, content: string) => {
    const clean = content.trim();
    if (!clean) return;
    messages.push({ role, content: clean });
};

export const compileStoryPreset = (input: {
    preset?: StoryTheaterPreset | null;
    slots: StoryPromptSlots;
    historyMessages?: StoryApiMessage[];
    currentInput?: string;
    currentInputIsNewUserMessage?: boolean;
    modelName?: string;
    continueRequested?: boolean;
    userName: string;
    characterNames: string[];
}): { messages: StoryApiMessage[]; settings: StoryGenerationSettings; assistantPrefill?: StoryApiMessage; afterLatestUser?: StoryApiMessage[]; continueNudge?: StoryApiMessage; nativeOverrideMessages?: StoryApiMessage[] } => {
    const { preset, slots, userName, characterNames } = input;
    const document = (preset || BUILTIN_NIGHT_SCREENING_PRESET).document;
    const messages: StoryApiMessage[] = [];
    const importedFromTavern = document.sourceFormat === 'sillytavern';
    const variables = new Map<string, string>();
    // A Tavern global is shared across chats in Tavern. Imported presets use
    // a REQUEST-LOCAL map instead to preserve SullyOS identity separation.
    const globalVariables = new Map<string, string>();
    // The imported Tavern preset may set a rich rule via {{setvar}} without any
    // active {{getvar}} consumer: its original helper script is not runnable here.
    // Inline just those standalone XML rule bodies so an enabled toggle actually
    // affects the model, while normal getvar references keep their source location.
    const referencedVariables = new Set<string>();
    if (importedFromTavern) {
        const enabledContents = [
            ...document.prompts.filter(prompt => prompt.enabled).map(prompt => prompt.content),
            document.assistantPrefill || '',
        ];
        for (const value of enabledContents) {
            for (const match of value.matchAll(/\{\{\s*getvar(?:\s*::\s*|\s+)([^{}]+?)\s*\}\}/gi)) {
                referencedVariables.add(match[1].trim());
            }
        }
    }
    const inChatPrompts: Array<{ message: StoryApiMessage; depth: number; order: number; sourceIndex: number }> = [];
    let historyStart: number | null = null;
    let historyLength = 0;
    const previousHistoryMessage = input.historyMessages?.at(-1);
    const pendingUserContent = input.currentInputIsNewUserMessage && input.currentInput?.trim()
        ? input.currentInput : undefined;
    const lastHistoryMessage = pendingUserContent !== undefined
        ? { role: 'user' as const, content: pendingUserContent } : previousHistoryMessage;
    const lastUserMessage = pendingUserContent !== undefined
        ? { role: 'user' as const, content: pendingUserContent }
        : [...(input.historyMessages || [])].reverse().find(message => message.role === 'user');
    const lastCharMessage = [...(input.historyMessages || [])].reverse().find(message => message.role === 'assistant');
    const expandImported = (value: string): string => importedFromTavern
        ? expandSillyTavernContextMacros(expandSillyTavernPromptText(macroReplace(value, userName, characterNames), variables, referencedVariables, globalVariables), {
            description: slots.tavernDescription ?? slots.actors,
            personality: slots.tavernPersonality ?? slots.actors,
            persona: slots.persona,
            scenario: slots.scenario,
            examples: slots.examples,
            lastMessage: lastHistoryMessage?.content,
            lastUserMessage: lastUserMessage?.content,
            lastCharMessage: lastCharMessage?.content,
            lastChatMessage: lastHistoryMessage?.content ?? '',
            input: input.currentInput,
            model: input.modelName,
            variables,
        })
        : value;

    const worldBeforePrompts = document.prompts.filter(prompt => prompt.marker === 'world_before');
    const enabledWorldBeforePrompt = worldBeforePrompts.find(prompt => prompt.enabled);
    const firstEnabledCharacterIndex = document.prompts.findIndex(prompt => prompt.enabled && prompt.marker === 'characters');
    const formatTavernSlot = (value: string, template: string | undefined, placeholder: string): string => {
        if (!importedFromTavern || !template?.trim() || !value.trim()) return value;
        if (!template.includes(placeholder)) return value;
        return template.split(placeholder).join(value);
    };
    const formatWorldBefore = (value: string): string => formatTavernSlot(value, document.tavernFormats?.worldInfo, '{0}');
    const shouldBackfillWorldBefore = worldBeforePrompts.length === 0 && Boolean(slots.worldBefore.trim());
    const shouldMoveWorldBeforeAheadOfCharacters = Boolean(
        enabledWorldBeforePrompt
        && firstEnabledCharacterIndex >= 0
        && document.prompts.indexOf(enabledWorldBeforePrompt) > firstEnabledCharacterIndex
        && slots.worldBefore.trim(),
    );

    // Native presets inject a character marker once. Imported Tavern presets
    // can carry two distinct, independently switchable card slots: description
    // and personality. Split only when both are active AND both source values
    // are available; otherwise keep the complete actor context intact.
    const splitCharacterSlots = importedFromTavern
        && Boolean(slots.tavernDescription?.trim() && slots.tavernPersonality?.trim())
        && document.prompts.some(prompt => prompt.enabled && prompt.marker === 'characters' && prompt.id === 'st-charDescription')
        && document.prompts.some(prompt => prompt.enabled && prompt.marker === 'characters' && prompt.id === 'st-charPersonality');
    const injectedMarkers = new Set<string>();
    for (let index = 0; index < document.prompts.length; index += 1) {
        const prompt = document.prompts[index];
        if (
            index === firstEnabledCharacterIndex
            && (shouldBackfillWorldBefore || shouldMoveWorldBeforeAheadOfCharacters)
        ) {
            pushPromptMessage(
                messages,
                enabledWorldBeforePrompt?.role || 'system',
                macroReplace(formatWorldBefore(slots.worldBefore), userName, characterNames),
            );
            injectedMarkers.add('world_before');
        }
        if (!prompt.enabled || prompt.section) continue;
        let raw = prompt.content;
        if (prompt.marker) {
            const separateTavernCardSlot = splitCharacterSlots && prompt.marker === 'characters'
                && (prompt.id === 'st-charDescription' || prompt.id === 'st-charPersonality');
            if (injectedMarkers.has(prompt.marker) && !separateTavernCardSlot) continue;
            injectedMarkers.add(prompt.marker);
            if (separateTavernCardSlot) {
                raw = prompt.id === 'st-charDescription'
                    ? slots.tavernDescription!
                    : formatTavernSlot(slots.tavernPersonality!, document.tavernFormats?.personality, '{{personality}}');
            } else if (prompt.marker === 'history' && input.historyMessages) {
                const newGroupHeader = characterNames.length > 1 && typeof document.tavernOptions?.new_group_chat_prompt === 'string'
                    ? document.tavernOptions.new_group_chat_prompt : '';
                const chatHeader = newGroupHeader || document.tavernFormats?.newChat || '';
                if (importedFromTavern && chatHeader.trim()) {
                    pushPromptMessage(messages, 'system', macroReplace(expandImported(chatHeader), userName, characterNames));
                }
                historyStart = messages.length;
                historyLength = input.historyMessages.length;
                messages.push(...input.historyMessages);
                continue;
            } else {
                raw = slotForMarker(prompt.marker, slots);
                if (prompt.marker === 'world_before' || prompt.marker === 'world_after') {
                    raw = formatTavernSlot(raw, document.tavernFormats?.worldInfo, '{0}');
                } else if (prompt.marker === 'scenario') {
                    raw = formatTavernSlot(raw, document.tavernFormats?.scenario, '{{scenario}}');
                } else if (prompt.marker === 'examples' && raw.trim() && importedFromTavern
                    && document.tavernFormats?.newExampleChat?.trim()) {
                    raw = `${document.tavernFormats.newExampleChat}\n${raw}`;
                }
            }
        }
        raw = expandImported(raw);
        if (!raw.trim()) continue;
        const content = macroReplace(raw, userName, characterNames).trim();
        if (prompt.injection?.position === 'chat' && !prompt.marker) {
            inChatPrompts.push({ message: { role: prompt.role, content }, depth: prompt.injection.depth, order: prompt.injection.order, sourceIndex: index });
            continue;
        }
        if (prompt.marker === 'history') {
            historyStart = messages.length;
            historyLength = 1;
        }
        pushPromptMessage(messages, prompt.role, content);
    }

    // 兼容没有任何原生槽位的旧自定义预设，确保角色设定前世界书不会静默丢失。
    if (shouldBackfillWorldBefore && firstEnabledCharacterIndex < 0 && !injectedMarkers.has('world_before')) {
        messages.unshift({ role: 'system', content: macroReplace(formatWorldBefore(slots.worldBefore), userName, characterNames).trim() });
        if (historyStart !== null) historyStart += 1;
    }

    // The pending user turn is appended by StoryTheaterSession after compilation.
    // SillyTavern depth=0 goes AFTER that pending turn, depth=1 goes immediately BEFORE it.
    const afterLatestUser: StoryApiMessage[] = [];
    if (inChatPrompts.length) {
        const rolePriority: Record<StoryApiRole, number> = { user: 0, assistant: 1, system: 2 };
        const byOrder = (a: typeof inChatPrompts[number], b: typeof inChatPrompts[number]) =>
            a.order - b.order || rolePriority[a.message.role] - rolePriority[b.message.role] || a.sourceIndex - b.sourceIndex;
        inChatPrompts.sort(byOrder);
        afterLatestUser.push(...inChatPrompts.filter(prompt => prompt.depth === 0).map(prompt => prompt.message));
        const insertionStart = historyStart ?? messages.length;
        const insertionLength = historyStart === null ? 0 : historyLength;
        const inserts = inChatPrompts.filter(prompt => prompt.depth > 0).map(prompt => ({
            ...prompt,
            index: insertionStart + Math.max(0, insertionLength - (prompt.depth - 1)),
        }));
        inserts.sort((a, b) => b.index - a.index || -byOrder(a, b));
        for (const item of inserts) messages.splice(item.index, 0, item.message);
    }

    const prefill = expandImported(String(document.assistantPrefill || '')).trim();
    const assistantPrefill = prefill ? { role: 'assistant' as const, content: macroReplace(prefill, userName, characterNames) } : undefined;
    const requestedContinue = importedFromTavern && input.continueRequested
        ? expandImported(document.tavernFormats?.continueNudge || '').trim()
        : '';
    const continueNudge = requestedContinue
        ? { role: 'system' as const, content: macroReplace(requestedContinue, userName, characterNames) }
        : undefined;

    return {
        messages,
        settings: {
            temperature: document.generation.temperature,
            top_p: document.generation.topP,
            frequency_penalty: document.generation.frequencyPenalty,
            presence_penalty: document.generation.presencePenalty,
            max_tokens: document.generation.maxTokens,
        },
        assistantPrefill,
        ...(importedFromTavern ? { nativeOverrideMessages: buildTavernNativeOverrideMessages(document, userName, characterNames) } : {}),
        ...(continueNudge ? { continueNudge } : {}),
        ...(afterLatestUser.length ? { afterLatestUser } : {}),
    };
};

/**
 * 部分 OpenAI 兼容模型硬性要求请求最后一条消息必须是 user，不能接受
 * SillyTavern 常用的 assistant prefill。把预填充改写成紧邻用户消息前的
 * system 约束，调用方仍可在返回文本缺失前缀时本地补齐。
 */
export const buildStoryPrefillInstruction = (assistantPrefill?: StoryApiMessage): StoryApiMessage | undefined => {
    const content = assistantPrefill?.content?.trim();
    if (!content) return undefined;
    return {
        role: 'system',
        content: [
            '### 回复起始文本（兼容模式）',
            '你的最终回复必须直接以下列文本开头；不要解释、转述或把它放进代码块：',
            content,
        ].join('\n'),
    };
};

/**
 * 默认完整保留原生 assistant prefill；只有用户为当前剧情显式开启 400 兼容模式时，
 * 才把预填改成 system 约束并让最终消息保持 user。这样个别严格接口不会改变所有人的预设效果。
 */
export const appendStoryUserTurn = (
    messages: StoryApiMessage[],
    userContent: string,
    assistantPrefill?: StoryApiMessage,
    forceUserLastMessage = false,
): StoryApiMessage[] => {
    if (forceUserLastMessage) {
        const instruction = buildStoryPrefillInstruction(assistantPrefill);
        return [
            ...messages,
            ...(instruction ? [instruction] : []),
            { role: 'user', content: userContent },
        ];
    }
    return [
        ...messages,
        { role: 'user', content: userContent },
        ...(assistantPrefill ? [assistantPrefill] : []),
    ];
};

export const dedupeTheaterWorldbooks = (characters: CharacterProfile[]): MountedWorldbook[] => {
    const seen = new Set<string>();
    const output: MountedWorldbook[] = [];
    for (const char of characters) {
        for (const book of (char.mountedWorldbooks || [])) {
            const keys = [
                book.id ? `id:${book.id}` : '',
                `body:${book.title.trim().toLocaleLowerCase()}\u0000${book.content.trim()}`,
            ].filter(Boolean);
            if (keys.length === 0 || keys.some(key => seen.has(key))) continue;
            keys.forEach(key => seen.add(key));
            output.push({ ...book });
        }
    }
    return output.sort((a, b) => (a.category || '').localeCompare(b.category || '', 'zh-CN') || a.title.localeCompare(b.title, 'zh-CN'));
};

/**
 * Available to *this story*, independent of who participates: the canonical
 * global library plus legacy character-only mounts from the user's library.
 * The actual model context still uses ONLY the IDs checked by this story.
 *
 * A legacy ID reused for two different character-only texts is ambiguous.
 * Suppress it rather than quietly injecting the first character's unrelated
 * world. An actual global record always takes priority over legacy copies.
 */
export const resolveStoryTheaterWorldbooks = (
    globalWorldbooks: readonly Worldbook[],
    characters: readonly CharacterProfile[],
): MountedWorldbook[] => {
    const byId = new Map<string, MountedWorldbook>();
    const canonicalIds = new Set<string>();
    const ambiguousLegacyIds = new Set<string>();
    // Same ID but different trigger/order rules is a different usable book.
    // Ignoring that mismatch would silently alter which world becomes active.
    const meaning = (book: MountedWorldbook) => JSON.stringify([
        book.title, book.content, book.category ?? null,
        book.key ?? [], book.keysecondary ?? [], book.constant ?? null,
        book.selective ?? null, book.selectiveLogic ?? null, book.order ?? null,
        book.position ?? null, book.disable ?? null, book.probability ?? null,
        book.useProbability ?? null, book.depth ?? null, book.role ?? null,
        book.scanDepth ?? null, book.caseSensitive ?? null,
        book.matchWholeWords ?? null,
    ]);
    const valid = (book: MountedWorldbook | null | undefined): book is MountedWorldbook =>
        !!book && typeof book.id === 'string' && !!book.id.trim()
        && typeof book.title === 'string' && typeof book.content === 'string';
    for (const book of Array.isArray(globalWorldbooks) ? globalWorldbooks : []) {
        if (!valid(book)) continue;
        if (!canonicalIds.has(book.id)) {
            canonicalIds.add(book.id);
            byId.set(book.id, { ...book });
        }
    }
    for (const person of Array.isArray(characters) ? characters : []) {
        if (!person || !Array.isArray(person.mountedWorldbooks)) continue;
        for (const book of person.mountedWorldbooks) {
            if (!valid(book) || canonicalIds.has(book.id) || ambiguousLegacyIds.has(book.id)) continue;
            const previous = byId.get(book.id);
            if (!previous) byId.set(book.id, { ...book });
            else if (meaning(previous) !== meaning(book)) {
                byId.delete(book.id);
                ambiguousLegacyIds.add(book.id);
            }
        }
    }
    return [...byId.values()].sort((a, b) =>
        (a.category || '').localeCompare(b.category || '', 'zh-CN')
        || a.title.localeCompare(b.title, 'zh-CN') || a.id.localeCompare(b.id));
};

export const buildStoryWorldbookScanMessages = (
    history: WorldbookScanMessage[],
    currentUserContent: string,
    limit = 20,
): WorldbookScanMessage[] => {
    const safeLimit = Math.max(1, Math.floor(limit));
    const current = currentUserContent.trim();
    if (!current) return history.slice(-safeLimit);
    const historyLimit = safeLimit - 1;
    return [
        ...(historyLimit > 0 ? history.slice(-historyLimit) : []),
        { role: 'user', content: current },
    ];
};

export const buildBareTheaterActorContext = (char: CharacterProfile, includeDescription = false): string => [
    `### 剧情角色：${char.name}`,
    `- 名字：${char.name}`,
    ...(includeDescription && char.description?.trim() ? [`- 角色描述：\n${char.description.trim()}`] : []),
    `- 核心指令：\n${char.systemPrompt || '无额外核心指令'}`,
    char.worldview?.trim() ? `- 世界观：\n${char.worldview.trim()}` : '',
].filter(Boolean).join('\n');

export const buildStoryActorMemoryEnvelope = (
    characterName: string,
    recalled: string,
    originalUserName: string,
    currentIdentityName: string,
): string => {
    const content = recalled.trim();
    if (!content) return '';
    const owner = characterName.trim() || '当前角色';
    const originalUser = originalUserName.trim() || '原本的你';
    const currentIdentity = currentIdentityName.trim() || originalUser;
    const identityReminder = currentIdentity === originalUser
        ? `- 本剧情当前用户侧身份仍是「${originalUser}」；记忆原文里的“你”继续指这个身份。`
        : `- 本剧情当前用户侧执笔身份是「${currentIdentity}」，不得因此把旧记忆里的“你”从「${originalUser}」改绑到当前身份。`;

    return [
        `### ${owner} 的专属既有记忆`,
        `归属规则：以下内容只属于角色「${owner}」，不得归给、共享给或改写成其他角色的亲历记忆。`,
        `- 记忆片段里的第一人称“我/我的”，默认指「${owner}」。`,
        `- 记忆片段里的第二人称“你/你的”，若片段没有另行点名，默认指形成记忆时的原互动对象「${originalUser}」。`,
        identityReminder,
        `【${owner}专属记忆开始】`,
        content,
        `【${owner}专属记忆结束】`,
    ].join('\n');
};

export const buildStoryArchiveMemoryEnvelope = (recalled: string): string => {
    const content = recalled.trim();
    if (!content) return '';
    return [
        '### 本剧情共享档案召回',
        '归属规则：以下内容是本剧情自己的叙事档案，只用于承接已经发生的剧情；它不属于任何一位角色的个人记忆，也不得写入或冒充角色的神经链接记忆。',
        '- 片段中的第一、第二人称只保留原文叙事视角；应依据片段内明确出现的姓名与事件判断身份。',
        '- 无法从片段确定指代时，保持模糊，不得擅自把“我/你”归给当前面具或任一角色。',
        '【本剧情共享档案开始】',
        content,
        '【本剧情共享档案结束】',
    ].join('\n');
};

export const buildTheaterPersona = (mask: ResolvedStoryTheaterMask): string => [
    '### 当前用户侧执笔身份',
    `- 名字：${mask.name || '你'}`,
    `- 身份/外在设定：${mask.description || '无'}`,
    mask.coreInstruction?.trim() ? `- 核心性格与行动边界：\n${mask.coreInstruction.trim()}` : '',
    mask.worldview?.trim() ? `- 所属世界观：\n${mask.worldview.trim()}` : '',
    '- 这是用户侧本轮亲自执笔的故事身份，不是生成回复的一方。除非预设明确允许代写，续写不得把该身份当作普通角色擅自决定重大选择。',
].join('\n');

export const storyTheaterMemoryRecipientIds = (entry: StoryTheaterEntry): string[] => {
    const ids = new Set(entry.characterIds);
    if (entry.mask?.type === 'character') ids.add(entry.mask.id);
    return [...ids];
};

const DISPLAY_BLOCK_META: Record<string, { kind: StoryDisplayBlockKind; title?: string }> = {
    scene_header: { kind: 'scene', title: '这一幕' },
    story_text: { kind: 'story' },
    backstage: { kind: 'backstage', title: '幕后层' },
    mind_weather: { kind: 'backstage', title: '内心气象' },
    worldline: { kind: 'worldline', title: '世界线' },
    world_line: { kind: 'worldline', title: '世界线' },
    shot_debts: { kind: 'debts', title: '尚未偿还的镜头' },
    mini_theater: { kind: 'theater', title: '幕间剧场' },
    reply_choices: { kind: 'choices', title: '可以这样推进' },
    affinity_panel: { kind: 'affinity', title: '关系变化' },
};

const DISPLAY_TAG_LABELS: Record<string, string> = {
    time: '时间', place: '地点', situation: '场面', owner: '主体', surface: '表层反应', undertow: '潜流',
    secret: '秘密', hidden: '隐藏事实', true_monologue: '真正的独白', voice: '心声', red: '危险信号',
    fracture: '裂纹', surge: '情绪峰值', world_line_title: '世界线', worldline_title: '世界线', world_event: '事件',
    scope: '影响范围', change: '变化', debt_title: '镜头债', debt: '未结事项', origin: '起因', unpaid: '尚未偿还',
    trigger: '触发条件', mt_title: '幕间', mt_system: '旁白', mt_ai: '人物', mt_user: '右侧', name: '人物',
    choice: '备选', label: '方向', reply: '推进', relation_note: '关系天气', u_note: '你的说明', c_note: '变化原因',
    c_score: '关系温度', u_score: '你的关系温度', u_affinity: '你的关系备注', u_delta: '你的变化', c_delta: '本轮变化', relation_fragment: '关系碎片',
    character_id: '角色 ID', character_name: '人物',
    c_to_u_score: '角色对你的温度', c_to_u_delta: '角色本轮变化', c_to_u_note: '角色变化依据',
    u_to_c_score: '你对角色的温度', u_to_c_delta: '你本轮的变化', u_to_c_note: '你的变化原因', awareness_state: '察觉状态',
    trust: '信任', security: '安全感', possessive_pull: '占有拉力', emotional_pressure: '情绪压强', repair_will: '修复意愿', state_note: '关系合力',
};

const HIDDEN_STORY_DISPLAY_TAGS = new Set(['u_score', 'u_delta', 'u_note']);

const decodeStoryCodePoint = (match: string, code: string, radix: number): string => {
    const value = parseInt(code, radix);
    return Number.isFinite(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : match;
};

const decodeStoryEntities = (value: string): string => value
    .replace(/&#(\d+);/g, (match, code) => decodeStoryCodePoint(match, code, 10))
    .replace(/&#x([0-9a-f]+);/gi, (match, code) => decodeStoryCodePoint(match, code, 16))
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, String.fromCharCode(34)).replace(/&#39;/gi, String.fromCharCode(39)).replace(/&amp;/gi, '&');

const cleanStoryMarkupText = (value: string): string => decodeStoryEntities(String(value || ''))
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/?[a-z][^>]*>/gi, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const firstStoryTagValue = (source: string, tag: string): string => {
    const closed = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, 'i').exec(source)?.[1];
    if (closed !== undefined) return cleanStoryMarkupText(closed);
    const openOnly = new RegExp(`<${tag}\\b[^>]*>([^<\\n]*)`, 'i').exec(source)?.[1];
    return cleanStoryMarkupText(openOnly || '');
};

/**
 * 小剧场单独按语义解析：把 name/text 合并成一条消息，并容忍缺失闭合标签、
 * 省略消息外壳或直接退化为纯文本，避免把每个 XML 标签渲染成一张卡。
 */
export const parseStoryMiniTheater = (fragment: string): StoryMiniTheaterDisplay => {
    const source = decodeStoryEntities(String(fragment || '')).replace(/\r\n?/g, '\n');
    const title = firstStoryTagValue(source, 'mt_title') || '幕间频道';
    const systems = [...source.matchAll(/<mt_system\b[^>]*>([\s\S]*?)(?:<\/mt_system\s*>|(?=<(?:mt_ai|mt_user|mt_title)\b)|$)/gi)]
        .map(match => cleanStoryMarkupText(match[1]))
        .filter(Boolean);
    const messages: StoryMiniTheaterDisplayMessage[] = [];
    const messagePattern = /<(mt_ai|mt_user)\b[^>]*>([\s\S]*?)(?:<\/\1\s*>|(?=<(?:mt_ai|mt_user|mt_system|mt_title)\b)|$)/gi;
    let match: RegExpExecArray | null;
    while ((match = messagePattern.exec(source)) !== null) {
        const side = match[1].toLowerCase() === 'mt_user' ? 'right' : 'left';
        const body = match[2];
        const name = firstStoryTagValue(body, 'name') || (side === 'right' ? '右侧' : '左侧');
        const taggedText = firstStoryTagValue(body, 'text');
        const fallbackText = cleanStoryMarkupText(body).replace(name, '').trim();
        const text = taggedText || fallbackText;
        if (text) messages.push({ side, name, text });
    }

    if (messages.length === 0) {
        const pairPattern = /<name\b[^>]*>([\s\S]*?)<\/name\s*>\s*<text\b[^>]*>([\s\S]*?)<\/text\s*>/gi;
        for (const pair of source.matchAll(pairPattern)) {
            const name = cleanStoryMarkupText(pair[1]) || '频道消息';
            const text = cleanStoryMarkupText(pair[2]);
            if (text) messages.push({ side: 'left', name, text });
        }
    }

    if (messages.length === 0) {
        const plain = cleanStoryMarkupText(source)
            .split(/\n+/)
            .map(line => line.trim())
            .filter(line => line && line !== title && !systems.includes(line));
        for (const line of plain) {
            const labeled = /^([^：:]{1,20})[：:]\s*(.+)$/.exec(line);
            messages.push({ side: 'left', name: labeled?.[1]?.trim() || '频道消息', text: labeled?.[2]?.trim() || line });
        }
    }

    return { title, ...(systems.length > 0 ? { system: systems.join(' · ') } : {}), messages };
};

const formatTaggedStoryFragment = (fragment: string): string => {
    let clean = decodeStoryEntities(String(fragment || '')).replace(/\r\n?/g, '\n');
    const pair = /<([a-z][\w-]*)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
    for (let pass = 0; pass < 8 && pair.test(clean); pass += 1) {
        pair.lastIndex = 0;
        clean = clean.replace(pair, (_whole, rawTag: string, body: string) => {
            const tag = rawTag.toLowerCase();
            const label = DISPLAY_TAG_LABELS[tag];
            const inner = body.trim();
            if (!inner) return '';
            if (HIDDEN_STORY_DISPLAY_TAGS.has(tag)) return '';
            if (tag === 'story_text' || tag === 'text') return inner;
            return label ? `\n${label}：${inner}\n` : `\n${inner}\n`;
        });
    }
    clean = clean
        .replace(/<\/?[a-z][^>]*>/gi, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return clean;
};

/**
 * Tavern output may nest <details> inside <sidestory>, or append side-theaters
 * inside a <content> body. Matching the first closing tag with a regex loses
 * nested information. Use the browser's HTML tree for imported output only;
 * original SullyOS preset parsing remains untouched.
 */
/** Imported Tavern ECoT is an output delimiter, not visible story prose.
 * Recover a missing closing delimiter only at an explicit story start; keep
 * original generated text unchanged in the saved floor and prompt history.
 */
const normalizeTavernThinkingBlocks = (raw: string): string => {
    let source = raw;
    // Lachesis uses <blend> for its pre-story deduction instead of <thinking>.
    // Only recognize it when it starts before the story body; never reinterpret
    // an author's <blend> markup inside the actual <content> prose.
    const firstBlend = source.search(/<\s*blend\b[^>]*>/i);
    const firstStory = source.search(/<\s*(?:content|story_text)\b[^>]*>/i);
    if (firstBlend >= 0 && (firstStory < 0 || firstBlend < firstStory)) {
        // The fixed bartender greeting belongs to the deduction header, not
        // the visible novel. This only affects the display copy, not history.
        source = source.replace(
            /^\s*拉刻西斯\s*[:：]\s*夜客[，,]\s*我在柜台后面听[。.!！]?\s*(?=(?:<!--\s*Mixing Now\s*-->\s*)?<\s*blend\b)/i,
            '',
        );
        const storyBoundary = source.search(/<\s*(?:content|story_text)\b[^>]*>/i);
        source = source.replace(/<\s*(\/?)\s*blend\b[^>]*>/gi,
            (tag, closing: string, offset: number) => storyBoundary >= 0 && offset >= storyBoundary
                ? tag : closing ? '</thinking>' : '<thinking>');
    }
    // Some Lite presets only print the ECoT comment markers. In that case,
    // recover their bounded thinking section without touching tagged output.
    source = source.replace(
        /<!--\s*Start the ECoT\s*-->([\s\S]*?)<!--\s*End of (?:The )?ECoT\s*-->/gi,
        (whole, body: string) => /<\s*\/?\s*(?:thinking|think|thought|ecot)\b/i.test(body)
            ? whole : '<thinking>' + body + '</thinking>',
    );
    source = source.replace(/<\s*(\/?)\s*ecot\b[^>]*>/gi,
        (_whole, closing: string) => closing ? '</thinking>' : '<thinking>');
    // Tavern authors use <Think>, <thinking>, <thought>, and <ECoT>.
    // HTML tag names are case-insensitive, but the repaired closing tag must
    // match its opener. Otherwise a lost </Think> can swallow all <content>.
    const delimiters = /<\s*\/?\s*(?:thinking|think|thought)\b[^>]*>|<\s*(?:content|story_text)\b[^>]*>/gi;
    let result = '';
    let cursor = 0;
    let thinkingOpen: string | null = null;
    for (const match of source.matchAll(delimiters)) {
        result += source.slice(cursor, match.index);
        const tag = match[0];
        const close = /^<\s*\/\s*(thinking|think|thought)\b/i.exec(tag);
        const open = /^<\s*(thinking|think|thought)\b/i.exec(tag);
        if (close) {
            if (thinkingOpen) {
                if (thinkingOpen !== close[1].toLowerCase()) {
                    result += '</' + thinkingOpen + '>';
                    thinkingOpen = null;
                } else {
                    thinkingOpen = null;
                    result += tag;
                }
            }
            // Stray or mismatched closing tags must not render as story prose.
        } else if (open) {
            if (thinkingOpen) result += '</' + thinkingOpen + '>';
            thinkingOpen = open[1].toLowerCase();
            result += tag;
        } else {
            if (thinkingOpen) {
                // Recover a missing close only at an explicit story boundary.
                result += '</' + thinkingOpen + '>';
                thinkingOpen = null;
            }
            result += tag;
        }
        cursor = match.index! + tag.length;
    }
    result += source.slice(cursor);
    return thinkingOpen ? result + '</' + thinkingOpen + '>' : result;
};

const parseTavernStoryDisplayBlocks = (source: string): StoryDisplayBlock[] => {
    const document = new DOMParser().parseFromString(source, 'text/html');
    const blocks: StoryDisplayBlock[] = [];
    const foreignNames: Record<string, string> = {
        sidestory: '酒馆小剧场',
        randomtheater: '酒馆随机小剧场',
        writing_interlude: '酒馆写作间隙',
        wine: '酒馆小剧场',
        partner_sidestory: '酒馆伙伴剧场',
        small_theater: '酒馆小剧场',
        side_theater: '酒馆小剧场',
        episode: '酒馆主题小剧场',
        draft: '酒馆剧情摘要',
        microlist: '酒馆临时待办',
        ink: '酒馆补充信息',
        count: '酒馆字数记录',
        meow_fm: '剧情摘要',
        branches: '剧情选项',
        seeds: '剧情伏笔',
        bbs: '论坛附录',
        snow: '故事附录',
        secrets: '秘密记录',
        status_1: '状态记录',
        status_2: '状态记录',
        update_variable: '变量更新',
        tableedit: '表格更新',
        ws_prologue: '世界记录',
        ws_galstatus: '世界状态',
        ws_activeworld: '世界记录',
        prologue: '开场附录',
    };
    const nativeNames = new Set(Object.keys(DISPLAY_BLOCK_META));
    const meaningfulTags = [...nativeNames, ...Object.keys(foreignNames), 'thinking', 'think', 'thought', 'content', 'details'];
    const structural = meaningfulTags.join(',');
    // Styles inside a particular appendix must NOT be copied into every
    // other appendix. Each sandbox should retain its own local CSS. Only
    // genuinely top-level author styles can be shared with all appendices.
    const sharedStyles = Array.from(document.querySelectorAll('style'))
        .filter(style => !style.closest('sidestory,randomtheater,writing_interlude,wine,partner_sidestory,small_theater,side_theater,episode,draft,microlist,details,mini_theater'))
        .map(style => '<style>' + (style.textContent || '') + '</style>')
        .join('\n').slice(0, 26000);
    const push = (kind: StoryDisplayBlockKind, raw: string, title?: string, htmlSource?: string) => {
        const displayRaw = raw.replace(
            /<(?:script|style|iframe|object|embed|svg|math)\b[^>]*>[\s\S]*?<\/\s*(?:script|style|iframe|object|embed|svg|math)\s*>/gi, '',
        );
        const text = formatTaggedStoryFragment(displayRaw);
        if (!text && !htmlSource) return;
        const last = blocks[blocks.length - 1];
        if (kind === 'story' && last?.kind === 'story') {
            last.text = last.text + '\n\n' + text;
        } else {
            blocks.push({ kind, text, ...(title ? { title } : {}),
                ...(htmlSource ? { htmlSource } : {}) });
        }
    };
    const pushStructuredTheater = (raw: string, title: string): boolean => {
        // Only explicit chat semantics map to native bubbles. Ordinary prose,
        // tables and stylized appendices must never be guessed as dialogue.
        const containsChat = /<(?:mt_ai|mt_user)\b/i.test(raw)
            || /<name\b[^>]*>[\s\S]*?<\/name\s*>\s*<text\b/i.test(raw);
        if (!containsChat) return false;
        const theater = parseStoryMiniTheater(raw);
        if (!theater.messages.length) return false;
        const text = [
            theater.title ? '幕间：' + theater.title : '',
            theater.system ? '旁白：' + theater.system : '',
            ...theater.messages.map(message => message.name + '：' + message.text),
        ].filter(Boolean).join('\n');
        blocks.push({ kind: 'theater', title, text, theater });
        return true;
    };
    const pushAppendix = (element: Element, title: string) => {
        const raw = element.innerHTML;
        if (pushStructuredTheater(raw, title)) return;
        const adapted = element.tagName.toLowerCase() === 'writing_interlude'
            ? adaptTavernWritingInterlude(raw) : undefined;
        const htmlSource = adapted || (hasStoryHtmlLayout(raw) ? sharedStyles + '\n' + raw : undefined);
        push('tavern-extra', raw, title, htmlSource);
    };
    const visit = (node: Node): void => {
        if (node.nodeType === 3) {
            const content = node.textContent || '';
            if (content.trim()) push('story', content);
            return;
        }
        if (node.nodeType !== 1) return;
        const element = node as Element;
        const tag = element.tagName.toLowerCase();
        if (['style', 'script', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math', 'template'].includes(tag)) return;
        if (['thinking', 'think', 'thought'].includes(tag)) {
            push('thinking', element.innerHTML, '思考过程');
            return;
        }
        if (tag === 'content') {
            Array.from(element.childNodes).forEach(visit);
            return;
        }
        if (Object.prototype.hasOwnProperty.call(foreignNames, tag)) {
            pushAppendix(element, foreignNames[tag]);
            return;
        }
        if (tag === 'details') {
            const fate = (element.getAttribute('data-fate') || '').toLowerCase();
            const info = (element.getAttribute('data-info') || '').toLowerCase();
            const title = info === 'archive' ? '剧情摘要'
                : fate === 'destiny' ? '剧情选项'
                : fate.includes('side_theater') ? '小剧场附录'
                : element.querySelector('summary')?.textContent?.trim().slice(0, 80) || '酒馆附录';
            pushAppendix(element, title);
            return;
        }
        if (nativeNames.has(tag)) {
            // Reuse existing native card parser, including original mini theater,
            // relationship and choices behavior, without changing native presets.
            blocks.push(...parseStoryDisplayBlocks(element.outerHTML, false));
            return;
        }
        const nested = element.querySelector(structural);
        if (nested) {
            Array.from(element.childNodes).forEach(visit);
            return;
        }
        // Full HTML layouts are never injected into the SullyOS page itself:
        // they are rendered in a separate CSP-locked sandboxed document.
        if (hasStoryHtmlLayout(element.outerHTML)
            && (['div', 'table', 'section', 'article', 'figure', 'img', 'ul', 'ol', 'pre', 'blockquote'].includes(tag)
                || element.hasAttribute('style') || element.hasAttribute('class'))) {
            push('html', element.outerHTML, '酒馆排版', sharedStyles + '\n' + element.outerHTML);
            return;
        }
        push('story', element.outerHTML);
    };
    Array.from(document.body.childNodes).forEach(visit);
    if (!blocks.length) {
        // Invalid/mismatched foreign tags must still produce readable fallback,
        // but discard untrusted executable markup rather than displaying JS.
        const fallback = source.replace(/<(?:script|style|iframe|object|svg)\b[^>]*>[\s\S]*?<\/\s*(?:script|style|iframe|object|svg)\s*>/gi, '');
        push('story', fallback);
    }
    return blocks;
};

/**
 * Old story messages predate theaterSourceFormat metadata. Detect their
 * output dialect from stable markup instead of reinterpreting every old
 * reply whenever the active preset is switched to another source.
 */
export const looksLikeLegacyTavernStoryOutput = (value: string): boolean =>
    /<\s*(?:ecot|blend|thinking|think|thought|content|wine|meow_fm|branches|seeds|bbs|snow|secrets|sidestory|randomtheater|writing_interlude|episode|draft|microlist|ink|count)\b/i.test(value)
    || /<details\b[^>]*\bdata-(?:info|fate)\s*=/i.test(value)
    || /<details\b[^>]*>\s*<summary\b/i.test(value);

/** 将模型的 XML 风格排版协议变成纯文本展示块；原始消息仍原样参与下一轮上下文。 */
export const parseStoryDisplayBlocks = (content: string, fromTavern = false): StoryDisplayBlock[] => {
    const source = fromTavern ? normalizeTavernThinkingBlocks(String(content || '')) : String(content || '');
    if (fromTavern && typeof DOMParser !== 'undefined') return parseTavernStoryDisplayBlocks(source);
    const blocks: StoryDisplayBlock[] = [];
    const topLevel = fromTavern
        ? /<(thinking|think|thought|content|details|wine|meow_fm|branches|seeds|bbs|snow|secrets|sidestory|randomtheater|writing_interlude|partner_sidestory|scene_header|story_text|backstage|mind_weather|worldline|world_line|shot_debts|mini_theater|reply_choices|affinity_panel)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi
        : /<(scene_header|story_text|backstage|mind_weather|worldline|world_line|shot_debts|mini_theater|reply_choices|affinity_panel)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
    let cursor = 0;
    let match: RegExpExecArray | null;
    const foreignTavernTheaters: Record<string, string> = {
        sidestory: '酒馆小剧场',
        randomtheater: '酒馆随机小剧场',
        writing_interlude: '酒馆写作间隙',
        partner_sidestory: '酒馆伙伴剧场',
        wine: '酒馆小剧场',
        meow_fm: '剧情摘要',
        branches: '剧情选项',
        seeds: '剧情伏笔',
        bbs: '论坛附录',
        snow: '故事附录',
        secrets: '秘密记录',
    };
    const push = (kind: StoryDisplayBlockKind, text: string, title?: string) => {
        // A Tavern <content> block may itself wrap foreign theater modules.
        // Keep those in their own collapsed text appendix, NOT the main story.
        // No embedded HTML, CSS, scripts or regex replacements are executed.
        if (fromTavern && kind === 'story') {
            const embedded = /<(sidestory|randomtheater|writing_interlude|partner_sidestory)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
            let cursor = 0;
            let matched = false;
            for (const foreign of text.matchAll(embedded)) {
                const start = foreign.index!;
                if (start > cursor) push('story', text.slice(cursor, start));
                push('tavern-extra', foreign[2], foreignTavernTheaters[foreign[1].toLowerCase()]);
                cursor = start + foreign[0].length;
                matched = true;
            }
            if (matched) {
                if (cursor < text.length) push('story', text.slice(cursor));
                return;
            }
        }
        const clean = formatTaggedStoryFragment(text);
        if (!clean) return;
        const previous = blocks[blocks.length - 1];
        if (kind === 'story' && previous?.kind === 'story') previous.text = `${previous.text}\n\n${clean}`;
        else blocks.push({ kind, text: clean, ...(title ? { title } : {}) });
    };
    const pushTheater = (fragment: string, title?: string) => {
        const theater = parseStoryMiniTheater(fragment);
        const text = [
            theater.title ? `幕间：${theater.title}` : '',
            theater.system ? `旁白：${theater.system}` : '',
            ...theater.messages.map(message => `${message.name}：${message.text}`),
        ].filter(Boolean).join('\n');
        if (text) blocks.push({ kind: 'theater', ...(title ? { title } : {}), text, theater });
    };
    while ((match = topLevel.exec(source)) !== null) {
        if (match.index > cursor) push('story', source.slice(cursor, match.index));
        const sourceTag = match[1].toLowerCase();
        if (fromTavern && ['thinking', 'think', 'thought'].includes(sourceTag)) {
            push('thinking', match[2], '思考过程');
            cursor = match.index + match[0].length;
            continue;
        }
        if (fromTavern && sourceTag === 'content') {
            push('story', match[2]);
            cursor = match.index + match[0].length;
            continue;
        }
        if (fromTavern && sourceTag in foreignTavernTheaters) {
            push('tavern-extra', match[2], foreignTavernTheaters[sourceTag]);
            cursor = match.index + match[0].length;
            continue;
        }
        if (fromTavern && sourceTag === 'details') {
            const opening = match[0].slice(0, match[0].indexOf('>') + 1);
            const title = /data-info\s*=\s*["']archive["']/i.test(opening) ? '剧情摘要'
                : /data-fate\s*=\s*["']destiny["']/i.test(opening) ? '剧情选项'
                : /data-fate\s*=\s*["']side_theater["']/i.test(opening) ? '小剧场附录'
                : '酒馆附录';
            push('tavern-extra', match[2], title);
            cursor = match.index + match[0].length;
            continue;
        }
        const meta = DISPLAY_BLOCK_META[sourceTag] || { kind: 'other' as const };
        if (meta.kind === 'theater') {
            // Native <mini_theater> may also contain authored HTML layouts.
            // Keep existing mt_ai/mt_user bubbles, but safely render visual-only
            // HTML inside the same collapsed theater surface.
            const hasNativeMessages = /<(?:mt_ai|mt_user)\b/i.test(match[2])
                || /<name\b[^>]*>[\s\S]*?<\/name\s*>\s*<text\b/i.test(match[2]);
            if (hasStoryHtmlLayout(match[2]) && !hasNativeMessages) {
                blocks.push({ kind: 'html', title: meta.title, text: formatTaggedStoryFragment(match[2]),
                    htmlSource: match[2] });
            } else {
                pushTheater(match[2], meta.title);
            }
        } else {
            push(meta.kind, match[2], meta.title);
        }
        cursor = match.index + match[0].length;
    }
    if (cursor < source.length) {
        const tail = source.slice(cursor);
        const unclosedTheater = /<mini_theater\b[^>]*>([\s\S]*)$/i.exec(tail);
        if (unclosedTheater) {
            if (unclosedTheater.index > 0) push('story', tail.slice(0, unclosedTheater.index));
            pushTheater(unclosedTheater[1], DISPLAY_BLOCK_META.mini_theater.title);
        } else {
            push('story', tail);
        }
    }
    if (blocks.length === 0) push('story', source);
    return blocks;
};

export const formatActorRecentMessages = (
    char: CharacterProfile,
    messages: Message[],
    originalUserName?: string,
    currentIdentityName?: string,
): string => {
    if (messages.length === 0) return '';
    const originalUser = originalUserName?.trim() || '你';
    const currentIdentity = currentIdentityName?.trim() || originalUser;
    const rows = messages.map(message => {
        const speaker = message.role === 'user' ? `记忆中的你（${originalUser}）` : message.role === 'assistant' ? char.name : '系统';
        const clean = String(message.content || '').replace(/data:[^\s]+/gi, '[媒体]').slice(0, 4000);
        return `- [${new Date(message.timestamp).toLocaleString()}] ${speaker}：${clean}`;
    });
    const identityReminder = currentIdentity === originalUser
        ? ''
        : `\n当前执笔身份是「${currentIdentity}」；不得把下列“记忆中的你”重新解释成当前身份。`;
    return `### ${char.name} 最近携带的专属原文上下文（${messages.length} 条）\n以下记录只属于「${char.name}」与原互动对象「${originalUser}」，不得并入其他角色的经历。${identityReminder}\n${rows.join('\n')}`;
};

const toStoryHistoryMessage = (message: Message): StoryApiMessage => ({
    role: message.role as StoryApiRole,
    content: message.metadata?.theaterOpeningGreeting
        ? storyOpeningReadingText(String(message.content || ''),
            message.metadata.theaterOpeningGreeting.greetingId,
            message.metadata.theaterOpeningGreeting.source)
        : String(message.content || ''),
});

export const buildStoryHistory = (messages: Message[]): StoryApiMessage[] => messages
    .filter(message => !message.metadata?.theaterArchived && message.role !== 'system')
    .sort((a, b) => a.id - b.id)
    .map(toStoryHistoryMessage);

/** Number floors before hiding old records so the API and reading view use the same numbers. */
export const buildStoryRequestHistory = (
    rows: Message[],
    beforeId: number,
    isArchived: (message: Message) => boolean,
) => {
    const history = rows.map((row, index) => ({ row, floor: index + 1 }))
        .filter(({ row }) => row.id < beforeId && (row.role === 'user' || row.role === 'assistant'));
    const anchor = history.map(({ row }) => row.role).lastIndexOf('assistant');
    return history.filter(({ row }, index) =>
        // Restore the exact previous reply for old stories that archived it too early.
        index === anchor || (index === anchor - 1 && row.role === 'user') || !isArchived(row),
    ).map(({ row, floor }) => {
        const message = toStoryHistoryMessage(row);
        if (row.role === 'user') {
            message.content = appendStoryAffinityInputs(message.content, storyAffinityInputsFromMessage(row));
        }
        return { row, floor, message };
    });
};

/** Use the original input on new replies. Legacy replies can use an adjacent user floor. */
export const getStoryReplyInput = (rows: Message[], reply: Message): Message | undefined => {
    const savedId = reply.metadata?.theaterReplyToUserId;
    const candidate = savedId === undefined
        ? rows[rows.findIndex(row => row.id === reply.id) - 1]
        : rows.find(row => row.id === savedId);
    return candidate?.role === 'user' && candidate.id < reply.id ? candidate : undefined;
};

/** 仅当最后一条剧场消息是尚未得到回复的用户推进时，提供中断续跑输入。 */
export const getPendingStoryRetryInput = (messages: Message[], archives?: StoryTheaterArchive[]): string => {
    const latest = messages[messages.length - 1];
    if (!latest || latest.role !== 'user'
        || (latest.metadata?.theaterArchived && (!archives || storyArchiveAtFloor(archives, latest.id)))) return '';
    return String(latest.content || '').trim();
};

export const estimateStoryTokens = (text: string): number => {
    const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
    const rest = Math.max(0, text.length - cjk);
    return cjk + Math.ceil(rest / 4);
};

const storyApiDetail = (value: unknown): string => {
    if (typeof value === 'string') return value.trim();
    if (!value || typeof value !== 'object') return '';
    const record = value as Record<string, unknown>;
    return storyApiDetail(record.message)
        || storyApiDetail(record.detail)
        || storyApiDetail(record.error)
        || storyApiDetail(record.code);
};

/** 保留上游 4xx 的真正原因，避免调试日志里只剩一条没有信息量的 “API Error 400”。 */
export const describeStoryApiError = (status: number, data: unknown): string => {
    const detail = storyApiDetail((data as Record<string, unknown> | null)?.error)
        || storyApiDetail((data as Record<string, unknown> | null)?.message)
        || storyApiDetail((data as Record<string, unknown> | null)?.detail);
    return `API Error ${status}${detail ? `：${detail.slice(0, 500)}` : ''}`;
};

export const isStoryUserLastCompatibilityError = (message: string): boolean => (
    /(?:last|final)[^\n]{0,80}(?:message|role)[^\n]{0,80}user/i.test(message)
    || /(?:最后|末尾)[^\n]{0,40}(?:消息|角色)[^\n]{0,40}user/i.test(message)
);

/** 200 但正文为空时把 finish_reason 带出来，区分截断、内容过滤和代理空包。 */
export const describeEmptyStoryCompletion = (data: unknown): string => {
    const record = data as Record<string, any> | null;
    const choice = record?.choices?.[0];
    const finishReason = String(choice?.finish_reason || choice?.finishReason || '').trim();
    const providerDetail = storyApiDetail(record?.error) || storyApiDetail(record?.message);
    if (providerDetail) return `没有生成正文：${providerDetail.slice(0, 500)}`;
    if (finishReason === 'length' || finishReason === 'max_tokens') {
        return '没有生成正文：模型在写出正文前已用完输出额度（finish_reason=length）。请提高“最大输出”，或降低模型思考量后重试';
    }
    if (finishReason === 'content_filter') return '没有生成正文：上游内容过滤拦截了本次回复（finish_reason=content_filter）';
    return `没有生成正文${finishReason ? `（finish_reason=${finishReason}）` : '：上游返回了空内容'}，请重试`;
};

export const memoryTimestampForCharacter = (entry: StoryTheaterEntry, charId: string, realTimestamp: number): number => {
    const anchorText = entry.characterMemoryDates?.[charId];
    const storyAnchor = anchorText ? new Date(anchorText).getTime() : NaN;
    if (!Number.isFinite(storyAnchor)) return realTimestamp;
    return storyAnchor + Math.max(0, realTimestamp - entry.createdAt);
};

/** Story time stays in metadata; receipt time controls chat ordering. */
export const storyTimelineTimestampForCharacter = memoryTimestampForCharacter;
export const createStoryTheaterMirrorMessage = (
    entry: StoryTheaterEntry, charId: string,
    central: Pick<Message, 'id' | 'role' | 'content' | 'timestamp'>,
): Omit<Message, 'id'> => ({
    charId, role: central.role, type: 'text', content: central.content, timestamp: central.timestamp,
    metadata: { source: 'story_theater_memory', theaterId: entry.id, theaterTitle: entry.title,
        theaterCentralId: central.id, theaterTimestampVersion: 1, theaterReceivedAt: central.timestamp,
        theaterTimelineTimestamp: storyTimelineTimestampForCharacter(entry, charId, central.timestamp) },
});

export const makeStoryPresetFileName = (name: string): string => {
    const safeName = name.replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 80) || '剧情预设';
    return `${safeName}.json`;
};

export const downloadStoryPreset = async (preset: StoryTheaterPreset): Promise<'shared' | 'downloaded' | 'cancelled'> => (
    shareOrDownloadFile({
        card: { kind: 'story', title: preset.name || '剧情预设' },
        content: JSON.stringify(preset.document.tavernOptions
            ? { ...preset.document, tavernOptions: normalizeTavernPresetOptions(preset.document.tavernOptions) }
            : preset.document, null, 2),
        fileName: makeStoryPresetFileName(preset.name),
        mimeType: 'application/json',
        shareTitle: `剧情预设：${preset.name || '未命名'}`,
    })
);
