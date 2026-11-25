import type { CharacterGroup, CharacterProfile, UserProfile, Worldbook } from '../types';
import { openDB } from './db';
import { toMountedWorldbook } from './worldbook';
import { characterImageProfileKey } from './characterImageProfile';
import { DECORATION_DELETED_STORE, parseDecorationDeletedIds } from './decorationTombstones';
import { createSaveStorage, DEFAULT_USER_SAVE, USER_SAVE_ID, USER_SAVES_KEY, nativeLocalStorage, readUserSaves, returnToProfileAfterUserSaveSwitch, scopedDatabaseName, isSharedPreference, writeUserSaves, type UserSaveRegistry } from './userSaveScope';

export type SharedBaseResource = 'characters' | 'worldbooks' | 'characterGroups';
export type SharedBaseDeletionPatch = Partial<Record<SharedBaseResource, string[]>>;

/** Publish a global deletion before the local DB mutation so stale copies cannot return. */
export function markSharedIdentityDeletions(patch: SharedBaseDeletionPatch): () => void {
    const registry = readUserSaves();
    const raw = nativeLocalStorage?.getItem(USER_SAVES_KEY) ?? null;
    const added: SharedBaseDeletionPatch = {};
    const next = { ...(registry.sharedDeletions || {}) };
    for (const resource of ['characters', 'worldbooks', 'characterGroups'] as const) {
        const requested = [...new Set((patch[resource] || []).filter(id => typeof id === 'string' && id.length > 0))];
        const existing = new Set(next[resource] || []);
        const fresh = requested.filter(id => !existing.has(id));
        if (!fresh.length) continue;
        added[resource] = fresh;
        next[resource] = [...existing, ...fresh];
    }
    if (!Object.keys(added).length) return () => {};
    writeUserSaves({ ...registry, sharedDeletions: next }, raw);
    return () => clearSharedIdentityDeletions(added);
}

/** An explicit add/re-import with the same stable ID creates the base resource again. */
export function clearSharedIdentityDeletions(patch: SharedBaseDeletionPatch): void {
    const registry = readUserSaves();
    const raw = nativeLocalStorage?.getItem(USER_SAVES_KEY) ?? null;
    const next = { ...(registry.sharedDeletions || {}) };
    let changed = false;
    for (const resource of ['characters', 'worldbooks', 'characterGroups'] as const) {
        const remove = new Set(patch[resource] || []);
        if (!remove.size) continue;
        const current = next[resource] || [];
        const remaining = current.filter(id => !remove.has(id));
        if (remaining.length !== current.length) {
            next[resource] = remaining;
            changed = true;
        }
    }
    if (changed) writeUserSaves({ ...registry, sharedDeletions: next }, raw);
}

export function isSharedIdentityDeleted(resource: SharedBaseResource, id: string): boolean {
    return (readUserSaves().sharedDeletions?.[resource] || []).includes(id);
}

/** Do not cascade-delete an imported book if another identity still mounts it. */
export async function worldbooksMountedInOtherUserSaves(characterId: string, candidateIds: string[]): Promise<Set<string>> {
    const candidates = new Set(candidateIds);
    if (!candidates.size) return new Set();
    const registry = readUserSaves();
    const revision = nativeLocalStorage?.getItem(USER_SAVES_KEY) ?? null;
    const source = await openDB();
    const opened: IDBDatabase[] = [];
    const found = new Set<string>();
    try {
        for (const save of registry.saves) {
            if (save.id === USER_SAVE_ID) continue;
            const db = await openTarget(source, save.id, false);
            opened.push(db);
            const characters = await all(db, 'characters') as CharacterProfile[];
            for (const char of characters) {
                if (char.id === characterId) continue;
                for (const mounted of char.mountedWorldbooks || []) {
                    if (candidates.has(mounted.id)) found.add(mounted.id);
                }
            }
        }
        if (nativeLocalStorage?.getItem(USER_SAVES_KEY) !== revision) return candidates;
        return found;
    } catch (error) {
        // If an inactive save cannot be inspected, retain the candidate rather
        // than destroy a library entry that might still be mounted there.
        console.warn('[userSaves] Could not verify other-identity worldbook mounts; retaining candidates', error);
        return candidates;
    } finally {
        for (const db of opened) db.close();
    }
}

