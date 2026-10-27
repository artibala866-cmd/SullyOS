import type { SocialPost } from '../types';
import type { SparkCommunityState } from './sparkCommunity';

export type SparkTraffic = {
    impressions: number;
    reads: number;
    likes: number;
    comments: number;
    saves: number;
    followersDelta: number;
    score: number;
    evaluatedLikes: number;
    evaluatedComments: number;
    evaluatedSaves: number;
};

const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const hash = (value: string) => Array.from(value).reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0, 17);
const words = (s: string) => (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(w => w.length > 1);

/** Content/identity-aware deterministic baseline; never randomizes again on reload. */
export function evaluateSparkTraffic(post: SocialPost, followers: number, previous?: SparkTraffic): SparkTraffic {
    const body = post.title + ' ' + post.content;
    const terms = words(body);
    const unique = new Set(terms);
    const relevance = terms.length ? unique.size / terms.length : 0;
    const detail = clamp(post.content.trim().length / 260, 0, 1);
    const headline = clamp(post.title.trim().length / 22, 0, 1);
    const tags = clamp(post.tags.length / 4, 0, 1);
    const topical = /教程|分享|攻略|测评|心得|日常|推荐|教程|guide|review|tips|vlog|生活|作品|穿搭|绘画|旅行/i.test(body) ? 1 : 0;
    const quality = clamp(0.18 + detail * 0.23 + headline * 0.16 + relevance * 0.16 + topical * 0.18 + tags * 0.09, 0.12, 0.95);
    const baseline = Math.round(50 + Math.sqrt(Math.max(0, followers) + 1) * 13);
    const impressions = Math.max(previous?.impressions || 0, Math.round(baseline * (0.5 + quality * 2.4)));
    const reads = Math.max(previous?.reads || 0, Math.round(impressions * (0.12 + quality * 0.33)));
    const likes = Math.max(0, post.likes || 0);
    const comments = (post.comments || []).length;
    const saves = post.isCollected ? 1 : 0;
    const engagement = (likes + comments * 3 + saves * 2) / Math.max(1, reads);
    const score = clamp(Math.round(quality * 68 + clamp(engagement, 0, 0.35) * 90), 0, 100);
    const growth = Math.round(reads * (score / 100) * (0.008 + clamp(engagement, 0, 0.4) * 0.12));
    const unfollows = score < 40 ? Math.min(followers, Math.round(Math.sqrt(followers) * (40 - score) / 250)) : 0;
    const delta = growth - unfollows;
    return {
        impressions, reads, likes, comments, saves, followersDelta: delta, score,
        evaluatedLikes: likes, evaluatedComments: comments, evaluatedSaves: saves,
    };
}

export function sparkTrafficKey(post: SocialPost): string {
    return post.authorType === 'user' ? 'user'
        : post.authorType === 'character' && post.authorCharId ? 'char:' + post.authorCharId + ':' + post.authorName
        : 'public:' + post.authorName;
}


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
