/** A document binds to one save for its whole lifetime. Old async work can only
 * write to that save, even while another tab changes the selected identity. */
export const USER_SAVES_KEY = 'sully:user-saves:v1';
export const DEFAULT_USER_SAVE = 'original';
export interface UserSave { id: string; name: string; restored?: boolean }
export interface UserSaveRegistry { activeId: string; saves: UserSave[]; deletedSaves?: (UserSave & { deletedAt: number; purgePending?: true })[] }
export const nativeLocalStorage = typeof window === 'undefined' ? undefined : window.localStorage;
export const nativeSessionStorage = typeof window === 'undefined' ? undefined : window.sessionStorage;
const RETURN_KEY = 'sully:user-save-return-profile:v1';
/** Kept outside every save facade so a per-save clear/export cannot remove it. */
export const USER_SAVES_RECOVERY_KEY = 'sully:user-saves:recovery:v1';
export function isUserSaveIndexKey(key: string): boolean {
    return key === USER_SAVES_KEY || key === USER_SAVES_RECOVERY_KEY;
}
function parseRegistry(raw: string): UserSaveRegistry {
    const value = JSON.parse(raw) as UserSaveRegistry;
    const validSave = (s: UserSave) => s && typeof s.name === 'string' && /^(original|[a-f0-9-]{36})$/.test(s.id);
    if (!value || !Array.isArray(value.saves) || !value.saves.length ||
        !value.saves.every(validSave) || new Set(value.saves.map(s => s.id)).size !== value.saves.length ||
        !value.saves.some(s => s.id === value.activeId) ||
        (value.deletedSaves !== undefined && (!Array.isArray(value.deletedSaves) ||
            !value.deletedSaves.every(s => validSave(s) && Number.isFinite(s.deletedAt) && !value.saves.some(live => live.id === s.id)) ||
            new Set(value.deletedSaves.map(s => s.id)).size !== value.deletedSaves.length)))
        throw new Error('身份存档索引无法读取，请保留本地数据后重试');
    return value;
}
export function readUserSaves(): UserSaveRegistry {
    const raw = nativeLocalStorage?.getItem(USER_SAVES_KEY);
    const recovery = nativeLocalStorage?.getItem(USER_SAVES_RECOVERY_KEY);
    if (raw) {
        try {
            const value = parseRegistry(raw);
            // Migrate existing installations without blocking reads on low storage.
            if (!recovery) { try { nativeLocalStorage?.setItem(USER_SAVES_RECOVERY_KEY, raw); } catch { /* commit will require a mirror */ } }
            return value;
        } catch { /* Try the separately retained index before refusing startup. */ }
    }
    if (recovery) {
        try {
            const value = parseRegistry(recovery);
            nativeLocalStorage?.setItem(USER_SAVES_KEY, recovery);
            return value;
        } catch { throw new Error('身份索引恢复失败，请保留本地数据，不要清空存储'); }
    }
    if (raw) throw new Error('身份存档索引无法读取，请保留本地数据后重试');
    return { activeId: DEFAULT_USER_SAVE, saves: [{ id: DEFAULT_USER_SAVE, name: '原有身份' }] };
}
/** Prepare a recovery copy before publishing. A failed publication restores the
 * old mirror; no caller can report success with an unprotected new identity. */
export function writeUserSaves(value: UserSaveRegistry, expectedRaw: string | null): void {
    if (!nativeLocalStorage) throw new Error('本地存储不可用');
    if (nativeLocalStorage.getItem(USER_SAVES_KEY) !== expectedRaw) throw new Error('身份列表已在其他页面变化，请重试');
    const next = JSON.stringify(value); parseRegistry(next);
    const previous = nativeLocalStorage.getItem(USER_SAVES_RECOVERY_KEY);
    nativeLocalStorage.setItem(USER_SAVES_RECOVERY_KEY, next);
    try { nativeLocalStorage.setItem(USER_SAVES_KEY, next); }
    catch (error) {
        if (previous === null) nativeLocalStorage.removeItem(USER_SAVES_RECOVERY_KEY);
        else nativeLocalStorage.setItem(USER_SAVES_RECOVERY_KEY, previous);
        throw error;
    }
}
// Never silently fall back to the original save if an index is corrupt.
export const USER_SAVE_ID = readUserSaves().activeId;
export const RETURN_TO_USER_PROFILE = (() => {
    try { if (nativeSessionStorage?.getItem(RETURN_KEY) === USER_SAVE_ID) { nativeSessionStorage.removeItem(RETURN_KEY); return true; } } catch { /* private storage may be unavailable */ }
    return false;
})();
export function returnToProfileAfterUserSaveSwitch(id: string): void {
    try { nativeSessionStorage?.setItem(RETURN_KEY, id); } catch { /* the save itself remains valid */ }
}
export function scopedDatabaseName(name: string, id = USER_SAVE_ID): string {
    return id === DEFAULT_USER_SAVE ? name : `${name}__user_${id}`;
}