/** Explicit base-data allowlist. New character fields are private until audited;
 * never copy an unknown future relationship/history field into a fresh save. */
export const SHARED_CHARACTER_FIELDS = [
    'id', 'cardImportOrigin', 'tavernGreetings', 'linkGreetings', 'name', 'avatar', 'description', 'systemPrompt', 'worldview', 'groupId', 'mountedWorldbooks',
    'dialogueApi', 'videoAvatar', 'videoAvatarWardrobe', 'companionAvatar', 'videoCallBackground', 'companionBackground', 'companionThemeColor',
    'videoCallPerformanceQuality', 'chatShowRemark', 'bubbleStyle', 'chatFineTune', 'chatAppearance', 'chatDecorationCssIsolated', 'chatBackground',
    'contextLimit', 'contextRangeMode', 'contextRangePolicyVersion', 'hideSystemLogs', 'dateBackground', 'dateSceneBackgrounds', 'sprites', 'spriteConfig',
    'customDateSprites', 'spriteConfigLandscape', 'dateLightReading', 'dateAppearance', 'dateReadingShowAvatars', 'dateSkinSets', 'activeSkinSetId', 'dateStyleConfig',
    'dateExtraPresets', 'dateObserve', 'chibiStudio', 'roomConfig', 'voiceProfile', 'timeAwarenessEnabled', 'customTimezoneEnabled', 'customTimezone',
    'dateTimeAwarenessEnabled', 'chatVoiceEnabled', 'chatVoiceAutoPlay', 'chatVoiceLang', 'dateVoiceEnabled', 'dateVoiceLang', 'callVoiceLang',
    'memoryPalaceEnabled', 'autoArchiveEnabled', 'memoryPalaceWaterline', 'embeddingConfig', 'personalityStyle', 'ruminationTendency', 'interactionAccommodation',
    'htmlModeEnabled', 'htmlModeCustomPrompt', 'chatCollaborationEnabled', 'chromeCustomCss', 'chatSound', 'chatSoundBound', 'showThinkingChain',
    'thinkingChainStyle', 'thinkingChainCustomColors', 'thinkingChainCustomPrompt', 'thinkingChainCustomCss',
] as const satisfies readonly (keyof CharacterProfile)[];
export function baseCharacter(char: CharacterProfile): CharacterProfile {
    const result: Record<string, unknown> = { memories: [] };
    for (const field of SHARED_CHARACTER_FIELDS) if (char[field] !== undefined) result[field] = char[field];
    // Decoration survives; inhabitants' histories, relationships and automation do not.
    if (char.home3D) {
        const { version, assetVersion, roomSizeVersion, homePalette, activeRoomId, rooms } = char.home3D;
        result.home3D = { version, assetVersion, roomSizeVersion, homePalette, activeRoomId, rooms, autonomy: false };
    }
    if (char.vrState?.chibi) result.vrState = { enabled: false, activityMode: 'manual', intervalMinutes: 120, chibi: char.vrState.chibi };
    return result as unknown as CharacterProfile;
}
export function mergeCharacterBase(base: CharacterProfile, previous?: CharacterProfile): CharacterProfile {
    if (!previous) return base;
    const result = { ...previous };
    for (const key of SHARED_CHARACTER_FIELDS) delete (result as any)[key];
    const merged = { ...result, ...base, memories: previous.memories ?? [] };
    // home3D mixes visual layout with runtime state: only carry its visual part.
    if (base.home3D && previous.home3D) merged.home3D = { ...previous.home3D, ...base.home3D, autonomy: previous.home3D.autonomy };
    if (base.vrState?.chibi && previous.vrState) merged.vrState = { ...previous.vrState, chibi: base.vrState.chibi };
    return merged;
}
export const SHARED_STORES = ['character_groups', 'worldbooks', 'themes', 'emojis', 'emoji_categories', 'journal_stickers',
    'cc_custom_parts', 'pixel_home_assets', 'pixel_home_layouts', 'vr_novels', 'vr_scripts', 'vr_presets', 'story_theater_presets', 'story_theater_masks'];
