import type { StoryTheaterPresetDocument, StoryTheaterPresetPrompt } from '../types';
import type { StoryApiMessage } from './storyTheater';

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
    if (value == null || value === '' || typeof value === 'boolean') return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const text = (value: unknown): string => typeof value === 'string' ? value : '';
const role = (value: unknown): StoryTheaterPresetPrompt['role'] => {
    // OpenAI's newer developer role has the same priority class as system in
    // this story API; unsupported roles cannot be silently rewritten.
    if (value == null || value === 'system' || value === 'developer') return 'system';
    if (value === 'user' || value === 'assistant') return value;
    throw new Error(`酒馆预设使用了无法映射的消息角色「${String(value)}」，请检查原文件`);
};

export const isSillyTavernChatPreset = (value: any): boolean =>
    !!value && Array.isArray(value.prompts) && value.prompts.length > 0
    && value.prompts.some((prompt: any) => prompt && typeof prompt.identifier === 'string'
        && (typeof prompt.content === 'string' || typeof prompt.role === 'string' || prompt.marker === true))
    // A few older/hand-edited Chat Completion exports only have prompts[].
    // Only support a genuinely missing order table; an explicitly malformed
    // order table must not turn disabled prompts on by accident.
    && (value.prompt_order === undefined || (Array.isArray(value.prompt_order)
        && value.prompt_order.some((group: any) => Array.isArray(group?.order))));

