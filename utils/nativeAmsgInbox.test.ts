import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  saveInboxMessage: vi.fn().mockResolvedValue(undefined),
  flushInboxToChat: vi.fn().mockResolvedValue([]),
  handleInstantErrorPushMessage: vi.fn().mockResolvedValue(undefined),
  drainOutbox: vi.fn().mockResolvedValue({ written: 0, writtenIds: [], ackNow: [], entries: [], staleDropped: 0 }),
  recoverOutboxPushByMessageId: vi.fn().mockResolvedValue(true),
}));

vi.mock('./activeMsgStore', () => ({
  ActiveMsgStore: { saveInboxMessage: mocks.saveInboxMessage },
}));
vi.mock('./activeMsgRuntime', () => ({
  flushInboxToChat: mocks.flushInboxToChat,
  handleInstantErrorPushMessage: mocks.handleInstantErrorPushMessage,
}));

vi.mock('./amsgInstantChat', () => ({
  drainOutbox: mocks.drainOutbox,
  recoverOutboxPushByMessageId: mocks.recoverOutboxPushByMessageId,
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
    mocks.handleInstantErrorPushMessage.mockReset().mockResolvedValue(undefined);
    mocks.drainOutbox.mockReset().mockResolvedValue({ written: 0, writtenIds: [], ackNow: [], entries: [], staleDropped: 0 });
    mocks.recoverOutboxPushByMessageId.mockReset().mockResolvedValue(true);
  });

  it('accepts objects or JSON strings, rejects arrays and malformed payloads', async () => {
    expect(parseNativeAmsgPayload({ message: 'hi' })).toEqual({ message: 'hi' });
    expect(parseNativeAmsgPayload('{"message":"hi"}')).toEqual({ message: 'hi' });
    expect(parseNativeAmsgPayload('[]')).toBeNull();
    expect(parseNativeAmsgPayload(['hi'])).toBeNull();
    expect(parseNativeAmsgPayload('not-json')).toBeNull();
    await expect(ingestNativeAmsgPayload({ metadata: { charId: 'char-1' }, message: 'missing ID' }))
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

  it('private-body-masked FCM fetches only the announced cloud message and never stores blank text', async () => {
    const result = await ingestNativeAmsgPayload({
      ...payload, messageId: 'hidden-1', message: '', amsgNeedsOutboxRecovery: true,
    }, '你有一条新消息');
    expect(result).toEqual({ charId: 'char-1', messageId: 'hidden-1' });
    expect(mocks.recoverOutboxPushByMessageId).toHaveBeenCalledWith('hidden-1', 'char-1');
    expect(mocks.saveInboxMessage).not.toHaveBeenCalled();
    expect(mocks.flushInboxToChat).toHaveBeenCalledTimes(1);
  });

  it('cloud content not yet available does not create blank bubbles or poison later retry', async () => {
    mocks.recoverOutboxPushByMessageId.mockResolvedValue(false);
    const hidden = { ...payload, messageId: 'hidden-late', message: '', amsgNeedsOutboxRecovery: true };
    await expect(ingestNativeAmsgPayload(hidden)).resolves.toBeNull();
    await expect(ingestNativeAmsgPayload(hidden)).resolves.toBeNull();
    expect(mocks.recoverOutboxPushByMessageId).toHaveBeenCalledTimes(2);
    expect(mocks.saveInboxMessage).not.toHaveBeenCalled();
    expect(mocks.flushInboxToChat).not.toHaveBeenCalled();
  });

  it('native metadata-only multipart fields survive absent top-level aliases', async () => {
    await ingestNativeAmsgPayload({
      ...payload, messageId: 'multipart-native',
      metadata: { charId: 'char-1', sessionId: 's1', messageIndex: 2, totalMessages: 3 },
    });
    expect(mocks.saveInboxMessage).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ sessionId: 's1', messageIndex: 2, totalMessages: 3 }),
    }));
  });

  it('instant failure notification settles the pending reply instead of creating a blank bubble', async () => {
    await ingestNativeAmsgPayload({
      ...payload, messageId: 'err-1', message: '', messageKind: 'error',
      metadata: { charId: 'char-1', taskUuid: 'task-1', reason: 'timeout' },
    });
    expect(mocks.handleInstantErrorPushMessage).toHaveBeenCalledWith(expect.objectContaining({
      messageKind: 'error', messageId: 'err-1',
    }));
    expect(mocks.saveInboxMessage).not.toHaveBeenCalled();
  });

  it('background result notification is reconciled through the cloud result ledger', async () => {
    await ingestNativeAmsgPayload({
      ...payload, messageId: 'result-1', messageKind: 'result', resultKind: 'schedule-change',
    });
    expect(mocks.drainOutbox).toHaveBeenCalledTimes(1);
    expect(mocks.saveInboxMessage).not.toHaveBeenCalled();
  });

  it('unknown native control messages cannot become empty chat bubbles', async () => {
    await expect(ingestNativeAmsgPayload({
      ...payload, messageId: 'unsupported', messageKind: 'diagnostic',
    })).resolves.toBeNull();
    expect(mocks.saveInboxMessage).not.toHaveBeenCalled();
    expect(mocks.flushInboxToChat).not.toHaveBeenCalled();
  });

  it('emotion-update envelope keeps its dispatch kind even if messageType was omitted', async () => {
    await ingestNativeAmsgPayload({
      ...payload, messageId: 'emotion-kind', message: '', messageKind: 'emotion_update',
      messageType: undefined,
    });
    expect(mocks.saveInboxMessage).toHaveBeenCalledWith(expect.objectContaining({
      messageType: 'emotion_update', body: '',
    }));
  });

  it('an empty native content still preserves non-chat metadata for the existing inbox dispatcher', async () => {
    await ingestNativeAmsgPayload({ ...payload, messageId: 'emotion-1',
      message: '', messageType: 'emotion_update', metadata: { charId: 'char-1', emotionRaw: '' } });
    expect(mocks.saveInboxMessage).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'emotion-1', messageType: 'emotion_update', body: '',
    }));
  });
});
