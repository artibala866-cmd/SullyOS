import { expandStoryRegexReplacement, renderStoryRegexTemplate, type StoryRegexParseMode } from './storyRegexTemplate';

export interface StoryRegexInput {
    text: string;
    role?: 'assistant' | 'user';
    depth?: number;
}

export interface StoryRegexContext {
    user?: string;
    char?: string;
}

export interface StoryRegexRule {
    id: string;
    name: string;
    enabled: boolean;
    presetId: string;
    kind: 'filter' | 'template';
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
        substituteRegex?: 0 | 1 | 2;
        minDepth?: number;
        maxDepth?: number;
        triggerKeywords?: string[];
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

export function validateStoryRegexRule(rule: StoryRegexRule): void {
    if (!rule.name.trim()) throw new Error('请输入规则名称');
    if (!rule.pattern.trim()) throw new Error('请输入匹配正则');
    try {
        const pattern = rule.source && rule.source.substituteRegex !== 0
            ? storyRegexMacros(rule.pattern, { user: '用户', char: '角色' }, rule.source.substituteRegex === 2)
            : rule.pattern;
        compileStoryRegex(pattern, rule.flags);
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
    if (!rule.enabled || (stage === 'display' ? (!rule.display && (rule.kind !== 'template' || Boolean(rule.source))) : (rule.kind !== 'filter' || !rule.history))) return false;
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
    if (key === 'time' || key === 'date') {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        return key === 'time' ? `${pad(now.getHours())}:${pad(now.getMinutes())}`
            : `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    }
    if (!key.startsWith('random:')) return undefined;
    const values = key.slice(7).split(',').map(value => value.trim()).filter(Boolean);
    return values[Math.floor(Math.random() * values.length)];
}

function storyRegexMacros(text: string, context: StoryRegexContext, escape = false): string {
    return text.replace(/\{\{([^{}]+)\}\}/g, (token, raw: string) => {
        const value = macroValue(raw.trim(), context);
        return value === undefined ? token : escape ? escapeStoryRegexLiteral(value) : value;
    });
}

export function storyRegexInstruction(rule: StoryRegexRule, context: StoryRegexContext, recentText: string): string {
    if (!storyRegexApplies(rule, 'display') || rule.kind !== 'template' || !rule.instruction.trim()) return '';
    const keywords = rule.source?.triggerKeywords;
    if (keywords && !keywords.some(keyword => recentText.toLowerCase().includes(keyword.toLowerCase()))) return '';
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
    const regexFor = (rule: StoryRegexRule) => compileStoryRegex(
        rule.source && rule.source.substituteRegex !== 0
            ? storyRegexMacros(rule.pattern, context, rule.source.substituteRegex === 2) : rule.pattern,
        rule.flags,
    );
    const cards: StoryRegexCard[] = [];
    let matches = 0;
    let source = text;
    // Filters operate on source text. Templates run last so later rules
    // cannot accidentally rewrite generated CSS, markup or captured values.
    const applicable = rules.filter(rule => storyRegexApplies(rule, stage, input));
    for (const rule of applicable.filter(rule => rule.kind === 'filter')) {
        const regex = regexFor(rule);
        let outputLength = source.length;
        source = source.replace(regex, (...args: unknown[]) => {
            matches++;
            const named = typeof args.at(-1) === 'object' ? args.pop() as Record<string, string> : undefined;
            const input = args.pop() as string;
            const offset = args.pop() as number;
            const captures = args as (string | undefined)[];
            const replacement = expandStoryRegexReplacement(replacementFor(rule), /\{\{([^{}]+)\}\}|\$(\$|&|\x60|'|\d{1,2}|<[^>]+>)/g, ([token, macro, key]) => {
                if (macro) {
                    if (!rule.source) return token;
                    return macro.trim().toLowerCase() === 'match' ? captures[0] || '' : macroValue(macro.trim(), context) ?? token;
                }
                if (rule.source) {
                    if (key.startsWith('<')) return named?.[key.slice(1, -1)] ?? token;
                    return /^\d+$/.test(key) ? captures[Number(key)] ?? token : token;
                }
                if (key === '$') return '$';
                if (key === '&') return captures[0] || '';
                if (key === '\x60') return input.slice(0, offset);
                if (key === "'") return input.slice(offset + (captures[0]?.length || 0));
                if (key.startsWith('<')) return named ? named[key.slice(1, -1)] ?? '' : token;
                const index = Number(key);
                if (index > 0 && index < captures.length) return captures[index] ?? '';
                const first = Number(key[0]);
                if (key.length === 2 && first > 0 && first < captures.length) return (captures[first] ?? '') + key[1];
                return token;
            }, Math.max(500000, text.length) - outputLength + (captures[0]?.length || 0));
            const cleaned = (rule.source?.trimStrings || []).reduce((current, strip) => strip ? current.split(strip).join('') : current, replacement);
            outputLength += cleaned.length - (captures[0]?.length || 0);
            return cleaned;
        });
        if (rule.source?.trim) source = source.trim();
    }
    const templates = applicable.filter(rule => rule.kind === 'template');
    if (!templates.length) return { text: source, cards, matches };
    let prefix = 'SULLYREGEXCARD';
    while (source.includes(prefix)) prefix += 'X';
    let fragments = [source];
    let htmlLength = 0;
    for (const rule of templates) {
        const regex = regexFor(rule);
        const next: string[] = [];
        let matchedFloor = false;
        // Only match the remaining source fragments. Cards are opaque to
        // subsequent rules, so a broad template cannot swallow an earlier one.
        for (const [index, fragment] of fragments.entries()) {
            if (index % 2 || (matchedFloor && !regex.global)) {
                next.push(fragment);
                continue;
            }
            let cursor = 0;
            fragment.replace(regex, (...args: unknown[]) => {
                const named = typeof args.at(-1) === 'object' ? args.pop() as Record<string, string> : undefined;
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
                matchedFloor = true;
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