/** Settings and decoration are shared; all unknown keys default to isolated.
 * In particular, waterlines, drafts, relationships, pending replies and remote
 * service identities must never fall back to another save's values. */
const SHARED_PREFERENCES = new Set([
        'os_theme', 'acnh_wallpaper_backup', 'os_api_config', 'os_api_presets', 'os_available_models',
        'os_memory_palace_config', 'study_api_config', 'study_tutor_presets',
        'chat_archive_prompts', 'chat_active_archive_prompt_id', 'character_refine_prompts',
        'character_active_refine_prompt_id', 'browser_brave_key', 'browser_use_real_search',
        'schedule_app_theme', 'tama_accent_hue', 'sully_chrome_css_presets_v1',
        'sully-beauty-author-defaults-v1', 'sully-call-theme-v1',
        'companion_frame_style_v1', 'companion_layout_v1', 'mg_style_v1',
        'sully_story_theater_appearance_v1', 'sully.home.photo-look-library.v1',
        'sully-home3d-room-scope', 'sully-home3d-wall-view', 'sully-home3d-view-mode',
        'sully-home3d-light-finish', 'sully-home3d-light-mode', 'sully-home3d-quality',
        'sully-home3d-furniture-outline', 'sully-home3d-furniture-style',
        'sullyos_disclaimer_accepted', 'os_first_use_memory_guide_v1', 'os_first_use_skip_vector_v1',
        // Phone-wide settings must survive a change of roleplay identity.
        'os_realtime_config', 'os_cloud_backup_config', 'os_remote_vector_config',
        'os_vision_available_models', 'os_analytics', 'push_vapid_v1',
        'sully_image_api_v1', 'sully_image_presets_v1', 'sully_proxy_worker_url_v1',
        'aetheros.mcp.servers', 'aetheros.mcp.useNativeTools',
        'aetheros.mcd.mcpToken', 'aetheros.mcd.mcpEnabled',
        'aetheros.luckin.mcpToken', 'aetheros.luckin.mcpEnabled',
        'sullyos_backup_reminder', 'sully-chat-input-preferences-v1',
        'handbook_lifestream_depth', 'groupchat_context_limit', 'bm25_mode',
        'chat_translate_source_lang', 'chat_translate_lang',
        'sullyos_chat_wardrobe_update_v2_seen', 'sullyos_chat_wardrobe_guide_v2_done',
    ]);
export function isSharedPreference(key: string): boolean {
    return SHARED_PREFERENCES.has(key) ||
        /^(sully[-_]beauty[-_]|sully[-_]decoration[-_]|sully[-_]appearance[-_]|sully_character_phone_appearance_v1:)/.test(key) ||
        /^chat_translate_(?:enabled_|expanded_|source_lang_|lang_)[^:]+$/.test(key);
}
const STORAGE_PREFIX = 'sully:save-data:';
/** Static iframe editors must use the same physical keys as the host facade. */
export function userSaveStoragePrefix(id = USER_SAVE_ID): string {
    return id === DEFAULT_USER_SAVE ? '' : `${STORAGE_PREFIX}${id}:`;
}
/** Retire obsolete per-identity copies after a shared setting has a durable
 * global value. Otherwise an old credential can reappear after "clear"/"remove". */
function retireLegacySharedCopies(raw: Storage, key: string): void {
    const suffix = ':' + key;
    const shadowKeys: string[] = [];
    for (let i = 0; i < raw.length; i++) {
        const physical = raw.key(i);
        if (physical?.startsWith(STORAGE_PREFIX) && physical.endsWith(suffix) &&
            /^(original|[a-f0-9-]{36})$/.test(physical.slice(STORAGE_PREFIX.length, -suffix.length)))
            shadowKeys.push(physical);
    }
    for (const shadow of shadowKeys) raw.removeItem(shadow);
}
/** Older releases stored settings under identity-specific keys. Promote only
 * audited shared keys; never overwrite a newer global choice. */
