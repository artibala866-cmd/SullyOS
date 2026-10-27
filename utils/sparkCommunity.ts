import type { SocialComment, SocialPost } from '../types';

export type SparkAccountType = 'user' | 'character' | 'stranger';

export interface SparkAccount {
    id: string;
    type: SparkAccountType;
    ownerCharId?: string;
    handleId?: string;
    displayName: string;
    aliases: string[];
    avatar?: string;
    bio?: string;
    interests: string[];
    createdAt: number;
    lastActiveAt: number;
}

export interface SparkFollow {
    followerId: string;
    followedId: string;
    createdAt: number;
}

export type SparkNotificationType = 'like' | 'comment' | 'reply' | 'follow' | 'message';

export interface SparkNotification {
    id: string;
    type: SparkNotificationType;
    actorAccountId: string;
    targetAccountId: string;
    postId?: string;
    commentId?: string;
    message: string;
    createdAt: number;
    readAt?: number;
    metadata?: Record<string, string | number | boolean | null>;
}

export type SparkEventType =
    | 'post_created' | 'comment_created'
    | 'post_liked' | 'post_unliked'
    | 'comment_liked' | 'comment_unliked'
    | 'post_collected' | 'post_uncollected'
    | 'followed' | 'unfollowed'
    | 'post_hidden' | 'post_unhidden' | 'post_deleted'
    | 'account_muted' | 'account_unmuted'
    | 'interest_followed' | 'interest_unfollowed' | 'dm_sent';

export interface SparkCommunityEvent {
    id: string;
    type: SparkEventType;
    actorAccountId: string;
    targetAccountId?: string;
    postId?: string;
    commentId?: string;
    createdAt: number;
    metadata?: Record<string, string | number | boolean | null>;
}

export interface SparkAutonomySettings {
    enabled: boolean;
    /** Minimum hours between paid autonomous generation calls. */
    minIntervalHours: number;
    /** Hard cap on autonomous generation calls per local day. */
    maxCallsPerDay: number;
    lastRunAt?: number;
    lastRunDay?: string;
    callsToday: number;
}

export interface SparkCommunityState {
    version: 1;
    accounts: SparkAccount[];
    follows: SparkFollow[];
    hiddenPostIds: string[];
    mutedAccountIds: string[];
    seenPostIds: string[];
    interests: string[];
    notifications: SparkNotification[];
    events: SparkCommunityEvent[];
    autonomy: SparkAutonomySettings;
}

const MAX_EVENTS = 500;
const MAX_NOTIFICATIONS = 200;
const MAX_SEEN_POSTS = 1000;
const uniqueStrings = (values: unknown[]): string[] =>
    [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))];

export const normalizeSparkName = (value: string): string =>
    value.normalize('NFKC').trim().toLocaleLowerCase();

/** Keep each historical character handle separate before the UI handle list finishes loading. */
export function resolveSparkCharacterHandleId(
    ownerCharId: string | undefined,
    authorId: string | undefined,
    authorName: string,
    handles: Array<{ id: string; handle: string }>,
): string | undefined {
    if (!ownerCharId) return undefined;
    const prefix = 'character:' + ownerCharId + ':handle:';
    if (authorId?.startsWith(prefix)) {
        const persisted = authorId.slice(prefix.length);
        if (persisted) return persisted;
    }
    return handles.find(item => item.handle === authorName)?.id ||
        'legacy-' + normalizeSparkName(authorName);
}


export function createEmptySparkCommunityState(): SparkCommunityState {
    return {
        version: 1,
        accounts: [{
            id: 'user',
            type: 'user',
            displayName: '',
            aliases: [],
            interests: [],
            createdAt: 0,
            lastActiveAt: 0,
        }],
        follows: [],
        hiddenPostIds: [],
        mutedAccountIds: [],
        seenPostIds: [],
        interests: [],
        notifications: [],
        events: [],
        autonomy: {
            enabled: false,
            minIntervalHours: 6,
            maxCallsPerDay: 3,
            callsToday: 0,
        },
    };
}

