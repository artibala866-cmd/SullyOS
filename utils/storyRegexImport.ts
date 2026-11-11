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
const depth = (value: unknown): number | undefined => {
    // SillyTavern JSON accepts numeric depths; some exported scripts serialize
    // them as strings. Reject fractions, negative numbers and empty strings.
    const parsed = typeof value === 'number' ? value :
        typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

/** Native alchemy imports SillyTavern regex_scripts and a single findRegex. */
function tavernRegexRow(row: SourceRecord, index: number): SourceRecord {
    const findRegex = asText(row.findRegex);
    const placement = Array.isArray(row.placement) ? row.placement : [];
    const appliesUser = placement.includes(1);
    const appliesAssistant = !placement.length || placement.some(value => value !== 1);
    const markdownOnly = switchOn(row.markdownOnly);
    const promptOnly = switchOn(row.promptOnly);
    return {
        name: asText(row.scriptName) || asText(row.name) || `酒馆正则 #${index + 1}`,
        enabled: !switchOn(row.disabled),
        pattern: findRegex,
        flags: '',
        replacement: asText(row.replaceString),
        trimStrings: strings(row.trimStrings),
        substituteRegex: row.substituteRegex ?? 0,
        minDepth: row.minDepth,
        maxDepth: row.maxDepth,
        role: appliesUser && appliesAssistant ? 'both' : appliesUser ? 'user' : 'assistant',
        applyOnDisplay: markdownOnly || !promptOnly,
        applyOnPrompt: promptOnly || !markdownOnly,
        scope: 'global',
        scenes: [],
        order: index,
    };
}

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
    // Keep authors' RegExp grammar byte-for-byte. Rewriting {a,b} to (a|b)
    // would change the meaning of a valid or intentionally literal pattern.
    const literal = /^\/([\s\S]+)\/([a-z]*)$/i.exec(row.pattern.trim());
    const pattern = literal?.[1] ?? row.pattern.trim();
    const rawFlags = (literal?.[2] || asText(row.flags)).trim();
    // Native Text Alchemist appends g at execution time. Keep that behavior
    // even for author-provided flags without g; do not change source semantics.
    const flags = [...new Set((rawFlags + (rawFlags.includes('g') ? '' : 'g')).split(''))].sort().join('');
    const template = switchOn(row.isHtmlTemplate, Boolean(asText(row.htmlTemplate).trim()));
    const rawReplacement = row.replacement;
    const [replacement = '', ...replacementChoices] = Array.isArray(rawReplacement)
        ? strings(rawReplacement) : [asText(rawReplacement)];
    const css = asText(row.cssScope).trim();
    const triggerKeywords = (Array.isArray(row.triggerKeywords)
        ? strings(row.triggerKeywords) : asText(row.triggerKeywords).split(/[,，、\n;；]/))
        .map(value => value.trim()).filter(Boolean);
    if (switchOn(row.triggerEnabled) && !triggerKeywords.length) {
        warn('关键词触发已开启但关键词为空，按无关键词限制处理，格式指令会正常参与续写');
    }
    const html = asText(row.htmlTemplate);
    if (template && !html.trim()) throw new Error('HTML 模板为空');
    const display = switchOn(row.applyOnDisplay, true);
    const history = !template && switchOn(row.applyOnPrompt);
    let enabled = switchOn(row.enabled, true);
    // Neither a private-chat scope nor a character-ID scope can be faithfully
    // mapped to a story preset. Never silently widen these rules to all stories.
    const scoped = row.scope === 'character' || row.scope === 'chat';
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
        order: typeof row.order === 'number' && Number.isFinite(row.order) ? row.order : index,
        replacement: template ? (css ? `<style>${css}</style>\n${html}` : html) : replacement,
        display, history, instruction: template || history ? asText(row.aiPrompt).trim() : '',
        role: row.role === 'user' || row.role === 'both' ? row.role : 'assistant',
        ...(template && { parseMode: row.parseMode === 'kv' || row.parseMode === 'json' ? row.parseMode : 'text' }),
        ...(replacementChoices.length > 0 && !template && { replacementChoices }),
        source: {
            trim: switchOn(row.trim) || undefined,
            scenes: scenes.length ? scenes : undefined,
            renderMode: row.renderMode === 'inline' || row.renderMode === 'iframe' ? row.renderMode : undefined,
            category: asText(row.category) || undefined,
            originalScope: asText(row.scope) || undefined,
            originalCharacterIds: strings(row.characterIds),
            triggerEnabled: switchOn(row.triggerEnabled),
            trimStrings: strings(row.trimStrings).filter(Boolean),
            substituteRegex: row.substituteRegex === 0 || row.substituteRegex === 2 ? row.substituteRegex : 1,
            minDepth: depth(row.minDepth),
            maxDepth: depth(row.maxDepth),
            ...(switchOn(row.triggerEnabled) && triggerKeywords.length > 0 && { triggerKeywords }),
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
    const extensions = asRecord(root?.extensions);
    const rows = Array.isArray(value) ? value :
        Array.isArray(extensions?.regex_scripts) ? extensions.regex_scripts :
        Array.isArray(root?.regex_scripts) ? root.regex_scripts :
        Array.isArray(root?.rules) ? root.rules : root ? [root] : [];
    if (!rows.length) throw new Error('文件里没有正则规则');
    const tavern = rows.some(value => typeof asRecord(value)?.findRegex === 'string'
        || typeof asRecord(value)?.replaceString === 'string');
    const ordered = rows.flatMap((value, index) => {
        const row = asRecord(value);
        return row ? (tavern ? [typeof row.findRegex === 'string' ? tavernRegexRow(row, index) : row]
            : legacyRows(row)).map(rule => ({ row: rule, index, order: typeof rule.order === 'number' ? rule.order : index }))
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
    // Earlier imports stored an empty array for enabled-but-empty keywords.
    // Semantically this equals "no keyword restriction" and should not duplicate
    // an existing template when the corrected importer is used again.
    // Execution scopes are user choices, not part of the imported file's
    // identity. Reimporting must not duplicate a rule after enabling both scenes.
    const key = ({ id: _id, enabled: _enabled, order: _order,
        domain: _domain, targets: _targets,
        importGroup: _group, subcategory: _sub, ...rule }: StoryRegexRule) => {
        const stableSource = rule.source ? {
            ...rule.source,
            triggerKeywords: rule.source.triggerKeywords?.length ? rule.source.triggerKeywords : undefined,
            scenes: undefined,
            renderMode: undefined,
            category: undefined,
            smartFilter: undefined,
            protectWords: undefined,
            originalScope: undefined,
            originalCharacterIds: undefined,
            triggerEnabled: undefined,
        } : {};
        const cleanSource = Object.fromEntries(
            Object.entries(stableSource).filter(([, value]) => value !== undefined),
        );
        return JSON.stringify({
            ...rule,
            source: Object.keys(cleanSource).length ? cleanSource : undefined,
        });
    };
    const rules = [...existing];
    const keys = new Set(rules.map(key));
    let added = 0;
    let updated = 0;
    let duplicates = 0;
    for (const rule of imported) {
        // Story preset bindings apply only to offline filters, never to
        // HTML templates which are restricted to online chat.
        const next = { ...rule, presetId: rule.kind === 'template' ? '' : presetId };
        const signature = key(next);
        if (keys.has(signature)) {
            // Old imports had no file folders. Attach the folder on reimport
            // without duplicating rules or altering user-enabled switches.
            const oldIndex = rules.findIndex(current => key(current) === signature);
            if (oldIndex !== -1 && ((!rules[oldIndex].importGroup && next.importGroup)
                || (!rules[oldIndex].subcategory && next.subcategory)
                || (rules[oldIndex].order == null && next.order != null))) {
                const old = rules[oldIndex];
                rules[oldIndex] = { ...old,
                    importGroup: old.importGroup || next.importGroup,
                    subcategory: old.subcategory || next.subcategory,
                    order: old.order ?? next.order,
                    domain: old.domain || next.domain,
                };
                updated++;
                continue;
            }
            duplicates++;
            continue;
        }
        // The prior importer discarded aiPrompt on prompt-stage text filters.
        // Recover it from the user's original file on reimport, preserving the
        // stored rule ID, enabled state, preset binding and other customizations.
        const missingPrompt = rules.findIndex(current =>
            !current.instruction.trim() && !!next.instruction.trim()
            && key({ ...current, instruction: '' }) === key({ ...next, instruction: '' }));
        if (missingPrompt !== -1) {
            const old = rules[missingPrompt];
            keys.delete(key(old));
            rules[missingPrompt] = { ...old, instruction: next.instruction };
            keys.add(key(rules[missingPrompt]));
            updated++;
            continue;
        }
        keys.add(signature);
        rules.push(next);
        added++;
    }
    return { rules, added, updated, duplicates };
}
