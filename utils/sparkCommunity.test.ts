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

describe('Spark historic account registration does not re-write unchanged state', () => {
    it('keeps the highest last-active time and returns the same state on replay', async () => {
        const { ensureSparkAccount } = await import('./sparkCommunity');
        const base = createEmptySparkCommunityState();
        const first = ensureSparkAccount(base, {
            type: 'character', ownerCharId: 'role', handleId: 'alt', displayName: 'alias'
        }, () => 'unused', 200);
        const replay = ensureSparkAccount(first.state, {
            type: 'character', ownerCharId: 'role', handleId: 'alt', displayName: 'alias'
        }, () => 'unused', 100);
        expect(replay.state).toBe(first.state);
        expect(replay.account.lastActiveAt).toBe(200);
    });
});

describe('Spark private-message identity migration', () => {
    it('preserves each private chat while upgrading uniquely attributable old handles', async () => {
        const { migrateSparkDMKeys } = await import('./sparkCommunity');
        const state = createEmptySparkCommunityState();
        const first = ensureSparkAccount(state, { type: 'character', ownerCharId: 'c1', handleId: 'main', displayName: '原昵称' }, () => 'unused');
        const second = ensureSparkAccount(first.state, { type: 'stranger', displayName: '网友' }, () => 'n2');
        const records = { '原昵称': [{ role: 'user', content: '私聊A' }], '网友': [{ role: 'assistant', content: '私聊B' }], '未知用户': [{ role: 'user', content: '旧历史' }] };
        const migrated = migrateSparkDMKeys(records, second.state.accounts);
        expect(migrated[first.account.id]).toEqual(records['原昵称']);
        expect(migrated[second.account.id]).toEqual(records['网友']);
        expect(migrated['未知用户']).toEqual(records['未知用户']);
        expect(migrateSparkDMKeys(migrated, second.state.accounts)).toEqual(migrated);
    });

    it('never merges two owners of a handle or replaces an existing ID thread', async () => {
        const { migrateSparkDMKeys, resolveSparkDMAccount } = await import('./sparkCommunity');
        const state = createEmptySparkCommunityState();
        const first = ensureSparkAccount(state, { type: 'character', ownerCharId: 'c1', handleId: 'main', displayName: '重名' }, () => 'unused');
        const second = ensureSparkAccount(first.state, { type: 'character', ownerCharId: 'c2', handleId: 'main', displayName: '重名' }, () => 'unused');
        const input = { '重名': ['无法归属'], [first.account.id]: ['主号已有会话'] };
        const migrated = migrateSparkDMKeys(input, second.state.accounts);
        expect(migrated).toEqual(input);
        expect(resolveSparkDMAccount(second.state.accounts, '重名')).toBeUndefined();
        expect(resolveSparkDMAccount(second.state.accounts, '重名', second.account.id)?.id).toBe(second.account.id);
    });
});

describe('Spark legacy notification migration', () => {
    it('copies known event notices exactly once and preserves already-read state', async () => {
        const { syncSparkLegacyNotices } = await import('./sparkCommunity');
        const empty = createEmptySparkCommunityState();
        const legacy = [{ id: 'comment:c1', kind: 'comments' as const, actor: '网友A', content: '你画得很细', postId: 'p1', time: 120, read: false }];
        const first = syncSparkLegacyNotices(empty, legacy);
        expect(first.notifications).toHaveLength(1);
        expect(first.notifications[0]).toMatchObject({ id: 'comment:c1', type: 'comment', postId: 'p1', targetAccountId: 'user' });
        expect(syncSparkLegacyNotices(first, legacy)).toBe(first);
        const read = syncSparkLegacyNotices(first, [{ ...legacy[0], read: true }]);
        expect(read.notifications).toHaveLength(1);
        expect(read.notifications[0].readAt).toBeDefined();
        expect(syncSparkLegacyNotices(read, [{ ...legacy[0], read: true }])).toBe(read);
    });

    it('does not invent a follower account from an ambiguous legacy nickname', async () => {
        const { syncSparkLegacyNotices } = await import('./sparkCommunity');
        const notice = [{ id: 'follows:abc', kind: 'follows' as const, actor: '同名', content: '关注了你', time: 5, read: false }];
        const result = syncSparkLegacyNotices(createEmptySparkCommunityState(), notice);
        expect(result.follows).toHaveLength(0);
        expect(result.notifications[0].actorAccountId).toContain('legacy-handle:');
    });
});

