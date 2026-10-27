import { describe, expect, it } from 'vitest';
import type { SocialComment, SocialPost } from '../types';
import {
    addSparkNotification,
    createEmptySparkCommunityState,
    deriveSparkProfileStats,
    ensureSparkAccount,
    mergeSparkCommunityStates,
    markSparkNotificationsRead,
    normalizeSparkCommunityState,
    normalizeSparkPost,
    rankSparkFeed,
    setSparkAccountMuted,
    setSparkPostHidden,
    toggleSparkFollow,
    toggleSparkInterest,
} from './sparkCommunity';

const post = (id: string, overrides: Partial<SocialPost> = {}): SocialPost => ({
    id,
    authorName: 'author-' + id,
    authorAvatar: '',
    title: 'title-' + id,
    content: 'content-' + id,
    images: ['✨'],
    likes: 0,
    isCollected: false,
    isLiked: false,
    comments: [],
    timestamp: 1_000,
    tags: [],
    ...overrides,
});

const comment = (id: string, overrides: Partial<SocialComment> = {}): SocialComment => ({
    id,
    authorName: 'commenter-' + id,
    content: 'comment-' + id,
    likes: 0,
    ...overrides,
});

describe('Spark persistent community state', () => {
    it('normalizes malformed or legacy state without throwing away valid defaults', () => {
        const state = normalizeSparkCommunityState({
            accounts: [{ id: 'stranger:1', type: 'stranger', displayName: 'Momo' }, { id: '', type: 'bad', displayName: '' }],
            follows: [{ followerId: 'user', followedId: 'user' }, { followerId: 'user', followedId: 'stranger:1' }],
            autonomy: { enabled: true, maxCallsPerDay: 99, minIntervalHours: 0, callsToday: 9 },
        });
        expect(state.accounts.some(account => account.id === 'user')).toBe(true);
        expect(state.accounts.some(account => account.id === 'stranger:1')).toBe(true);
        expect(state.follows).toHaveLength(1);
        expect(state.autonomy).toMatchObject({ enabled: true, maxCallsPerDay: 3, minIntervalHours: 1, callsToday: 3 });
    });

    it('assigns stable internal IDs to strangers and keeps aliases when a display name changes', () => {
        const first = ensureSparkAccount(createEmptySparkCommunityState(), {
            type: 'stranger', displayName: 'Momo', avatar: 'avatar-a',
        }, () => 'generated-1', 10);
        const repeated = ensureSparkAccount(first.state, {
            type: 'stranger', displayName: 'Momo', avatar: 'avatar-b',
        }, () => 'generated-2', 20);
        expect(repeated.account.id).toBe(first.account.id);
        const renamed = ensureSparkAccount(repeated.state, {
            id: repeated.account.id, type: 'stranger', displayName: 'Momo的新名字',
        }, () => 'generated-3', 30);
        expect(renamed.account.id).toBe(first.account.id);
        expect(renamed.account.aliases).toContain('Momo');
    });

    it('gives a character main account and each configured alt account distinct stable IDs', () => {
        const empty = createEmptySparkCommunityState();
        const main = ensureSparkAccount(empty, {
            type: 'character', ownerCharId: 'char-1', handleId: 'main', displayName: '本名',
        }, () => 'unused', 10);
        const alt = ensureSparkAccount(main.state, {
            type: 'character', ownerCharId: 'char-1', handleId: 'alt-1', displayName: '小号',
        }, () => 'unused', 20);
        expect(main.account.id).toBe('character:char-1:handle:main');
        expect(alt.account.id).toBe('character:char-1:handle:alt-1');
        expect(alt.account.id).not.toBe(main.account.id);
    });

    it('rebuilds old generated counters from recorded actors rather than retaining random numbers', () => {
        const legacy = post('legacy', {
            authorType: 'stranger',
            likes: 12_345,
            comments: [comment('c1', { likes: 999 })],
        });
        const normalized = normalizeSparkPost(legacy);
        expect(normalized.likes).toBe(0);
        expect(normalized.comments[0].likes).toBe(0);
        expect(normalized.source).toBe('legacy');
        const actual = normalizeSparkPost(post('actual', {
            authorType: 'user',
            isLiked: true,
            likes: 400,
            likedByAccountIds: ['user', 'character:char-1:handle:main'],
            collectedByAccountIds: ['stranger:1'],
        }));
        expect(actual.likes).toBe(2);
        expect(actual.comments).toEqual([]);
        expect(actual.collectedByAccountIds).toEqual(['stranger:1']);
    });

    it('migrates legacy collection flags into the canonical actor list', () => {
        const legacyCollected = normalizeSparkPost(post('legacy-collected', {
            authorType: 'user',
            isCollected: true,
        }));
        expect(legacyCollected.isCollected).toBe(true);
        expect(legacyCollected.collectedByAccountIds).toEqual(['user']);

        const actorListCollected = normalizeSparkPost(post('actor-list-collected', {
            authorType: 'user',
            isCollected: false,
            collectedByAccountIds: ['user'],
        }));
        expect(actorListCollected.isCollected).toBe(true);
    });

    it('preserves un-follow, unhide, unmute and topic-unfollow actions during state merge', () => {
        const empty = createEmptySparkCommunityState();
        const followed = toggleSparkFollow(empty, 'user', 'stranger:1', 10, 'follow-on').state;
        const hidden = setSparkPostHidden(followed, 'post-1', 'user', true, 11, 'hide-on');
        const muted = setSparkAccountMuted(hidden, 'stranger:1', 'user', true, 12, 'mute-on');
        const interested = toggleSparkInterest(muted, 'art', 13, 'interest-on').state;

        const unfollowed = toggleSparkFollow(interested, 'user', 'stranger:1', 20, 'follow-off').state;
        const unhidden = setSparkPostHidden(unfollowed, 'post-1', 'user', false, 21, 'hide-off');
        const unmuted = setSparkAccountMuted(unhidden, 'stranger:1', 'user', false, 22, 'mute-off');
        const noInterest = toggleSparkInterest(unmuted, 'art', 23, 'interest-off').state;
        const live = {
            ...noInterest,
            autonomy: { ...noInterest.autonomy, enabled: true, lastRunAt: 23, lastRunDay: '2026-10-27', callsToday: 1 },
        };

        const merged = mergeSparkCommunityStates(interested, live, true);
        expect(merged.follows).toEqual([]);
        expect(merged.hiddenPostIds).not.toContain('post-1');
        expect(merged.mutedAccountIds).not.toContain('stranger:1');
        expect(merged.interests).not.toContain('art');
        expect(merged.autonomy).toMatchObject({ enabled: true, callsToday: 1 });
    });

    it('records follow and unfollow as real relationship events and derives profile counts', () => {
        const state = createEmptySparkCommunityState();
        const followed = toggleSparkFollow(state, 'user', 'character:c1:handle:main', 100, 'event-1');
        expect(followed.action).toBe('follow');
        expect(followed.state.follows).toHaveLength(1);
        expect(followed.state.events[0].type).toBe('followed');
        const stats = deriveSparkProfileStats([
            post('mine', { authorType: 'user', authorId: 'user', likedByAccountIds: ['stranger:1'], collectedByAccountIds: ['character:c1:handle:main'] }),
        ], followed.state, 'my name');
        expect(stats).toEqual({ following: 1, followers: 0, likesAndCollections: 2 });
        const unfollowed = toggleSparkFollow(followed.state, 'user', 'character:c1:handle:main', 200, 'event-2');
        expect(unfollowed.action).toBe('unfollow');
        expect(unfollowed.state.follows).toHaveLength(0);
        expect(unfollowed.state.events.map(event => event.type)).toEqual(['followed', 'unfollowed']);
    });

    it('stores notifications idempotently and marks unread items without changing their creation time', () => {
        const state = createEmptySparkCommunityState();
        const notification = {
            id: 'notification-1',
            type: 'reply' as const,
            actorAccountId: 'character:c1:handle:main',
            targetAccountId: 'user',
            postId: 'p1',
            commentId: 'c1',
            message: '有人回复了你',
            createdAt: 100,
        };
        const added = addSparkNotification(state, notification);
        expect(addSparkNotification(added, notification).notifications).toHaveLength(1);
        const read = markSparkNotificationsRead(added, 250);
        expect(read.notifications[0]).toMatchObject({ createdAt: 100, readAt: 250 });
        expect(markSparkNotificationsRead(read, 300)).toBe(read);
    });

    it('preserves a character-chat target on autonomous private-message notifications', () => {
        const state = createEmptySparkCommunityState();
        const message = {
            id: 'dm-notification',
            type: 'message' as const,
            actorAccountId: 'character:c1:handle:main',
            targetAccountId: 'user',
            message: '@阿青 给你发来一条私信',
            createdAt: 200,
            metadata: { charId: 'c1' },
        };
        const normalized = normalizeSparkCommunityState({
            ...state,
            notifications: [message],
            events: [{
                id: 'dm-event',
                type: 'dm_sent',
                actorAccountId: 'character:c1:handle:main',
                targetAccountId: 'user',
                createdAt: 200,
                metadata: { characterId: 'c1' },
            }],
        });
        expect(normalized.notifications[0]).toMatchObject({ type: 'message', metadata: { charId: 'c1' } });
        expect(normalized.events[0]).toMatchObject({ type: 'dm_sent', metadata: { characterId: 'c1' } });
    });

    it('keeps following, search, topic, hidden-post and muted-account filters distinct', () => {
        const now = 100_000_000;
        const state = createEmptySparkCommunityState();
        const followed = toggleSparkFollow(state, 'user', 'character:c1:handle:main', now, 'follow-1').state;
        const hidden = setSparkPostHidden(followed, 'hidden', 'user', true, now, 'hidden-1');
        const muted = setSparkAccountMuted(hidden, 'stranger:muted', 'user', true, now, 'muted-1');
        const posts = [
            post('followed-new', { authorId: 'character:c1:handle:main', authorType: 'character', title: 'Watercolor tips', tags: ['art'], timestamp: now - 1000 }),
            post('unfollowed', { authorId: 'stranger:other', authorType: 'stranger', title: 'Watercolor tips', tags: ['art'], timestamp: now - 1000 }),
            post('hidden', { authorId: 'character:c1:handle:main', authorType: 'character', title: 'Hidden', timestamp: now - 1000 }),
            post('muted', { authorId: 'stranger:muted', authorType: 'stranger', title: 'Muted', timestamp: now - 1000 }),
        ];
        expect(rankSparkFeed(posts, muted, { mode: 'following', now }).map(item => item.id)).toEqual(['followed-new']);
        expect(rankSparkFeed(posts, muted, { query: 'watercolor', now }).map(item => item.id)).toEqual(['followed-new', 'unfollowed']);
        expect(rankSparkFeed(posts, muted, { topic: 'art', now }).map(item => item.id)).toEqual(['followed-new', 'unfollowed']);
    });
});


