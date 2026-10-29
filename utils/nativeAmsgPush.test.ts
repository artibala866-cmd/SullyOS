import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  registered: [] as { event: string; callback: (...args: any[]) => any }[],
  failOnce: '' as string,
  ingest: vi.fn().mockResolvedValue(null),
  register: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    createChannel: vi.fn().mockResolvedValue(undefined),
    addListener: vi.fn(async (event: string, callback: (...args: any[]) => any) => {
      if (state.failOnce === event) {
        state.failOnce = '';
        throw new Error('FCM listener not ready');
      }
      state.registered.push({ event, callback });
    }),
    checkPermissions: vi.fn().mockResolvedValue({ receive: 'granted' }),
    requestPermissions: vi.fn().mockResolvedValue({ receive: 'granted' }),
    register: state.register,
  },
}));
vi.mock('./activeMsgClient', () => ({ ActiveMsgClient: {}, NATIVE_PUSH_TOKEN_STORAGE_KEY: 'token' }));
vi.mock('./nativeAmsgInbox', () => ({
  parseNativeAmsgPayload: (raw: string) => JSON.parse(raw),
  ingestNativeAmsgPayload: state.ingest,
}));

import { decodeNativeAmsgPayload, initNativeAmsgPush } from './nativeAmsgPush';

const notification = {
  body: '你好呀',
  data: { amsgHasBody: '1', amsgPayload: JSON.stringify({
    messageId: 'm1', metadata: { charId: 'c1' },
  }) },
} as any;

describe('native AMSG2 FCM payload bridge', () => {
  beforeEach(() => {
    state.ingest.mockReset().mockResolvedValue({ charId: 'c1', messageId: 'm1' });
    state.register.mockClear();
    state.failOnce = '';
  });

  it('restores the notification body only when Worker explicitly marks it present', () => {
    const payload = decodeNativeAmsgPayload(notification);
    expect(payload?.message).toBe('你好呀');
    expect(payload?.metadata.charId).toBe('c1');
    expect(decodeNativeAmsgPayload({ ...notification, data: {
      ...notification.data, amsgHasBody: '0',
    } })?.message).toBe('');
  });

  it('does not hijack notifications that are not AMSG2', () => {
    expect(decodeNativeAmsgPayload({ body: '普通通知', data: {} })).toBeNull();
  });

  it('retries a half-failed native registration without duplicate listeners', async () => {
    state.failOnce = 'pushNotificationReceived';
    await expect(initNativeAmsgPush()).rejects.toThrow('FCM listener not ready');
    expect(state.registered.map(x => x.event))
      .toEqual(['registration', 'registrationError']);
    // Two callers racing during recovery must still install only once.
    await Promise.all([initNativeAmsgPush(), initNativeAmsgPush()]);
    expect(state.registered.map(x => x.event)).toEqual([
      'registration', 'registrationError',
      'pushNotificationReceived', 'pushNotificationActionPerformed',
    ]);
    expect(state.register).toHaveBeenCalledTimes(1);
    await initNativeAmsgPush();
    expect(state.registered).toHaveLength(4);
  });

  it('native receipt and notification tap both use the shared durable ingest', async () => {
    await initNativeAmsgPush();
    const received = state.registered.find(x => x.event === 'pushNotificationReceived')!.callback;
    const opened = state.registered.find(x => x.event === 'pushNotificationActionPerformed')!.callback;
    received(notification);
    opened({ notification });
    await vi.waitFor(() => expect(state.ingest).toHaveBeenCalledTimes(2));
    expect(state.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'm1', message: '你好呀' }), '你好呀');
  });

});
