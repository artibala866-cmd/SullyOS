import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: vi.fn(() => true) } }));
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: { getPending: vi.fn(), cancel: vi.fn() },
}));
vi.mock('./db', () => ({ DB: {
  retireLegacyProactiveConfig: vi.fn(), getLegacyScheduledMessages: vi.fn(),
  getCharacter: vi.fn(), deleteScheduledMessage: vi.fn(),
} }));
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { DB } from './db';
import { retireLegacyAiMessages } from './legacyAiScheduledCleanup';
const rows = [
  { id: 'old', charId: 'role', content: '蛋糕', dueAt: 1 },
  { id: 'identified', charId: 'deleted-role', content: '起床', notificationId: 72, dueAt: 9999999999999 },
];
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
  vi.mocked(DB.retireLegacyProactiveConfig).mockResolvedValue(undefined);
  vi.mocked(DB.getLegacyScheduledMessages).mockResolvedValue(rows as any);
  vi.mocked(DB.getCharacter).mockImplementation(async id => id === 'role'
    ? { id, name: '阿一', activeMsg2Config: { enabled: true } } as any : null);
  vi.mocked(DB.deleteScheduledMessage).mockResolvedValue(undefined);
  vi.mocked(LocalNotifications.getPending).mockResolvedValue({ notifications: [] });
  vi.mocked(LocalNotifications.cancel).mockResolvedValue(undefined as any);
});
describe('one-way retirement of 1.0', () => {
  it('cleans past/future and orphan rows even while 2.0 is enabled; preserves unrelated alarms', async () => {
    vi.mocked(LocalNotifications.getPending).mockResolvedValue({ notifications: [
      { id: 14, title: '阿一', body: '蛋糕' },
      { id: 72, title: '旧角色名', body: '起床' },
      { id: 82, title: '日程', body: '起床' },
      { id: 93, title: '阿一', body: '医生预约' },
      { id: 94, extra: { source: 'proactive-chat' } },
      { id: 95, extra: { source: 'amsg2' } },
    ] } as any);
    expect(await retireLegacyAiMessages()).toBe(2);
    expect(LocalNotifications.cancel).toHaveBeenCalledWith({ notifications: [{ id: 14 }, { id: 72 }] });
    expect(vi.mocked(DB.deleteScheduledMessage).mock.calls.flat()).toEqual(['old', 'identified']);
  });
  it('retains identities if native cancellation fails, then retries without declaring completion', async () => {
    vi.mocked(LocalNotifications.getPending).mockResolvedValue({ notifications: [{ id: 72, body: '起床' }] } as any);
    vi.mocked(LocalNotifications.cancel).mockRejectedValueOnce(new Error('native offline'));
    await expect(retireLegacyAiMessages()).rejects.toThrow('native offline');
    expect(DB.deleteScheduledMessage).not.toHaveBeenCalled();
    await retireLegacyAiMessages();
    expect(DB.deleteScheduledMessage).toHaveBeenCalledTimes(2);
  });
  it('does not erase native identities when permission/plugin access fails', async () => {
    vi.mocked(LocalNotifications.getPending).mockRejectedValueOnce(new Error('plugin unavailable'));
    await expect(retireLegacyAiMessages()).rejects.toThrow('plugin unavailable');
    expect(DB.deleteScheduledMessage).not.toHaveBeenCalled();
  });
  it('preserves ambiguous old alarms from renamed/deleted roles for a later explicit cleanup', async () => {
    vi.mocked(LocalNotifications.getPending).mockResolvedValue({ notifications: [{ id: 19, title: '别的提醒', body: '蛋糕' }] } as any);
    await expect(retireLegacyAiMessages()).rejects.toThrow('无法确认归属');
    expect(LocalNotifications.cancel).not.toHaveBeenCalled();
    expect(vi.mocked(DB.deleteScheduledMessage).mock.calls.flat()).toEqual(['identified']);
  });
  it('web cleanup has no notification permission or subscription side effects', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    expect(await retireLegacyAiMessages()).toBe(2);
    expect(LocalNotifications.getPending).not.toHaveBeenCalled();
  });
  it('coalesces concurrent startup/resume/import cleanup', async () => {
    const first = retireLegacyAiMessages();
    expect(retireLegacyAiMessages()).toBe(first);
    await first;
    expect(DB.getLegacyScheduledMessages).toHaveBeenCalledTimes(1);
  });
});
