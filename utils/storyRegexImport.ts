import { hasStoryHtmlLayout } from './storyTheaterHtml';
import { escapeStoryRegexLiteral, validateStoryRegexRule, type StoryRegexRule } from './storyRegex';

export const MAX_STORY_REGEX_FILE_BYTES = 4 * 1024 * 1024;
export interface StoryRegexImportResult {
    rules: StoryRegexRule[];
    warnings: string[];
    rejected: number;
}

type SourceRecord = Record<string, unknown>;
const asRecord = (value: unknown): SourceRecord | undefined =>
    value && typeof value === 'object' && !Array.isArray(value) ? value as SourceRecord : undefined;
const asText = (value: unknown): string => typeof value === 'string' ? value : '';
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
const switchOn = (value: unknown, fallback = false): boolean => value == null ? fallback : value === true || value === 1;
const depth = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;

function legacyRows(row: SourceRecord): SourceRecord[] {
    const subRules = row.subRules;
    if (!Array.isArray(subRules) || !subRules.length) return [row];
    return subRules.map((value, index) => {
        const sub = asRecord(value);
        const name = asText(row.name) || '旧版炼金规则';
        const targets = strings(sub?.targets).filter(Boolean);
        return {
            name: subRules.length > 1 ? `${name} #${index + 1}` : name,
            enabled: row.enabled,
            pattern: targets.map(target => sub?.mode === 'text' ? escapeStoryRegexLiteral(target) : target).join('|'),
            replacement: strings(sub?.replacements),
            substituteRegex: 0,
        };
    });
}

function convertRule(row: SourceRecord, index: number, warn: (message: string) => void): StoryRegexRule[] {
    const name = asText(row.name).trim() || `炼金规则 ${index + 1}`;
    if (typeof row.pattern !== 'string') throw new Error('缺少糯叽机匹配正则 pattern');
    const literal = /^\/([\s\S]+)\/([a-z]*)$/i.exec(row.pattern.trim());
    const pattern = (literal?.[1] ?? row.pattern.trim())
        .replace(/(?<!\\)\{([^{}\n]*,[^{}\n]*)\}/g, (token, body: string) => {
            if (/^\s*\d*\s*,\s*\d*\s*$/.test(body) || body.includes('\\')) return token;
            const choices = body.split(',').map(item => item.trim()).filter(Boolean);
            return choices.length > 1 ? '(?:' + choices.join('|') + ')' : token;
        });
    const rawFlags = (literal?.[2] || asText(row.flags)).trim();
    const flags = [...new Set((rawFlags + (rawFlags.includes('g') ? '' : 'g')).split(''))].sort().join('');
    const template = switchOn(row.isHtmlTemplate, Boolean(asText(row.htmlTemplate).trim()));
    const rawReplacement = row.replacement;
    const [replacement = '', ...replacementChoices] = Array.isArray(rawReplacement)
        ? strings(rawReplacement) : [asText(rawReplacement)];
    const css = asText(row.cssScope).trim();
    const html = asText(row.htmlTemplate);
    if (template && !html.trim()) throw new Error('HTML 模板为空');
    const display = switchOn(row.applyOnDisplay, true);
    const history = !template && switchOn(row.applyOnPrompt);
    let enabled = switchOn(row.enabled, true);
    const scoped = row.scope === 'character' || (row.scope === 'chat' && Array.isArray(row.characterIds) && row.characterIds.length > 0);
    const scenes = strings(row.scenes);
    const otherScenes = scenes.length > 0 && !scenes.some(scene => scene === 'chat' || scene === 'isekai' || scene === 'story');
    if (scoped || otherScenes) {
        enabled = false;
        warn(scoped ? '原文件绑定了糯叽机角色，已停用。请核对适用预设后启用' : '原文件仅用于其他场景，已停用。请核对用途后启用');
    }
    if (!display && !history) {
        enabled = false;
        warn('原规则关闭了应用时机，已保留为停用。请调整后启用');
    }
    if (display && /<script\b|\son\w+\s*=|https?:\/\//i.test(template ? html + css : [replacement, ...replacementChoices].join(''))) {
        warn('卡片使用剧情的安全预览。脚本、事件和外链资源会被过滤');
    }
    if (/\{\{\s*(?:user|char)\.(?:gender|avatar)\s*\}\}/i.test(pattern + replacement + html + asText(row.aiPrompt))) {
        warn('原文件的头像或性别变量需在剧情正则里手动替换');
    }

    const rule: StoryRegexRule = {
        id: crypto.randomUUID(),
        name, enabled, presetId: '', kind: template ? 'template' : 'filter', pattern, flags,
        replacement: template ? (css ? `<style>${css}</style>\n${html}` : html) : replacement,
        display, history, instruction: template ? asText(row.aiPrompt).trim() : '',
        role: row.role === 'user' || row.role === 'both' ? row.role : 'assistant',
        ...(template && { parseMode: row.parseMode === 'kv' || row.parseMode === 'json' ? row.parseMode : 'text' }),
        ...(replacementChoices.length > 0 && !template && { replacementChoices }),
        source: {
            trim: switchOn(row.trim) || undefined,
            trimStrings: strings(row.trimStrings).filter(Boolean),
            substituteRegex: row.substituteRegex === 0 || row.substituteRegex === 2 ? row.substituteRegex : 1,
            minDepth: depth(row.minDepth),
            maxDepth: depth(row.maxDepth),
            ...(switchOn(row.triggerEnabled) && { triggerKeywords: (Array.isArray(row.triggerKeywords)
                ? strings(row.triggerKeywords) : asText(row.triggerKeywords).split(/[,，、\n;；]/)).map(value => value.trim()).filter(Boolean) }),
        },
    };
    if ((rule.source?.minDepth ?? 0) > (rule.source?.maxDepth ?? Infinity)) throw new Error('最小楼层深度超过最大深度');
    validateStoryRegexRule(rule);
    // Some native exports contain a plain rule originally imported from Tavern.
    // The display replacement is markup, but a prompt replacement remains text.
    if (!template && display && [replacement, ...replacementChoices].some(hasStoryHtmlLayout)) {
        const displayRule: StoryRegexRule = { ...rule, kind: 'template', history: false, parseMode: 'text' };
        if (history) return [displayRule, { ...rule, id: crypto.randomUUID(), name: name + '（续写过滤）', display: false }];
        return [displayRule];
    }
    return [rule];
}

