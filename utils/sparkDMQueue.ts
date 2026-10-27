/** Small durable state transitions for Spark private-message send/retry. */
export type SparkDMDelivery = 'pending' | 'failed' | 'sent';
export interface SparkPrivateMessage {
    role: 'user' | 'assistant';
    content: string;
    time: number;
    id?: string;
    delivery?: SparkDMDelivery;
}
export type SparkDMThreads = Record<string, SparkPrivateMessage[]>;

export function appendSparkDMUser(threads: SparkDMThreads, key: string, content: string, id: string, now: number): SparkDMThreads {
    if (!key || !content.trim() || !id || (threads[key] || []).some(item => item.id === id)) return threads;
    return { ...threads, [key]: [...(threads[key] || []), { role: 'user', content: content.trim(), time: now, id, delivery: 'pending' }] };
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
    return messages.slice(0, end + 1).filter(message => message.role === 'assistant' || message.delivery !== 'failed').slice(-20);
}

export function appendSparkDMAnswer(threads: SparkDMThreads, key: string, id: string, content: string, now: number): SparkDMThreads {
    const sent = setSparkDMDelivery(threads, key, id, 'sent');
    if (sent === threads || !content.trim()) return threads;
    return { ...sent, [key]: [...sent[key], { role: 'assistant', content: content.trim(), time: now }] };
}