/** Parse legacy or malformed state without throwing away valid community records. */
export function normalizeSparkCommunityState(raw: unknown): SparkCommunityState {
    const empty = createEmptySparkCommunityState();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty;
    const value = raw as Partial<SparkCommunityState> & Record<string, any>;
    const accounts: SparkAccount[] = Array.isArray(value.accounts)
        ? value.accounts.flatMap((account: any) => {
            if (!account || typeof account.id !== 'string' || typeof account.displayName !== 'string') return [];
            if (!['user', 'character', 'stranger'].includes(account.type)) return [];
            return [{
                id: account.id,
                type: account.type as SparkAccountType,
                ...(typeof account.ownerCharId === 'string' ? { ownerCharId: account.ownerCharId } : {}),
                ...(typeof account.handleId === 'string' ? { handleId: account.handleId } : {}),
                displayName: account.displayName,
                aliases: uniqueStrings(Array.isArray(account.aliases) ? account.aliases : []),
                ...(typeof account.avatar === 'string' ? { avatar: account.avatar } : {}),
                ...(typeof account.bio === 'string' ? { bio: account.bio } : {}),
                interests: uniqueStrings(Array.isArray(account.interests) ? account.interests : []),
                createdAt: Number.isFinite(account.createdAt) ? account.createdAt : 0,
                lastActiveAt: Number.isFinite(account.lastActiveAt) ? account.lastActiveAt : 0,
            }];
        })
        : [];
    if (!accounts.some(account => account.id === 'user')) accounts.unshift(empty.accounts[0]);

    const follows: SparkFollow[] = [];
    const followKeys = new Set<string>();
    if (Array.isArray(value.follows)) {
        value.follows.forEach((follow: any) => {
            if (!follow || typeof follow.followerId !== 'string' || typeof follow.followedId !== 'string') return;
            if (follow.followerId === follow.followedId) return;
            const key = follow.followerId + '\u0000' + follow.followedId;
            if (followKeys.has(key)) return;
            followKeys.add(key);
            follows.push({
                followerId: follow.followerId,
                followedId: follow.followedId,
                createdAt: Number.isFinite(follow.createdAt) ? follow.createdAt : 0,
            });
        });
    }

    const notificationTypes: SparkNotificationType[] = ['like', 'comment', 'reply', 'follow', 'message'];
    const notifications: SparkNotification[] = Array.isArray(value.notifications)
        ? value.notifications.flatMap((item: any) => {
            if (!item || typeof item.id !== 'string' || !notificationTypes.includes(item.type)) return [];
            if (typeof item.actorAccountId !== 'string' || typeof item.targetAccountId !== 'string') return [];
            return [{
                id: item.id,
                type: item.type as SparkNotificationType,
                actorAccountId: item.actorAccountId,
                targetAccountId: item.targetAccountId,
                ...(typeof item.postId === 'string' ? { postId: item.postId } : {}),
                ...(typeof item.commentId === 'string' ? { commentId: item.commentId } : {}),
                message: typeof item.message === 'string' ? item.message : '',
                createdAt: Number.isFinite(item.createdAt) ? item.createdAt : 0,
                ...(Number.isFinite(item.readAt) ? { readAt: item.readAt } : {}),
                ...(item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata) ? { metadata: item.metadata } : {}),
            }];
        })
        : [];

    const eventTypes: SparkEventType[] = [
        'post_created', 'comment_created', 'post_liked', 'post_unliked', 'comment_liked', 'comment_unliked',
        'post_collected', 'post_uncollected', 'followed', 'unfollowed', 'post_hidden', 'post_unhidden', 'post_deleted',
        'account_muted', 'account_unmuted', 'interest_followed', 'interest_unfollowed', 'dm_sent',
    ];
    const events: SparkCommunityEvent[] = Array.isArray(value.events)
        ? value.events.flatMap((item: any) => {
            if (!item || typeof item.id !== 'string' || !eventTypes.includes(item.type)) return [];
            if (typeof item.actorAccountId !== 'string') return [];
            return [{
                id: item.id,
                type: item.type as SparkEventType,
                actorAccountId: item.actorAccountId,
                ...(typeof item.targetAccountId === 'string' ? { targetAccountId: item.targetAccountId } : {}),
                ...(typeof item.postId === 'string' ? { postId: item.postId } : {}),
                ...(typeof item.commentId === 'string' ? { commentId: item.commentId } : {}),
                createdAt: Number.isFinite(item.createdAt) ? item.createdAt : 0,
                ...(item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata) ? { metadata: item.metadata } : {}),
            }];
        })
        : [];

    const autonomy: Partial<SparkAutonomySettings> = value.autonomy && typeof value.autonomy === 'object' ? value.autonomy : {};
    const maxCalls = Number.isFinite(autonomy.maxCallsPerDay) ? Math.max(0, Math.min(3, Number(autonomy.maxCallsPerDay))) : 3;
    const interval = Number.isFinite(autonomy.minIntervalHours) ? Math.max(1, Math.min(48, Number(autonomy.minIntervalHours))) : 6;
    return {
        version: 1,
        accounts,
        follows,
        hiddenPostIds: uniqueStrings(Array.isArray(value.hiddenPostIds) ? value.hiddenPostIds : []),
        mutedAccountIds: uniqueStrings(Array.isArray(value.mutedAccountIds) ? value.mutedAccountIds : []),
        seenPostIds: uniqueStrings(Array.isArray(value.seenPostIds) ? value.seenPostIds : []).slice(-MAX_SEEN_POSTS),
        interests: uniqueStrings(Array.isArray(value.interests) ? value.interests : []),
        notifications: notifications.sort((a, b) => a.createdAt - b.createdAt).slice(-MAX_NOTIFICATIONS),
        events: events.sort((a, b) => a.createdAt - b.createdAt).slice(-MAX_EVENTS),
        autonomy: {
            enabled: autonomy.enabled === true,
            minIntervalHours: interval,
            maxCallsPerDay: maxCalls,
            ...(Number.isFinite(autonomy.lastRunAt) ? { lastRunAt: Number(autonomy.lastRunAt) } : {}),
            ...(typeof autonomy.lastRunDay === 'string' ? { lastRunDay: autonomy.lastRunDay } : {}),
            callsToday: Number.isFinite(autonomy.callsToday) ? Math.max(0, Math.min(maxCalls, Number(autonomy.callsToday))) : 0,
        },
    };
}