export const convertSillyTavernChatPreset = (value: any, fallbackName: string): StoryTheaterPresetDocument => {
    if (!isSillyTavernChatPreset(value)) throw new Error('无法识别为酒馆 Chat Completion 预设');

    const missingOrderTable = value.prompt_order === undefined;
    const orderGroups = missingOrderTable ? [] : value.prompt_order.filter((group: any) => Array.isArray(group?.order));
    const populated = orderGroups.filter((group: any) => group.order.length > 0);
    // 100001 / 100000 are the SillyTavern default character-order configurations.
    const eligibleOrderGroups = populated.length ? populated : orderGroups;
    const orderGroup = missingOrderTable
        ? { order: value.prompts.filter((prompt: any) => typeof prompt?.identifier === 'string')
            .map((prompt: any) => ({ identifier: prompt.identifier, enabled: prompt.enabled !== false })) }
        : eligibleOrderGroups.find((group: any) => group.character_id === 100001)
            || eligibleOrderGroups.find((group: any) => group.character_id === 100000)
            || eligibleOrderGroups[0];
    if (!orderGroup || (orderGroup.order.length === 0 && !missingOrderTable)) {
        throw new Error('酒馆排序表为空，无法确认提示词开关；请重新导出完整 Chat Completion 预设');
    }
    const sourceById = new Map<string, any>();
    for (const item of value.prompts) {
        if (!item || typeof item.identifier !== 'string' || !item.identifier.trim()) {
            throw new Error('酒馆预设存在缺少 identifier 的提示词；为避免遗漏原文已取消导入');
        }
        if (sourceById.has(item.identifier)) {
            throw new Error(`酒馆预设的提示词标识「${item.identifier}」重复；无法安全判断排序和开关，未覆盖任何数据`);
        }
        sourceById.set(item.identifier, item);
    }

    const prompts: StoryTheaterPresetPrompt[] = [];
    const used = new Set<string>();
    const append = (identifier: string, active: boolean) => {
        const source = sourceById.get(identifier);
        if (!source || used.has(identifier)) return;
        used.add(identifier);
        const content = text(source.content);
        // Recognize standard SillyTavern placeholder IDs even in exports that
        // omit marker:true; only do so when the prompt has no custom text.
        const mappedMarker = MARKERS[identifier] && (source.marker === true || !content.trim())
            ? MARKERS[identifier] : undefined;
        // Preserve unknown marker entries for lossless editing/export; do not execute them.
        const next: StoryTheaterPresetPrompt = {
            id: `st-${identifier}`,
            name: text(source.name).trim() || identifier,
            enabled: active,
            role: role(source.role),
            content,
            ...(mappedMarker ? { marker: mappedMarker } : {}),
        };
        if (Number(source.injection_position) === 1 && !mappedMarker) {
            next.injection = {
                position: 'chat',
                depth: Math.round(numeric(source.injection_depth, 4, 0, 10000)),
                order: numeric(source.injection_order, 100, -100000, 100000),
            };
        }
        prompts.push(next);
        if (mappedMarker && content.trim()) {
            // A non-empty marker also contains authored text. The slot must
            // remain dynamic AND its content must not disappear at runtime.
            // Preserve the authored text as an adjacent independent prompt.
            prompts.push({
                id: `st-${identifier}-content`, name: `${next.name} · 附加正文`,
                enabled: active, role: next.role, content,
            });
        }
    };

    const seenOrderIds = new Set<string>();
    for (const item of orderGroup.order) {
        if (typeof item?.identifier !== 'string') {
            throw new Error('酒馆排序表包含没有 identifier 的条目，无法安全导入');
        }
        if (seenOrderIds.has(item.identifier)) {
            throw new Error(`酒馆排序表重复引用「${item.identifier}」，无法判断最终发送位置`);
        }
        seenOrderIds.add(item.identifier);
        const source = sourceById.get(item.identifier);
        if (!source) {
            if (item.enabled === true) throw new Error(`启用的提示词「${item.identifier}」缺少正文定义，为避免遗漏已取消导入`);
            continue;
        }
        // Older order tables can omit enabled: use the prompt's own explicit
        // flag, instead of silently disabling the whole preset.
        const active = item.enabled === undefined
            ? source.enabled !== false
            : item.enabled === true || item.enabled === 1 || item.enabled === 'true';
        append(item.identifier, active);
    }
    // Preserve unlisted content for the editor without making it active unexpectedly.
    for (const identifier of sourceById.keys()) if (!used.has(identifier)) append(identifier, false);
    // A fully disabled preset is still a valid editable import: do not silently turn
    // anything on, and do not reject its user's archived prompt text.

    const warnings: string[] = [];
    if (missingOrderTable) warnings.push('原文件没有 prompt_order；已按 prompts 数组顺序和各条 enabled 开关导入（原文件无法提供更精确的排序）');
    const regexCount = Array.isArray(value.extensions?.regex_scripts)
        ? value.extensions.regex_scripts.filter((script: any) => script?.disabled !== true).length : 0;
    const helperCount = Array.isArray(value.extensions?.tavern_helper?.scripts)
        ? value.extensions.tavern_helper.scripts.filter((script: any) => script?.enabled === true).length : 0;
    if (regexCount || helperCount) warnings.push(`酒馆扩展中的 ${regexCount} 条启用正则和 ${helperCount} 个启用脚本不会执行；仅导入预设文字`);
    if (prompts.some(prompt => prompt.enabled && /\{\{\s*setvar::/i.test(prompt.content))) {
        warnings.push('已启用的 setvar 规则型正文会转为糯米机实际提示词；只有插件脚本才能实现的变量联动仍不执行');
    }
    if (prompts.some(prompt => prompt.enabled && /\{\{(?!user\}\}|char\}\}|group\}\}|trim\}\}|setvar::|getvar::|\/\/)/i.test(prompt.content))) {
        warnings.push('部分酒馆专属动态宏尚无糯米机等价功能，原文保留供检查');
    }
    if (orderGroups.length > 1) warnings.push('多个角色排序表只采用酒馆默认排序表');
    if (prompts.some(prompt => prompt.enabled && !prompt.marker && !prompt.content.trim())) warnings.push('空白或未知酒馆占位条目已保留，不会误当作可执行指令');
    if (value.top_k > 0 || value.top_a > 0 || value.min_p > 0 || (typeof value.repetition_penalty === 'number' && value.repetition_penalty !== 1)) {
        warnings.push('top_k / top_a / min_p / repetition_penalty 等模型采样字段无原生等价参数，未强制应用');
    }
    if (Number(value.openai_max_tokens) > 32000) warnings.push('酒馆最大输出 tokens 超过糯米机当前 32000 上限，已按原生范围适配');
    if (prompts.some(prompt => prompt.enabled && prompt.marker === 'examples')) warnings.push('对话示例占位已保留；当前剧情角色资料没有独立示例字段时，该槽位不发送内容');
    if (prompts.some(prompt => prompt.marker === 'characters')) warnings.push('酒馆角色资料按当前糯米机角色动态绑定；描述与性格两个占位均启用时分别插入');

    return {
        schema: 'sullyos.story-preset',
        version: 1,
        name: fallbackName,
        description: '从酒馆 Chat Completion 预设适配；原有提示词、开关及顺序已保留。',
        sourceFormat: 'sillytavern',
        ...(value.squash_system_messages === true ? { squashSystemMessages: true } : {}),
        // Other Chat Completion presets can use format strings without any
        // double-brace name macros. Keep these templates intact until runtime.
        tavernFormats: {
            worldInfo: text(value.wi_format),
            scenario: text(value.scenario_format),
            personality: text(value.personality_format),
            newChat: text(value.new_chat_prompt),
            newExampleChat: text(value.new_example_chat_prompt),
            continueNudge: text(value.continue_nudge_prompt),
        },
        // Retain safe scalar configuration fields (including unsupported sampler
        // options) so editing/exporting as a native preset does not silently erase
        // the source's configuration. Never copy extensions or execute scripts.
        tavernOptions: Object.fromEntries(Object.entries(value)
            .filter(([key, option]) => !['prompts', 'prompt_order', 'extensions'].includes(key)
                && (option === null || ['string', 'number', 'boolean'].includes(typeof option))
                && (typeof option !== 'string' || option.length <= 65536))) as Record<string, string | number | boolean | null>,
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
/** A rich XML rule hidden inside a setvar is prompt text, not executable JS.
 * These are safe to place into the request if no active getvar consumes them.
 */
const isStandaloneTavernRule = (value: string): boolean => {
    const match = /^\s*<([a-z][\w-]*)\b[^>]*>[\s\S]*<\/\1\s*>\s*$/i.exec(value);
    // Tavern's preset can wrap rules in custom XML names (e.g.
    // <five_senses_intimate>), not just <rule>. Treat them as static
    // instruction text, never as DOM or executable code.
    return Boolean(match && !/^(?:script|style|iframe|object|embed|svg|html)$/i.test(match[1]));
};

export const expandSillyTavernPromptText = (
    raw: string,
    variables: Map<string, string>,
    referencedVariables?: ReadonlySet<string>,
    globalVariables: Map<string, string> = new Map(),
    randomValue: () => number = Math.random,
): string => raw
    .replace(/\{\{\s*\/\/[\s\S]*?\}\}/g, '')
    .replace(/(?:\r?\n)*\{\{\s*trim\s*\}\}(?:\r?\n)*/gi, '')
    .replace(/\{\{\s*setvar\s*::\s*([^{}:]+?)\s*::([\s\S]*?)\}\}/gi, (_macro, key: string, value: string) => {
        const name = key.trim();
        variables.set(name, value);
        // SillyTavern extensions may read this variable later. They cannot run in
        // SullyOS, so standalone rich rule bodies must not silently disappear.
        // A real enabled getvar still owns its injection site and avoids duplicates.
        return referencedVariables && !referencedVariables.has(name) && isStandaloneTavernRule(value)
            ? value.trim()
            : '';
    })
    .replace(/\{\{\s*setglobalvar\s*::\s*([^{}:]+?)\s*::([\s\S]*?)\}\}/gi, (_macro, key: string, value: string) => {
        // Global values must never leak into other SullyOS stories/identities.
        globalVariables.set(key.trim(), value);
        return '';
    })
    .replace(/\{\{\s*getvar(?:\s*::\s*|\s*:\s*|\s+)([^{}]+?)\s*\}\}/gi, (_macro, key: string) => variables.get(key.trim()) || '')
    .replace(/\{\{\s*getglobalvar(?:\s*::\s*|\s*:\s*|\s+)([^{}]+?)\s*\}\}/gi, (_macro, key: string) =>
        globalVariables.get(key.trim()) || '')
    .replace(/\{\{\s*\.([\w\p{L}\p{N}-]+)\s*\}\}/gu, (original, key: string) =>
        variables.has(key) ? variables.get(key) || '' : original)
    .replace(/\{\{\s*\$([\w\p{L}\p{N}-]+)\s*\}\}/gu, (original, key: string) =>
        globalVariables.has(key) ? globalVariables.get(key) || '' : original)
    // Random choices are safe text macros, rerolled for each generation.
    .replace(/\{\{\s*random\s*(?:::|\s+)([^{}]+?)\s*\}\}/gi, (original, options: string) => {
        const choices = options.includes('::') ? options.split('::') : options.split(',');
        const usable = choices.map(value => value.trim()).filter(Boolean);
        if (usable.length < 2) return original;
        const index = Math.min(usable.length - 1, Math.max(0, Math.floor(randomValue() * usable.length)));
        return usable[index];
    });

/** Resolve supported Tavern card/persona/history macros against the actual story
 * runtime. Unsupported syntax is preserved literally for editing instead of
 * silently deleting or executing uploaded code.
 */
export const expandSillyTavernContextMacros = (
    raw: string,
    values: {
        description?: string;
        personality?: string;
        persona?: string;
        scenario?: string;
        examples?: string;
        lastMessage?: string;
        lastUserMessage?: string;
        lastCharMessage?: string;
        lastChatMessage?: string;
        input?: string;
        model?: string;
        variables?: ReadonlyMap<string, string>;
        now?: Date;
    },
): string => {
    const aliases: Record<string, string | undefined> = {
        description: values.description,
        personality: values.personality,
        persona: values.persona,
        scenario: values.scenario,
        mesexamples: values.examples,
        mesexamplesraw: values.examples,
        lastmessage: values.lastMessage,
        lastusermessage: values.lastUserMessage,
        lastcharmessage: values.lastCharMessage,
        lastchatmessage: values.lastChatMessage ?? values.lastCharMessage ?? values.lastMessage,
        input: values.input,
        model: values.model,
    };
    const now = values.now ?? new Date();
    const datePart = (number: number) => String(number).padStart(2, '0');
    const localDate = `${now.getFullYear()}-${datePart(now.getMonth() + 1)}-${datePart(now.getDate())}`;
    const localTime = `${datePart(now.getHours())}:${datePart(now.getMinutes())}`;
    const dates: Record<string, string> = {
        date: now.toLocaleDateString(),
        time: now.toLocaleTimeString(),
        weekday: now.toLocaleDateString(undefined, { weekday: 'long' }),
        isodate: localDate,
        isotime: localTime,
    };
    const conditionalValue = (rawCondition: string): boolean | undefined => {
        const condition = rawCondition.trim();
        const negated = condition.startsWith('!');
        const name = negated ? condition.slice(1).trim() : condition;
        const key = name.toLowerCase();
        const scalar = key === 'true' || key === 'false' || key === 'off' || key === 'on'
            || key === 'yes' || key === 'no' || key === '0' || key === '1' ? key
            : name.startsWith('.') ? values.variables?.get(name.slice(1)) : aliases[key];
        if (scalar === undefined) return undefined;
        const active = !['', 'false', 'off', 'no', '0'].includes(String(scalar).trim().toLowerCase());
        return negated ? !active : active;
    };
    const expandConditionals = (source: string): string => {
        let result = source;
        // Process innermost pairs first; leave unknown conditions UNCHANGED so
        // future macro syntax is never silently discarded from imported prompts.
        for (let pass = 0; pass < 64; pass++) {
            const tags = [...result.matchAll(/\{\{\s*(#?if(?:\s*::\s*|\s+)[^{}]+|else|\/if)\s*\}\}/gi)];
            const stack: Array<{ tag: RegExpMatchArray; elseTag?: RegExpMatchArray }> = [];
            let changed = false;
            for (const tag of tags) {
                const directive = tag[1].trim();
                if (/^#?if(?:\s|::)/i.test(directive)) {
                    stack.push({ tag });
                } else if (/^else$/i.test(directive)) {
                    if (stack.length) stack[stack.length - 1].elseTag = tag;
                } else if (/^\/if$/i.test(directive) && stack.length) {
                    const start = stack.pop()!;
                    const condition = start.tag[1].replace(/^#?if(?:\s*::\s*|\s+)/i, '');
                    const yes = conditionalValue(condition);
                    if (yes === undefined) continue;
                    const headEnd = start.tag.index! + start.tag[0].length;
                    const elseStart = start.elseTag?.index ?? tag.index!;
                    const elseEnd = start.elseTag ? start.elseTag.index! + start.elseTag[0].length : tag.index!;
                    const body = yes ? result.slice(headEnd, elseStart)
                        : result.slice(elseEnd, tag.index!);
                    result = result.slice(0, start.tag.index!) + body + result.slice(tag.index! + tag[0].length);
                    changed = true;
                    break;
                }
            }
            if (!changed) break;
        }
        return result;
    };
    const resolved = raw
        .replace(/\{\{\s*(description|personality|persona|scenario|mesexamples|mesexamplesraw|lastmessage|lastusermessage|lastcharmessage|lastchatmessage|input|model)\s*\}\}/gi,
            (original, key: string) => aliases[key.toLowerCase()] ?? original)
        .replace(/\{\{\s*newline(?:\s*::\s*(\d+))?\s*\}\}/gi,
            (_original, count?: string) => '\n'.repeat(Math.min(20, Math.max(0, Number(count || 1)))))
        .replace(/\{\{\s*space(?:\s*::\s*(\d+))?\s*\}\}/gi,
            (_original, count?: string) => ' '.repeat(Math.min(20, Math.max(0, Number(count || 1)))))
        .replace(/\{\{\s*noop\s*\}\}/gi, '')
        .replace(/\{\{\s*(date|time|weekday|isodate|isotime)\s*\}\}/gi,
            (original, key: string) => dates[key.toLowerCase()] ?? original);
    return expandConditionals(resolved);
};

/** Scoped to imported Tavern stories: the app's generic extractContent() strips
 * <thinking> blocks by design. Keep their original markup in Tavern story
 * messages instead, and support providers returning reasoning in a separate
 * OpenAI-compatible field. The native chat API parser remains untouched.
 */
export const extractSillyTavernStoryContent = (data: any): string => {
    const message = data?.choices?.[0]?.message;
    const asText = (input: unknown): string => {
        if (typeof input === 'string') return input;
        if (!Array.isArray(input)) return '';
        return input.map(part => {
            if (typeof part === 'string') return part;
            if (!part || typeof part !== 'object') return '';
            const item = part as Record<string, unknown>;
            if (item.type === 'thinking' && typeof item.thinking === 'string') {
                return `<thinking>${item.thinking}</thinking>`;
            }
            return typeof item.text === 'string' ? item.text
                : typeof item.content === 'string' ? item.content : '';
        }).join('');
    };
    const content = asText(message?.content);
    const separateThinking = asText(message?.reasoning_content ?? message?.reasoning ?? message?.thinking);
    if (!separateThinking || /<(?:thinking|think|thought)\b/i.test(content)) return content.trim();
    const formattedThinking = /^<(?:thinking|think|thought)\b/i.test(separateThinking.trim())
        ? separateThinking : `<thinking>${separateThinking}</thinking>`;
    return `${formattedThinking}\n${content}`.trim();
};

/** Preserve roles and message order while matching Tavern's system-message squashing. */
export const squashAdjacentSystemMessages = (items: StoryApiMessage[]): StoryApiMessage[] => {
    const result: StoryApiMessage[] = [];
    for (const item of items) {
        const last = result[result.length - 1];
        if (item.role === 'system' && last?.role === 'system') {
            result[result.length - 1] = { ...last, content: `${last.content}\n\n${item.content}` };
        } else {
            result.push(item);
        }
    }
    return result;
};
