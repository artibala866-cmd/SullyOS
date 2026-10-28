/**
 * Lossless backup of historical CharacterPhone localStorage, independent of
 * master CharacterProfile.phoneState. Never merges identities or migrates data.
 * Only explicitly known, Char-scoped keys are eligible; unrelated keys, cloud
 * credentials, and ephemeral request timers are not copied.
 */
const SINGLE_KEYS = [
    'sully_character_phone_npcs_v1:',
    'sully_character_phone_wechat_v1:',
    'sully_character_moments_v1:',
    'sully_character_memo_entries_v1:',
    'sully_character_phone_browser_v1:',
    'sully_character_phone_wallet_v1:',
    'sully_character_phone_pay_receipts_v1:',
    'sully_character_phone_self_v1:',
    'sully_character_phone_install_plan_v1:',
    'sully_character_phone_appearance_v1:',
    'sully_character_phone_dialogue_api_v1:',
    'sully_character_phone_inbox_prefs_v1:',
    'sully_character_phone_autonomy_v1:',
    'sully_char_phone_api_preferences_v1:',
    'sully_char_phone_api_budget_v1:',
    'sully_phone_autonomy_disabled_v1:',
    'sully_moment_interaction_preferences_v1:',
    'sully_phone_pending_contacts_v1:',
    'sully_character_life_events_v1:',
    'sully_phone_opportunity_seen_v1:',
    'sully_phone_inbox_auto_at:',
    'sully_chat_phone_event_applied_v1:',
    'sully_phone_hide_private:',
    'sully_moment_autonomy_v1:',
    'sully_character_phone_self_auto_at:',
    'sully_char_browser_autonomy_v1:',
    'sully_npc_moments_refresh_v1:',
    'sully_npc_moments_autonomy_v1:',
    'sully_moments_interactions_v1:',
] as const;

// Known nested subkeys: app IDs, content kinds. Require the colon delimiter
// so character A cannot accidentally match keys belonging to character AB.
const NESTED_KEYS = [
    'sully_character_phone_social_snapshot_v1:',
    'sully_phone_content_clear_revision_v1:',
] as const;

type PhoneBackupStorage = Pick<Storage, 'length' | 'key' | 'getItem'>;
type PhoneRestoreStorage = Pick<Storage, 'getItem' | 'setItem'>;

const charIds = (ids: readonly string[]) =>
    [...new Set(ids.filter((id): id is string => typeof id === 'string' && !!id.trim()))];

export function isLegacyPhoneBackupKey(key: string, ids: readonly string[]): boolean {
    if (!key || !ids.length) return false;
    return ids.some(id =>
        SINGLE_KEYS.some(prefix => key === prefix + id)
        || NESTED_KEYS.some(prefix => key.startsWith(prefix + id + ':')
            && key.length > (prefix + id + ':').length));
}

/**
 * Read every relevant historical Char phone value verbatim. A read failure
 * fails the export instead of quietly generating an incomplete backup.
 */
export function collectLegacyPhoneBackup(
    characterIds: readonly string[],
    storage: PhoneBackupStorage = localStorage,
): Record<string, string> | undefined {
    const ids = charIds(characterIds);
    const result: Record<string, string> = Object.create(null);
    if (!ids.length) return undefined;
    for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (!key || !isLegacyPhoneBackupKey(key, ids)) continue;
        const raw = storage.getItem(key);
        if (raw !== null) result[key] = raw;
    }
    return Object.keys(result).length ? result : undefined;
}

export type LegacyPhoneRestoreResult = {
    restored: number;
    preserved: number;
    skipped: number;
    failed: number;
};

/**
 * Restore missing values only. The device's existing manual edits, contact
 * records and privacy/autonomy switches always win over an imported snapshot.
 * Does not delete anything, infer contact identities or invoke an AI request.
 */
export function restoreLegacyPhoneBackup(
    snapshot: unknown,
    characterIds: readonly string[],
    storage: PhoneRestoreStorage = localStorage,
): LegacyPhoneRestoreResult {
    const report: LegacyPhoneRestoreResult = { restored: 0, preserved: 0, skipped: 0, failed: 0 };
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return report;
    const ids = charIds(characterIds);
    for (const [key, raw] of Object.entries(snapshot)) {
        if (typeof raw !== 'string' || !isLegacyPhoneBackupKey(key, ids)) {
            report.skipped++;
            continue;
        }
        try {
            if (storage.getItem(key) !== null) {
                report.preserved++;
                continue;
            }
            storage.setItem(key, raw);
            report.restored++;
        } catch {
            report.failed++;
        }
    }
    return report;
}