export function isSharedAsset(id: string): boolean {
    return ['wallpaper', 'lock_wallpaper', 'wallpaper_user_backup', 'custom_font_data', 'room_custom_assets_list', 'chat_decoration_presets_v1', DECORATION_DELETED_STORE].includes(id) ||
        /^(icon_|widget_|deco_|appearance_preset_|decoration_|beauty_|chat_theme_)/.test(id);
}
/** Shared asset IDs use last-active-save semantics, but a decoration library is
 * a collection inside one row. Merge by stable preset ID to keep target-only
 * saved backgrounds instead of erasing them on every identity switch. */
export function mergeSharedAppearanceAssets(source: any[], target: any[]): any[] {
    // Merge deletion markers before merging presets. Without this, removing an
    // item in B and returning to A silently resurrects A's stale copy.
    const deleted = new Set<string>([
        ...parseDecorationDeletedIds(target.find(row => row.id === DECORATION_DELETED_STORE)?.data),
        ...parseDecorationDeletedIds(source.find(row => row.id === DECORATION_DELETED_STORE)?.data),
    ]);
    const byId = new Map<string, any>();
    for (const row of target) if (isSharedAsset(row.id)) byId.set(row.id, row);
    for (const row of source) {
        if (!isSharedAsset(row.id)) continue;
        if (row.id === 'chat_decoration_presets_v1' && byId.has(row.id) && byId.get(row.id).data !== row.data) {
            let incoming: any[], existing: any[];
            try {
                incoming = JSON.parse(row.data);
                existing = JSON.parse(byId.get(row.id).data);
            } catch { throw new Error('聊天装扮收藏无法读取，切换已取消以保护原有收藏'); }
            if (!Array.isArray(incoming) || !Array.isArray(existing))
                throw new Error('聊天装扮收藏格式异常，切换已取消以保护原有收藏');
            const identity = (item: any) => typeof item?._libraryId === 'string' && item._libraryId
                ? 'id:' + item._libraryId : 'legacy:' + JSON.stringify(item);
            const seen = new Set(incoming.map(identity));
            const missing = existing.filter(item => {
                const key = identity(item);
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
            byId.set(row.id, {...row, data: JSON.stringify([...incoming, ...missing])});
        } else byId.set(row.id, row);
    }
    if (deleted.size) {
        const library = byId.get('chat_decoration_presets_v1');
        if (library) {
            let items: any[];
            try { items = JSON.parse(library.data); }
            catch { throw new Error('聊天装扮收藏无法读取，切换已取消以保护原有收藏'); }
            if (!Array.isArray(items)) throw new Error('聊天装扮收藏格式异常，切换已取消以保护原有收藏');
            byId.set(library.id, {...library, data: JSON.stringify(items.filter(item => !deleted.has(item?._libraryId)))});
        }
    }
    if (deleted.size || byId.has(DECORATION_DELETED_STORE))
        byId.set(DECORATION_DELETED_STORE, {id: DECORATION_DELETED_STORE, data: JSON.stringify([...deleted])});
    return Array.from(byId.values());
}
function all(db: IDBDatabase, name: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(name, 'readonly'); const req = tx.objectStore(name).getAll();
        req.onsuccess = () => resolve(req.result); tx.onerror = tx.onabort = () => reject(tx.error);
    });
}
function openTarget(source: IDBDatabase, id: string, create: boolean): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        let created = false;
        const request = indexedDB.open(scopedDatabaseName('AetherOS_Data', id), source.version);
        request.onupgradeneeded = event => {
            if ((event.oldVersion === 0) !== create) { request.transaction!.abort(); return; }
            created = event.oldVersion === 0;
            const schema = source.transaction(Array.from(source.objectStoreNames), 'readonly');
            for (const name of Array.from(source.objectStoreNames)) {
                const old = schema.objectStore(name);
                const store = request.result.objectStoreNames.contains(name)
                    ? request.transaction!.objectStore(name)
                    : request.result.createObjectStore(name, { keyPath: old.keyPath, autoIncrement: old.autoIncrement });
                for (const indexName of Array.from(old.indexNames)) {
                    if (store.indexNames.contains(indexName)) continue;
                    const index = old.index(indexName);
                    store.createIndex(indexName, index.keyPath, { unique: index.unique, multiEntry: index.multiEntry });
                }
            }
        };
        let blocked = false;
        request.onsuccess = () => { if (blocked) request.result.close(); else if (create && !created) { request.result.close(); reject(new Error('身份数据库已存在，请重试')); } else resolve(request.result); };
        request.onerror = () => reject(request.error?.name === 'AbortError' ? new Error(create ? '身份数据库已存在，请重试' : '这个身份的本地数据库不存在，已停止切换。请从备份恢复，不会创建空档覆盖它。') : request.error);
        request.onblocked = () => { blocked = true; reject(new Error('请关闭其他页面后再切换身份')); };
    });
}
/** Read only referenced common binaries, never copy gallery/chat image history. */
export function referencedBlobs(db: IDBDatabase, data: unknown[]): Promise<any[]> {
    const ids = new Set<string>();
    const visit = (value: any): void => {
        if (typeof value === 'string') {
            for (const match of value.matchAll(/blobref:([a-zA-Z0-9_-]+)/g)) ids.add(match[1]);
            // Imported model asset ids are plain strings rather than blobref tokens.
            if (/^[a-zA-Z0-9_-]{1,160}$/.test(value)) ids.add(value);
            if (value.startsWith('{') || value.startsWith('[')) { try { visit(JSON.parse(value)); } catch { /* plain text */ } }
        } else if (value && typeof value === 'object') for (const item of Object.values(value)) visit(item);
    };
    data.forEach(visit);
    return new Promise((resolve, reject) => {
        const tx = db.transaction('blob_assets', 'readonly'), result: any[] = [];
        for (const id of ids) {
            const req = tx.objectStore('blob_assets').get(id);
            req.onsuccess = () => { if (req.result) result.push(req.result); };
        }
        tx.oncomplete = () => resolve(result); tx.onerror = tx.onabort = () => reject(tx.error);
    });
}
let switching = false;
/** Some desktop images/CSS live only inside shared preferences, not assets rows. */
export function sharedAppearancePreferences(): string[] {
    const result: string[] = [];
    if (nativeLocalStorage) for (let i = 0; i < nativeLocalStorage.length; i++) {
        const key = nativeLocalStorage.key(i)!;
        if (isSharedPreference(key)) result.push(nativeLocalStorage.getItem(key) ?? '');
    }
    return result;
}
/** Heal saves created by older releases without asking the user to reimport.
 * Only explicit references from shared appearance are eligible, never private
 * avatars, chat media, galleries or the rest of another save's blob store. */
