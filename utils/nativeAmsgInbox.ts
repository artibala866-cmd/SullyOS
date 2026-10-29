import type { ActiveMsg2InboxMessage } from '../types';
import { flushInboxToChat, handleInstantErrorPushMessage } from './activeMsgRuntime';
import { ActiveMsgStore } from './activeMsgStore';

const RECEIVED_IDS_KEY = 'amsg2_native_received_ids_v2';
/** Both native notification callbacks use this one ingest path. */
const inFlight = new Map<string, Promise<{ charId: string; messageId: string } | null>>();

const readReceivedIds = (): string[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECEIVED_IDS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
};

const rememberReceivedId = (messageId: string): void => {
  try {
    const next = [messageId, ...readReceivedIds().filter(id => id !== messageId)].slice(0, 100);
    localStorage.setItem(RECEIVED_IDS_KEY, JSON.stringify(next));
  } catch {
    // A storage/quota failure cannot keep an already-persisted push from
    // reaching the inbox. The messageId is also idempotent in IndexedDB.
  }
};

export const parseNativeAmsgPayload = (raw: unknown): Record<string, any> | null => {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, any>;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, any> : null;
  } catch {
    return null;
  }
};

/** UnifiedPush and Capacitor FCM both persist through the same durable inbox.
 * A duplicate receipt still retries the flush: the first save may have
 * succeeded immediately before a WebView suspension or a failed flush.
 */
export const ingestNativeAmsgPayload = (
  raw: unknown,
  previewOverride?: string,
): Promise<{ charId: string; messageId: string } | null> => {
  const payload = parseNativeAmsgPayload(raw);
  const charId = payload?.metadata?.charId;
  // Do not manufacture a Date.now()-based ID for malformed envelopes:
  // multiple callbacks would then persist duplicate or empty chat messages.
  const messageId = typeof payload?.messageId === 'string' ? payload.messageId.trim() : '';
  if (typeof charId !== 'string' || !charId || !messageId) return Promise.resolve(null);

  const key = JSON.stringify([charId, messageId]);
  const running = inFlight.get(key);
  if (running) return running;

  const task = (async () => {
    const result = { charId, messageId };
    const kind = typeof payload?.messageKind === 'string' ? payload.messageKind : 'content';
    if (kind === 'error') {
      // An instant-chat failure is a control message, not an empty reply.
      await handleInstantErrorPushMessage(payload);
      return result;
    }
    if (kind === 'result') {
      // Cloud results are processed/acked by the existing outbox dispatcher.
      // Never insert their payload into private chat as an empty bubble.
      const { drainOutbox } = await import('./amsgInstantChat');
      await drainOutbox();
      await flushInboxToChat('原生收件箱');
      return result;
    }
    if (kind !== 'content' && kind !== 'emotion_update') return null;
    if (!readReceivedIds().includes(messageId)) {
      const parsedSentAt = payload?.timestamp ? new Date(payload.timestamp).getTime() : NaN;
      const body = String(payload?.message || '').trim();
      const inbox: ActiveMsg2InboxMessage = {
        messageId,
        charId,
        charName: String(payload?.contactName || payload?.metadata?.charName || '主动消息'),
        body,
        previewBody: String(previewOverride || payload?.previewBody || body).trim(),
        avatarUrl: payload?.avatarUrl,
        source: payload?.source,
        messageType: kind === 'emotion_update' ? 'emotion_update' : payload?.messageType,
        messageSubtype: payload?.messageSubtype,
        taskId: payload?.taskId ?? null,
        taskUuid: payload?.taskUuid ?? null,
        recurrenceType: payload?.recurrenceType ?? null,
        occurrenceMs: payload?.occurrenceMs ?? null,
        metadata: {
          ...(payload?.metadata || {}),
          sessionId: payload?.sessionId,
          messageIndex: payload?.messageIndex,
          totalMessages: payload?.totalMessages,
        },
        sentAt: Number.isFinite(parsedSentAt) ? parsedSentAt : Date.now(),
        receivedAt: Date.now(),
      };
      // Failure here must not mark the receipt as seen: a later native
      // callback should be free to retry the durable save.
      await ActiveMsgStore.saveInboxMessage(inbox);
      rememberReceivedId(messageId);
    }
    // flushInboxToChat itself degrades to [] on IDB failure. Re-attempt
    // on a duplicate receipt instead of silently stranding the saved item.
    await flushInboxToChat('原生收件箱');
    return result;
  })();

  inFlight.set(key, task);
  void task.finally(() => { if (inFlight.get(key) === task) inFlight.delete(key); }).catch(() => {});
  return task;
};