export function mergeSparkCommunityStates(
    base: SparkCommunityState,
    live: SparkCommunityState,
    preferLiveAutonomy = false,
): SparkCommunityState {
    const accounts = new Map<string, SparkAccount>();
    [...base.accounts, ...live.accounts].forEach(account => {
        const previous = accounts.get(account.id);
        accounts.set(account.id, previous ? {
            ...previous,
            ...account,
            aliases: uniqueStrings([...previous.aliases, ...account.aliases]),
            interests: uniqueStrings([...previous.interests, ...account.interests]),
            createdAt: Math.min(previous.createdAt, account.createdAt),
            lastActiveAt: Math.max(previous.lastActiveAt, account.lastActiveAt),
        } : account);
    });

    const notifications = new Map<string, SparkNotification>();
    [...base.notifications, ...live.notifications].forEach(item => notifications.set(item.id, item));
    const eventsById = new Map<string, SparkCommunityEvent>();
    [...base.events, ...live.events].forEach(item => eventsById.set(item.id, item));
    const events = [...eventsById.values()]
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(-MAX_EVENTS);

    // Start with both snapshots, then replay explicit relationship changes. A plain
    // union loses unfollows/unhides/unmutes when a user acts while IndexedDB is loading.
    const follows = new Map<string, SparkFollow>();
    [...base.follows, ...live.follows].forEach(follow => {
        follows.set(follow.followerId + '\\u0000' + follow.followedId, follow);
    });
    const hiddenPostIds = new Set(uniqueStrings([...base.hiddenPostIds, ...live.hiddenPostIds]));
    const mutedAccountIds = new Set(uniqueStrings([...base.mutedAccountIds, ...live.mutedAccountIds]));
    const interests = new Map<string, string>();
    [...base.interests, ...live.interests].forEach(topic => interests.set(normalizeSparkName(topic), topic));

    events.forEach(event => {
        if (event.targetAccountId) {
            const key = event.actorAccountId + '\\u0000' + event.targetAccountId;
            if (event.type === 'followed') {
                follows.set(key, {
                    followerId: event.actorAccountId,
                    followedId: event.targetAccountId,
                    createdAt: event.createdAt,
                });
            } else if (event.type === 'unfollowed') {
                follows.delete(key);
            }
        }

        if (event.postId && event.type === 'post_hidden') hiddenPostIds.add(event.postId);
        else if (event.postId && event.type === 'post_unhidden') hiddenPostIds.delete(event.postId);

        if (event.targetAccountId && event.type === 'account_muted') mutedAccountIds.add(event.targetAccountId);
        else if (event.targetAccountId && event.type === 'account_unmuted') mutedAccountIds.delete(event.targetAccountId);

        if (event.type === 'interest_followed' || event.type === 'interest_unfollowed') {
            const topic = typeof event.metadata?.topic === 'string' ? event.metadata.topic.trim() : '';
            const key = normalizeSparkName(topic);
            if (!key) return;
            if (event.type === 'interest_followed') interests.set(key, topic);
            else interests.delete(key);
        }
    });

    return normalizeSparkCommunityState({
        version: 1,
        accounts: [...accounts.values()],
        follows: [...follows.values()],
        hiddenPostIds: [...hiddenPostIds],
        mutedAccountIds: [...mutedAccountIds],
        seenPostIds: uniqueStrings([...base.seenPostIds, ...live.seenPostIds]),
        interests: [...interests.values()],
        notifications: [...notifications.values()],
        events,
        autonomy: preferLiveAutonomy ? live.autonomy : base.autonomy,
    });
}
export function ensureSparkAccount(
    state: SparkCommunityState,
    candidate: {
        id?: string;
        type: SparkAccountType;
        ownerCharId?: string;
        handleId?: string;
        displayName: string;
        avatar?: string;
        bio?: string;
        interests?: string[];
    },
    createId: () => string,
    now = Date.now(),
): { state: SparkCommunityState; account: SparkAccount } {
    const name = candidate.displayName.trim() || '未命名账号';
    const type = candidate.type;
    const existingByName = type === 'stranger'
        ? state.accounts.find(account => account.type === 'stranger' &&
            [account.displayName, ...account.aliases].some(alias => normalizeSparkName(alias) === normalizeSparkName(name)))
        : undefined;
    const id = type === 'user'
        ? 'user'
        : type === 'character' && candidate.ownerCharId
            ? 'character:' + candidate.ownerCharId + ':handle:' + (candidate.handleId || 'default')
            : candidate.id || existingByName?.id || ('stranger:' + createId());
    const existing = state.accounts.find(account => account.id === id) || existingByName;
    const account: SparkAccount = {
        id,
        type,
        ...(candidate.ownerCharId ? { ownerCharId: candidate.ownerCharId } : {}),
        ...(candidate.handleId ? { handleId: candidate.handleId } : {}),
        displayName: name,
        aliases: uniqueStrings([
            ...(existing?.aliases || []),
            ...(existing && existing.displayName !== name ? [existing.displayName] : []),
        ]).filter(alias => normalizeSparkName(alias) !== normalizeSparkName(name)),
        ...(candidate.avatar ? { avatar: candidate.avatar } : existing?.avatar ? { avatar: existing.avatar } : {}),
        ...(candidate.bio ? { bio: candidate.bio } : existing?.bio ? { bio: existing.bio } : {}),
        interests: uniqueStrings([...(existing?.interests || []), ...(candidate.interests || [])]),
        createdAt: existing?.createdAt ?? now,
        // Reading an older saved note is not a new activity; do not roll the account clock back.
        lastActiveAt: Math.max(existing?.lastActiveAt || 0, now),
    };
    if (existing && JSON.stringify(existing) === JSON.stringify(account)) {
        return { state, account: existing };
    }
    const accounts = existing
        ? state.accounts.map(item => item.id === existing.id || item.id === id ? account : item)
        : [...state.accounts, account];
    return { state: { ...state, accounts }, account };
}


