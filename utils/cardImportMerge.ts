import type { CardImportOrigin, CharacterProfile, MountedWorldbook, TavernOpeningGreeting, Worldbook } from '../types';
import { toMountedWorldbook } from './worldbook';

/**
 * Card identity lives on the character, not in a permanent import registry.
 * Deleting the character therefore immediately releases its identity.
 */
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
    if (found && externalId && found.cardImportOrigin?.source === origin.source &&
        found.cardImportOrigin.externalId && found.cardImportOrigin.externalId !== externalId) {
        throw new Error('同名角色来自不同的卡片身份，为避免错误覆盖已停止导入');
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
    'id', 'cardImportOrigin', 'mountedWorldbooks', 'avatar', 'name', 'tavernGreetings',
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
    const output = [...existing];
    for (const greeting of incoming) {
        if (!greeting.content?.trim()) continue;
        // Identical text must not be imported twice even when the source changed IDs.
        if (output.some(row => row.content.trim() === greeting.content.trim())) continue;
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
            (!row.cardImportKey || row.cardImportKey.startsWith('tavern:')));
        if (found.length === 1) return found[0]; // legacy imports predate cardImportKey
    }
    const identical = mounted.filter(row => bookSignature(row) === bookSignature(incoming));
    if (identical.length === 1) return identical[0];
    const sameText = mounted.filter(row =>
        row.content.trim() === incoming.content.trim() && row.category === incoming.category);
    if (sameText.length === 1) return sameText[0];
    const sameTitle = mounted.filter(row =>
        row.title.trim() === incoming.title.trim() && row.category === incoming.category);
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
        const next: CharacterProfile = target ? { ...target } : { ...item.character };
        if (target) {
            for (const [key, value] of Object.entries(item.fields)) {
                if (PRIVATE_FIELDS.has(key) || !nonBlank(value)) continue;
                // Replacing source text is idempotent. Appending would duplicate the persona.
                (next as any)[key] = value;
            }
            const incomingName = item.fields.name?.trim();
            if (incomingName && (target.name === target.cardImportOrigin?.originalName ||
                normalizeCardName(target.name) === normalizeCardName(item.origin.originalName))) {
                next.name = incomingName;
            }
            if (item.fields.avatar && item.origin.avatarFingerprint &&
                item.origin.avatarFingerprint !== target.cardImportOrigin?.avatarFingerprint) {
                next.avatar = item.fields.avatar;
            }
            if (item.fields.tavernGreetings?.length) {
                next.tavernGreetings = mergeCardGreetings(target.tavernGreetings, item.fields.tavernGreetings);
            }
        }
        next.cardImportOrigin = {
            ...item.origin,
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
