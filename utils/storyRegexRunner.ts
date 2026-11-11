import { storyRegexApplies, type StoryRegexResult, type StoryRegexRule } from './storyRegex';

let worker: Worker | undefined;
let pending: Promise<unknown> = Promise.resolve();

// A user's regex can take exponential time. Run it off the UI thread and
// terminate that worker if it stalls, including when running a test sample.
export function runStoryRegex(
    texts: string[], rules: StoryRegexRule[], stage: 'display' | 'history', signal?: AbortSignal,
): Promise<StoryRegexResult[]> {
    const applicable = rules.filter(rule => storyRegexApplies(rule, stage));
    if (!applicable.length || !texts.length) {
        return Promise.resolve(texts.map(text => ({ text, cards: [], matches: 0 })));
    }
    const job = pending.then(() => new Promise<StoryRegexResult[]>((resolve, reject) => {
        if (signal?.aborted) { reject(signal.reason); return; }
        const active = worker ??= new Worker(new URL('./storyRegex.worker.ts', import.meta.url), { type: 'module' });
        const clear = () => {
            clearTimeout(timeout);
            signal?.removeEventListener('abort', abort);
            active.onmessage = null;
            active.onerror = null;
        };
        const fail = (error: unknown) => {
            clear();
            active.terminate();
            worker = undefined;
            reject(error);
        };
        const abort = () => fail(signal?.reason);
        const timeout = setTimeout(() => fail(new Error('正则处理超时，请缩小匹配范围或检查嵌套重复')), 1800);
        signal?.addEventListener('abort', abort, { once: true });
        active.onerror = () => fail(new Error('正则处理器未能启动'));
        active.onmessage = ({ data }) => {
            clear();
            if (data.error) reject(new Error(data.error));
            else resolve(data.results);
        };
        active.postMessage({ texts, rules: applicable, stage });
    }));
    pending = job.catch(() => {});
    return job;
}
