/**
 * In-app Meet story generation lifetime.
 *
 * A StoryTheaterSession can unmount when the user opens another page, but its
 * accepted request must remain owned by this module until its reply is written
 * to IndexedDB. Nothing here depends on a mounted React component.
 *
 * This is intentionally an in-page background task, NOT a server worker:
 * Android/browser process termination, reload and OS suspension cannot be
 * guaranteed to keep a fetch running.
 */
export type StoryGenerationPhase = 'running' | 'completed' | 'failed';

export interface StoryGenerationSnapshot {
    entryId: string;
    phase: StoryGenerationPhase;
    stage: string;
    startedAt: number;
    updatedAt: number;
    error?: string;
    unsavedReply?: UnsavedStoryReply;
}

export interface UnsavedStoryReply {
    content: string;
    fromTavern: boolean;
    commit: () => Promise<void>;
}

export class StoryReplySaveError extends Error {
    constructor(readonly reply: UnsavedStoryReply, cause: unknown) {
        const detail = cause instanceof Error ? cause.message || cause.name : String(cause);
        super(`正文已收到，本地保存失败（${detail}）`);
    }
}

export function retryUnsavedStoryReply(entryId: string): boolean {
    const reply = snapshots.get(entryId)?.unsavedReply;
    if (!reply) return false;
    return startStoryBackgroundGeneration(entryId, async reportStage => {
        reportStage('正在重试本地保存…');
        try { await reply.commit(); }
        catch (error) { throw new StoryReplySaveError(reply, error); }
    });
}

type Listener = (snapshot: StoryGenerationSnapshot) => void;

const inFlight = new Map<string, Promise<void>>();
const snapshots = new Map<string, StoryGenerationSnapshot>();
const listeners = new Map<string, Set<Listener>>();
const allListeners = new Set<Listener>();

function announce(snapshot: StoryGenerationSnapshot): void {
    snapshots.set(snapshot.entryId, snapshot);
    for (const listener of listeners.get(snapshot.entryId) || []) {
        try { listener(snapshot); } catch (error) { console.error('[StoryBackground] listener', error); }
    }
    for (const listener of allListeners) {
        try { listener(snapshot); } catch (error) { console.error('[StoryBackground] observer', error); }
    }
}

export function isStoryGenerationRunning(entryId: string): boolean {
    return inFlight.has(entryId);
}

export function getStoryGenerationSnapshot(entryId: string): StoryGenerationSnapshot | undefined {
    return snapshots.get(entryId);
}

export function subscribeStoryGeneration(entryId: string, listener: Listener): () => void {
    let set = listeners.get(entryId);
    if (!set) { set = new Set(); listeners.set(entryId, set); }
    set.add(listener);
    const initial = snapshots.get(entryId);
    if (initial) listener(initial);
    return () => {
        set!.delete(listener);
        if (set!.size === 0) listeners.delete(entryId);
    };
}

export function observeStoryGenerations(listener: Listener): () => void {
    allListeners.add(listener);
    return () => { allListeners.delete(listener); };
}

/**
 * Acquire synchronously, before React's next render. A second screen instance
 * cannot start a second billable completion for the same theater.
 *
 * The accepted task is invoked independently of the caller's component life.
 * The returned boolean is only acceptance, not generation success.
 */
export function startStoryBackgroundGeneration(
    entryId: string,
    execute: (reportStage: (stage: string) => void) => Promise<void>,
    onSettled?: () => void,
): boolean {
    if (!entryId || inFlight.has(entryId)) return false;

    const now = Date.now();
    const initial: StoryGenerationSnapshot = {
        entryId, phase: 'running', stage: '正在准备剧情请求…', startedAt: now, updatedAt: now,
        unsavedReply: snapshots.get(entryId)?.unsavedReply,
    };

    // Defer execution by one microtask so the in-flight guard is installed
    // even when execute immediately performs a synchronous operation.
    const run = () => execute(stage => {
        if (inFlight.get(entryId) !== task) return;
        announce({ ...initial, stage, updatedAt: Date.now() });
    });
    const task = Promise.resolve().then(async () => {
        const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
        if (!locks?.request) {
            await run();
            return;
        }
        await locks.request(`sullyos:story-generation:${entryId}`, { ifAvailable: true }, async lock => {
            if (!lock) throw new Error('这段剧情正在另一个标签页生成，本页未发送请求');
            await run();
        });
    });
    inFlight.set(entryId, task);
    announce(initial);

    void task.then(() => {
        announce({ ...initial, phase: 'completed', stage: '剧情已生成并保存', updatedAt: Date.now(), unsavedReply: undefined });
    }, error => {
        const reason = error instanceof Error ? error.message : String(error);
        const unsavedReply = error instanceof StoryReplySaveError ? error.reply : initial.unsavedReply;
        announce({ ...initial, phase: 'failed', stage: '剧情未完成', updatedAt: Date.now(), error: reason, unsavedReply });
        console.error('[StoryBackground] generation failed', entryId, reason);
    }).finally(() => {
        if (inFlight.get(entryId) === task) inFlight.delete(entryId);
        onSettled?.();
    });
    return true;
}