/**
 * Only migrate legacy DM records keyed by handle when exactly one known account
 * owns that handle (including historical aliases). Never merge ambiguous
 * conversations or overwrite a stable-ID record.
 */
export function migrateSparkDMKeys<T>(
    saved: Record<string, T>,
    accounts: SparkAccount[],
): Record<string, T> {
    let next = saved;
    for (const [oldKey, value] of Object.entries(saved)) {
        if (accounts.some(account => account.id === oldKey)) continue;
        const matches = accounts.filter(account => account.type !== 'user' &&
            [account.displayName, ...account.aliases].some(name => normalizeSparkName(name) === normalizeSparkName(oldKey)));
        if (matches.length !== 1 || Object.prototype.hasOwnProperty.call(next, matches[0].id)) continue;
        if (next === saved) next = { ...saved };
        next[matches[0].id] = value;
        delete next[oldKey];
    }
    return next;
}

export function resolveSparkDMAccount(
    accounts: SparkAccount[],
    handle: string,
    id?: string,
): SparkAccount | undefined {
    if (id) return accounts.find(account => account.id === id && account.type !== 'user');
    const matches = accounts.filter(account => account.type !== 'user' &&
        [account.displayName, ...account.aliases].some(name => normalizeSparkName(name) === normalizeSparkName(handle)));
    return matches.length === 1 ? matches[0] : undefined;
}

