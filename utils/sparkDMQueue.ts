/** Small durable state transitions for Spark private-message send/retry. */
export type SparkDMDelivery = 'pending' | 'failed' | 'sent';
export interface SparkPrivateMessage {
    role: 'user' | 'assistant';
    content: string;
    time: number;
    id?: string;
    delivery?: SparkDMDelivery;
    replyToId?: string;
}
export type SparkDMThreads = Record<string, SparkPrivateMessage[]>;

/** Drafts are private to a stable receiver ID; never reuse input across chats. */
export function setSparkDMDraft(
    drafts: Record<string, string>, key: string, content: string,
): Record<string, string> {
    if (!key) return drafts;
    const clean = content.slice(0, 4000);
    if ((drafts[key] || '') === clean) return drafts;
    const next = { ...drafts };
    if (clean) next[key] = clean;
    else delete next[key];
    return next;
}

export function appendSparkDMUser(threads: SparkDMThreads, key: string, content: string, id: string, now: number): SparkDMThreads {
    if (!key || !content.trim() || !id || (threads[key] || []).some(item => item.id === id)) return threads;
    return { ...threads, [key]: [...(threads[key] || []), { role: 'user', content: content.trim(), time: now, id, delivery: 'pending' }] };
}

/** Merge first-time NPC greetings into the latest local thread snapshot.
 * Never overwrite messages that were sent while an AI callback was pending.
 */
export function mergeSparkIncomingDMs(
    threads: SparkDMThreads,
    incoming: readonly { key: string; name: string; content: string }[],
    now: number,
): SparkDMThreads {
    let next = threads;
    for (const item of incoming) {
        if (!item.key || !item.content.trim() || next[item.key]?.length || next[item.name]?.length) continue;
        if (next === threads) next = { ...threads };
        next[item.key] = [{ role: 'assistant', content: item.content.trim(), time: now }];
    }
    return next;
}

export function setSparkDMDelivery(threads: SparkDMThreads, key: string, id: string, delivery: SparkDMDelivery): SparkDMThreads {
    const messages = threads[key];
    if (!messages?.some(message => message.id === id && message.role === 'user' && message.delivery !== delivery)) return threads;
    return { ...threads, [key]: messages.map(message => message.id === id && message.role === 'user' ? { ...message, delivery } : message) };
}

/** After an app is restarted, no network request is still running. */
export function recoverSparkInterruptedDMs(threads: SparkDMThreads): SparkDMThreads {
    let changed = false;
    const result: SparkDMThreads = {};
    for (const [key, messages] of Object.entries(threads)) {
        result[key] = (Array.isArray(messages) ? messages : []).map(message => {
            if (message.delivery !== 'pending') return message;
            changed = true;
            return { ...message, delivery: 'failed' };
        });
    }
    return changed ? result : threads;
}

/** Capture the conversation only as far as the queued message; do not pre-read later sends. */
export function sparkDMHistoryThrough(threads: SparkDMThreads, key: string, id: string): SparkPrivateMessage[] {
    const messages = threads[key] || [];
    const end = messages.findIndex(message => message.id === id);
    if (end < 0) return [];
    // Assistant replies can arrive after later queued user messages. Include only
    // replies to messages up to this queue position, never any later user text.
    const priorIds = new Set(messages.slice(0, end + 1).map(item => item.id).filter(Boolean));
    return messages.filter((message, index) =>
        (index <= end && (message.role === 'assistant' || message.delivery !== 'failed')) ||
        (index > end && message.role === 'assistant' && !!message.replyToId && priorIds.has(message.replyToId))
    ).slice(-20);
}

export function appendSparkDMAnswer(threads: SparkDMThreads, key: string, id: string, content: string, now: number): SparkDMThreads {
    const sent = setSparkDMDelivery(threads, key, id, 'sent');
    if (sent === threads || !content.trim()) return threads;
    return { ...sent, [key]: [...sent[key], { role: 'assistant', content: content.trim(), time: now, replyToId: id }] };
}


export interface SparkQueuedDMJob {
    key: string;
    id: string;
    /** Stable receiver identity, not just a mutable display handle. */
    accountId?: string;
}

/** Batch only consecutive messages to precisely the same receiver. No cross-character private context. */
export function takeSparkDMJobBatch<T extends SparkQueuedDMJob>(
    queued: T[], maxSize = 6,
): { jobs: T[]; remaining: T[] } {
    if (!queued.length) return { jobs: [], remaining: queued };
    const first = queued[0];
    const countLimit = Math.max(1, Math.min(6, Math.floor(maxSize) || 1));
    let count = 0;
    for (const item of queued) {
        // Even one stable account can have a not-yet-migrated legacy name thread.
        // Do not bill one batch if its messages live under different storage keys:
        // the later user bubble would otherwise remain pending forever.
        if (count >= countLimit || item.accountId !== first.accountId ||
            item.key !== first.key) break;
        count++;
    }
    return { jobs: queued.slice(0, count), remaining: queued.slice(count) };
}

