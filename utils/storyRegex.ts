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
        compileStoryRegex(rule.pattern, rule.flags);
    } catch {
        throw new Error('正则或修饰符无效，请检查括号、转义和重复修饰符');
    }
    if (rule.kind === 'template' && !rule.replacement.trim()) throw new Error('请输入 HTML 模板');
    if (rule.replacement.length > STORY_TEMPLATE_MAX_LENGTH) throw new Error('替换内容过长，图片请压缩后再嵌入');
    if (rule.kind === 'filter' && !rule.display && !rule.history) throw new Error('请至少选择一个过滤时机');
}

export function readStoryRegexRules(raw: string | null): StoryRegexRule[] {
    if (!raw) return [];
    const rules: unknown = JSON.parse(raw);
    if (!Array.isArray(rules)) throw new Error('正则规则数据格式无效');
    return rules.filter((rule): rule is StoryRegexRule => rule && ['filter', 'template'].includes(rule.kind)
        && ['id', 'name', 'presetId', 'pattern', 'flags', 'replacement', 'instruction'].every(key => typeof rule[key] === 'string')
        && ['enabled', 'display', 'history'].every(key => typeof rule[key] === 'boolean'));
}

export function storyRegexApplies(rule: StoryRegexRule, stage: 'display' | 'history'): boolean {
    return rule.enabled && (stage === 'display' ? rule.kind === 'template' || rule.display
        : rule.kind === 'filter' && rule.history);
}

const escapeCapture = (text: string): string => text.replace(/[&<>"']/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character);

function expandReplacement(template: string, tokens: RegExp, resolve: (match: RegExpMatchArray) => string, limit: number): string {
    const parts: string[] = [];
    let cursor = 0;
    let length = 0;
    for (const match of template.matchAll(tokens)) {
        const start = match.index!;
        const value = resolve(match);
        length += start - cursor + value.length;
        if (length > limit) throw new Error('正则替换结果过长');
        parts.push(template.slice(cursor, start), value);
        cursor = start + match[0].length;
    }
    if (length + template.length - cursor > limit) throw new Error('正则替换结果过长');
    return parts.join('') + template.slice(cursor);
}

export function applyStoryRegex(text: string, rules: StoryRegexRule[], stage: 'display' | 'history'): StoryRegexResult {
    const cards: StoryRegexCard[] = [];
    let matches = 0;
    let source = text;
    // Filters operate on source text. Templates run last so later rules
    // cannot accidentally rewrite generated CSS, markup or captured values.
    const applicable = rules.filter(rule => storyRegexApplies(rule, stage));
    for (const rule of applicable.filter(rule => rule.kind === 'filter')) {
        const regex = compileStoryRegex(rule.pattern, rule.flags);
        let outputLength = source.length;
        source = source.replace(regex, (...args: unknown[]) => {
            matches++;
            const named = typeof args.at(-1) === 'object' ? args.pop() as Record<string, string> : undefined;
            const input = args.pop() as string;
            const offset = args.pop() as number;
            const captures = args as (string | undefined)[];
            const replacement = expandReplacement(rule.replacement, /\$(\$|&|\x60|'|\d{1,2}|<[^>]+>)/g, ([token, key]) => {
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
            outputLength += replacement.length - (captures[0]?.length || 0);
            return replacement;
        });
    }
    const templates = applicable.filter(rule => rule.kind === 'template');
    if (!templates.length) return { text: source, cards, matches };
    let prefix = 'SULLYREGEXCARD';
    while (source.includes(prefix)) prefix += 'X';
    let fragments = [source];
    let htmlLength = 0;
    for (const rule of templates) {
        const regex = compileStoryRegex(rule.pattern, rule.flags);
        const next: string[] = [];
        // Only match the remaining source fragments. Cards are opaque to
        // subsequent rules, so a broad template cannot swallow an earlier one.
        for (const [index, fragment] of fragments.entries()) {
            if (index % 2) {
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
                const html = expandReplacement(rule.replacement, /\{\{\s*(\$\d+|\$&|match|\$<[^>]+>)\s*\}\}|\$(\d+|&|<[^>]+>)/g,
                    ([_token, wrapped, plain]) => {
                        const key = wrapped === 'match' ? '&' : wrapped ? wrapped.slice(1) : plain || '';
                        const value = key.startsWith('<') ? named?.[key.slice(1, -1)] : captures[key === '&' ? 0 : Number(key)];
                        return escapeCapture(value ?? '');
                    }, Math.min(STORY_TEMPLATE_MAX_LENGTH, 900000 - htmlLength));
                htmlLength += html.length;
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