export function promoteSharedPreferences(raw: Storage, id = USER_SAVE_ID): void {
    const prefix = userSaveStoragePrefix(id);
    if (!prefix) return;
    const oldKeys: string[] = [];
    for (let i = 0; i < raw.length; i++) {
        const physical = raw.key(i);
        if (physical?.startsWith(prefix) && isSharedPreference(physical.slice(prefix.length)))
            oldKeys.push(physical);
    }
    for (const physical of oldKeys) {
        const key = physical.slice(prefix.length);
        const old = raw.getItem(physical);
        if (old === null) continue;
        try {
            if (raw.getItem(key) === null) raw.setItem(key, old);
            // Only discard the shadow after a readable global value is present.
            if (raw.getItem(key) !== null) raw.removeItem(physical);
        } catch { /* Keep the source copy readable if migration cannot commit. */ }
    }
}
export function createSaveStorage(raw: Storage, id: string, shared = true): Storage {
    const prefix = `${STORAGE_PREFIX}${id}:`;
    const map = (key: string) => shared && isSharedPreference(key) ? key : userSaveStoragePrefix(id) + key;
    const keys = () => {
        const result = new Set<string>();
        for (let i = 0; i < raw.length; i++) {
            const key = raw.key(i)!;
            if (isUserSaveIndexKey(key)) continue;
            if (shared && isSharedPreference(key)) result.add(key);
            else if (id === DEFAULT_USER_SAVE && !key.startsWith(STORAGE_PREFIX)) result.add(key);
            else if (id !== DEFAULT_USER_SAVE && key.startsWith(prefix)) {
                const logical = key.slice(prefix.length);
                if (logical && (!shared || !isSharedPreference(logical) || raw.getItem(logical) === null))
                    result.add(logical);
            }
        }
        return [...result];
    };
    const api: Storage = {
        get length() { return keys().length; },
        key: index => keys()[index] ?? null,
        getItem: key => {
            const logical = String(key);
            if (isUserSaveIndexKey(logical)) return null;
            const value = raw.getItem(map(logical));
            // A full store cannot migrate immediately; do not hide its old setting.
            return value ?? (shared && id !== DEFAULT_USER_SAVE && isSharedPreference(logical)
                ? raw.getItem(prefix + logical) : null);
        },
        setItem: (key, value) => {
            const logical = String(key);
            if (isUserSaveIndexKey(logical)) return;
            raw.setItem(map(logical), String(value));
            if (shared && isSharedPreference(logical)) retireLegacySharedCopies(raw, logical);
        },
        removeItem: key => {
            const logical = String(key);
            if (isUserSaveIndexKey(logical)) return;
            raw.removeItem(map(logical));
            if (shared && isSharedPreference(logical)) retireLegacySharedCopies(raw, logical);
        },
        // Clearing one identity must not reset shared phone settings.
        clear: () => {
            for (const key of keys()) {
                if (shared && isSharedPreference(key)) continue;
                raw.removeItem(map(key));
            }
        },
    };
    // Support the few legacy property/enumeration callers as well as Storage methods.
    return new Proxy(api, {
        get: (target, key) => typeof key !== 'string' || key in target ? Reflect.get(target, key) : target.getItem(key) ?? undefined,
        set: (target, key, value) => { target.setItem(String(key), value); return true; },
        deleteProperty: (target, key) => { target.removeItem(String(key)); return true; },
        ownKeys: () => keys(),
        getOwnPropertyDescriptor: (_target, key) => typeof key === 'string' && keys().includes(key)
            ? { configurable: true, enumerable: true, writable: true, value: api.getItem(key) } : undefined,
    });
}
export function installUserSaveStorage(): void {
    if (typeof window === 'undefined') return;
    if (nativeLocalStorage) {
        promoteSharedPreferences(nativeLocalStorage, USER_SAVE_ID);
        Object.defineProperty(window, 'localStorage', { configurable: true, value: createSaveStorage(nativeLocalStorage, USER_SAVE_ID) });
    }
    const rawSession = window.sessionStorage;
    Object.defineProperty(window, 'sessionStorage', { configurable: true, value: createSaveStorage(rawSession, USER_SAVE_ID, false) });
    const checkIdentity = () => { if (readUserSaves().activeId !== USER_SAVE_ID) window.location.reload(); };
    window.addEventListener('storage', event => { if (event.key === USER_SAVES_KEY) checkIdentity(); });
    // Frozen/background pages may miss storage events until they are restored.
    window.addEventListener('pageshow', checkIdentity);
    window.addEventListener('focus', checkIdentity);
}