/** A single AI reply acknowledges all the user's quick follow-up messages. */
export function appendSparkDMBatchAnswer(
    threads: SparkDMThreads, key: string, ids: string[], content: string, now: number,
): SparkDMThreads {
    if (!content.trim() || !ids.length) return threads;
    const messages = threads[key] || [];
    const pendingIds = new Set(ids.filter(id => messages.some(m =>
        m.role === 'user' && m.id === id && m.delivery === 'pending')));
    if (!pendingIds.size) return threads;
    const updated = messages.map(message =>
        message.role === 'user' && message.id && pendingIds.has(message.id)
            ? { ...message, delivery: 'sent' as const } : message);
    const last = ids.filter(id => pendingIds.has(id)).at(-1)!;
    return { ...threads, [key]: [...updated, {
        role: 'assistant', content: content.trim(), time: now, replyToId: last,
    }] };
}

/** For one batch prompt include all user messages through its final message. */
export function sparkDMBatchHistory(
    threads: SparkDMThreads, key: string, ids: string[],
): SparkPrivateMessage[] {
    return ids.length ? sparkDMHistoryThrough(threads, key, ids[ids.length - 1]) : [];
}

/** Reject unreadable backup data rather than silently replacing old DM history. */
export function parseSparkDMThreadSnapshot(raw: string | null): SparkDMThreads {
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid Spark DM snapshot');
    const result: SparkDMThreads = {};
    for (const [key, messages] of Object.entries(parsed)) {
        if (!key || !Array.isArray(messages)) throw new Error('Invalid Spark DM thread');
        if (messages.some(message => !message || typeof message !== 'object' ||
            (message.role !== 'user' && message.role !== 'assistant') ||
            typeof message.content !== 'string' || !Number.isFinite(message.time))) {
            throw new Error('Invalid Spark DM message');
        }
        result[key] = messages as SparkPrivateMessage[];
    }
    return result;
}

/** Preserve committed and still-local messages; prefer live delivery states by ID. */
export function mergeSparkDMThreadSnapshots(durable: SparkDMThreads, live: SparkDMThreads): SparkDMThreads {
    const merged: SparkDMThreads = {};
    for (const key of new Set([...Object.keys(durable), ...Object.keys(live)])) {
        const entries = new Map<string, SparkPrivateMessage>();
        for (const message of [...(durable[key] || []), ...(live[key] || [])]) {
            const identity = message.id ? 'id:' + message.id :
                'legacy:' + [message.role, message.time, message.content, message.replyToId || ''].join('\\u0000');
            const previous = entries.get(identity);
            // A confirmed sent message must never become retryable because an
            // older local cache says pending/failed. Otherwise reopening Spark
            // can charge AI twice for the same private message.
            entries.set(identity, previous?.role === 'user' && previous.delivery === 'sent' &&
                message.role === 'user' && message.delivery !== 'sent' ? previous : message);
        }
        merged[key] = [...entries.values()].sort((a, b) => a.time - b.time);
    }
    return merged;
}

/** Preserve the old per-account localStorage format for Spark DM drafts. */
export function parseSparkDMDrafts(raw: string | null): Record<string, string> {
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Invalid Spark DM drafts');
    }
    return Object.fromEntries(Object.entries(parsed).filter(([key, value]) =>
        !!key && typeof value === 'string' && value.length > 0));
}

export interface SparkDMDraftBackup {
    version: 1;
    updatedAt: number;
    drafts: Record<string, string>;
}

export function parseSparkDMDraftBackup(raw: string | null): SparkDMDraftBackup | null {
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Invalid Spark DM draft backup');
    }
    const snapshot = parsed as Partial<SparkDMDraftBackup>;
    if (snapshot.version !== 1 || typeof snapshot.updatedAt !== 'number' ||
        !Number.isSafeInteger(snapshot.updatedAt) || snapshot.updatedAt < 0 ||
        !snapshot.drafts || Array.isArray(snapshot.drafts)) {
        throw new Error('Invalid Spark DM draft backup');
    }
    return { version: 1, updatedAt: snapshot.updatedAt,
        drafts: parseSparkDMDrafts(JSON.stringify(snapshot.drafts)) };
}

/**
 * The newer complete snapshot wins, including cleared drafts. Apply live edits
 * made during asynchronous IndexedDB recovery last; a deleted key is a tombstone.
 */
export function mergeSparkDMDraftRecovery(
    local: Record<string, string>, localVersion: number,
    backup: SparkDMDraftBackup | null, touched: ReadonlySet<string>,
): Record<string, string> {
    const next: Record<string, string> = backup && backup.updatedAt > localVersion
        ? { ...backup.drafts } : { ...local };
    for (const key of touched) {
        if (Object.prototype.hasOwnProperty.call(local, key)) next[key] = local[key];
        else delete next[key];
    }
    return next;
}

/** A late persisted send must never erase input typed after the user tapped send. */
export function canClearSparkSentDMDraft(current: string | undefined, submitted: string): boolean {
    return current === submitted;
}