export function parseStoryRegexImport(raw: string): StoryRegexImportResult {
    let value: unknown;
    try {
        value = JSON.parse(raw.replace(/^\uFEFF/, ''));
    } catch {
        throw new Error('文件不是有效的 JSON，请使用糯叽机炼金术导出的正则文件');
    }
    const root = asRecord(value);
    const rows = Array.isArray(value) ? value : Array.isArray(root?.rules) ? root.rules : root ? [root] : [];
    if (!rows.length) throw new Error('文件里没有正则规则');
    const ordered = rows.flatMap((value, index) => {
        const row = asRecord(value);
        return row ? legacyRows(row).map(rule => ({ row: rule, index, order: typeof rule.order === 'number' ? rule.order : index }))
            : [{ row: {}, index, order: index }];
    }).sort((a, b) => a.order - b.order || a.index - b.index);
    const result: StoryRegexImportResult = { rules: [], warnings: [], rejected: 0 };
    for (const [index, { row }] of ordered.entries()) {
        const name = asText(row.name) || `第 ${index + 1} 条`;
        const notes: string[] = [];
        try {
            result.rules.push(...convertRule(row, index, message => notes.push(message)));
            result.warnings.push(...notes.map(note => `${name}：${note}`));
        } catch (error) {
            result.rejected++;
            result.warnings.push(`${name}：${error instanceof Error ? error.message : '无法转换'}`);
        }
    }
    return result;
}

export function mergeStoryRegexImport(existing: StoryRegexRule[], imported: StoryRegexRule[], presetId: string) {
    const key = ({ id: _id, enabled: _enabled, ...rule }: StoryRegexRule) => JSON.stringify(rule);
    const keys = new Set(existing.map(key));
    const additions: StoryRegexRule[] = [];
    for (const rule of imported) {
        const next = { ...rule, presetId };
        const signature = key(next);
        if (keys.has(signature)) continue;
        keys.add(signature);
        additions.push(next);
    }
    return { rules: [...existing, ...additions], added: additions.length, duplicates: imported.length - additions.length };
}
