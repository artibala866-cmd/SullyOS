import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  registered: [] as { event: string; callback: (...args: any[]) => any }[],
  failOnce: '' as string,
  permission: 'granted' as 'granted' | 'denied' | 'prompt',
  ingest: vi.fn().mockResolvedValue(null),
  register: vi.fn().mockResolvedValue(undefined),
  registerToken: vi.fn().mockResolvedValue(undefined),
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
    checkPermissions: vi.fn(async () => ({ receive: state.permission })),
    requestPermissions: vi.fn(async () => ({ receive: state.permission })),
    register: state.register,
  },
}));
vi.mock('./activeMsgClient', () => ({
  ActiveMsgClient: { registerNativePushToken: state.registerToken },
  NATIVE_PUSH_TOKEN_STORAGE_KEY: 'token',
}));
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
    state.registerToken.mockReset().mockResolvedValue(undefined);
    state.failOnce = '';
    state.permission = 'granted';
  });

  it('restores the notification body only when Worker explicitly marks it present', () => {
    const payload = decodeNativeAmsgPayload(notification);
    expect(payload?.message).toBe('你好呀');
    expect(payload?.metadata.charId).toBe('c1');
    const privateNotice = decodeNativeAmsgPayload({ ...notification, data: {
      ...notification.data, amsgHasBody: '0',
    } });
    expect(privateNotice?.message).toBe('');
    expect(privateNotice?.amsgNeedsOutboxRecovery).toBe(true);
    expect(payload?.amsgNeedsOutboxRecovery).toBeUndefined();
  });

  it('does not hijack notifications that are not AMSG2', () => {
    expect(decodeNativeAmsgPayload({ body: '普通通知', data: {} })).toBeNull();
  });

  it('retries a half-failed native registration without duplicate listeners', async () => {
    state.failOnce = 'pushNotificationReceived';
    await expect(initNativeAmsgPush()).rejects.toThrow('FCM listener not ready');
    expect(state.registered.map(x => x.event))
      .toEqual(['registration', 'registrationError']);
    // Recovery first happens while OS notification permission is denied.
    state.permission = 'denied';
    await Promise.all([initNativeAmsgPush(), initNativeAmsgPush()]);
    expect(state.registered.map(x => x.event)).toEqual([
      'registration', 'registrationError',
      'pushNotificationReceived', 'pushNotificationActionPerformed',
    ]);
    expect(state.register).not.toHaveBeenCalled();
    // User later enables the permission in Android Settings.
    state.permission = 'granted';
    await initNativeAmsgPush();
    expect(state.register).toHaveBeenCalledTimes(1);
    await initNativeAmsgPush();
    expect(state.register).toHaveBeenCalledTimes(1);
    expect(state.registered).toHaveLength(4);
  });

  it('registrationError clears apparent success and permits retry', async () => {
    const failed = state.registered.find(x => x.event === 'registrationError')!.callback;
    failed({ error: 'FCM token rejected' });
    await initNativeAmsgPush();
    expect(state.register).toHaveBeenCalledTimes(1);
    expect(state.registered).toHaveLength(4);
  });

  it('a storage quota failure does not prevent direct FCM token registration', async () => {
    const registration = state.registered.find(x => x.event === 'registration')!.callback;
    vi.stubGlobal('localStorage', {
      setItem: () => { throw new Error('storage disabled'); },
    });
    try {
      await registration({ value: 'fcm-device-token' });
      expect(state.registerToken).toHaveBeenCalledWith('fcm-device-token');
    } finally {
      vi.unstubAllGlobals();
    }
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