export function getSparkPostAccountId(post: SocialPost, userDisplayName?: string): string | undefined {
    if (post.authorId) return post.authorId;
    if (post.authorType === 'user' || (!!userDisplayName && post.authorName === userDisplayName)) return 'user';
    if (post.authorType === 'character' && post.authorCharId) {
        return 'character:' + post.authorCharId + ':handle:legacy-' + normalizeSparkName(post.authorName);
    }
    return undefined;
}

/** Old generated counts were prompt/random values, not recorded social events. Rebuild counters from actors. */
export function normalizeSparkPost(post: SocialPost, userDisplayNames: string[] = []): SocialPost {
    const userNames = new Set(userDisplayNames.filter(Boolean).map(normalizeSparkName));
    const authorType = post.authorType || (
        userNames.has(normalizeSparkName(post.authorName)) ? 'user' : post.authorCharId ? 'character' : 'stranger'
    );
    const likedByAccountIds = uniqueStrings(Array.isArray(post.likedByAccountIds) ? post.likedByAccountIds : []);
    if (post.isLiked && !likedByAccountIds.includes('user')) likedByAccountIds.push('user');
    const collectedByAccountIds = uniqueStrings(Array.isArray(post.collectedByAccountIds) ? post.collectedByAccountIds : []);
    if (post.isCollected && !collectedByAccountIds.includes('user')) collectedByAccountIds.push('user');
    const comments: SocialComment[] = (Array.isArray(post.comments) ? post.comments : []).map((comment: any) => {
        const commentType = comment.authorType || (
            userNames.has(normalizeSparkName(String(comment.authorName || ''))) ? 'user' : comment.authorCharId ? 'character' : 'stranger'
        );
        const commentLikedBy = uniqueStrings(Array.isArray(comment.likedByAccountIds) ? comment.likedByAccountIds : []);
        if (comment.isLiked && !commentLikedBy.includes('user')) commentLikedBy.push('user');
        return {
            ...comment,
            authorType: commentType,
            ...(commentType === 'user' ? { authorId: comment.authorId || 'user' } : {}),
            likes: commentLikedBy.length,
            isLiked: commentLikedBy.includes('user'),
            likedByAccountIds: commentLikedBy,
            timestamp: Number.isFinite(comment.timestamp) ? comment.timestamp : post.timestamp,
        };
    });
    return {
        ...post,
        authorType,
        source: post.source || (authorType === 'user' ? 'user' : 'legacy'),
        ...(authorType === 'user' ? { authorId: post.authorId || 'user' } : {}),
        images: Array.isArray(post.images) ? post.images : [],
        tags: Array.isArray(post.tags) ? post.tags : [],
        comments,
        likes: likedByAccountIds.length,
        isLiked: likedByAccountIds.includes('user'),
        likedByAccountIds,
        collectedByAccountIds,
        isCollected: collectedByAccountIds.includes('user'),
    };
}