describe('Spark explicit private-message account ID selection', () => {
    it('never shows ambiguous shared-name history as either account\'s private thread', async () => {
        const { getSparkDMThreadKey } = await import('./sparkCommunity');
        const empty = createEmptySparkCommunityState();
        const a = ensureSparkAccount(empty, { type: 'character', ownerCharId: 'c1', handleId: 'main', displayName: '同名' }, () => 'x');
        const b = ensureSparkAccount(a.state, { type: 'character', ownerCharId: 'c2', handleId: 'main', displayName: '同名' }, () => 'x');
        const old = { '同名': ['无法明确归属的历史私信'] };
        expect(getSparkDMThreadKey(a.account.id, '同名', old, b.state.accounts)).toBe(a.account.id);
        expect(getSparkDMThreadKey(b.account.id, '同名', old, b.state.accounts)).toBe(b.account.id);
        expect(old['同名']).toHaveLength(1);
    });

    it('continues a uniquely owned legacy conversation before migration finishes', async () => {
        const { getSparkDMThreadKey } = await import('./sparkCommunity');
        const first = ensureSparkAccount(createEmptySparkCommunityState(),
            { type: 'stranger', displayName: '老朋友' }, () => 'npc1');
        expect(getSparkDMThreadKey(first.account.id, '老朋友', { '老朋友': ['你好'] }, first.state.accounts)).toBe('老朋友');
        expect(getSparkDMThreadKey(first.account.id, '老朋友', { [first.account.id]: ['你好'] }, first.state.accounts)).toBe(first.account.id);
    });
});

describe('Spark renamed account history', () => {
    it('prefers configured current handle for an old post and comment', async () => {
        const { getSparkCanonicalAccountName } = await import('./sparkCommunity');
        const old = '马甲旧名', handleId = 'alt';
        const configured = [{ id: 'alt', handle: '马甲新名' }];
        expect(getSparkCanonicalAccountName(old, 'character:c1:handle:alt', handleId, configured, [])).toBe('马甲新名');
        expect(getSparkCanonicalAccountName(old, undefined, handleId, [], [])).toBe(old);
    });
    it('preserves a renamed stranger using the same account ID', async () => {
        const { getSparkCanonicalAccountName } = await import('./sparkCommunity');
        const account = ensureSparkAccount(createEmptySparkCommunityState(),
            { type: 'stranger', displayName: '新名字' }, () => 'id-1').account;
        expect(getSparkCanonicalAccountName('旧名字', account.id, undefined, [], [account])).toBe('新名字');
    });
});

describe('Spark read-post recommendation consistency', () => {
    it('persists a seen post only once without overwriting other account state', async () => {
        const { markSparkPostSeen } = await import('./sparkCommunity');
        const first = markSparkPostSeen(createEmptySparkCommunityState(), 'post-1');
        expect(first.seenPostIds).toEqual(['post-1']);
        expect(markSparkPostSeen(first, 'post-1')).toBe(first);
        expect(markSparkPostSeen(first, 'post-2').seenPostIds).toEqual(['post-1', 'post-2']);
    });
});

describe('Spark NPC autonomous engagement bookkeeping', () => {
    it('increments likes only once for a stable actor, retaining the existing total', async () => {
        const { applySparkNpcLike } = await import('./sparkCommunity');
        const actor = ensureSparkAccount(createEmptySparkCommunityState(),
            { type: 'stranger', displayName: '真实网友' }, () => 'npc1');
        const note = post('user-note', { authorType: 'user', authorId: 'user', likes: 12, likedByAccountIds: [] });
        const once = applySparkNpcLike(actor.state, note, actor.account.id, 101);
        expect(once.changed).toBe(true);
        expect(once.post.likes).toBe(13);
        expect(once.post.likedByAccountIds).toEqual([actor.account.id]);
        expect(once.state.events.filter(e => e.type === 'post_liked')).toHaveLength(1);
        const repeated = applySparkNpcLike(once.state, once.post, actor.account.id, 102);
        expect(repeated.changed).toBe(false);
        expect(repeated.post.likes).toBe(13);
    });
    it('follows and unfollows precisely once, without inventing follower identities', async () => {
        const { applySparkNpcFollow } = await import('./sparkCommunity');
        const actor = ensureSparkAccount(createEmptySparkCommunityState(),
            { type: 'stranger', displayName: '真实网友' }, () => 'npc2');
        const follow = applySparkNpcFollow(actor.state, actor.account.id, 'user', 'follow', 100);
        expect(follow.changed).toBe(true);
        expect(follow.state.follows).toMatchObject([{ followerId: actor.account.id, followedId: 'user' }]);
        expect(applySparkNpcFollow(follow.state, actor.account.id, 'user', 'follow', 101).changed).toBe(false);
        const leave = applySparkNpcFollow(follow.state, actor.account.id, 'user', 'unfollow', 102);
        expect(leave.changed).toBe(true);
        expect(leave.state.follows).toHaveLength(0);
        expect(applySparkNpcFollow(leave.state, actor.account.id, 'user', 'unfollow', 103).changed).toBe(false);
    });
    it('rejects non-existent actors, self likes and muted actors', async () => {
        const { applySparkNpcLike, applySparkNpcFollow } = await import('./sparkCommunity');
        const actor = ensureSparkAccount(createEmptySparkCommunityState(),
            { type: 'stranger', displayName: '路人' }, () => 'npc3');
        const note = post('public', { authorId: actor.account.id, likes: 4 });
        expect(applySparkNpcLike(actor.state, note, actor.account.id, 42).changed).toBe(false);
        expect(applySparkNpcLike(actor.state, note, 'nonexistent', 42).changed).toBe(false);
        const muted = { ...actor.state, mutedAccountIds: [actor.account.id] };
        expect(applySparkNpcFollow(muted, actor.account.id, 'user', 'follow', 42).changed).toBe(false);
    });
});
