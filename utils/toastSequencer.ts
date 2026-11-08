import type { Toast } from '../types';

/**
 * Global toast dispatcher. One visible toast at a time; distinct messages
 * wait their turn, while repeated taps cannot build a backlog of duplicates.
 *
 * The active toast remains reserved during the short disappearance gap:
 * another tap can show the same message only after the previous one is gone.
 */
export function createToastSequencer(
    publish: (visible: Toast[]) => void,
    visibleMs = 3000,
    gapMs = 180,
) {
    let active: Toast | null = null;
    const pending: Toast[] = [];
    let visibleTimer: ReturnType<typeof setTimeout> | null = null;
    let gapTimer: ReturnType<typeof setTimeout> | null = null;
    let nextId = 0;
    let disposed = false;

    const displayNext = (): void => {
        if (disposed || active || pending.length === 0) return;
        active = pending.shift()!;
        publish([active]);
        visibleTimer = setTimeout(() => {
            visibleTimer = null;
            publish([]);
            // Do not display the next toast until the old one has cleared.
            gapTimer = setTimeout(() => {
                gapTimer = null;
                active = null;
                displayNext();
            }, gapMs);
        }, visibleMs);
    };

    return {
        enqueue(message: string, type: Toast['type'] = 'info'): void {
            if (disposed || !message.trim()) return;
            if (active?.type === type && active.message === message) return;
            if (pending.some(item => item.type === type && item.message === message)) return;
            pending.push({ id: `toast-${++nextId}`, message, type });
            displayNext();
        },
        dispose(): void {
            disposed = true;
            if (visibleTimer !== null) clearTimeout(visibleTimer);
            if (gapTimer !== null) clearTimeout(gapTimer);
            pending.length = 0;
            active = null;
        },
    };
}