describe('Spark topic interests', () => {
    it('toggles a topic interest idempotently by normalized topic name', async () => {
        const { toggleSparkInterest } = await import('./sparkCommunity');
        const first = toggleSparkInterest(createEmptySparkCommunityState(), 'Watercolor', 10, 'interest-1');
        const second = toggleSparkInterest(first.state, ' watercolor ', 20, 'interest-2');
        expect(first.action).toBe('follow');
        expect(first.state.interests).toEqual(['Watercolor']);
        expect(second.action).toBe('unfollow');
        expect(second.state.interests).toEqual([]);
        expect(second.state.events.map(event => event.type)).toEqual(['interest_followed', 'interest_unfollowed']);
    });
});

describe('legacy character handle identity migration', () => {
    it('does not collapse two historical aliases into the main handle', async () => {
        const { resolveSparkCharacterHandleId } = await import('./sparkCommunity');
        expect(resolveSparkCharacterHandleId('char-1', undefined, '主号', [])).toBe('legacy-主号');
        expect(resolveSparkCharacterHandleId('char-1', undefined, '马甲', [])).toBe('legacy-马甲');
        expect(resolveSparkCharacterHandleId('char-1', undefined, '马甲', [{id:'default',handle:'主号'},{id:'alt-2',handle:'马甲'}])).toBe('alt-2');
    });

    it('retains saved handle IDs after a display name change', async () => {
        const { resolveSparkCharacterHandleId } = await import('./sparkCommunity');
        expect(resolveSparkCharacterHandleId('char-1', 'character:char-1:handle:alt-2', '新名字', [{id:'default',handle:'主号'}])).toBe('alt-2');
        expect(resolveSparkCharacterHandleId(undefined, undefined, '路人', [])).toBeUndefined();
    });
});
