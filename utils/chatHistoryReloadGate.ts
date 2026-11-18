/**
 * Keep private-chat IndexedDB reads in commit order.
 *
 * A read that started earlier may finish after a newer message was persisted.
 * Without a gate, that older snapshot replaces the React list for a frame,
 * making one or several newly added bubbles disappear and then reappear.
 *
 * No clocks or network calls are involved. This is local UI sequencing only.
 */
export class ChatHistoryReloadGate {
    private revision = 0;

    /** A newer read supersedes any earlier in-flight read. */
    begin(): number {
        return ++this.revision;
    }

    /** A direct chat-generation update supersedes all in-flight DB snapshots. */
    invalidate(): void {
        this.revision++;
    }

    /** Only the latest read is allowed to replace the visible message list. */
    isCurrent(ticket: number): boolean {
        return ticket === this.revision;
    }
}
