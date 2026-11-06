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

/** Fingerprint only for local opening identity, never security or authorization. */
const linkSceneFingerprint = (content: string): string => {
    let a = 2166136261, b = 0x811c9dc7;
    for (let index = 0; index < content.length; index++) {
        const code = content.charCodeAt(index);
        a = Math.imul(a ^ code, 16777619);
        b = Math.imul(b ^ (code + (index & 255)), 16777619);
    }
    return [content.length, (a >>> 0).toString(16), (b >>> 0).toString(16)].join('-');
};

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
    // Malformed optional fields from older backups must not crash Story setup.
    const links = Array.isArray(character.linkGreetings) ? character.linkGreetings : [];
    const tavern = Array.isArray(character.tavernGreetings) ? character.tavernGreetings : [];
    for (const greeting of links) add(greeting, 'link');
    for (const greeting of tavern) {
        if (!greeting || typeof greeting.id !== 'string' ||
            typeof greeting.content !== 'string') continue;
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
    // Do not remove existing duplicate IDs during import: old unfinished
    // stories may still reference either of them. Only dedupe incoming rows.
    const result: LinkOpeningGreeting[] = existing.filter(g =>
        g && typeof g.content === 'string' && g.content.trim()).map(g => ({ ...g }));
    const existingCount = result.length;
    for (const row of incoming) {
        if (!row || typeof row.content !== 'string' || !row.content.trim()) continue;
        const key = row.content.trim();
        const byBody = result.findIndex(old => old.content.trim() === key);
        if (byBody >= 0) {
            // Within a single share, keep the first title/description of two
            // identical scenes. Across imports, update metadata in place while
            // preserving the ID already referenced by saved stories.
            if (byBody < existingCount) {
                const previous = result[byBody];
                result[byBody] = { ...previous, ...row, id: previous.id };
            }
            continue;
        }
        const byId = result.findIndex(old => old.id === row.id);
        if (byId >= 0 && row.id.startsWith('babylink-opening-text-')) {
            // Defensive fallback for a fingerprint collision: never silently
            // replace a different opening that a saved story might reference.
            let suffix = 2;
            let id = row.id + '-' + suffix;
            while (result.some(old => old.id === id)) id = row.id + '-' + ++suffix;
            result.push({ ...row, id });
        } else if (byId >= 0) {
            result[byId] = { ...row, id: result[byId].id };
        } else result.push({ ...row });
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
        const content = typeof value === 'string' ? value
            : (typeof object?.opening === 'string' && object.opening.trim()
                ? object.opening : object?.content ?? object?.opening);
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
            // Link may reorder its openings between exports. When it provides
            // no stable source ID, derive one from the raw scene instead of the
            // list index so re-import never changes a saved story's scene.
            id: typeof externalId === 'string' && externalId.trim()
                ? 'babylink-opening-source-' + externalId.trim()
                : 'babylink-opening-text-' + linkSceneFingerprint(content.trim()),
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
