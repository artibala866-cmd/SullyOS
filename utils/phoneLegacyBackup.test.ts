import { describe, expect, it } from 'vitest';
import {
    collectLegacyPhoneBackup, isLegacyPhoneBackupKey, restoreLegacyPhoneBackup,
} from './phoneLegacyBackup';

function storage(initial: Record<string, string> = {}) {
    const values = new Map(Object.entries(initial));
    const store = {
        get length() { return values.size; },
        key(index: number) { return [...values.keys()][index] ?? null; },
        getItem(key: string) { return values.get(key) ?? null; },
        setItem(key: string, value: string) { values.set(key, value); },
        removeItem(key: string) { values.delete(key); },
    };
    return { store, values };
}

describe('historical CharacterPhone backup, without migration', () => {
    const npc = 'sully_character_phone_npcs_v1:char-a';
    const chat = 'sully_character_phone_wechat_v1:char-a';
    it('preserves raw message contents, stable contact IDs, user preferences and per-app state', () => {
        const raw = {
            [npc]: '[{"id":"npc-1","name":"小林","remark":"同事"}]',
            [chat]: '[{"id":"thread-1","contactId":"npc-1","messages":[{"text":"嗯"}]}]',
            'sully_character_phone_social_snapshot_v1:char-a:bilibili': '{"appId":"bilibili","items":[1]}',
            'sully_phone_content_clear_revision_v1:char-a:memos': '3',
            'sully_character_phone_dialogue_api_v1:char-a': '{"enabled":true,"model":"preferred"}',
            'sully_character_phone_wallet_v1:char-a': '{"balance":200}',
            'sully_phone_hide_private:char-a': '1',
            'sully_moment_autonomy_v1:char-a': '{"attempts":3}',
            'sully_character_phone_npcs_v1:char-ab': 'NOT_YOURS',
            'check_phone_api': '{"apiKey":"other-app"}',
        };
        const { store } = storage(raw);
        const saved = collectLegacyPhoneBackup(['char-a'], store);
        expect(saved?.[npc]).toBe(raw[npc]);
        expect(saved?.[chat]).toBe(raw[chat]);
        expect(saved?.['sully_character_phone_social_snapshot_v1:char-a:bilibili']).toBe(raw['sully_character_phone_social_snapshot_v1:char-a:bilibili']);
        expect(saved?.['sully_character_phone_wallet_v1:char-a']).toBe(raw['sully_character_phone_wallet_v1:char-a']);
        expect(saved?.['sully_phone_hide_private:char-a']).toBe('1');
        expect(saved?.['sully_moment_autonomy_v1:char-a']).toBe('{"attempts":3}');
        expect(saved?.['sully_phone_content_clear_revision_v1:char-a:memos']).toBe('3');
        expect(saved?.['sully_character_phone_npcs_v1:char-ab']).toBeUndefined();
        expect(saved?.check_phone_api).toBeUndefined();
    });
    it('requires exact Char IDs rather than matching a prefix of another ID', () => {
        expect(isLegacyPhoneBackupKey(npc, ['char-a'])).toBe(true);
        expect(isLegacyPhoneBackupKey('sully_character_phone_npcs_v1:char-ab', ['char-a'])).toBe(false);
        expect(isLegacyPhoneBackupKey('sully_character_phone_social_snapshot_v1:char-a:', ['char-a'])).toBe(false);
        expect(isLegacyPhoneBackupKey('sully_phone_content_clear_revision_v1:char-a:memos', ['char-a'])).toBe(true);
    });
    it('round-trips historical data when the destination has no phone records', () => {
        const source = storage({
            [npc]: '[{"id":"stable-npc","name":"小林"}]',
            [chat]: '[{"contactId":"stable-npc","messages":[{"text":"晚安"}]}]',
        });
        const saved = collectLegacyPhoneBackup(['char-a'], source.store);
        const target = storage();
        expect(restoreLegacyPhoneBackup(saved, ['char-a'], target.store))
            .toEqual({ restored: 2, preserved: 0, skipped: 0, failed: 0 });
        expect(collectLegacyPhoneBackup(['char-a'], target.store)).toEqual(saved);
    });
    it('preserves newer local edits and cannot revive an intentionally emptied inbox', () => {
        const current = storage({ [npc]: '[]', [chat]: '[]' });
        const report = restoreLegacyPhoneBackup({ [npc]: '[{"id":"obsolete"}]', [chat]: '[{"id":"obsolete-thread"}]' }, ['char-a'], current.store);
        expect(report).toEqual({ restored: 0, preserved: 2, skipped: 0, failed: 0 });
        expect(current.store.getItem(npc)).toBe('[]');
        expect(current.store.getItem(chat)).toBe('[]');
    });
    it('ignores orphan Char data, unknown keys, malformed values and old backups', () => {
        const target = storage();
        const report = restoreLegacyPhoneBackup({
            [npc]: '[]',
            'sully_character_phone_npcs_v1:other': '[1]',
            'os_api_config': '{"apiKey":"hijack"}',
            'sully_phone_content_clear_revision_v1:char-a': '9',
            [chat]: null,
        }, ['char-a'], target.store);
        expect(report).toEqual({ restored: 1, preserved: 0, skipped: 4, failed: 0 });
        expect(target.values.size).toBe(1);
        expect(restoreLegacyPhoneBackup(undefined, ['char-a'], target.store).restored).toBe(0);
    });
    it('reports quota failure and never removes existing data', () => {
        const target = {
            getItem: (key: string) => key === npc ? 'manual' : null,
            setItem: () => { throw new Error('QuotaExceededError'); },
        };
        expect(restoreLegacyPhoneBackup({ [npc]: 'imported', [chat]: 'imported' }, ['char-a'], target))
            .toEqual({ restored: 0, preserved: 1, skipped: 0, failed: 1 });
    });
    it('rejects a storage read failure rather than exporting a false empty success', () => {
        expect(() => collectLegacyPhoneBackup(['char-a'], {
            length: 1, key: () => npc, getItem: () => { throw new Error('read denied'); },
        })).toThrow('read denied');
    });
});
