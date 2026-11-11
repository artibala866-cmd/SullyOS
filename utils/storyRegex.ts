import { expandStoryRegexReplacement, renderStoryRegexTemplate, type StoryRegexParseMode } from './storyRegexTemplate';

export interface StoryRegexInput {
    text: string;
    role?: 'assistant' | 'user';
    depth?: number;
}

export interface StoryRegexContext {
    user?: string;
    char?: string;
    userGender?: string;
    charGender?: string;
    userAvatar?: string;
    charAvatar?: string;
}

export interface StoryRegexRule {
    id: string;
    name: string;
    enabled: boolean;
    presetId: string;
    kind: 'filter' | 'template';
    /** Legacy single scope, read as fallback when targets are absent. */
    domain?: 'online' | 'offline';
    /** Independent execution switches. Filters may run online, offline or both;
     * HTML templates are restricted to online regardless of imported metadata. */
    targets?: Array<'online' | 'offline'>;
    /** Import file folder and per-rule author-defined subcategory. */
    importGroup?: string;
    subcategory?: string;
    /** Alchemy order: lower values run first; equal values keep import order. */
    order?: number;
    pattern: string;
    flags: string;
    replacement: string;
    display: boolean;
    history: boolean;
    instruction: string;
    role?: 'assistant' | 'user' | 'both';
    parseMode?: StoryRegexParseMode;
    replacementChoices?: string[];
    source?: {
        trim?: boolean;
        trimStrings?: string[];
        scenes?: string[];
        renderMode?: 'inline' | 'iframe';
        /** Original alchemy file metadata, not story-global authorization. */
        category?: string;
        originalScope?: string;
        originalCharacterIds?: string[];
        triggerEnabled?: boolean;
        /** true: preserve ambiguous words in broad prose-ban filters. */
        smartFilter?: boolean;
        /** Explicit local exceptions; keep any match containing a protected word. */
        protectWords?: string[];
        substituteRegex?: 0 | 1 | 2;
        minDepth?: number;
        maxDepth?: number;
        triggerKeywords?: string[];
        /** Lossless imported source for auditing/round-tripping author metadata. */
        originalRule?: Record<string, unknown>;
    };
}

export interface StoryRegexCard {
    token: string;
    title: string;
    html: string;
    fallback: string;
}

export interface StoryRegexResult {
    text: string;
    cards: StoryRegexCard[];
    matches: number;
}

export const STORY_REGEX_ASSET = 'story_theater_regex_rules_v1';
export const STORY_TEMPLATE_MAX_LENGTH = 150000;

export function compileStoryRegex(pattern: string, flags: string): RegExp {
    const literal = /^\/([\s\S]+)\/([a-z]*)$/i.exec(pattern);
    return new RegExp(literal?.[1] ?? pattern, literal?.[2] ?? flags.trim());
}

export function expandStoryRegexShorthand(pattern: string): string {
    // Native Text Alchemist supports {a,b,c} as alternatives but JS
    // quantifiers ({2,5}) and escaped literals (\\{a,b\\}) must survive.
    let output = '';
    let characterClass = false;
    for (let index = 0; index < pattern.length; index++) {
        const character = pattern[index];
        if (character === '\\' && index + 1 < pattern.length) {
            output += character + pattern[++index];
            continue;
        }
        if (character === '[') characterClass = true;
        else if (character === ']') characterClass = false;
        if (character !== '{' || characterClass) { output += character; continue; }
        const end = pattern.indexOf('}', index + 1);
        if (end < 0) { output += character; continue; }
        const options = pattern.slice(index + 1, end).split(',').map(item => item.trim());
        if (!options.length || options.some(item => !item || /[{}]/.test(item))
            || options.every(item => /^\d+$/.test(item))) {
            output += character; continue;
        }
        output += '(?:' + options.join('|') + ')';
        index = end;
    }
    return output;
}

export function validateStoryRegexRule(rule: StoryRegexRule): void {
    if (!rule.name.trim()) throw new Error('请输入规则名称');
    if (rule.targets !== undefined && (!Array.isArray(rule.targets)
        || !rule.targets.length
        || rule.targets.some(target => target !== 'online' && target !== 'offline')))
        throw new Error('规则至少选择一个生效场景');
    if (rule.kind === 'template' && rule.targets?.includes('offline'))
        throw new Error('HTML 美化只能用于私聊和群聊');
    if (!rule.pattern.trim()) throw new Error('请输入匹配正则');
    try {
        const pattern = rule.source && rule.source.substituteRegex !== 0
            ? storyRegexMacros(rule.pattern, { user: '用户', char: '角色' }, rule.source.substituteRegex === 2)
            : rule.pattern;
        compileStoryRegex(rule.source ? expandStoryRegexShorthand(pattern) : pattern, rule.flags);
    } catch {
        throw new Error('正则或修饰符无效，请检查括号、转义和重复修饰符');
    }
    if (rule.kind === 'template' && !rule.replacement.trim()) throw new Error('请输入 HTML 模板');
    if ([rule.replacement, ...(rule.replacementChoices || [])].some(value => value.length > STORY_TEMPLATE_MAX_LENGTH)) throw new Error('替换内容过长，图片请压缩后再嵌入');
    if (rule.enabled && !rule.display && (rule.kind === 'template' || !rule.history)) throw new Error('请至少选择一个过滤时机');
}

