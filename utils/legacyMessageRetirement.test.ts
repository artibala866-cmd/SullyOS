import { beforeEach, describe, expect, it } from 'vitest';
import { DB, openDB } from './db';
import { retireLegacyAiMessages } from './legacyAiScheduledCleanup';

async function seed(store: string, value: any) {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
}
beforeEach(async () => {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['characters', 'scheduled_messages'], 'readwrite');
    tx.objectStore('characters').clear();
    tx.objectStore('scheduled_messages').clear();
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
});
describe('existing database and backup retirement', () => {
  it('removes only the retired config/queue, preserving 2.0, schedules, role data and chat history', async () => {
    const role = { id: 'legacy-role', name: '阿一', proactiveConfig: { enabled: true, intervalMinutes: 30 },
      activeMsg2Config: { enabled: true, tasks: [{ taskUuid: 'cloud-keep' }] },
      scheduleConfig: { enabled: true }, systemPrompt: '保留人设' };
    await seed('characters', role);
    await seed('scheduled_messages', { id: 'future', charId: 'legacy-role', content: '旧消息', dueAt: 9999999999999 });
    await seed('scheduled_messages', { id: 'orphan', charId: 'missing', content: '旧孤儿任务', dueAt: 1 });
    const msg = await DB.saveMessage({ charId: role.id, role: 'user', type: 'text', content: '保留聊天' });
    expect(await retireLegacyAiMessages()).toBe(2);
    expect(await DB.getLegacyScheduledMessages()).toEqual([]);
    const { proactiveConfig, ...expected } = role;
    expect(await DB.getCharacter(role.id)).toEqual(expected);
    expect((await DB.getMessagesByCharId(role.id, true)).some(m => m.id === msg)).toBe(true);
    expect(await retireLegacyAiMessages()).toBe(0);
  });
  it('ignores old backup jobs and role 1.0 config without disabling imported 2.0', async () => {
    await DB.importFullData({ characters: [{ id: 'restored', name: '恢复角色',
      proactiveConfig: { enabled: true, intervalMinutes: 30 }, activeMsg2Config: { enabled: true } }],
      scheduledMessages: [{ id: 'revive', charId: 'restored', content: '不要复活', dueAt: 1 }],
    } as any);
    expect(await DB.getLegacyScheduledMessages()).toEqual([]);
    expect(await DB.getCharacter('restored')).toMatchObject({ activeMsg2Config: { enabled: true } });
    expect(await DB.getCharacter('restored')).not.toHaveProperty('proactiveConfig');
  });
  it('never exports retired jobs/config, even before startup cleanup', async () => {
    await seed('characters', { id: 'export-role', name: '阿一', proactiveConfig: { enabled: true } });
    await seed('scheduled_messages', { id: 'export-job', charId: 'export-role', content: '旧消息', dueAt: 1 });
    const backup = await DB.exportFullData();
    expect(backup.scheduledMessages).toEqual([]);
    expect(backup.characters?.find(c => c.id === 'export-role')).not.toHaveProperty('proactiveConfig');
    // Exporting must not delete the alarm identity needed by native cleanup.
    expect(await DB.getLegacyScheduledMessages()).toHaveLength(1);
  });
  it('does not persist an old in-memory role config again after cleanup', async () => {
    await DB.saveCharacter({ id: 'stale-ui', name: '阿一', proactiveConfig: { enabled: true }, activeMsg2Config: { enabled: true } } as any);
    expect(await DB.getCharacter('stale-ui')).not.toHaveProperty('proactiveConfig');
    expect(await DB.getCharacter('stale-ui')).toMatchObject({ activeMsg2Config: { enabled: true } });
  });
});
