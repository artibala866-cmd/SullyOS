import type { StoryArchiveFact } from '../types';

const normalized = (text: string) => text.normalize('NFKC').trim().toLowerCase();
const compact = (text: string) => normalized(text).replace(/\s+/gu, '');
const identifierLabel = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/iu;

/** Identifiers remain usable as keys; they are not invented human-facing tags. */
export function storyArchiveKeywordTags(values: readonly unknown[], body: string): string[] {
    const evidence = normalized(body);
    return [...new Set(values.filter((value): value is string => typeof value === 'string')
        .map(normalized).filter(value => value.length >= 2 && value !== '剧情'
            && (!identifierLabel.test(value) || evidence.includes(value))))];
}

export function storyArchiveFallbackTags(key: string, body: string): string[] {
    const evidence = normalized(body);
    return storyArchiveKeywordTags(key.split(/[\/：:·-]+/u).filter(label =>
        /\p{Script=Han}/u.test(label) || evidence.includes(normalized(label))), body);
}

/** Read-only check: never guess who a narrator's "I/you/he" refers to. */
export function hasUnresolvedStoryNarration(text: string, names: readonly string[] = []): boolean {
    let body = text.normalize('NFKC').replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"]*"/gu, '引文');
    for (const name of [...new Set(names)].filter(name => name.length >= 2).sort((a, b) => b.length - a.length)) {
        body = body.replaceAll(name.normalize('NFKC'), '人物');
    }
    const head = /^\s*(?:[-*]\s*)?(?:(?:如今|现在|当时|此时|此刻|随后|后来|生前|死后)[，,\s]*)*(?:他(?!人)|她|它|你|我)(?:们)?(?=的|在|从|生前|死后|已经|是|不|也|仍|还|正|曾|要|想|会|能|没|将|作为|身为)/u;
    const addressed = /(?:被|给|对|替|把|让|帮|与|陪|跟|向|为|到|离|比)(?:你|我)(?:们)?(?=[\p{Script=Han}，。！？；\s]|$)/u;
    return head.test(body) || addressed.test(body) || /^\s*(?:now\s+)?(?:he|she|they|you|i)\b/iu.test(body);
}

export function storyArchiveSummaryIssue(
    fact: StoryArchiveFact, sourceTexts: readonly string[], names: readonly string[] = [],
): string | undefined {
    if (fact.kind !== 'fact') return;
    const body = compact(fact.text);
    if (identifierLabel.test(fact.text.trim()) && !sourceTexts.some(source => compact(source).includes(body))) {
        return '只返回了内部标识，没有有效的剧情总结';
    }
    // A short factual assertion may legitimately equal its source. Reject the
    // copied narrator fragment, not all verbatim evidence or long summaries.
    if (sourceTexts.some(source => compact(source).includes(body))
        && hasUnresolvedStoryNarration(fact.text, [...names, ...(fact.entities ?? []).map(entity => entity.name)])) {
        return '剧情总结仍是人物指代不明的原文片段';
    }
}