export function readStoryRegexRules(raw: string | null): StoryRegexRule[] {
    if (!raw) return [];
    const rules: unknown = JSON.parse(raw);
    if (!Array.isArray(rules)) throw new Error('正则规则数据格式无效');
    return rules.filter((rule): rule is StoryRegexRule => rule && ['filter', 'template'].includes(rule.kind)
        && ['id', 'name', 'presetId', 'pattern', 'flags', 'replacement', 'instruction'].every(key => typeof rule[key] === 'string')
        && ['enabled', 'display', 'history'].every(key => typeof rule[key] === 'boolean'));
}

export function storyRegexApplies(rule: StoryRegexRule, stage: 'display' | 'history', input?: StoryRegexInput): boolean {
    if (!rule.enabled || (stage === 'display' ? !rule.display : (rule.kind !== 'filter' || !rule.history))) return false;
    if (!input) return true;
    const role = rule.role ?? 'assistant';
    if (role !== 'both' && role !== (input.role ?? 'assistant')) return false;
    const depth = input.depth;
    return depth === undefined || (depth >= (rule.source?.minDepth ?? 0) && depth <= (rule.source?.maxDepth ?? Infinity));
}

export function escapeStoryRegexLiteral(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function macroValue(key: string, context: StoryRegexContext): string | undefined {
    if (key === 'user' || key === 'char') return context[key];
    if (key === 'user.gender') return context.userGender;
    if (key === 'char.gender') return context.charGender;
    if (key === 'user.avatar') return context.userAvatar;
    if (key === 'char.avatar') return context.charAvatar;
    if (key === 'time' || key === 'date') {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        return key === 'time' ? `${pad(now.getHours())}:${pad(now.getMinutes())}`
            : `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    }
    if (!key.startsWith('random:')) return undefined;
    const values = key.slice(7).split(',').map(value => value.trim()).filter(Boolean);
    return values.length ? values[Math.floor(Math.random() * values.length)] : undefined;
}

function storyRegexMacros(text: string, context: StoryRegexContext, escape = false): string {
    return text.replace(/\{\{([^{}]+)\}\}/g, (token, raw: string) => {
        const value = macroValue(raw.trim(), context);
        return value === undefined ? token : escape ? escapeStoryRegexLiteral(value) : value;
    });
}

export function storyRegexInstruction(rule: StoryRegexRule, context: StoryRegexContext, recentText: string): string {
    // Imported prompt-only filters carry an aiPrompt but have no display replacement.
    // Their instructions belong in the request, not in the displayed or historical text.
    if (!rule.enabled || !rule.instruction.trim()) return '';
    if (rule.kind === 'template' ? !rule.display : !rule.history) return '';
    const keywords = rule.source?.triggerKeywords;
    // A source may enable keyword triggering without providing any keywords.
    // An empty list means no keyword restriction, never an impossible trigger.
    if (keywords?.length && !keywords.some(keyword => recentText.toLowerCase().includes(keyword.toLowerCase()))) return '';
    return rule.source ? storyRegexMacros(rule.instruction, context) : rule.instruction;
}

function replacementFor(rule: StoryRegexRule): string {
    const choices = rule.replacementChoices;
    if (!choices?.length) return rule.replacement;
    const index = Math.floor(Math.random() * (choices.length + 1));
    return index === 0 ? rule.replacement : choices[index - 1];
}

export function applyStoryRegex(
    value: string | StoryRegexInput, rules: StoryRegexRule[], stage: 'display' | 'history', context: StoryRegexContext = {},
): StoryRegexResult {
    const input = typeof value === 'string' ? { text: value } : value;
    const { text } = input;
    const regexFor = (rule: StoryRegexRule) => {
        const pattern = rule.source && rule.source.substituteRegex !== 0
            ? storyRegexMacros(rule.pattern, context, rule.source.substituteRegex === 2) : rule.pattern;
        return compileStoryRegex(rule.source ? expandStoryRegexShorthand(pattern) : pattern, rule.flags);
    };
    const cards: StoryRegexCard[] = [];
    let matches = 0;
    // Fragments alternate between raw source text and opaque card tokens.
    // This respects original order even when a filter follows a template,
    // without letting subsequent rules rewrite generated HTML/CSS.
    let fragments = [text];
    let prefix = 'SULLYREGEXCARD';
    while (text.includes(prefix)) prefix += 'X';
    let htmlLength = 0;
    const applicable = rules.filter(rule => storyRegexApplies(rule, stage, input))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    for (const rule of applicable) {
        const regex = regexFor(rule);
        if (rule.kind === 'filter') {
            let outputLength = fragments.join('').length;
            const updated = fragments.map((fragment, index) => {
                if (index % 2) return fragment;
                return fragment.replace(regex, (...args: unknown[]) => {
                    const named = typeof args.at(-1) === 'object'
                        ? args.pop() as Record<string, string> : undefined;
                    const originalInput = args.pop() as string;
                    const offset = args.pop() as number;
                    const captures = args as (string | undefined)[];
                    const matched = captures[0] || '';
                    const exceptions = rule.source?.protectWords || [];
                    if (exceptions.some(word => !!word.trim() && matched.includes(word.trim()))) return matched;
                    const broadBan = rule.source?.smartFilter === true || /^WS\d/i.test(rule.name)
                        || /八股净化|词汇级禁令|句式级禁令/.test((rule.source?.category || '') + rule.name);
                    // Conservative, deterministic recognition. Keep normal words
                    // such as 情绪/草莓 and the untouched history; no extra API.
                    if (rule.source?.smartFilter !== false && broadBan && !rule.replacement
                        && matched.length < 6 && !/[<>[\]{}]/.test(matched)) return matched;
                    matches++;
                    const replacement = expandStoryRegexReplacement(
                        replacementFor(rule),
                        /\{\{([^{}]+)\}\}|\$(\$|&|\x60|'|\d{1,2}|<[^>]+>)/g,
                        ([token, macro, key]) => {
                            if (macro) {
                                if (!rule.source) return token;
                                return macro.trim().toLowerCase() === 'match'
                                    ? captures[0] || '' : macroValue(macro.trim(), context) ?? token;
                            }
                            if (key === '$') return '$';
                            if (key === '&') return captures[0] || '';
                            if (key === '\x60') return originalInput.slice(0, offset);
                            if (key === "'") return originalInput.slice(offset + (captures[0]?.length || 0));
                            if (key.startsWith('<')) return named
                                ? named[key.slice(1, -1)] ?? '' : token;
                            const capture = Number(key);
                            if (capture > 0 && capture < captures.length) return captures[capture] ?? '';
                            const first = Number(key[0]);
                            if (key.length === 2 && first > 0 && first < captures.length) {
                                return (captures[first] ?? '') + key[1];
                            }
                            return token;
                        }, Math.max(500000, text.length) - outputLength + (captures[0]?.length || 0),
                    );
                    const cleaned = (rule.source?.trimStrings || []).reduce(
                        (result, strip) => strip ? result.split(strip).join('') : result, replacement);
                    outputLength += cleaned.length - (captures[0]?.length || 0);
                    return cleaned;
                });
            });
            fragments = updated;
            if (rule.source?.trim) {
                fragments[0] = fragments[0].trimStart();
                fragments[fragments.length - 1] = fragments[fragments.length - 1].trimEnd();
            }
            continue;
        }

        const next: string[] = [];
        let matchedRule = false;
        for (const [index, fragment] of fragments.entries()) {
            if (index % 2 || (matchedRule && !regex.global)) {
                next.push(fragment);
                continue;
            }
            let cursor = 0;
            fragment.replace(regex, (...args: unknown[]) => {
                const named = typeof args.at(-1) === 'object'
                    ? args.pop() as Record<string, string> : undefined;
                args.pop();
                const offset = args.pop() as number;
                const captures = args as (string | undefined)[];
                const matched = captures[0] || '';
                if (!matched) return matched;
                if (cards.length >= 60) throw new Error('单个楼层匹配的 HTML 卡片过多');
                const html = renderStoryRegexTemplate(
                    replacementFor(rule), captures, named, rule.parseMode || 'text',
                    Math.min(STORY_TEMPLATE_MAX_LENGTH, 900000 - htmlLength),
                    key => rule.source ? macroValue(key, context) : undefined,
                );
                htmlLength += html.length;
                matchedRule = true;
                const token = prefix + cards.length + 'END';
                cards.push({ token, title: rule.name, html, fallback: matched });
                next.push(fragment.slice(cursor, offset), token);
                cursor = offset + matched.length;
                matches++;
                return matched;
            });
            next.push(fragment.slice(cursor));
        }
        fragments = next;
    }
    return { text: fragments.join(''), cards, matches };
}
