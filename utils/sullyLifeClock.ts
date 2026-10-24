/** Shared clock: mode changes never alter chat history or memory. */
export type LifeClockState = { mode: 'real' | 'virtual'; virtualTime: number };
const KEY = 'sully_life_clock_v1';
export function readLifeClock(): LifeClockState {
    try {
        const value = JSON.parse(localStorage.getItem(KEY) || '{}');
        return { mode: value.mode === 'virtual' ? 'virtual' : 'real',
            virtualTime: Number.isFinite(value.virtualTime) ? value.virtualTime : Date.now() };
    } catch { return { mode: 'real', virtualTime: Date.now() }; }
}
export function writeLifeClock(next: LifeClockState) {
    localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new Event('sully-life-clock-change'));
}
export function getLifeTime() {
    const state = readLifeClock();
    return state.mode === 'virtual' ? state.virtualTime : Date.now();
}
export function getNaturalReplyDelay(characterId: string, now = getLifeTime()) {
    const hour = new Date(now).getHours();
    const sleepy = hour >= 23 || hour < 7;
    const busy = (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18);
    const seed = [...characterId].reduce((n, c) => Math.imul(n, 31) + c.charCodeAt(0), 7) >>> 0;
    const jitter = seed % 7000;
    return sleepy ? 90_000 + jitter : busy ? 12_000 + jitter : 2_000 + jitter;
}

/** Derive availability from an existing schedule slot, without inventing activities. */
export function classifyLifeActivity(activity: string): 'sleep' | 'busy' | 'free' {
    if (/睡|休息|午睡|梦乡|就寝|入眠|sleep|nap|bedtime/i.test(activity)) return 'sleep';
    if (/工作|上班|开会|学习|上课|考试|赶稿|忙|训练|排练|驾驶|手术|work|meeting|class|study/i.test(activity)) return 'busy';
    return 'free';
}
export function currentLifeActivity(slots: Array<{startTime: string; activity: string}>, at = getLifeTime()) {
    if (!slots.length) return null;
    const date = new Date(at);
    const minutes = date.getHours() * 60 + date.getMinutes();
    const sorted = slots.map(slot => {
        const match = /^(\d{1,2}):(\d{2})$/.exec(slot.startTime);
        return match ? { ...slot, minute: Number(match[1]) * 60 + Number(match[2]) } : null;
    }).filter((slot): slot is {startTime: string; activity: string; minute: number} => slot !== null).sort((a,b) => a.minute-b.minute);
    if (!sorted.length) return null;
    return [...sorted].reverse().find(slot => slot.minute <= minutes) || sorted[sorted.length - 1];
}
