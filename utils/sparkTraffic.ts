import type { SparkCommunityState } from './sparkCommunity';

export type SparkTrafficBlockReason = 'disabled' | 'daily-cap' | 'interval';

export type SparkTrafficReservation =
    | { allowed: true; state: SparkCommunityState; day: string }
    | { allowed: false; state: SparkCommunityState; reason: SparkTrafficBlockReason };

/** Use the browser's local calendar day so the daily budget matches the user's settings. */
export function getSparkTrafficLocalDay(now = Date.now()): string {
    const date = new Date(now);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
}

/**
 * Reserve budget before sending an autonomous AI request. Failed/aborted requests still
 * consume one slot because the provider may already have charged for the request.
 * The feature is opt-in and this function never enables it.
 */
export function reserveSparkTrafficRun(
    state: SparkCommunityState,
    now = Date.now(),
): SparkTrafficReservation {
    const autonomy = state.autonomy;
    if (!autonomy.enabled) return { allowed: false, reason: 'disabled', state };

    const day = getSparkTrafficLocalDay(now);
    const callsToday = autonomy.lastRunDay === day ? autonomy.callsToday : 0;
    const maxCalls = Math.max(0, Math.min(3, Math.floor(autonomy.maxCallsPerDay)));
    if (callsToday >= maxCalls) return { allowed: false, reason: 'daily-cap', state };

    const intervalMs = Math.max(1, Math.min(48, autonomy.minIntervalHours)) * 60 * 60 * 1000;
    if (autonomy.lastRunAt && now - autonomy.lastRunAt < intervalMs) {
        return { allowed: false, reason: 'interval', state };
    }

    return {
        allowed: true,
        day,
        state: {
            ...state,
            autonomy: {
                ...autonomy,
                lastRunAt: now,
                lastRunDay: day,
                callsToday: callsToday + 1,
            },
        },
    };
}
