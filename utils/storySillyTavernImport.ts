import { normalizeStoryOutputTokens, STORY_MAX_OUTPUT_TOKENS } from './storyOutputLimits';
import { completionContentToText } from './completionContent';
import type { StoryTheaterPresetDocument, StoryTheaterPresetPrompt, StoryTavernChoiceKey, StoryTavernNativeControls } from '../types';
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

export function normalizeTavernPresetOptions(value: Record<string, unknown>): NonNullable<StoryTheaterPresetDocument['tavernOptions']> {
    return Object.fromEntries(Object.entries(value).filter(([key, option]) => {
        const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
        const isCredential = /apikey|accesstoken|refreshtoken|authtoken|authorization|password|credential|secret/.test(normalizedKey);
        return !['prompts', 'prompt_order', 'extensions'].includes(key) && !isCredential
            && (option === null || ['string', 'number', 'boolean'].includes(typeof option))
            && (typeof option !== 'string' || option.length <= 65536);
    })) as NonNullable<StoryTheaterPresetDocument['tavernOptions']>;
}

const promptEnabled = (value: unknown, fallback: boolean, identifier: string): boolean => {
    if (value === undefined) return fallback;
    if (value === true || value === 1 || (typeof value === 'string' && /^(true|1)$/i.test(value.trim()))) return true;
    if (value === false || value === 0 || (typeof value === 'string' && /^(false|0)$/i.test(value.trim()))) return false;
    throw new Error(`酒馆提示词「${identifier}」的 enabled 开关无效，请检查原文件`);
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

/** Read supported order table shapes without inspecting any author's prose. */
const readTavernOrderGroups = (input: unknown): Array<{ character_id?: number | string; order: any[] }> | null => {
    if (Array.isArray(input)) {
        if (!input.length) return null;
        if (input.every(item => item && typeof item === 'object' && Array.isArray(item.order))) return input;
        if (input.every(item => typeof item === 'string'
            || (item && typeof item === 'object' && typeof item.identifier === 'string')))
            return [{ character_id: 100001, order: input }];
        return null;
    }
    if (input && typeof input === 'object' && Array.isArray((input as any).order))
        return [input as { character_id?: number | string; order: any[] }];
    return null;
};

export const isSillyTavernChatPreset = (value: any): boolean =>
    !!value && Array.isArray(value.prompts) && value.prompts.length > 0
    && value.prompts.some((prompt: any) => prompt && typeof prompt.identifier === 'string'
        && (typeof prompt.content === 'string' || typeof prompt.role === 'string' || prompt.marker === true))
    && (value.prompt_order === undefined || readTavernOrderGroups(value.prompt_order) !== null);


/** Conservative mapping to the EXISTING native eight-option preset maker.
 * Only currently enabled author rules count. Nothing is rewritten or injected.
 * A label without a selected built-in ID means the author's rules are more
 * specific than the native mode and must be respected verbatim.
 */
export const detectTavernNativeControls = (prompts: readonly StoryTheaterPresetPrompt[]): StoryTavernNativeControls => {
    const inferred: StoryTavernNativeControls['inferred'] = {};
    const labels: StoryTavernNativeControls['labels'] = {};
    const active = prompts.filter(p => p.enabled && !p.marker && !p.section && p.content.trim()).map(p => ({
        name: p.name,
        text: p.content.replace(/\{\{\s*\/\/[\s\S]*?\}\}/g, '').replace(/<!--[\s\S]*?-->/g, ''),
    }));
    const hint = (key: StoryTavernChoiceKey, label: string, id?: string): void => {
        labels[key] = label.slice(0, 75);
        if (id) inferred[key] = id;
    };
    // Titles identify the selected style; the longest prose entry might just
    // be a language banlist that happens to mention "writing style".
    const stylePriority = (p: { name: string; text: string }): number => {
        if (/禁词|词表|语言审查|^说明|免责|禁止词/.test(p.name)) return -1;
        if (/主文风|内置文风|当前文风/i.test(p.name)) return 6;
        if (/光影美学|光影风格/.test(p.name)) return 5;
        if (/文风|写作风格|叙事风格|writing[_ ]style/i.test(p.name)) return 4;
        if (/美学|审美风格/.test(p.name)) return 3;
        if (/文风|写作风格|writing[_ ]style|AKOSTYLE|CREATIVE_STYLE|叙事风格/i
            .test(p.text.slice(0, 300))) return 1;
        return 0;
    };
    const style = active.filter(p => p.text.length > 120 && stylePriority(p) > 0)
        .sort((a, b) => stylePriority(b) - stylePriority(a) || b.text.length - a.text.length)[0];
    if (style) {
        const content = style.name + style.text.slice(0, 1000);
        const builtin: Array<[RegExp, string, string]> = [
            [/汽水日常/, '汽水日常', 'nmj-v3-style-soda'],
            [/潮雨走廊/, '潮雨走廊', 'nmj-v3-style-corridor'],
            [/荒诞喜剧/, '荒诞喜剧', 'nmj-v3-style-comedy'],
            [/黑喜剧/, '黑喜剧', 'nmj-v3-style-darkcomedy'],
            [/直球甜宠/, '直球甜宠', 'nmj-v3-style-syrup'],
            [/钝刀虐心/, '钝刀虐心', 'nmj-v3-style-dullknife'],
            [/冷峻正剧/, '冷峻正剧', 'nmj-v3-style-drama'],
        ];
        const matches = builtin.filter(([pattern]) => pattern.test(content));
        if (matches.length === 1) hint('style', matches[0][1], matches[0][2]);
        else if (/动态|随机适配|Dynamic_Writing_Style/.test(content)) hint('style', '作者动态文风');
        else if (/严肃文学|古典文学|文学名著/.test(content)) hint('style', '作者严肃文学文风');
        else if (/光影美学|光影叙事|光影风格/.test(content)) hint('style', '作者光影美学文风');
        else if (/电影化|电影创作|Cinematic|白描/.test(content)) hint('style', '作者电影化文风');
        else hint('style', '作者自定义文风');
    }
    // <pov_user> is authoritative for the player. A third-person NPC setting,
    // an output example and a disabled alternative are not player POV settings.
    const userPov = active.flatMap(p => [...p.text.matchAll(/<pov_user\b[^>]*>\s*([^<\n]{1,40})/gi)]
        .map(match => match[1].trim())).at(-1);
    const namedPov = active.filter(p => /(?:第一|第二|第三)人称|视角体系/i.test(p.name)
        && /(?:第一|第二|第三)人称|POV/i.test(p.text.slice(0, 350)));
    const scopedPov = userPov || (namedPov.length === 1
        ? namedPov[0].name + ' ' + namedPov[0].text.slice(0, 260) : '');
    const first = /第一人称/.test(scopedPov), second = /第二人称/.test(scopedPov), third = /第三人称/.test(scopedPov);
    if (second && !first && !third) hint('pov', '第二人称', 'nmj-v3-pov-second');
    else if (third && !first && !second) hint('pov', '第三人称', 'nmj-v3-pov-third');
    else if (first && !second && !third) hint('pov', '作者第一人称');
    else if (scopedPov || active.some(p => /Perspective_System|叙事视角/i.test(p.name + p.text.slice(0, 180))))
        hint('pov', '作者自定义／多视角');

    const retelling = active.filter(p => /(?:RP转述|不复述|回复处理|转述模式|输入转述|回放扩写|纯推进)/i.test(p.name)
        || /<转述>|<retelling>|<input_replay>/i.test(p.text.slice(0, 300)));
    const replay = retelling.some(p => /扩写|回放|重拍|重新描写|重述输入/.test(p.name + p.text.slice(0, 350)));
    const direct = retelling.some(p => /不复述|直接接戏|纯推进|不重复|已经发生|直接.{0,12}回应/.test(p.name + p.text.slice(0, 350)));
    if (replay && !direct) hint('retelling', '回放扩写', 'nmj-v62-retelling-replay');
    else if (direct && !replay) hint('retelling', '直接接戏', 'nmj-v62-retelling-direct');
    else if (retelling.length) hint('retelling', '作者自定义转述规则');

    const agency = active.filter(p => /抢话|执笔权|演绎权限|玩家自主|禁止代写|user.agency/i.test(p.name)
        || /(?:不可|不得|禁止|不允许).{0,22}(?:代替|替.*?决定|控制).{0,14}(?:用户|玩家|user)|make major decisions.{0,22}behalf of (?:the )?user/i
            .test(p.text.slice(0, 620)));
    const locked = agency.some(p => /不抢话|绝对不抢|完全不代写|不可代替|不得代替|禁止代写/i
        .test(p.name + p.text.slice(0, 400)));
    const auto = agency.some(p => /全自动演绎|完全接管用户|自动代写|允许.{0,15}完整.{0,10}用户行动|make major decisions.{0,22}behalf of (?:the )?user/i
        .test(p.name + p.text.slice(0, 650))
        || (/抢话/.test(p.name) && !/不抢话|禁止抢话/.test(p.name)
            && /on behalf of the user|both user and Character|both user and char/i.test(p.text.slice(0, 650))));
    if (locked && !auto) hint('agency', '完全不代写', 'nmj-v63-user-agency-locked');
    else if (auto && !locked) hint('agency', '全自动演绎', 'nmj-v63-user-agency-auto');
    else if (agency.length) hint('agency', '作者限定的执笔权');

    const tension = active.find(p => /低烧[ⅠⅡⅢI123]|场景张力|tension.mode/i.test(p.name));
    if (tension) {
        const id = /低烧\s*(?:Ⅲ|III|3)/i.test(tension.name) ? 'nmj-v64-tension-lowfever-3'
            : /低烧\s*(?:Ⅱ|II|2)/i.test(tension.name) ? 'nmj-v64-tension-lowfever-2'
            : /低烧\s*(?:Ⅰ|I|1)/i.test(tension.name) ? 'nmj-v64-tension-lowfever-1' : undefined;
        hint('tension', id ? '作者低烧张力' : '作者场景张力', id);
    }
    const theaterCandidates = active.filter(p => (
        /小剧场|sidestory|mini_theater|randomtheater|side.theater/i.test(p.name)
        // The author may title this section "附录/输出合同" instead of 小剧场.
        || /<(?:sidestory|randomtheater|mini_theater|small_theater|side_theater)\b|(?:正文结束后|每轮结尾).{0,90}小剧场/i
            .test(p.text.slice(0, 1800))
    ) && /(?:小剧场|sidestory|mini_theater|randomtheater|输出|生成)/i.test(p.text)
        && !/^(?:关闭|不生成|禁用)小剧场/.test(p.name));
    const theaterPriority = (p: { name: string; text: string }): number =>
        /随机小剧场|随机换台/i.test(p.name) ? 6
            : /主题小剧场|自由小剧场/i.test(p.name) ? 5
                : /小剧场|sidestory|randomtheater|mini_theater/i.test(p.name) ? 4 : 1;
    const theater = theaterCandidates.sort((a, b) =>
        theaterPriority(b) - theaterPriority(a) || b.text.length - a.text.length)[0];
    if (theater) {
        const random = /随机小剧场|随机换台|random.theater/i.test(theater.name);
        const ai = /AI客服|AI聊天|角色与AI|AI应用/i.test(theater.name);
        hint('theater', random ? '作者随机小剧场' : '作者自定义小剧场',
            random ? 'nmj-v3-theater-random' : ai ? 'nmj-v3-theater-ai' : undefined);
    }
    const language = active.find(p => /(?:修改语言|叙述语言|中文语言|叙事中文|对话中文|语言设置|输出语言|^语言$|语言翻译)/.test(p.name)
        || /setvar\s*::\s*(?:主要语言|叙述语言|正文语言)\s*::|<language_forms>|language\s*:\s*Chinese|(?:正文要求|叙事必须|叙述必须).{0,55}(?:简体中文|繁體中文|繁体中文)|(?:write|output|respond|generate).{0,140}(?:zh-CN|zh-TW|zh-Hans|zh-Hant|Simplified Chinese|Traditional Chinese)/i
            .test(p.text.slice(0, 800)));
    if (language) {
        const sample = language.text.slice(0, 650);
        const simplified = /(?:主要语言|叙述语言|正文语言)\s*::\s*简体中文|(?:正文要求|叙事必须|叙述必须).{0,40}简体中文|只使用.{0,6}简体中文|(?:write|output|respond|generate).{0,140}(?:zh-CN|zh-Hans|Simplified Chinese)/i.test(sample);
        const traditional = /(?:主要语言|叙述语言|正文语言)\s*::\s*(?:繁體中文|繁体中文)|(?:正文要求|叙事必须|叙述必须).{0,40}(?:繁體中文|繁体中文)|只使用.{0,6}(?:繁體中文|繁体中文)|(?:write|output|respond|generate).{0,140}(?:zh-TW|zh-Hant|Traditional Chinese)/i.test(sample);
        if (simplified && !traditional) hint('language', '简体中文', 'nmj-v3-language-cn');
        else if (traditional && !simplified) hint('language', '繁體中文', 'nmj-v3-language-tw');
        else if (/<language_forms>[\s\S]{0,160}language\s*:\s*Chinese\b/i.test(sample)) hint('language', '中文（简繁未指定）');
        else hint('language', '作者语言／翻译规则');
    }
    const length = active.find(p => /正文.{0,4}(?:字数|篇幅|长度)|字数.{0,5}(?:设定|要求|设置|修改|前置)|修改字数|篇幅设定|^字数要求$/i.test(p.name)
        || /setvar\s*::\s*正文字数\s*::|字数要求.{0,10}\d{3,5}\s*字|Word_budget\s*:\s*\d{2,5}/i.test(p.text.slice(0, 450)));
    if (length) {
        const sample = length.text.slice(0, 750);
        const range = /(\d{3,5})\s*(?:[-—–~～]|至|到)\s*(\d{3,5})\s*(?:个)?字/.exec(sample);
        // English "800-1,200-word" is a word count, NOT a Chinese
        // character count. Display it precisely without forcing short/medium.
        const wordRange = /(\d{3,5})\s*(?:[-—–~～]|to)\s*([\d,]{3,7})\s*[- ]?(?:word|words)\b/i.exec(sample);
        const exact = /(?:字数要求|正文字数|篇幅)\s*[：:=]?\s*(\d{3,5})\s*(?:个)?字/.exec(sample);
        const budget = /Word_budget\s*:\s*(\d{2,5})\s*(?:[-—–~～]|to)\s*(\d{2,5})/i.exec(sample);
        const minimum = range ? Number(range[1]) : exact ? Number(exact[1]) : 0;
        const maximum = range ? Number(range[2]) : minimum;
        if (wordRange) {
            hint('length', wordRange[1] + '–' + wordRange[2].replace(/,/g, '') + ' words（英文计数）');
        } else if (budget) {
            // No explicit unit: cannot safely claim Chinese character count.
            hint('length', `${budget[1]}–${budget[2]}（Word_budget，按作者单位）`);
        } else if (minimum && maximum >= minimum) {
            const id = maximum <= 1250 ? 'nmj-v3-length-short'
                : minimum >= 1300 && maximum <= 2350 ? 'nmj-v3-length-medium'
                : minimum >= 2250 ? 'nmj-v3-length-long' : undefined;
            hint('length', range ? minimum + '–' + maximum + '字' : minimum + '字', id);
        } else hint('length', '作者篇幅规则');
    }
    if (!scopedPov && active.some(p => /(?:用[“"']?你\s*\/\s*您[”"']?指代\s*<user>|He\/She\s*&\s*You)/i.test(p.text)
        && /(?:Third-Person|第三人称)/i.test(p.text))) {
        // Character-third + user-second perspective is NOT identical to the
        // native limited second-person preset. Keep its authored mixed rules.
        hint('pov', '作者混合视角（角色第三／用户第二）');
    }
    return { inferred, labels };
};

export const convertSillyTavernChatPreset = (value: any, fallbackName: string): StoryTheaterPresetDocument => {
    if (!isSillyTavernChatPreset(value)) throw new Error('无法识别为酒馆 Chat Completion 预设');

    const missingOrderTable = value.prompt_order === undefined;
    const groups = missingOrderTable ? [] : readTavernOrderGroups(value.prompt_order);
    if (!missingOrderTable && !groups) throw new Error('酒馆排序表结构无效，未导入');
    const populated = (groups || []).filter(group => group.order.length > 0);
    // Prefer the author's real default order. Never guess between non-default tables.
    const orderGroup = missingOrderTable
        ? { order: value.prompts.filter((prompt: any) => typeof prompt?.identifier === 'string')
            .map((prompt: any) => ({ identifier: prompt.identifier, enabled: prompt.enabled })) }
        : populated.find(group => String(group.character_id) === '100001')
            || populated.find(group => String(group.character_id) === '100000')
            || (populated.length === 1 ? populated[0] : undefined);
    if (!orderGroup) throw new Error(populated.length > 1
        ? '存在多个非默认排序表，无法确认原作者开启状态；未导入'
        : '酒馆排序表为空，无法确认开关；请重新导出完整预设');
    const sourceById = new Map<string, any>();
    for (const item of value.prompts) {
        if (!item || typeof item.identifier !== 'string' || !item.identifier.trim()) {
            throw new Error('酒馆预设存在缺少 identifier 的提示词；为避免遗漏原文已取消导入');
        }
        if (sourceById.has(item.identifier)) {
            throw new Error(`酒馆预设的提示词标识「${item.identifier}」重复；无法安全判断排序和开关，未覆盖任何数据`);
        }
        if (item.content != null && typeof item.content !== 'string') {
            throw new Error(`酒馆提示词「${item.identifier}」的正文不是文本，请检查原文件`);
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
        const mappedMarker = Object.prototype.hasOwnProperty.call(MARKERS, identifier) && (source.marker === true || !content.trim())
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
            let companionIdentifier = `${identifier}-content`;
            while (sourceById.has(companionIdentifier)) companionIdentifier += '-content';
            prompts.push({
                id: `st-${companionIdentifier}`, name: `${next.name} · 附加正文`,
                enabled: active, role: next.role, content,
            });
        }
    };

    const seenOrderIds = new Set<string>();
    let unknownEnabledCount = 0;
    let legacyDefaultOnCount = 0;
    for (const item of orderGroup.order) {
        const identifier = typeof item === 'string' ? item : item?.identifier;
        if (typeof identifier !== 'string' || !identifier.trim())
            throw new Error('酒馆排序表包含没有 identifier 的条目，无法安全导入');
        if (seenOrderIds.has(identifier))
            throw new Error(`酒馆排序表重复引用「${identifier}」，无法判断最终发送位置`);
        seenOrderIds.add(identifier);
        const source = sourceById.get(identifier);
        if (!source) {
            if (typeof item !== 'string' && promptEnabled(item.enabled, false, identifier))
                throw new Error(`启用的提示词「${identifier}」缺少正文定义，为避免遗漏已取消导入`);
            continue;
        }
        const orderEnabled = typeof item === 'string' ? undefined : item.enabled;
        const flag = orderEnabled === undefined ? source.enabled : orderEnabled;
        // Only the full legacy character-specific order table implies default-on.
        // A bare identifier list or an absent order table does not tell us that
        // an unannotated rule was enabled; keep those off for safe inspection.
        const defaultOn = !missingOrderTable && typeof item !== 'string'
            && Array.isArray(value.prompt_order)
            && value.prompt_order.some((group: any) => group && Array.isArray(group.order));
        if (flag === undefined) {
            unknownEnabledCount += 1;
            if (defaultOn) legacyDefaultOnCount += 1;
        }
        append(identifier, promptEnabled(flag, defaultOn, identifier));
    }
    // Preserve unlisted content for the editor without making it active unexpectedly.
    const unlistedEntries = sourceById.size - used.size;
    for (const identifier of sourceById.keys()) if (!used.has(identifier)) append(identifier, false);
    // A fully disabled preset is still a valid editable import: do not silently turn
    // anything on, and do not reject its user's archived prompt text.

    const warnings: string[] = [];
    if (missingOrderTable) warnings.push('原文件没有 prompt_order；按原数组顺序和明确开关导入');
    if (unknownEnabledCount) warnings.push(`有 ${unknownEnabledCount} 条缺少原始开关；${legacyDefaultOnCount ? `${legacyDefaultOnCount} 条沿用酒馆旧版排序表默认开启；` : ''}${unknownEnabledCount - legacyDefaultOnCount ? `${unknownEnabledCount - legacyDefaultOnCount} 条已保守关闭` : '请在专业版确认'}`);
    const regexCount = Array.isArray(value.extensions?.regex_scripts)
        ? value.extensions.regex_scripts.filter((script: any) => script?.disabled !== true).length : 0;
    const helperCount = Array.isArray(value.extensions?.tavern_helper?.scripts)
        ? value.extensions.tavern_helper.scripts.filter((script: any) => script?.enabled === true).length : 0;
    if (regexCount || helperCount) warnings.push(`酒馆扩展中的 ${regexCount} 条启用正则和 ${helperCount} 个启用脚本不会执行；仅导入预设文字`);
    // Some imported presets demand HTML/CSS mini-theaters whose actual
    // layout used Tavern Regex's display-only transformation. The story UI
    // renders safe text/structured native <mini_theater>, not arbitrary HTML.
    // Preserve author instructions and user toggles, but report the mismatch.
    const htmlTheaterPrompts = prompts.filter(prompt => prompt.enabled && (
        /<(?:sidestory|randomtheater|writing_interlude|small_theater)\b/i.test(prompt.content)
        || /(?:小剧场[\s\S]{0,200}(?:HTML|CSS)|(?:HTML|CSS)[\s\S]{0,200}小剧场)/i.test(prompt.content)
    ));
    if (htmlTheaterPrompts.length) warnings.push(
        `有 ${htmlTheaterPrompts.length} 条启用的酒馆小剧场/HTML 排版指令（如 ${htmlTheaterPrompts.slice(0, 2).map(prompt => prompt.name).join('、')}）已尝试转换原生小剧场或使用隔离的安全 HTML/CSS 显示；酒馆专属 JS、正则美化与交互插件不会执行。无法安全转换的内容会保留可读文字，请检查作者原版的额外依赖`
    );
    const enabledText = prompts.filter(prompt => prompt.enabled).map(prompt => prompt.content).join('\n');
    const setLocals = new Set([...enabledText.matchAll(/\{\{\s*setvar\s*::\s*([^{}:]+?)\s*::/gi)]
        .map(match => match[1].trim()));
    const readLocals = new Set([...enabledText.matchAll(/\{\{\s*getvar(?:\s*::\s*|\s*:\s*|\s+)([^{}]+?)\s*\}\}/gi)]
        .map(match => match[1].trim()));
    const missingLocals = [...readLocals].filter(key => !setLocals.has(key));
    if (missingLocals.length) {
        warnings.push(`有 ${missingLocals.length} 个 getvar 变量在当前启用条目中没有对应 setvar：${missingLocals.slice(0, 6).join('、')}${missingLocals.length > 6 ? ' 等' : ''}；外部酒馆变量不会自动导入`);
    }
    if (/\{\{\s*(?:setglobalvar|getglobalvar)\s*::/i.test(enabledText)) {
        warnings.push('酒馆 globalvar 在糯米机仅限本轮剧情请求内可用，不会写入其它身份、聊天或应用全局配置');
    }
    if (/\{\{\s*random\s*::/i.test(enabledText)) {
        warnings.push('random 随机分支在每轮发送时重新选择；不保证与酒馆使用相同随机序列');
    }
    if (prompts.some(prompt => prompt.enabled && /\{\{\s*setvar::/i.test(prompt.content))) {
        warnings.push('已启用的 setvar 规则型正文会转为糯米机实际提示词；只有插件脚本才能实现的变量联动仍不执行');
    }
    if (prompts.some(prompt => prompt.enabled && /\{\{(?!user\}\}|char\}\}|group\}\}|trim\}\}|setvar::|getvar::|\/\/)/i.test(prompt.content))) {
        warnings.push('部分酒馆专属动态宏尚无糯米机等价功能，原文保留供检查');
    }
    if ((groups || []).length > 1) warnings.push('多个角色排序表只采用酒馆默认排序表');
    if (prompts.some(prompt => prompt.enabled && !prompt.marker && !prompt.content.trim())) warnings.push('空白或未知酒馆占位条目已保留，不会误当作可执行指令');
    if (value.top_k > 0 || value.top_a > 0 || value.min_p > 0 || (typeof value.repetition_penalty === 'number' && value.repetition_penalty !== 1)) {
        warnings.push('top_k / top_a / min_p / repetition_penalty 等模型采样字段无原生等价参数，未强制应用');
    }
    if (Number(value.openai_max_tokens) > STORY_MAX_OUTPUT_TOKENS) warnings.push(`酒馆最大输出 tokens 超过糯米机当前 ${STORY_MAX_OUTPUT_TOKENS} 上限，已按原生范围适配`);
    if (prompts.some(prompt => prompt.enabled && prompt.marker === 'examples')) warnings.push('对话示例占位已保留；当前剧情角色资料没有独立示例字段时，该槽位不发送内容');
    if (prompts.some(prompt => prompt.marker === 'characters')) warnings.push('酒馆角色资料按当前糯米机角色动态绑定；描述与性格两个占位均启用时分别插入');

    // baibaiToolkit is the current MoM export index: category -> member ID.
    // Read metadata only. Names, text, enabled states and prompt order are untouched.
    const toolkit = value.extensions?.baibaiToolkit?.presetPromptGroups;
    const toolkitOwners = toolkit?.prompts && typeof toolkit.prompts === 'object'
        && !Array.isArray(toolkit.prompts) ? toolkit.prompts : {};
    const toolkitGroups = (Array.isArray(toolkit?.groups) ? toolkit.groups : [])
        .filter((group: any) => group && typeof group.id === 'string' && typeof group.name === 'string'
            && group.id.trim() && group.name.trim())
        .slice(0, 120).map((group: any) => ({
            id: group.id.slice(0, 120),
            name: group.name.trim().slice(0, 100),
            memberIdentifiers: prompts.filter(prompt => prompt.id.startsWith('st-')
                && toolkitOwners[prompt.id.slice(3)]?.groupId === group.id)
                .map(prompt => prompt.id.slice(3)).slice(0, 600),
        })).filter((group: any) => group.memberIdentifiers.length > 0);

    const toolkitMemberIds = new Set<string>(toolkitGroups.flatMap((group: any) => group.memberIdentifiers));
    // entryGrouping is an independent older index. Prefer the explicit
    // baibaiToolkit owner map where both describe the same author prompts.
    // In some exports old endIdentifier points to an unlisted prompt appended
    // by the importer, and would otherwise swallow several unrelated groups.
    const legacyEntryGroups = (Array.isArray(value.extensions?.entryGrouping)
        ? value.extensions.entryGrouping : [])
        .filter((group: any) => group && typeof group.name === 'string'
            && group.name.trim() && typeof group.id === 'string')
        .slice(0, 120)
        .map((group: any) => ({
            id: group.id.slice(0, 120),
            name: group.name.trim().slice(0, 100),
            ...(Array.isArray(group.memberIdentifiers)
                ? { memberIdentifiers: group.memberIdentifiers
                    .filter((id: unknown): id is string => typeof id === 'string'
                        && sourceById.has(id)).slice(0, 600) } : {}),
            ...(typeof group.startIdentifier === 'string' && sourceById.has(group.startIdentifier)
                ? { startIdentifier: group.startIdentifier } : {}),
            ...(typeof group.endIdentifier === 'string' && sourceById.has(group.endIdentifier)
                ? { endIdentifier: group.endIdentifier } : {}),
        }))
        .filter((group: { memberIdentifiers?: string[]; startIdentifier?: string; endIdentifier?: string }) => {
            if (!toolkitMemberIds.size) return true;
            const members = group.memberIdentifiers?.length ? group.memberIdentifiers : (() => {
                const start = prompts.findIndex(p => p.id === 'st-' + group.startIdentifier);
                const end = prompts.findIndex(p => p.id === 'st-' + group.endIdentifier);
                return start >= 0 && end >= start
                    ? prompts.slice(start, end + 1).map(p => p.id.slice(3))
                    : [group.startIdentifier, group.endIdentifier].filter((id): id is string => typeof id === 'string');
            })();
            return !members.some(identifier => toolkitMemberIds.has(identifier));
        });

    return {
        schema: 'sullyos.story-preset',
        version: 1,
        name: fallbackName,
        description: '从酒馆 Chat Completion 预设适配；原有提示词、开关及顺序已保留。',
        sourceFormat: 'sillytavern',
        tavernControls: detectTavernNativeControls(prompts),
        // Static metadata supplied by some MoM Tavern exports. Import ONLY
        // names and prompt references: never execute extension JS or regex.
        tavernEntryGroups: [...toolkitGroups, ...legacyEntryGroups],
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
        tavernOptions: normalizeTavernPresetOptions(value),
        importWarnings: warnings,
        tavernImportAudit: {
            sourceEntries: sourceById.size,
            importedEntries: sourceById.size,
            enabledEntries: prompts.filter(prompt => prompt.enabled && sourceById.has(prompt.id.slice(3))).length,
            unlistedEntries,
            orderTableCount: populated.length,
            skippedRegexCount: regexCount,
            skippedScriptCount: helperCount,
        },
        generation: {
            temperature: numeric(value.temperature, 0.9, 0, 2),
            topP: numeric(value.top_p, 1, 0, 1),
            frequencyPenalty: numeric(value.frequency_penalty, 0, -2, 2),
            presencePenalty: numeric(value.presence_penalty, 0, -2, 2),
            maxTokens: normalizeStoryOutputTokens(value.openai_max_tokens),
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
    const asText = (input: unknown): string => Array.isArray(input)
        ? input.map(part => part?.type === 'thinking' && typeof part.thinking === 'string'
            ? `<thinking>${part.thinking}</thinking>` : completionContentToText(part)).join('')
        : completionContentToText(input);
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
