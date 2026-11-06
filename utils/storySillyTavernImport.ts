import type { StoryTheaterPresetDocument, StoryTheaterPresetPrompt } from '../types';

/**
 * SillyTavern Chat Completion preset -> native story preset.
 * Never evaluate uploaded scripts/regex/HTML: only the prompt text is imported.
 * prompt_order (not prompts[]) is the effective order and enabled-state source.
 */
const MARKERS: Record<string, StoryTheaterPresetPrompt['marker']> = {
    worldInfoBefore: 'world_before',
    charDescription: 'characters',
    charPersonality: 'characters',
    personaDescription: 'user',
    scenario: 'scenario',
    worldInfoAfter: 'world_after',
    dialogueExamples: 'examples',
    chatHistory: 'history',
};

const numeric = (value: unknown, fallback: number, min: number, max: number): number => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const text = (value: unknown): string => typeof value === 'string' ? value : '';
const role = (value: unknown): StoryTheaterPresetPrompt['role'] =>
    value === 'user' ? 'user' : value === 'assistant' ? 'assistant' : 'system';

export const isSillyTavernChatPreset = (value: any): boolean =>
    !!value && Array.isArray(value.prompts) && value.prompts.length > 0
    && value.prompts.some((prompt: any) => prompt && typeof prompt.identifier === 'string')
    && Array.isArray(value.prompt_order)
    && value.prompt_order.some((group: any) => Array.isArray(group?.order));

export const convertSillyTavernChatPreset = (value: any, fallbackName: string): StoryTheaterPresetDocument => {
    if (!isSillyTavernChatPreset(value)) throw new Error('无法识别为酒馆 Chat Completion 预设');

    const orderGroups = value.prompt_order.filter((group: any) => Array.isArray(group?.order));
    // 100001 / 100000 are the SillyTavern default character-order configurations.
    const orderGroup = orderGroups.find((group: any) => group.character_id === 100001)
        || orderGroups.find((group: any) => group.character_id === 100000)
        || orderGroups[0];
    const sourceById = new Map<string, any>();
    for (const item of value.prompts) {
        if (item && typeof item.identifier === 'string' && !sourceById.has(item.identifier)) {
            sourceById.set(item.identifier, item);
        }
    }

    const prompts: StoryTheaterPresetPrompt[] = [];
    const used = new Set<string>();
    const append = (identifier: string, active: boolean) => {
        const source = sourceById.get(identifier);
        if (!source || used.has(identifier)) return;
        used.add(identifier);
        const isMarker = source.marker === true;
        const mappedMarker = isMarker ? MARKERS[identifier] : undefined;
        const content = text(source.content);
        // Unrecognized empty system placeholders cannot be represented by the story runtime.
        // Keep meaningful text even when the source mistakenly flags it as a marker.
        if (isMarker && !mappedMarker && !content.trim()) return;
        const next: StoryTheaterPresetPrompt = {
            id: `st-${identifier}`,
            name: text(source.name).trim() || identifier,
            enabled: active,
            role: role(source.role),
            content,
            ...(mappedMarker ? { marker: mappedMarker } : {}),
        };
        if (source.injection_position === 1 && !mappedMarker) {
            next.injection = {
                position: 'chat',
                depth: Math.round(numeric(source.injection_depth, 4, 0, 10000)),
                order: numeric(source.injection_order, 100, -100000, 100000),
            };
        }
        prompts.push(next);
    };

    for (const item of orderGroup.order) {
        if (typeof item?.identifier === 'string') {
            // The order entry controls activation in SillyTavern; respect explicit false.
            append(item.identifier, item.enabled === true);
        }
    }
    // Preserve unlisted content for the editor without making it active unexpectedly.
    for (const identifier of sourceById.keys()) if (!used.has(identifier)) append(identifier, false);
    if (!prompts.some(prompt => prompt.enabled && (prompt.content.trim() || prompt.marker))) {
        throw new Error('酒馆预设没有可启用的有效提示词');
    }

    const warnings: string[] = [];
    const regexCount = Array.isArray(value.extensions?.regex_scripts)
        ? value.extensions.regex_scripts.filter((script: any) => script?.disabled !== true).length : 0;
    const helperCount = Array.isArray(value.extensions?.tavern_helper?.scripts)
        ? value.extensions.tavern_helper.scripts.filter((script: any) => script?.enabled === true).length : 0;
    if (regexCount || helperCount) warnings.push(`酒馆扩展中的 ${regexCount} 条启用正则和 ${helperCount} 个启用脚本不会执行；仅导入预设文字`);
    if (prompts.some(prompt => prompt.enabled && /\{\{(?!user\}\}|char\}\}|group\}\}|trim\}\}|setvar::|getvar::|\/\/)/i.test(prompt.content))) {
        warnings.push('部分酒馆专属动态宏尚无糯米机等价功能，原文保留供检查');
    }
    if (orderGroups.length > 1) warnings.push('多个角色排序表只采用酒馆默认排序表');
    if (prompts.some(prompt => prompt.marker === 'characters')) warnings.push('酒馆角色描述与性格槽位合并使用糯米机的完整角色资料，避免重复发送');

    return {
        schema: 'sullyos.story-preset',
        version: 1,
        name: fallbackName,
        description: '从酒馆 Chat Completion 预设适配；原有提示词、开关及顺序已保留。',
        sourceFormat: 'sillytavern',
        importWarnings: warnings,
        generation: {
            temperature: numeric(value.temperature, 0.9, 0, 2),
            topP: numeric(value.top_p, 1, 0, 1),
            frequencyPenalty: numeric(value.frequency_penalty, 0, -2, 2),
            presencePenalty: numeric(value.presence_penalty, 0, -2, 2),
            maxTokens: Math.round(numeric(value.openai_max_tokens, 8000, 256, 32000)),
        },
        prompts,
        assistantPrefill: text(value.assistant_prefill),
    };
};

/** SillyTavern's basic text-variable macros, without evaluating arbitrary code. */
export const expandSillyTavernPromptText = (raw: string, variables: Map<string, string>): string => raw
    .replace(/\{\{\s*\/\/[\s\S]*?\}\}/g, '')
    .replace(/(?:\r?\n)*\{\{\s*trim\s*\}\}(?:\r?\n)*/gi, '')
    .replace(/\{\{\s*setvar::([^{}:]+)::([\s\S]*?)\}\}/gi, (_macro, key: string, value: string) => {
        variables.set(key.trim(), value);
        return '';
    })
    .replace(/\{\{\s*getvar::([^{}]+)\}\}/gi, (_macro, key: string) => variables.get(key.trim()) || '');
