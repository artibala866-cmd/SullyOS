/** Live private-chat composer occupancy, adapted from the reference's composer-interruption.
 * No persisted draft may create a reply. This only defers an existing saved user turn.
 */
export const COMPOSER_ACTIVITY_CHANGED = 'sully:chat-composer-activity';
export const COMPOSER_SETTLE_MS = 2500;
export type ChatComposerActivity = { hasDraft: boolean; composing: boolean; keyboardVisible: boolean; activityAt: number };
const composers = new Map<string, ChatComposerActivity>();

export function setChatComposerActivity(charId: string, state: ChatComposerActivity | null): void {
    if (!charId) return;
    if (state) composers.set(charId, state);
    else composers.delete(charId);
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(COMPOSER_ACTIVITY_CHANGED, { detail: { charId } }));
}

export function chatComposerWaitMs(charId: string, now = Date.now()): number {
    const state = composers.get(charId);
    if (!state) return 0;
    if (state.hasDraft || state.composing || state.keyboardVisible) return Infinity;
    return Math.max(0, COMPOSER_SETTLE_MS - (now - state.activityAt));
}

/** Hold the same generated result while the user types; never pay to regenerate it. */
export async function waitForChatComposer(charId: string, signal: AbortSignal): Promise<void> {
    while (true) {
        signal.throwIfAborted();
        const delay = chatComposerWaitMs(charId);
        if (delay === 0) return;
        await new Promise<void>(resolve => {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const done = () => {
                if (timer) clearTimeout(timer);
                window.removeEventListener(COMPOSER_ACTIVITY_CHANGED, done);
                signal.removeEventListener('abort', done);
                resolve();
            };
            window.addEventListener(COMPOSER_ACTIVITY_CHANGED, done);
            signal.addEventListener('abort', done, { once: true });
            if (Number.isFinite(delay)) timer = setTimeout(done, delay);
        });
    }
}
