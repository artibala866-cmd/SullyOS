import type { CardImportOrigin, CharacterProfile, MountedWorldbook, TavernOpeningGreeting, Worldbook } from '../types';
import { toMountedWorldbook } from './worldbook';
import { adaptTavernOpeningGreeting, tavernOpeningBodyKey } from './tavernOpeningGreeting';
import { isLegacyLinkOpening, mergeLinkGreetings } from './linkStoryOpenings';

/**
 * Card identity lives on the character, not in a permanent import registry.
 * Deleting the character therefore immediately releases its identity.
 */
/** Fast stable fingerprints only for skipping identical image copies; never used as role identity. */
export function cardContentFingerprint(value: string | Uint8Array): string {
    let first = 2166136261, second = 0x811c9dc7;
    for (let index = 0; index < value.length; index++) {
        const n = typeof value === 'string' ? value.charCodeAt(index) : value[index];
        first = Math.imul(first ^ n, 16777619);
        second = Math.imul(second ^ (n + (index & 255)), 16777619);
    }
    return value.length + ':' + (first >>> 0).toString(16) + ':' + (second >>> 0).toString(16);
}

export const normalizeCardName = (name: string): string =>
    (name || '').normalize('NFKC').trim().replace(/\s+/g, '').toLocaleLowerCase();

export function findCardImportTarget(
    characters: CharacterProfile[], origin: CardImportOrigin, name: string,
): CharacterProfile | undefined {
    const externalId = origin.externalId?.trim();
    if (externalId) {
        const exact = characters.filter(char =>
            char.cardImportOrigin?.source === origin.source &&
            char.cardImportOrigin?.externalId === externalId);
        if (exact.length > 1) throw new Error('发现多个角色使用相同的卡片身份，请先整理重复角色');
        if (exact.length === 1) return exact[0];
    }
    const key = normalizeCardName(name);
    if (!key) throw new Error('角色卡姓名为空');
    const names = characters.filter(char =>
        normalizeCardName(char.name) === key ||
        (char.cardImportOrigin && normalizeCardName(char.cardImportOrigin.originalName) === key));
    if (names.length > 1) throw new Error('发现多个同名角色，无法安全判断需要更新哪一个，请先整理重复角色');
    const found = names[0];
    // A TXT/DOCX filename is not a verified identity. The original Link
    // character may share that name but have completely different memories
    // and persona; never replace it based on the document filename alone.
    if (found && origin.source === 'document' &&
        found.cardImportOrigin?.source !== 'document') {
        throw new Error('同名角色已存在，但文档文件名无法证明是同一角色。为保护原有人设与记忆，已停止自动覆盖；可重命名文档后作为独立角色导入');
    }
    if (found?.cardImportOrigin?.externalId && externalId &&
        (found.cardImportOrigin.source !== origin.source ||
         found.cardImportOrigin.externalId !== externalId)) {
        throw new Error('同名角色的来源身份不同，不能确定是同一角色；为避免误覆盖已停止导入');
    }
    return found;
}

