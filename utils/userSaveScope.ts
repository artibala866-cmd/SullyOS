/** A document binds to one save for its whole lifetime. Old async work can only
 * write to that save, even while another tab changes the selected identity. */
export const USER_SAVES_KEY = 'sully:user-saves:v1';
export const DEFAULT_USER_SAVE = 'original';
export interface UserSave { id: string; name: string }
export interface UserSaveRegistry { activeId: string; saves: UserSave[] }
export const nativeLocalStorage = typeof window === 'undefined' ? undefined : window.localStorage;
export function readUserSaves(): UserSaveRegistry {
    const raw = nativeLocalStorage?.getItem(USER_SAVES_KEY);
    if (!raw) return { activeId: DEFAULT_USER_SAVE, saves: [{ id: DEFAULT_USER_SAVE, name: '原有身份' }] };
    const value = JSON.parse(raw) as UserSaveRegistry;
    if (!Array.isArray(value.saves) || !value.saves.length ||
        !value.saves.every(s => typeof s.name === 'string' && /^(original|[a-f0-9-]{36})$/.test(s.id)) ||
        new Set(value.saves.map(s => s.id)).size !== value.saves.length ||
        !value.saves.some(s => s.id === value.activeId)) throw new Error('身份存档索引无法读取，请保留本地数据后重试');
    return value;
}
// Never silently fall back to the original save if an index is corrupt.
export const USER_SAVE_ID = readUserSaves().activeId;
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
        'sullyos_disclaimer_accepted', 'os_first_use_memory_guide_v1',
    ]);
export function isSharedPreference(key: string): boolean {
    return SHARED_PREFERENCES.has(key) || /^(sully[-_]beauty[-_]|sully[-_]decoration[-_]|sully[-_]appearance[-_]|sully_character_phone_appearance_v1:)/.test(key);
}
const STORAGE_PREFIX = 'sully:save-data:';
export function createSaveStorage(raw: Storage, id: string, shared = true): Storage {
    const prefix = `${STORAGE_PREFIX}${id}:`;
    const map = (key: string) => shared && isSharedPreference(key) ? key : id === DEFAULT_USER_SAVE ? key : prefix + key;
    const keys = () => {
        const result: string[] = [];
        for (let i = 0; i < raw.length; i++) {
            const key = raw.key(i)!;
            if (key === USER_SAVES_KEY) continue;
            if (shared && isSharedPreference(key)) result.push(key);
            else if (id === DEFAULT_USER_SAVE && !key.startsWith(STORAGE_PREFIX)) result.push(key);
            else if (id !== DEFAULT_USER_SAVE && key.startsWith(prefix)) result.push(key.slice(prefix.length));
        }
        return result;
    };
    const api: Storage = {
        get length() { return keys().length; },
        key: index => keys()[index] ?? null,
        getItem: key => raw.getItem(map(String(key))),
        setItem: (key, value) => raw.setItem(map(String(key)), String(value)),
        removeItem: key => raw.removeItem(map(String(key))),
        clear: () => { for (const key of keys()) raw.removeItem(map(key)); },
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
    if (nativeLocalStorage) Object.defineProperty(window, 'localStorage', { configurable: true, value: createSaveStorage(nativeLocalStorage, USER_SAVE_ID) });
    const rawSession = window.sessionStorage;
    Object.defineProperty(window, 'sessionStorage', { configurable: true, value: createSaveStorage(rawSession, USER_SAVE_ID, false) });
    const checkIdentity = () => { if (readUserSaves().activeId !== USER_SAVE_ID) window.location.reload(); };
    window.addEventListener('storage', event => { if (event.key === USER_SAVES_KEY) checkIdentity(); });
    // Frozen/background pages may miss storage events until they are restored.
    window.addEventListener('pageshow', checkIdentity);
    window.addEventListener('focus', checkIdentity);
}