export function appendSparkEvent(state: SparkCommunityState, event: SparkCommunityEvent): SparkCommunityState {
    if (state.events.some(item => item.id === event.id)) return state;
    return { ...state, events: [...state.events, event].sort((a, b) => a.createdAt - b.createdAt).slice(-MAX_EVENTS) };
}

export function addSparkNotification(state: SparkCommunityState, notification: SparkNotification): SparkCommunityState {
    if (state.notifications.some(item => item.id === notification.id)) return state;
    return { ...state, notifications: [...state.notifications, notification].sort((a, b) => a.createdAt - b.createdAt).slice(-MAX_NOTIFICATIONS) };
}

export function markSparkNotificationsRead(state: SparkCommunityState, now = Date.now(), notificationId?: string): SparkCommunityState {
    let changed = false;
    const notifications = state.notifications.map(item => {
        if (item.readAt || (notificationId && item.id !== notificationId)) return item;
        changed = true;
        return { ...item, readAt: now };
    });
    return changed ? { ...state, notifications } : state;
}

export function toggleSparkFollow(
    state: SparkCommunityState,
    followerId: string,
    followedId: string,
    now: number,
    eventId: string,
): { state: SparkCommunityState; action: 'follow' | 'unfollow' | 'noop' } {
    if (!followerId || !followedId || followerId === followedId) return { state, action: 'noop' };
    const exists = state.follows.some(follow => follow.followerId === followerId && follow.followedId === followedId);
    const follows = exists
        ? state.follows.filter(follow => !(follow.followerId === followerId && follow.followedId === followedId))
        : [...state.follows, { followerId, followedId, createdAt: now }];
    const event: SparkCommunityEvent = {
        id: eventId,
        type: exists ? 'unfollowed' : 'followed',
        actorAccountId: followerId,
        targetAccountId: followedId,
        createdAt: now,
    };
    return { state: appendSparkEvent({ ...state, follows }, event), action: exists ? 'unfollow' : 'follow' };
}

export function setSparkPostHidden(
    state: SparkCommunityState,
    postId: string,
    actorAccountId: string,
    hidden: boolean,
    now: number,
    eventId: string,
): SparkCommunityState {
    const ids = new Set(state.hiddenPostIds);
    if (hidden) ids.add(postId);
    else ids.delete(postId);
    return appendSparkEvent({
        ...state,
        hiddenPostIds: [...ids],
    }, {
        id: eventId,
        type: hidden ? 'post_hidden' : 'post_unhidden',
        actorAccountId,
        postId,
        createdAt: now,
    });
}

export function setSparkAccountMuted(
    state: SparkCommunityState,
    accountId: string,
    actorAccountId: string,
    muted: boolean,
    now: number,
    eventId: string,
): SparkCommunityState {
    const ids = new Set(state.mutedAccountIds);
    if (muted) ids.add(accountId);
    else ids.delete(accountId);
    return appendSparkEvent({
        ...state,
        mutedAccountIds: [...ids],
    }, {
        id: eventId,
        type: muted ? 'account_muted' : 'account_unmuted',
        actorAccountId,
        targetAccountId: accountId,
        createdAt: now,
    });
}

export function markSparkPostSeen(state: SparkCommunityState, postId: string): SparkCommunityState {
    if (state.seenPostIds.includes(postId)) return state;
    return { ...state, seenPostIds: [...state.seenPostIds, postId].slice(-MAX_SEEN_POSTS) };
}