export async function repairSharedAppearanceBlobs(db: IDBDatabase, appearanceAssets?: {id: string; data: unknown}[], roleImageProfiles: string[] = []): Promise<void> {
    const assets = (appearanceAssets ?? await all(db, 'assets')).filter(row => isSharedAsset(row.id));
    const refs = [...new Set(Array.from(JSON.stringify([assets, sharedAppearancePreferences(), roleImageProfiles]).matchAll(/blobref:([a-zA-Z0-9_-]+)/g), m => m[0]))];
    if (!refs.length) return;
    const present = new Set((await referencedBlobs(db, refs)).map(row => `blobref:${row.id}`));
    const missing = new Set(refs.filter(ref => !present.has(ref)));
    const recovered: any[] = [];
    const registry = readUserSaves();
    const donors = [...registry.saves, ...(registry.deletedSaves ?? []).filter(save => !save.purgePending)];
    for (const save of donors) {
        if (!/^(original|[a-f0-9-]{36})$/.test(save?.id ?? '')) continue;
        const name = scopedDatabaseName('AetherOS_Data', save.id);
        if (!missing.size || name === db.name) continue;
        const donor = await new Promise<IDBDatabase | null>((resolve, reject) => {
            const req = indexedDB.open(name); let absent = false, blocked = false;
            req.onupgradeneeded = () => { absent = true; req.transaction!.abort(); };
            req.onerror = () => absent ? resolve(null) : reject(req.error);
            req.onblocked = () => { blocked = true; resolve(null); };
            req.onsuccess = () => { if (blocked) req.result.close(); else resolve(req.result); };
        });
        if (!donor) continue;
        try {
            if (!donor.objectStoreNames.contains('blob_assets')) continue;
            for (const row of await referencedBlobs(donor, [...missing])) {
                recovered.push(row); missing.delete(`blobref:${row.id}`);
            }
        } finally { donor.close(); }
    }
    if (recovered.length) await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('blob_assets', 'readwrite');
        for (const row of recovered) tx.objectStore('blob_assets').put(row);
        tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error);
    });
}
export function isUserSaveSwitching(): boolean { return switching; }
/** A user's face/body is identity data, not the phone's shared decoration.
 * No source profile is accepted here: '+' always opens a blank identity. */
