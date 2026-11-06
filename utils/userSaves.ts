import type { CharacterProfile, UserProfile } from '../types';
import { openDB } from './db';
import { DEFAULT_USER_SAVE, USER_SAVE_ID, USER_SAVES_KEY, nativeLocalStorage, readUserSaves, returnToProfileAfterUserSaveSwitch, scopedDatabaseName, type UserSaveRegistry } from './userSaveScope';

/** Explicit base-data allowlist. New character fields are private until audited;
 * never copy an unknown future relationship/history field into a fresh save. */
export const SHARED_CHARACTER_FIELDS = [
    'id', 'cardImportOrigin', 'tavernGreetings', 'name', 'avatar', 'description', 'systemPrompt', 'worldview', 'groupId', 'mountedWorldbooks',
    'dialogueApi', 'videoAvatar', 'videoAvatarWardrobe', 'companionAvatar', 'videoCallBackground', 'companionBackground', 'companionThemeColor',
    'videoCallPerformanceQuality', 'chatShowRemark', 'bubbleStyle', 'chatFineTune', 'chatAppearance', 'chatDecorationCssIsolated', 'chatBackground',
    'contextLimit', 'contextRangeMode', 'contextRangePolicyVersion', 'hideSystemLogs', 'dateBackground', 'dateSceneBackgrounds', 'sprites', 'spriteConfig',
    'customDateSprites', 'dateLightReading', 'dateAppearance', 'dateReadingShowAvatars', 'dateSkinSets', 'activeSkinSetId', 'dateStyleConfig',
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
    return ['wallpaper', 'lock_wallpaper', 'wallpaper_user_backup', 'custom_font_data', 'room_custom_assets_list', 'chat_decoration_presets_v1'].includes(id) ||
        /^(icon_|widget_|deco_|appearance_preset_|decoration_|beauty_|chat_theme_)/.test(id);
}
function all(db: IDBDatabase, name: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(name, 'readonly'); const req = tx.objectStore(name).getAll();
        req.onsuccess = () => resolve(req.result); tx.onerror = tx.onabort = () => reject(tx.error);
    });
}
function openTarget(source: IDBDatabase, id: string): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(scopedDatabaseName('AetherOS_Data', id), source.version);
        request.onupgradeneeded = () => {
            const schema = source.transaction(Array.from(source.objectStoreNames), 'readonly');
            for (const name of Array.from(source.objectStoreNames)) {
                if (request.result.objectStoreNames.contains(name)) continue;
                const old = schema.objectStore(name);
                const store = request.result.createObjectStore(name, { keyPath: old.keyPath, autoIncrement: old.autoIncrement });
                for (const indexName of Array.from(old.indexNames)) {
                    const index = old.index(indexName);
                    store.createIndex(indexName, index.keyPath, { unique: index.unique, multiEntry: index.multiEntry });
                }
            }
        };
        let blocked = false;
        request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
        request.onerror = () => reject(request.error);
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
    if (switching || saveOperation) throw new Error(`正在${saveOperation || '切换身份'}，请稍候`);
    switching = true;
    let target: IDBDatabase | undefined;
    try {
        const registry = readUserSaves();
        if (registry.activeId !== USER_SAVE_ID) throw new Error('身份已在其他页面切换，请刷新后重试');
        if (!nativeLocalStorage) throw new Error('本地存储不可用，无法保存身份');
        if (options?.deleteCurrent && (targetId === USER_SAVE_ID || registry.saves.length < 2)) throw new Error('至少保留一个身份');
        if (targetId === USER_SAVE_ID) { switching = false; return; }
        if (create) {
            if (!/^[a-f0-9-]{36}$/.test(targetId) || registry.saves.some(s => s.id === targetId)) throw new Error('身份编号无效');
            if (!create.name.trim() || create.name.trim().length > 40) throw new Error('身份名称请填写 1～40 个字');
        } else if (!registry.saves.some(s => s.id === targetId)) throw new Error('找不到这个身份');
        const source = await openDB();
        const storeNames = SHARED_STORES.filter(name => source.objectStoreNames.contains(name));
        const [characters, assets, ...resources] = await Promise.all([all(source, 'characters'), all(source, 'assets'), ...storeNames.map(async name => sharedStoreRows(name, await all(source,name)))]);
        const bases = characters.map(baseCharacter);
        const sharedAssets = assets.filter(row => isSharedAsset(row.id));
        const newProfile = create ? freshUserProfile(create.name) : undefined;
        const blobs = await referencedBlobs(source, [...bases, ...sharedAssets, ...resources]);
        target = await openTarget(source, targetId);
        const previous = await all(target, 'characters');
        const previousAssets = await all(target, 'assets');
        await new Promise<void>((resolve, reject) => {
            const tx = target!.transaction(['characters', 'assets', 'blob_assets', 'user_profile', ...storeNames], 'readwrite');
            const chars = tx.objectStore('characters'); chars.clear();
            const byId = new Map(previous.map(char => [char.id, char]));
            for (const char of bases) chars.put(mergeCharacterBase(char, byId.get(char.id)));
            for (let i = 0; i < storeNames.length; i++) {
                const store = tx.objectStore(storeNames[i]); store.clear();
                for (const row of resources[i]) store.put(row);
            }
            const assetStore = tx.objectStore('assets');
            for (const row of previousAssets) if (isSharedAsset(row.id)) assetStore.delete(row.id);
            for (const row of sharedAssets) assetStore.put(row);
            for (const row of blobs) tx.objectStore('blob_assets').put(row);
            if (newProfile) tx.objectStore('user_profile').put({ ...newProfile, id: 'me' });
            tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('身份存档保存失败'));
        });
        // Check for a concurrent tab again after the asynchronous preparation.
        if (nativeLocalStorage.getItem(USER_SAVES_KEY) !== null && readUserSaves().activeId !== USER_SAVE_ID) throw new Error('其他页面已切换身份，请刷新');
        const next: UserSaveRegistry = { ...registry, activeId: targetId, saves: create ? [...registry.saves, { id: targetId, name: create.name.trim() }] : registry.saves };
        if (options?.deleteCurrent) {
            next.saves = next.saves.filter(save => save.id !== USER_SAVE_ID);
            next.deletedSaves = [...(registry.deletedSaves ?? []), {...registry.saves.find(save => save.id === USER_SAVE_ID)!, deletedAt: Date.now()}];
        }
        nativeLocalStorage.setItem(USER_SAVES_KEY, JSON.stringify(next));
        target.close(); target = undefined;
        returnToProfileAfterUserSaveSwitch(targetId);
        window.location.reload();
    } catch (error) {
        target?.close();
        // An unlisted fresh database has no user gameplay; remove failed preparation
        // so repeated quota errors cannot accumulate invisible copies of assets.
        if (create && !readUserSaves().saves.some(save => save.id === targetId)) indexedDB.deleteDatabase(scopedDatabaseName('AetherOS_Data', targetId));
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
        nativeLocalStorage.setItem(USER_SAVES_KEY, JSON.stringify({...registry, saves: registry.saves.map(save => save.id === id ? {...save, name: clean} : save)}));
    } finally { release(); }
}

export function sharedStoreRows(name: string, rows: any[]): any[] {
    if (name !== 'pixel_home_layouts') return rows;
    return rows.map(({charId, roomId, furniture, wallColor, floorColor, wallFillMode, wallOffsetX, wallOffsetY, floorFillMode, floorOffsetX, floorOffsetY}) =>
        ({charId, roomId, furniture: (Array.isArray(furniture) ? furniture : []).map((item: any) => ({...item, placedBy: 'user'})), wallColor, floorColor, wallFillMode, wallOffsetX, wallOffsetY, floorFillMode, floorOffsetX, floorOffsetY, ambiance: '', lastUpdatedAt: 0, lastDecoratedBy: 'user'}));
}

/** Remove a visible identity only after the replacement save is ready. Retain
 * its underlying database so neither late writers nor an accidental tap destroy
 * private history. No character/worldbook deletion is involved. */
export async function deleteCurrentUserSave(): Promise<void> {
    const registry = readUserSaves();
    const replacement = registry.saves.find(save => save.id !== USER_SAVE_ID);
    if (!replacement) throw new Error('至少保留一个身份');
    await activateUserSave(replacement.id, undefined, {deleteCurrent: true});
}
