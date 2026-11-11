export type StoryRegexParseMode = 'text' | 'kv' | 'json';

export const escapeStoryRegexHtml = (text: string): string => text.replace(/[&<>"']/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character);

export function expandStoryRegexReplacement(
    template: string, tokens: RegExp, resolve: (match: RegExpMatchArray, remaining: number) => string, limit: number,
): string {
    const parts: string[] = [];
    let cursor = 0;
    let length = 0;
    for (const match of template.matchAll(tokens)) {
        const start = match.index!;
        length += start - cursor;
        if (length > limit) throw new Error('正则替换结果过长');
        const value = resolve(match, limit - length);
        length += value.length;
        if (length > limit) throw new Error('正则替换结果过长');
        parts.push(template.slice(cursor, start), value);
        cursor = start + match[0].length;
    }
    if (length + template.length - cursor > limit) throw new Error('正则替换结果过长');
    return parts.join('') + template.slice(cursor);
}

function parseCapture(text: string, mode: StoryRegexParseMode): unknown {
    if (mode === 'kv') {
        const fields: Record<string, string> = Object.create(null);
        for (const pair of text.split(/[|｜\n]/)) {
            const match = /^\s*([^:=：＝]+?)\s*[:=：＝]\s*(.*)$/.exec(pair.trim());
            if (match) fields[match[1]] = match[2].trim();
        }
        return fields;
    }
    if (mode === 'json') {
        const content = text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1');
        const candidates = [content];
        const object = /\{[\s\S]*\}/.exec(content)?.[0];
        const array = /\[[\s\S]*\]/.exec(content)?.[0];
        if (object) candidates.push(object);
        if (array) candidates.push(array);
        for (const candidate of candidates) {
            for (const source of [candidate, candidate.replace(/[“”]/g, '"').replace(/,\s*([}\]])/g, '$1')]) {
                try {
                    const value: unknown = JSON.parse(source);
                    if (value && typeof value === 'object') return value;
                } catch { /* Try the next form. */ }
            }
        }
    }
    return undefined;
}

function propertyAt(value: unknown, path: string): unknown {
    for (const key of path.split('.').map(key => key.trim())) {
        if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, key)) return undefined;
        value = (value as Record<string, unknown>)[key];
    }
    return value;
}

export function renderStoryRegexTemplate(
    template: string, captures: (string | undefined)[], named: Record<string, string> | undefined,
    mode: StoryRegexParseMode, limit: number, macros: (key: string) => string | undefined,
): string {
    const parsed = new Map<number, unknown>();
    const field = (key: string): unknown => {
        const match = /^(\d+)\.(.+)$/.exec(key);
        if (!match || Number(match[1]) < 1) return undefined;
        const group = Number(match[1]);
        if (!parsed.has(group)) parsed.set(group, parseCapture(captures[group] ?? '', mode));
        return propertyAt(parsed.get(group), match[2]);
    };
    const capture = (key: string): string | undefined =>
        key.startsWith('<') ? named?.[key.slice(1, -1)] : captures[key === '&' ? 0 : Number(key)];
    const renderFields = (source: string, available: number, item?: unknown) =>
        expandStoryRegexReplacement(source, /\{\{([^{}]+)\}\}|\$(\d+|&|<[^>]+>)/g, ([token, wrapped, plain]) => {
            const key = wrapped?.trim() ?? '';
            let value: unknown;
            if (plain || key.startsWith('$') || key === 'match') {
                value = capture(plain || (key === 'match' ? '&' : key.slice(1)));
            } else {
                value = propertyAt(item, key) ?? field(key) ?? macros(key);
                if (value === undefined && item === undefined && !/^\d+\./.test(key) && !key.startsWith('#')) return token;
            }
            return escapeStoryRegexHtml(value == null ? '' : String(value));
        }, available);

    const parts: string[] = [];
    let cursor = 0;
    let remaining = limit;
    const append = (source: string, item?: unknown) => {
        const rendered = renderFields(source, remaining, item);
        remaining -= rendered.length;
        parts.push(rendered);
    };
    for (const match of template.matchAll(/\{\{#each:([^{}]+)\}\}([\s\S]*?)\{\{\/each\}\}/g)) {
        append(template.slice(cursor, match.index));
        const items = field(match[1].trim());
        if (Array.isArray(items)) {
            if (items.length > 500) throw new Error('HTML 模板列表条目过多');
            for (const item of items) append(match[2], item);
        }
        cursor = match.index! + match[0].length;
    }
    append(template.slice(cursor));
    return parts.join('');
}