export function freshUserProfile(name: string): UserProfile {
    const avatar = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" fill="#f1f5f9"/><circle cx="64" cy="46" r="22" fill="#cbd5e1"/><ellipse cx="64" cy="115" rx="43" ry="38" fill="#cbd5e1"/></svg>');
    return { name: name.trim(), avatar, bio: '' };
}
/** Copy base resources in a single target transaction, then commit the tiny
 * active-id manifest. Failure never selects an uninitialized/half-written save.
 * Reload is deliberate: every component, queue and singleton gets a new lifetime. */
export async function activateUserSave(targetId: string, create?: { name: string }, options?: { deleteCurrent?: boolean }): Promise<void> {
    // Serialize database preparation between browser tabs where Web Locks exist.
    // The revision guard below remains mandatory for browsers without that API.
    if (typeof navigator !== 'undefined' && navigator.locks?.request)
        return navigator.locks.request('sully-user-save-switch', () => activateUserSaveLocked(targetId, create, options));
    return activateUserSaveLocked(targetId, create, options);
}
async function activateUserSaveLocked(targetId: string, create?: { name: string }, options?: { deleteCurrent?: boolean }): Promise<void> {
    if (switching || saveOperation) throw new Error(`正在${saveOperation || '切换身份'}，请稍候`);
    switching = true;
    let target: IDBDatabase | undefined;
    const otherDatabases: IDBDatabase[] = [];
    let preparedNew = false;
    const copiedImageProfiles = new Map<string, string>();
    let targetStorage: Storage | undefined;
    try {
        const registry = readUserSaves();
        const revision = nativeLocalStorage?.getItem(USER_SAVES_KEY) ?? null;
        if (registry.activeId !== USER_SAVE_ID) throw new Error('身份已在其他页面切换，请刷新后重试');
        if (!nativeLocalStorage) throw new Error('本地存储不可用，无法保存身份');
        if (options?.deleteCurrent && (targetId === USER_SAVE_ID || registry.saves.length < 2)) throw new Error('至少保留一个身份');
        if (targetId === USER_SAVE_ID) { switching = false; return; }
        if (create) {
            if (!/^[a-f0-9-]{36}$/.test(targetId) || [...registry.saves, ...(registry.deletedSaves ?? [])].some(s => s.id === targetId)) throw new Error('身份编号无效');
            if (!create.name.trim() || create.name.trim().length > 40) throw new Error('身份名称请填写 1～40 个字');
        } else if (!registry.saves.some(s => s.id === targetId)) throw new Error('找不到这个身份');

        const source = await openDB();
        // Character profiles and worldbooks are shared base records. Interaction
        // stores such as messages, memory nodes and story progress stay isolated.
        const storeNames = SHARED_STORES.filter(name => name !== 'worldbooks' && name !== 'character_groups' && source.objectStoreNames.contains(name));
        const [assets, ...resources] = await Promise.all([
            all(source, 'assets'),
            ...storeNames.map(async name => sharedStoreRows(name, await all(source, name))),
        ]);
        const sharedAssets = assets.filter(row => isSharedAsset(row.id));

        target = await openTarget(source, targetId, !!create);
        preparedNew = !!create;
        const identityDatabases = [source, target];
        for (const save of registry.saves) {
            if (save.id === USER_SAVE_ID || save.id === targetId) continue;
            const other = await openTarget(source, save.id, false);
            otherDatabases.push(other);
            identityDatabases.push(other);
        }

        // Build the union from every live identity. The active save wins a
        // same-ID edit; records that exist only in another identity are additions.
        const snapshots = await Promise.all(identityDatabases.map(async db => ({
            db,
            characters: await all(db, 'characters') as CharacterProfile[],
            worldbooks: await all(db, 'worldbooks') as Worldbook[],
            characterGroups: db.objectStoreNames.contains('character_groups')
                ? await all(db, 'character_groups') as CharacterGroup[]
                : [],
        })));
        const sourceSnapshot = snapshots[0];
        const deletedCharacters = new Set(registry.sharedDeletions?.characters || []);
        const deletedWorldbooks = new Set(registry.sharedDeletions?.worldbooks || []);
        const deletedCharacterGroups = new Set(registry.sharedDeletions?.characterGroups || []);

        const characterGroupById = new Map<string, CharacterGroup>();
        for (const snapshot of snapshots.slice(1)) {
            for (const group of snapshot.characterGroups) if (!characterGroupById.has(group.id)) characterGroupById.set(group.id, group);
        }
        // The active identity wins edits for the same stable group ID.
        for (const group of sourceSnapshot.characterGroups) characterGroupById.set(group.id, group);
        for (const id of deletedCharacterGroups) characterGroupById.delete(id);
        const sharedCharacterGroups = Array.from(characterGroupById.values());
        const sharedCharacterGroupIds = new Set(sharedCharacterGroups.map(group => group.id));

        const characterById = new Map<string, CharacterProfile>();
        for (const snapshot of snapshots.slice(1)) {
            for (const char of snapshot.characters) if (!characterById.has(char.id)) characterById.set(char.id, char);
        }
        for (const char of sourceSnapshot.characters) characterById.set(char.id, char);
        for (const id of deletedCharacters) characterById.delete(id);

        const worldbookById = new Map<string, Worldbook>();
        for (const snapshot of snapshots.slice(1)) {
            for (const book of snapshot.worldbooks) {
                const existing = worldbookById.get(book.id);
                if (!existing || (book.updatedAt || 0) > (existing.updatedAt || 0)) worldbookById.set(book.id, book);
            }
        }
        // The currently active identity is authoritative for same-ID edits.
        for (const book of sourceSnapshot.worldbooks) worldbookById.set(book.id, book);
        for (const id of deletedWorldbooks) worldbookById.delete(id);
        const sharedBooks = Array.from(worldbookById.values());
        const resolvedMountedBooks = new Map(sharedBooks.map(book => [book.id, toMountedWorldbook(book)]));

        const bases = Array.from(characterById.values()).map(char => {
            const base = baseCharacter(char);
            // A deleted or orphaned group must not leave a dangling groupId in any save.
            if (base.groupId && !sharedCharacterGroupIds.has(base.groupId)) base.groupId = undefined;
            if (Array.isArray(base.mountedWorldbooks)) {
                base.mountedWorldbooks = base.mountedWorldbooks
                    .filter(book => !deletedWorldbooks.has(book.id))
                    .map(book => resolvedMountedBooks.get(book.id) || book);
            }
            return base;
        });
        const baseIds = new Set(bases.map(char => char.id));

        const sourceStorage = createSaveStorage(nativeLocalStorage, USER_SAVE_ID);
        targetStorage = createSaveStorage(nativeLocalStorage, targetId);
        const targetPreferences = targetStorage;
        const imageProfiles = bases.flatMap(char => {
            const key = characterImageProfileKey(char.id);
            const value = sourceStorage.getItem(key);
            return value === null ? [] : [{ key, value }];
        });
        const roleImageValues = imageProfiles.map(entry => entry.value);
        await repairSharedAppearanceBlobs(source, sharedAssets, roleImageValues);
        const newProfile = create ? freshUserProfile(create.name) : undefined;
        const blobInputs = [...bases, ...sharedBooks, ...sharedAssets, ...resources, ...sharedAppearancePreferences(), ...roleImageValues];
        const blobRowsById = new Map<string, any>();
        for (const snapshot of snapshots.slice(1)) {
            for (const row of await referencedBlobs(snapshot.db, blobInputs)) {
                if (!blobRowsById.has(row.id)) blobRowsById.set(row.id, row);
            }
        }
        for (const row of await referencedBlobs(source, blobInputs)) blobRowsById.set(row.id, row);
        const blobs = Array.from(blobRowsById.values());

        if (nativeLocalStorage.getItem(USER_SAVES_KEY) !== revision) throw new Error('身份列表已在其他页面变化，请重试');

        // Write the common character/worldbook base into every saved DB. The
        // character merge updates only the shared whitelist; each DB keeps its
        // own memories, impression, chat history, phone state and interactions.
        // Deleted character rows are retained privately but hidden globally;
        // deleted worldbooks are purged because they carry no private state.
        await Promise.all(snapshots.map(snapshot => new Promise<void>((resolve, reject) => {
            const sharedStores = ['characters', 'worldbooks'];
            if (snapshot.db.objectStoreNames.contains('character_groups')) sharedStores.push('character_groups');
            const tx = snapshot.db.transaction(sharedStores, 'readwrite');
            const chars = tx.objectStore('characters');
            const previousById = new Map(snapshot.characters.map(char => [char.id, char]));
            for (const previous of snapshot.characters) {
                if (deletedCharacters.has(previous.id)) continue;
                if (!baseIds.has(previous.id)) chars.delete(previous.id);
            }
            for (const base of bases) chars.put(mergeCharacterBase(base, previousById.get(base.id)));
            const books = tx.objectStore('worldbooks');
            books.clear();
            for (const book of sharedBooks) books.put(book);
            if (snapshot.db.objectStoreNames.contains('character_groups')) {
                const groups = tx.objectStore('character_groups');
                groups.clear();
                for (const group of sharedCharacterGroups) groups.put(group);
            }
            tx.oncomplete = () => resolve();
            tx.onerror = tx.onabort = () => reject(tx.error || new Error('身份共享人设/世界书同步失败'));
        })));

        const previousAssets = await all(target, 'assets');
        const mergedSharedAssets = mergeSharedAppearanceAssets(sharedAssets, previousAssets);
        await new Promise<void>((resolve, reject) => {
            const tx = target!.transaction(['assets', 'blob_assets', 'user_profile', ...storeNames], 'readwrite');
            for (let i = 0; i < storeNames.length; i++) {
                const store = tx.objectStore(storeNames[i]);
                for (const row of resources[i]) store.put(row);
            }
            const assetStore = tx.objectStore('assets');
            for (const row of mergedSharedAssets) assetStore.put(row);
            for (const row of blobs) tx.objectStore('blob_assets').put(row);
            if (newProfile) tx.objectStore('user_profile').put({ ...newProfile, id: 'me' });
            tx.oncomplete = () => resolve();
            tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('身份存档保存失败'));
        });

        if (nativeLocalStorage.getItem(USER_SAVES_KEY) !== revision) throw new Error('身份列表已在其他页面变化，请重试');
        const next: UserSaveRegistry = {
            ...registry,
            activeId: targetId,
            saves: create ? [...registry.saves, { id: targetId, name: create.name.trim() }] : registry.saves,
        };
        if (options?.deleteCurrent) {
            next.saves = next.saves.filter(save => save.id !== USER_SAVE_ID);
            next.deletedSaves = [...(registry.deletedSaves ?? []), { ...registry.saves.find(save => save.id === USER_SAVE_ID)!, deletedAt: Date.now(), purgePending: true }];
        }
        for (const { key, value } of imageProfiles) {
            if (targetPreferences.getItem(key) !== null) continue;
            targetPreferences.setItem(key, value);
            copiedImageProfiles.set(key, value);
        }
        writeUserSaves(next, revision);
        target.close();
        target = undefined;
        for (const db of otherDatabases) db.close();
        returnToProfileAfterUserSaveSwitch(targetId);
        window.location.reload();
    } catch (error) {
        target?.close();
        for (const db of otherDatabases) db.close();
        for (const [key, value] of copiedImageProfiles) {
            if (targetStorage?.getItem(key) === value) targetStorage.removeItem(key);
        }
        if (preparedNew && !readUserSaves().saves.some(save => save.id === targetId)) indexedDB.deleteDatabase(scopedDatabaseName('AetherOS_Data', targetId));
        switching = false;
        throw error;
    }
}
export function newUserSaveId(): string { return crypto.randomUUID(); }
export { readUserSaves, USER_SAVE_ID, DEFAULT_USER_SAVE };