export function rankSparkFeed(
    posts: SocialPost[],
    state: SparkCommunityState,
    options: {
        mode?: 'discover' | 'following';
        query?: string;
        topic?: string | null;
        accountId?: string | null;
        now?: number;
        userDisplayName?: string;
    } = {},
): SocialPost[] {
    const now = options.now ?? Date.now();
    const query = normalizeSparkName(options.query || '');
    const topic = options.topic ? normalizeSparkName(options.topic) : '';
    const followed = new Set(state.follows.filter(follow => follow.followerId === 'user').map(follow => follow.followedId));
    const muted = new Set(state.mutedAccountIds);
    const hidden = new Set(state.hiddenPostIds);
    const interests = new Set(state.interests.map(normalizeSparkName));
    const filtered = posts.filter(post => {
        const authorId = getSparkPostAccountId(post, options.userDisplayName);
        if (hidden.has(post.id) || (authorId && muted.has(authorId))) return false;
        if (options.mode === 'following' && (!authorId || !followed.has(authorId))) return false;
        if (options.accountId && authorId !== options.accountId) return false;
        const postTopics = [...(post.tags || []), ...(post.topicIds || [])].map(normalizeSparkName);
        if (topic && !postTopics.some(item => item === topic || item.includes(topic))) return false;
        if (query) {
            const haystack = [post.title, post.content, post.authorName, ...(post.tags || []), ...(post.topicIds || [])]
                .map(value => normalizeSparkName(String(value || ''))).join(' ');
            if (!haystack.includes(query)) return false;
        }
        return true;
    });
    const authorCounts = new Map<string, number>();
    const remaining = filtered.map(post => {
        const authorId = getSparkPostAccountId(post, options.userDisplayName) || 'unknown:' + normalizeSparkName(post.authorName);
        const topics = [...(post.tags || []), ...(post.topicIds || [])].map(normalizeSparkName);
        const ageHours = Math.max(0, (now - post.timestamp) / 3600000);
        const recency = Math.max(0, 4 - ageHours / 18);
        const interestScore = topics.some(item => interests.has(item)) ? 2.5 : 0;
        const followScore = followed.has(authorId) ? 5 : 0;
        const novelty = state.seenPostIds.includes(post.id) ? 0 : 1;
        const engagement = Math.log1p(Math.max(0, post.likes || 0) + (post.comments || []).length) * 0.2;
        return { post, authorId, baseScore: recency + interestScore + followScore + novelty + engagement };
    });
    const result: SocialPost[] = [];
    while (remaining.length) {
        remaining.sort((a, b) => {
            const aScore = a.baseScore - (authorCounts.get(a.authorId) || 0) * 2;
            const bScore = b.baseScore - (authorCounts.get(b.authorId) || 0) * 2;
            return bScore - aScore || b.post.timestamp - a.post.timestamp;
        });
        const next = remaining.shift()!;
        result.push(next.post);
        authorCounts.set(next.authorId, (authorCounts.get(next.authorId) || 0) + 1);
    }
    return result;
}

export function deriveSparkProfileStats(posts: SocialPost[], state: SparkCommunityState, userDisplayName = ''): {
    following: number;
    followers: number;
    likesAndCollections: number;
} {
    const ownPosts = posts.filter(post =>
        post.authorId === 'user' || post.authorType === 'user' ||
        (!post.authorType && !!userDisplayName && post.authorName === userDisplayName)
    );
    const likesAndCollections = ownPosts.reduce((sum, post) =>
        sum + (Array.isArray(post.likedByAccountIds) ? post.likedByAccountIds.length : Math.max(0, post.likes || 0))
            + (Array.isArray(post.collectedByAccountIds) ? post.collectedByAccountIds.length : 0), 0
    );
    return {
        following: state.follows.filter(follow => follow.followerId === 'user').length,
        followers: state.follows.filter(follow => follow.followedId === 'user').length,
        likesAndCollections,
    };
}


export function toggleSparkInterest(
    state: SparkCommunityState,
    topic: string,
    now: number,
    eventId: string,
): { state: SparkCommunityState; action: 'follow' | 'unfollow' | 'noop' } {
    const value = topic.trim();
    const normalized = normalizeSparkName(value);
    if (!normalized) return { state, action: 'noop' };
    const existing = state.interests.find(item => normalizeSparkName(item) === normalized);
    const interests = existing
        ? state.interests.filter(item => normalizeSparkName(item) !== normalized)
        : [...state.interests, value];
    const next = appendSparkEvent({ ...state, interests }, {
        id: eventId,
        type: existing ? 'interest_unfollowed' : 'interest_followed',
        actorAccountId: 'user',
        createdAt: now,
        metadata: { topic: value },
    });
    return { state: next, action: existing ? 'unfollow' : 'follow' };
}
