import type { CardImportOrigin, CharacterProfile, MountedWorldbook, TavernOpeningGreeting, Worldbook } from '../types';
import { toMountedWorldbook } from './worldbook';
import { adaptTavernOpeningGreeting, tavernOpeningBodyKey, tavernOpeningSceneText, tavernOpeningAuthorNote } from './tavernOpeningGreeting';
import { isLegacyLinkOpening, mergeLinkGreetings } from './linkStoryOpenings';
import { canReplaceImportedRemark, importedCardRemarkCorrection } from './cardImportRemark';

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
    if (found && !found.cardImportOrigin && origin.source !== 'sully') {
        const prompt = found.systemPrompt || '';
        const mounted = found.mountedWorldbooks || [];
        const legacyTavern = origin.source === 'tavern' && (
            prompt.startsWith('【角色身份与背景】\n') ||
            prompt.startsWith('【角色性格与行为设定】\n') ||
            mounted.some(book => book.sourceUid != null && !book.cardImportKey)
        );
        const legacyLink = origin.source === 'babylink' && (
            prompt.startsWith('【角色稳定人设】\n') ||
            mounted.some(book => (book.category || '').startsWith('BabyLink · ')) ||
            (Array.isArray(found.linkGreetings) && found.linkGreetings.length > 0) ||
            (Array.isArray(found.tavernGreetings) &&
                found.tavernGreetings.some(row => row && isLegacyLinkOpening(row)))
        );
        if (!legacyTavern && !legacyLink)
            throw new Error('同名角色没有可核验的旧导入来源，可能是手动创建角色；为保护原有人设与记忆，已停止自动覆盖');
    }
    // Names from different card ecosystems do not establish the same
    // identity. Even when only one side has an external ID, cross-source
    // import must not overwrite an existing person's memories or persona.
    if (found?.cardImportOrigin &&
        found.cardImportOrigin.source !== origin.source) {
        throw new Error('同名角色来自不同的卡片格式，不能只凭姓名合并；为保护已有内容已停止导入');
    }
    if (found?.cardImportOrigin?.externalId && externalId &&
        found.cardImportOrigin.externalId !== externalId) {
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
    // An import is not a repair operation: never silently discard malformed
    // existing scenes when the user has saved stories pointing to them.
    if (!Array.isArray(existing) || !Array.isArray(incoming) ||
        existing.some(g => !g || typeof g.id !== 'string' ||
            typeof g.content !== 'string' || typeof g.title !== 'string')) {
        throw new Error('已有开场白数据结构异常，为保护原有剧情，已停止导入');
    }
    const isHandwritten = (g: TavernOpeningGreeting) => g.id.startsWith('story-custom-');
    const output = existing.map(g => isHandwritten(g) ? { ...g } : adaptTavernOpeningGreeting(g));
    const semanticKey = (g: TavernOpeningGreeting) => {
        const body = tavernOpeningSceneText(g.content);
        if (!body) return '';
        // Author requests affect role behavior even if not shown as dialogue.
        // The display layer intentionally renders a Markdown/HTML link as
        // its label. Its destination still matters to story identity: two
        // diary clues with the same label but different destinations must not
        // be merged just because their visible text matches.
        const references = [
            ...Array.from(g.content.matchAll(/(?<!!)\[[^\]\r\n]+\]\(\s*(https?:\/\/[^\s)]+)\s*\)/gi), match => match[1]),
            ...Array.from(g.content.matchAll(/<a\b[^>]*\bhref\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>/gi), match => match[1]),
        ];
        return JSON.stringify([body, tavernOpeningAuthorNote(g.content), references]);
    };
    for (const original of incoming) {
        if (!original?.content?.trim()) continue;
        const greeting = isHandwritten(original) ? { ...original } : adaptTavernOpeningGreeting(original);
        const key = isHandwritten(greeting) ? greeting.content.trim() : tavernOpeningBodyKey(greeting);
        if (!key) continue;
        // Exact body matches and display-only asset changes are the same
        // opening; retain the ID used by old saved stories.
        const semantic = semanticKey(greeting);
        const byBody = output.findIndex(row =>
            (isHandwritten(row) ? row.content.trim() : tavernOpeningBodyKey(row)) === key ||
            (!isHandwritten(row) && !isHandwritten(greeting) && semantic && semanticKey(row) === semantic));
        if (byBody >= 0) {
            const previous = output[byBody];
            // Identical imported prose cannot overwrite a user's separately
            // authored scene or its title/description on re-import.
            if (!isHandwritten(previous))
                output[byBody] = { ...previous, ...greeting, id: previous.id };
            continue;
        }
        // Tavern's tavern-alt-N ID is a list position, not a permanent source
        // identity. Reordering/adding/renaming a scene must never replace a
        // different old scene (nor should two stories with the same title).
        let id = greeting.id;
        if (output.some(row => row.id === id)) {
            const fingerprint = cardContentFingerprint(greeting.content).replace(/:/g, '-');
            id = greeting.id + '-scene-' + fingerprint;
            let suffix = 2;
            while (output.some(row => row.id === id))
                id = greeting.id + '-scene-' + fingerprint + '-' + suffix++;
        }
        output.push({ ...greeting, id });
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
            row.category === incoming.category && !row.cardImportKey);
        if (found.length === 1) return found[0]; // legacy imports predate cardImportKey
    }
    // Different nonempty source keys are independent lore entries, even if
    // their prose is identical. They can have different activation, scope or
    // ordering. Body-only fallback is for pre-key legacy mounted entries.
    const candidates = incoming.cardImportKey
        ? mounted.filter(row =>
            !row.cardImportKey && (
                // Legacy imports can be upgraded in place, but a handwritten
                // unkeyed worldbook must never become imported source data.
                (source === 'tavern' && row.sourceUid != null &&
                    row.category === incoming.category) ||
                (source === 'babylink' && (row.category || '').startsWith('BabyLink · ')) ||
                source === 'sully'
            )) : mounted;
    const identical = candidates.filter(row => bookSignature(row) === bookSignature(incoming));
    if (identical.length === 1) return identical[0];
    // A role imported once from Tavern and then from Link may carry the same
    // lore under differently named folders. Keep only one copy of identical
    // titled content, rather than making a second mounted instruction.
    const crossFormat = candidates.filter(row => row.title.trim() === incoming.title.trim() &&
        row.content.trim() === incoming.content.trim());
    if (crossFormat.length === 1) return crossFormat[0];
    const sameText = candidates.filter(row =>
        row.content.trim() === incoming.content.trim() && row.category === incoming.category);
    if (sameText.length === 1) return sameText[0];
    // Differently keyed entries with the same title are NOT the same module.
    // This matters for cards containing two different chapters both called
    // "设定": the second must be added rather than overwrite the first.
    // Only the legacy Link importer had stable, recognizable folder names
    // without source keys. A user-created lore entry with the same title must
    // not be silently replaced by unrelated imported content.
    if (source !== 'babylink' || !incoming.category.startsWith('BabyLink · ')) return undefined;
    const sameTitle = candidates.filter(row =>
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
        // A document filename proves neither content authorship nor that a
        // user-edited imported persona is safe to overwrite. New imports
        // retain a baseline hash; legacy rows without a baseline may only
        // establish one by reimporting unchanged content.
        if (target && item.origin.source === 'document' &&
            typeof item.fields.systemPrompt === 'string' &&
            item.fields.systemPrompt !== target.systemPrompt) {
            const baseline = target.cardImportOrigin?.personaFingerprint;
            if (!baseline || baseline !== cardContentFingerprint(target.systemPrompt || ''))
                throw new Error('已有文档角色的人设可能被手动修改，无法确认安全覆盖；本次未改动原有人设和聊天，请手动核对后再更新');
        }
        const next: CharacterProfile = target ? { ...target } : { ...item.character, mountedWorldbooks: [] };
        // Previously imported Tavern/Link cards can have an auto-generated
        // persona summary in the editable Neural Link remark. A selective
        // reimport may safely remove ONLY a provably generated legacy remark.
        // Never erase a handwritten note or change a new character's identity.
        if (target && Object.prototype.hasOwnProperty.call(item.fields, 'description') &&
            (item.origin.source === 'tavern' || item.origin.source === 'babylink' ||
             item.origin.source === 'document')) {
            const corrected = importedCardRemarkCorrection(target);
            if (corrected !== null) next.description = corrected;
        }
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
                if (PRIVATE_FIELDS.has(key)) continue;
                if (key === 'description' &&
                    (item.origin.source === 'tavern' || item.origin.source === 'document')) continue;
                if (key === 'description' && item.origin.source === 'babylink') {
                    if (!canReplaceImportedRemark(target, 'babylink')) continue;
                    next.description = typeof value === 'string' ? value : '';
                    continue;
                }
                if (!nonBlank(value)) continue;
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
                // A damaged legacy field is not an empty library. Abort rather
                // than discarding unrecognized stored records on re-import.
                if (target.tavernGreetings != null && !Array.isArray(target.tavernGreetings))
                    throw new Error('已有开场白数据结构异常，为保护原有剧情，已停止导入');
                // Preserve any old Link entries mixed into this legacy field
                // without running Tavern's title/desc rules over their body.
                const all = target.tavernGreetings || [];
                next.tavernGreetings = [
                    ...mergeCardGreetings(all.filter(g => !isLegacyLinkOpening(g)), item.fields.tavernGreetings),
                    ...all.filter(isLegacyLinkOpening),
                ];
            }
            if (item.fields.linkGreetings?.length) {
                if ((target.linkGreetings != null && !Array.isArray(target.linkGreetings)) ||
                    (target.tavernGreetings != null && !Array.isArray(target.tavernGreetings)))
                    throw new Error('已有 Link／酒馆开场白结构异常，已停止导入以保护旧存档');
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
            // Record only a nickname actually applied, not a skipped incoming
            // value, so user-edited notes are never mistaken for source data.
            importedRemark: item.origin.source === 'babylink' && importingPersona &&
                Object.prototype.hasOwnProperty.call(item.fields, 'description') &&
                next.description === item.fields.description
                ? next.description : target?.cardImportOrigin?.importedRemark,
            personaFingerprint: item.origin.source === 'document' &&
                Object.prototype.hasOwnProperty.call(item.fields, 'systemPrompt')
                ? cardContentFingerprint(next.systemPrompt || '')
                : target?.cardImportOrigin?.personaFingerprint,
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