let saveOperation = '';
export function beginUserSaveOperation(label: string): () => void {
    if (switching || saveOperation) throw new Error(`正在${saveOperation || '切换身份'}，请完成后重试`);
    saveOperation = label;
    return () => { saveOperation = ''; };
}
export function renameUserSave(id: string, name: string): void {
    const release = beginUserSaveOperation('修改身份名称');
    try {
        const registry = readUserSaves();
        if (registry.activeId !== USER_SAVE_ID) throw new Error('身份已在其他页面切换，请刷新');
        const clean = name.trim();
        if (!clean || clean.length > 40) throw new Error('身份名称请填写 1～40 个字');
        if (!registry.saves.some(save => save.id === id)) throw new Error('找不到这个身份');
        if (!nativeLocalStorage) throw new Error('本地存储不可用');
        writeUserSaves({...registry, saves: registry.saves.map(save => save.id === id ? {...save, name: clean} : save)}, nativeLocalStorage.getItem(USER_SAVES_KEY));
    } finally { release(); }
}

export function sharedStoreRows(name: string, rows: any[]): any[] {
    if (name !== 'pixel_home_layouts') return rows;
    return rows.map(({charId, roomId, furniture, wallColor, floorColor, wallFillMode, wallOffsetX, wallOffsetY, floorFillMode, floorOffsetX, floorOffsetY}) =>
        ({charId, roomId, furniture: (Array.isArray(furniture) ? furniture : []).map((item: any) => ({...item, placedBy: 'user'})), wallColor, floorColor, wallFillMode, wallOffsetX, wallOffsetY, floorFillMode, floorOffsetX, floorOffsetY, ambiance: '', lastUpdatedAt: 0, lastDecoratedBy: 'user'}));
}