export interface CardImportItem {
    /** ID found before image processing. Recheck inside the write transaction. */
    expectedTargetId: string | null;
    /** Fully initialized new-character record. */
    character: CharacterProfile;
    /** Only source-card fields; excludes new-character runtime defaults. */
    fields: Partial<CharacterProfile>;
    worldbooks: Worldbook[];
    origin: CardImportOrigin;
}
export interface CardImportResult {
    createdIds: string[];
    updatedIds: string[];
    unchangedIds: string[];
    booksAdded: number;
    booksUpdated: number;
}
export interface CardImportChanges {
    characters: CharacterProfile[];
    worldbooks: Worldbook[];
    result: CardImportResult;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const nonBlank = (value: unknown): boolean =>
    value !== undefined && value !== null && (typeof value !== 'string' || value.trim() !== '');

/** A character's chats, memories, UI and local preferences never come from an imported update. */
const PRIVATE_FIELDS = new Set([
    'id', 'cardImportOrigin', 'mountedWorldbooks', 'avatar', 'name', 'tavernGreetings', 'linkGreetings',
    'memories', 'refinedMemories', 'activeMemoryMonths', 'impression', 'guidebookInsights',
    'chatBlock', 'groupId', 'dialogueApi', 'activeMsg2Config', 'proactiveConfig',
    'emotionConfig', 'embeddingConfig', 'phoneState', 'home3D', 'savedDateState',
    'savedRoomState', 'dreamLogs', 'specialMomentRecords',
]);
const bookSignature = (book: Pick<MountedWorldbook, 'category' | 'title' | 'content'>) =>
    JSON.stringify([book.category || '', book.title.trim(), book.content.trim()]);
const equalBook = (a: Worldbook, b: Worldbook): boolean => {
    const { updatedAt: _a, ...left } = a;
    const { updatedAt: _b, ...right } = b;
    return same(left, right);
};

export function mergeCardGreetings(
    existing: TavernOpeningGreeting[] = [], incoming: TavernOpeningGreeting[] = [],
): TavernOpeningGreeting[] {
    const output = existing.map(adaptTavernOpeningGreeting);
    for (const original of incoming) {
        if (!original?.content?.trim()) continue;
        const greeting = adaptTavernOpeningGreeting(original);
        const key = tavernOpeningBodyKey(greeting);
        if (!key) continue;
        // An old saved card with <!-- title/desc --> is the SAME scene as its
        // new normalized version. Upgrade its metadata in place, not a copy.
        const byBody = output.findIndex(row => tavernOpeningBodyKey(row) === key);
        if (byBody >= 0) {
            const previous = output[byBody];
            output[byBody] = { ...previous, ...greeting, id: previous.id };
            continue;
        }
        const byId = output.findIndex(row => row.id === greeting.id);
        const byTitle = output.findIndex(row => row.title === greeting.title);
        const index = byId >= 0 ? byId : byTitle;
        if (index >= 0) output[index] = { ...greeting, id: output[index].id };
        else output.push(greeting);
    }
    return output;
}

const matchedMountedBook = (
    mounted: MountedWorldbook[], incoming: Worldbook, source: CardImportOrigin['source'],
): MountedWorldbook | undefined => {
    if (incoming.cardImportKey) {
        const exact = mounted.find(row => row.cardImportKey === incoming.cardImportKey);
        if (exact) return exact;
    }
    if (source === 'tavern' && incoming.sourceUid != null) {
        const found = mounted.filter(row => row.sourceUid === incoming.sourceUid &&
            row.category === incoming.category &&
            (!row.cardImportKey || row.cardImportKey.startsWith('tavern:')));
        if (found.length === 1) return found[0]; // legacy imports predate cardImportKey
    }
    const identical = mounted.filter(row => bookSignature(row) === bookSignature(incoming));
    if (identical.length === 1) return identical[0];
    // A role imported once from Tavern and then from Link may carry the same
    // lore under differently named folders. Keep only one copy of identical
    // titled content, rather than making a second mounted instruction.
    const crossFormat = mounted.filter(row => row.title.trim() === incoming.title.trim() &&
        row.content.trim() === incoming.content.trim());
    if (crossFormat.length === 1) return crossFormat[0];
    const sameText = mounted.filter(row =>
        row.content.trim() === incoming.content.trim() && row.category === incoming.category);
    if (sameText.length === 1) return sameText[0];
    // Differently keyed entries with the same title are NOT the same module.
    // This matters for cards containing two different chapters both called
    // "设定": the second must be added rather than overwrite the first.
    // Only the legacy Link importer had stable, recognizable folder names
    // without source keys. A user-created lore entry with the same title must
    // not be silently replaced by unrelated imported content.
    if (source !== 'babylink' || !incoming.category.startsWith('BabyLink · ')) return undefined;
    const sameTitle = mounted.filter(row =>
        row.title.trim() === incoming.title.trim() &&
        row.category === incoming.category &&
        !row.cardImportKey);
    return sameTitle.length === 1 ? sameTitle[0] : undefined;
};

/**
 * Pure, deterministic plan computed from the latest DB snapshot *inside* one
 * IndexedDB transaction. Only the caller's selected cards and their worldbooks
 * may change; unselected characters keep their own fields and mounts.
 */
export function mergeCardImports(
    existingCharacters: CharacterProfile[], existingWorldbooks: Worldbook[], items: CardImportItem[],
): CardImportChanges {
    if (!items.length) throw new Error('未选择任何角色');
    const seenNames = new Set<string>();
    for (const item of items) {
        const sourceKeys = item.worldbooks.map(book => book.cardImportKey).filter((key): key is string => !!key);
        if (new Set(sourceKeys).size !== sourceKeys.length) {
            throw new Error('角色卡存在重复的世界书来源条目 ID，无法安全合并');
        }
        const nameKey = normalizeCardName(item.fields.name || item.character.name);
        if (!nameKey || seenNames.has(nameKey)) throw new Error('本次导入含有重复姓名的角色，请分别导入以免合并错误');
        seenNames.add(nameKey);
    }
    const characters = new Map(existingCharacters.map(char => [char.id, char]));
    const library = new Map(existingWorldbooks.map(book => [book.id, book]));
    const originalCharacterIds = new Set(characters.keys());
    const originalWorldbookIds = new Set(library.keys());
    const sharedIncomingIds = new Map<string, string>();
    const result: CardImportResult = {
        createdIds: [], updatedIds: [], unchangedIds: [], booksAdded: 0, booksUpdated: 0,
    };
    const timestamp = Date.now();

    for (const item of items) {
        const target = findCardImportTarget([...characters.values()], item.origin, item.fields.name || item.character.name);
        if ((target?.id || null) !== item.expectedTargetId) {
            throw new Error('导入期间角色列表发生变化，请重新选择角色卡，避免覆盖错误角色');
        }
        const next: CharacterProfile = target ? { ...target } : { ...item.character, mountedWorldbooks: [] };
        const importingPersona = ['avatar','description','systemPrompt','worldview']
            .some(key => Object.prototype.hasOwnProperty.call(item.fields, key));
        if (!target && next.tavernGreetings?.length) {
            // First import must also dedupe identical opening text, not just re-imports.
            next.tavernGreetings = mergeCardGreetings([], next.tavernGreetings);
        }
        if (!target && next.linkGreetings?.length) {
            // Link is a distinct native format, never pass its scenes through
            // the Tavern HTML-comment adapter.
            next.linkGreetings = mergeLinkGreetings([], next.linkGreetings);
        }
        if (target) {
            for (const [key, value] of Object.entries(item.fields)) {
                if (PRIVATE_FIELDS.has(key) || !nonBlank(value)) continue;
                // Replacing source text is idempotent. Appending would duplicate the persona.
                (next as any)[key] = value;
            }
            const incomingName = item.fields.name?.trim();
            if (importingPersona && incomingName &&
                (target.name === target.cardImportOrigin?.originalName ||
                normalizeCardName(target.name) === normalizeCardName(item.origin.originalName))) {
                next.name = incomingName;
            }
            if (item.fields.avatar && item.origin.avatarFingerprint &&
                item.origin.avatarFingerprint !== target.cardImportOrigin?.avatarFingerprint) {
                next.avatar = item.fields.avatar;
            }
            if (item.fields.tavernGreetings?.length) {
                // Preserve any old Link entries mixed into this legacy field
                // without running Tavern's title/desc rules over their body.
                const all = target.tavernGreetings || [];
                next.tavernGreetings = [
                    ...mergeCardGreetings(all.filter(g => !isLegacyLinkOpening(g)), item.fields.tavernGreetings),
                    ...all.filter(isLegacyLinkOpening),
                ];
            }
            if (item.fields.linkGreetings?.length) {
                // Migrate pre-separation Link entries in place (same greeting IDs)
                // only when an actual Link openings payload was imported.
                const legacy = (target.tavernGreetings || []).filter(isLegacyLinkOpening);
                next.linkGreetings = mergeLinkGreetings(
                    [...(target.linkGreetings || []), ...legacy],
                    item.fields.linkGreetings,
                );
                if (legacy.length) next.tavernGreetings = (target.tavernGreetings || []).filter(g => !isLegacyLinkOpening(g));
            }
        }
        next.cardImportOrigin = {
            ...item.origin,
            // A lore-only/greetings-only update must not mutate the name or
            // reset the source name against which future persona changes compare.
            originalName: importingPersona ? item.origin.originalName :
                target?.cardImportOrigin?.originalName || item.origin.originalName,
            avatarFingerprint: item.origin.avatarFingerprint || target?.cardImportOrigin?.avatarFingerprint,
            imageFingerprint: item.origin.imageFingerprint || target?.cardImportOrigin?.imageFingerprint,
        };
        const mounted: MountedWorldbook[] = [...(next.mountedWorldbooks || [])];
        for (const incoming of item.worldbooks) {
            let matching = matchedMountedBook(mounted, incoming, item.origin.source);
            const previouslyMappedId = sharedIncomingIds.get(incoming.id);
            if (!matching && previouslyMappedId) {
                const already = library.get(previouslyMappedId);
                if (already) matching = toMountedWorldbook(already);
            }
            if (!matching) {
                // A deleted character's orphaned library entry is deliberately NOT
                // considered an identity match: fresh import means a fresh character.
                const copy: Worldbook = { ...incoming };
                if (library.has(copy.id)) throw new Error('世界书 ID 冲突，请重试导入');
                library.set(copy.id, copy);
                sharedIncomingIds.set(incoming.id, copy.id);
                mounted.push(toMountedWorldbook(copy));
                continue;
            }
            sharedIncomingIds.set(incoming.id, matching.id);
            const old = library.get(matching.id);
            const previous: Worldbook = old || {
                ...matching, category: matching.category || '',
                createdAt: timestamp, updatedAt: timestamp,
            };
            const replacement: Worldbook = {
                ...previous, ...incoming, id: matching.id,
                createdAt: previous.createdAt,
                updatedAt: previous.updatedAt,
            };
            if (!equalBook(previous, replacement)) {
                replacement.updatedAt = timestamp;
                library.set(matching.id, replacement);
            }
            const mountedIndex = mounted.findIndex(row => row.id === matching!.id);
            if (mountedIndex >= 0) mounted[mountedIndex] = toMountedWorldbook(library.get(matching.id)!);
            else mounted.push(toMountedWorldbook(library.get(matching.id)!));
        }
        next.mountedWorldbooks = [...new Map(mounted.map(book => [book.id, book])).values()];
        characters.set(next.id, next);
        if (!target) result.createdIds.push(next.id);
        else if (!same(target, next)) result.updatedIds.push(next.id);
        else result.unchangedIds.push(next.id);
    }

    // A worldbook shared by multiple BabyLink characters is a single library row.
    // Updating it must refresh every character that already mounts that same ID.
    for (const [charId, char] of characters) {
        if (!char.mountedWorldbooks?.length) continue;
        const synced = char.mountedWorldbooks.map(book =>
            library.has(book.id) && !same(book, toMountedWorldbook(library.get(book.id)!))
                ? toMountedWorldbook(library.get(book.id)!) : book);
        if (!same(synced, char.mountedWorldbooks)) characters.set(charId, { ...char, mountedWorldbooks: synced });
    }

    const characterChanges = [...characters.values()].filter(char =>
        !originalCharacterIds.has(char.id) ||
        !same(existingCharacters.find(row => row.id === char.id), char));
    const worldbookChanges = [...library.values()].filter(book =>
        !originalWorldbookIds.has(book.id) ||
        !same(existingWorldbooks.find(row => row.id === book.id), book));
    result.booksAdded = worldbookChanges.filter(book => !originalWorldbookIds.has(book.id)).length;
    result.booksUpdated = worldbookChanges.length - result.booksAdded;
    return { characters: characterChanges, worldbooks: worldbookChanges, result };
}
