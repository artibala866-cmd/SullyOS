import type { CharacterProfile, LinkOpeningGreeting, TavernOpeningGreeting } from '../types';
import { adaptTavernOpeningGreeting } from './tavernOpeningGreeting';

export type StoryOpeningSource = 'link' | 'tavern' | 'custom';
export interface StoryOpeningChoice extends LinkOpeningGreeting {
    source: StoryOpeningSource;
}

/** Pre-separation Link imports were stored in tavernGreetings under this ID prefix. */
export const isLegacyLinkOpening = (greeting: { id?: string } | null | undefined): boolean =>
    typeof greeting?.id === 'string' &&
    /^(?:babylink-opening-|link-opening:)/.test(greeting.id);

/**
 * Link and Tavern adapters remain separate. This is only a read-time adapter
 * for the common Story > Existing Opening selector, never an importer.
 *
 * Original Link V1 exports may omit the opening payload entirely; this function
 * neither invents missing scenes nor treats a missing field as a deletion.
 */
export const listCharacterStoryOpenings = (character: Pick<CharacterProfile, 'linkGreetings' | 'tavernGreetings'>): StoryOpeningChoice[] => {
    const result: StoryOpeningChoice[] = [];
    const seen = new Set<string>();
    const add = (raw: LinkOpeningGreeting, source: StoryOpeningSource) => {
        if (!raw || typeof raw.id !== 'string' || typeof raw.content !== 'string' ||
            !raw.content.trim() || seen.has(raw.id)) return;
        result.push({ ...raw, source });
        seen.add(raw.id);
    };
    // Native Link entries win over a shadow copy from pre-migration storage.
    for (const greeting of character.linkGreetings || []) add(greeting, 'link');
    for (const greeting of character.tavernGreetings || []) {
        if (isLegacyLinkOpening(greeting)) add(greeting, 'link');
        else {
            const source: StoryOpeningSource = greeting.id.startsWith('story-custom-') ? 'custom' : 'tavern';
            add(adaptTavernOpeningGreeting(greeting), source);
        }
    }
    return result;
};

/** Link raw text and structured title/description are preserved as-is. */
export function mergeLinkGreetings(
    existing: LinkOpeningGreeting[] = [], incoming: LinkOpeningGreeting[] = [],
): LinkOpeningGreeting[] {
    const result = existing.filter(g => g && typeof g.content === 'string' && g.content.trim())
        .map(g => ({ ...g }));
    for (const row of incoming) {
        if (!row || typeof row.content !== 'string' || !row.content.trim()) continue;
        const key = row.content.trim();
        const byId = result.findIndex(old => old.id === row.id);
        const byBody = result.findIndex(old => old.content.trim() === key);
        // Equal text cannot create a duplicate even when Link changes indices.
        const index = byBody >= 0 ? byBody : byId;
        if (index < 0) result.push({ ...row });
        else result[index] = { ...row, id: result[index].id };
    }
    return result;
}

/** Only recognized Link native opening keys, not stage headings inside persona text. */
export function normalizeLinkOpeningEntries(raw: unknown, maxCount = 100): LinkOpeningGreeting[] {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw) || raw.length > maxCount) throw new Error('Link 独立开场白结构或数量无效');
    const parsed: LinkOpeningGreeting[] = [];
    for (const [index, value] of raw.entries()) {
        const object = value && typeof value === 'object' && !Array.isArray(value)
            ? value as Record<string, unknown> : null;
        const content = typeof value === 'string' ? value : object?.opening ?? object?.content;
        if (content == null || content === '') continue;
        if (typeof content !== 'string' || content.length > 200000)
            throw new Error('Link 第 ' + (index + 1) + ' 条开场白正文无效');
        if (!content.trim()) continue;
        const title = object?.title;
        const description = object?.description ?? object?.desc;
        if (title != null && (typeof title !== 'string' || title.length > 160))
            throw new Error('Link 第 ' + (index + 1) + ' 条开场白标题无效');
        if (description != null && (typeof description !== 'string' || description.length > 4000))
            throw new Error('Link 第 ' + (index + 1) + ' 条开场白简介无效');
        const externalId = object?.id;
        if (externalId != null && (typeof externalId !== 'string' || externalId.length > 128))
            throw new Error('Link 第 ' + (index + 1) + ' 条开场白 ID 无效');
        const opening: LinkOpeningGreeting = {
            id: 'babylink-opening-' + (typeof externalId === 'string' && externalId.trim() ? externalId.trim() : index),
            title: typeof title === 'string' && title.trim() ? title.trim() : 'Link 开场白 ' + (index + 1),
            ...(typeof description === 'string' && description.trim() ? { description: description.trim() } : {}),
            content,
        };
        parsed.push(opening);
    }
    if (new Set(parsed.map(row => row.id)).size !== parsed.length)
        throw new Error('Link 分享数据包含重复开场白 ID，已停止以防止错误覆盖');
    return mergeLinkGreetings([], parsed);
}