/** Commit the deletion only after the replacement holds the shared library.
 * The next document releases the old database connections before purging. */
export async function deleteCurrentUserSave(): Promise<void> {
    const registry = readUserSaves();
    const replacement = registry.saves.find(save => save.id !== USER_SAVE_ID);
    if (!replacement) throw new Error('至少保留一个身份');
    await activateUserSave(replacement.id, undefined, {deleteCurrent: true});
}

let purgeJob: Promise<void> | undefined;

/** Retry unfinished explicit deletions on startup. Old soft-deletion records
 * are hidden and remain eligible only as donors for shared appearance bytes. */
export function purgeDeletedUserSaves(): Promise<void> {
    return purgeJob ??= purgePendingDeletions();
}

async function purgePendingDeletions(): Promise<void> {
    if (!nativeLocalStorage) return;
    const registry = readUserSaves();
    if (registry.activeId !== USER_SAVE_ID) return;
    for (const save of registry.deletedSaves ?? []) {
        if (!save.purgePending) continue;
        // IDB waits for other documents holding open connections. The pending
        // entry survives a closed page, so startup can retry without restoring it.
        await Promise.all(['AetherOS_Data', 'SullyOS_Collaboration', 'ActiveMsg'].map(name =>
            new Promise<void>((resolve, reject) => {
                const request = indexedDB.deleteDatabase(scopedDatabaseName(name, save.id));
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            })
        ));
        const latest = readUserSaves();
        if (latest.activeId !== USER_SAVE_ID || !latest.deletedSaves?.some(entry => entry.id === save.id && entry.purgePending)) continue;
        if (save.id === DEFAULT_USER_SAVE) {
            // The original identity uses unprefixed private keys, which must be
            // removed without touching the global phone-wide preferences.
            const storage = createSaveStorage(nativeLocalStorage, save.id);
            for (const key of Object.keys(storage)) {
                if (!isSharedPreference(key)) storage.removeItem(key);
            }
        } else {
            // For deleted secondary identities, remove ALL physical namespaced
            // keys, including legacy shadow copies of now-shared API settings.
            // The real global preference is unprefixed and is not affected.
            const prefix = `sully:save-data:${save.id}:`;
            const stale: string[] = [];
            for (let i = 0; i < nativeLocalStorage.length; i++) {
                const key = nativeLocalStorage.key(i);
                if (key?.startsWith(prefix)) stale.push(key);
            }
            for (const key of stale) nativeLocalStorage.removeItem(key);
        }
        writeUserSaves({
            ...latest,
            deletedSaves: latest.deletedSaves.filter(entry => entry.id !== save.id),
        }, nativeLocalStorage.getItem(USER_SAVES_KEY));
    }
}
