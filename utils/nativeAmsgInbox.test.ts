import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  saveInboxMessage: vi.fn().mockResolvedValue(undefined),
  flushInboxToChat: vi.fn().mockResolvedValue([]),
}));

vi.mock('./activeMsgStore', () => ({
  ActiveMsgStore: { saveInboxMessage: mocks.saveInboxMessage },
}));
vi.mock('./activeMsgRuntime', () => ({
  flushInboxToChat: mocks.flushInboxToChat,
}));

import { ingestNativeAmsgPayload, parseNativeAmsgPayload } from './nativeAmsgInbox';

const payload = {
  messageId: 'msg-up-1',
  message: '该醒啦',
  contactName: '小明',
  timestamp: '2026-08-09T08:00:00.000Z',
  metadata: { charId: 'char-1', charName: '小明' },
};

describe('UnifiedPush and Android native AMSG durable inbox', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.saveInboxMessage.mockReset().mockResolvedValue(undefined);
    mocks.flushInboxToChat.mockReset().mockResolvedValue([]);
  });

  it('accepts objects or JSON strings, rejects arrays and malformed payloads', () => {
    expect(parseNativeAmsgPayload({ message: 'hi' })).toEqual({ message: 'hi' });
    expect(parseNativeAmsgPayload('{"message":"hi"}')).toEqual({ message: 'hi' });
    expect(parseNativeAmsgPayload('[]')).toBeNull();
    expect(parseNativeAmsgPayload(['hi'])).toBeNull();
    expect(parseNativeAmsgPayload('not-json')).toBeNull();
    expect(ingestNativeAmsgPayload({ metadata: { charId: 'char-1' }, message: 'missing ID' }))
      .resolves.toBeNull();
  });

  it('uses one durable messageId across original notification and JSON replay', async () => {
    await ingestNativeAmsgPayload(payload);
    await ingestNativeAmsgPayload(JSON.stringify(payload));
    expect(mocks.saveInboxMessage).toHaveBeenCalledTimes(1);
    expect(mocks.saveInboxMessage).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'msg-up-1', charId: 'char-1', body: '该醒啦',
      sentAt: Date.parse('2026-08-09T08:00:00.000Z'),
    }));
    // Repeated receipt can rescue a save already queued when first flush failed.
    expect(mocks.flushInboxToChat).toHaveBeenCalledTimes(2);
  });

  it('concurrent notification and notification-tap callbacks only save and flush once', async () => {
    let finish!: () => void;
    mocks.saveInboxMessage.mockImplementationOnce(() =>
      new Promise<void>(resolve => { finish = resolve; }));
    const first = ingestNativeAmsgPayload(payload);
    const second = ingestNativeAmsgPayload(JSON.stringify(payload));
    expect(mocks.saveInboxMessage).toHaveBeenCalledTimes(1);
    finish();
    await Promise.all([first, second]);
    expect(mocks.saveInboxMessage).toHaveBeenCalledTimes(1);
    expect(mocks.flushInboxToChat).toHaveBeenCalledTimes(1);
  });

  it('failed persistence does not poison dedupe; a later callback can retry', async () => {
    mocks.saveInboxMessage.mockRejectedValueOnce(new Error('IndexedDB blocked'));
    await expect(ingestNativeAmsgPayload(payload)).rejects.toThrow('IndexedDB blocked');
    await ingestNativeAmsgPayload(payload);
    expect(mocks.saveInboxMessage).toHaveBeenCalledTimes(2);
    expect(mocks.flushInboxToChat).toHaveBeenCalledTimes(1);
  });

  it('duplicate receipt retries a flush that failed after the first durable save', async () => {
    mocks.flushInboxToChat.mockRejectedValueOnce(new Error('WebView suspended'));
    await expect(ingestNativeAmsgPayload(payload)).rejects.toThrow('WebView suspended');
    await ingestNativeAmsgPayload(payload);
    expect(mocks.saveInboxMessage).toHaveBeenCalledTimes(1);
    expect(mocks.flushInboxToChat).toHaveBeenCalledTimes(2);
  });

  it('an empty native content still preserves non-chat metadata for the existing inbox dispatcher', async () => {
    await ingestNativeAmsgPayload({ ...payload, messageId: 'emotion-1',
      message: '', messageType: 'emotion_update', metadata: { charId: 'char-1', emotionRaw: '' } });
    expect(mocks.saveInboxMessage).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'emotion-1', messageType: 'emotion_update', body: '',
    }));
  });
});
