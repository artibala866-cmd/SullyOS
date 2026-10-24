// Only supported desktop visual preferences are portable.
// Retired Animal Crossing / Tamagotchi preferences and artwork must not be exported or restored.
const ACTIVE_KEYS = [
    'companion_frame_style_v1',
    'companion_layout_v1',
    'mg_style_v1',
] as const;

export async function exportDesktopSkinLocal(_includeImage = true): Promise<Record<string, string> | undefined> {
    const values: Record<string, string> = {};
    try {
        for (const key of ACTIVE_KEYS) {
            const value = localStorage.getItem(key);
            if (value !== null) values[key] = value;
        }
    } catch { /* storage may be restricted */ }
    return Object.keys(values).length > 0 ? values : undefined;
}

export async function importDesktopSkinLocal(values?: Record<string, string> | null): Promise<void> {
    if (!values) return;
    try {
        for (const key of ACTIVE_KEYS) {
            const value = values[key];
            if (typeof value === 'string') localStorage.setItem(key, value);
        }
    } catch { /* storage may be restricted */ }
}
