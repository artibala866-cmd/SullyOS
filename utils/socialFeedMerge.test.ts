import { describe, expect, it } from 'vitest';
import type { SocialComment, SocialPost } from '../types';
import { canDeleteSocialPost, mergeSocialComments, prependUniqueSocialPosts, toggleSocialCommentLike, toggleSocialPostLike, toggleSocialPostCollection, uniqueGeneratedSocialComments, updateSocialPost } from './socialFeedMerge';

const post = (id: string, comments: SocialComment[] = []): SocialPost => ({
    id, authorName: 'author', authorAvatar: '', title: id, content: id,
    images: ['✨'], likes: 0, isCollected: false, isLiked: false,
    comments, timestamp: 1, tags: [], bgStyle: '',
});

const comment = (id: string, authorType: SocialComment['authorType'] = 'stranger'): SocialComment => ({
    id, authorName: id, authorAvatar: '', content: id,
    likes: 0, isCharacter: false, authorType,
});

describe('social feed race-safe merging', () => {
    it('keeps posts created while a refresh request was in flight', () => {
        const live = [post('user-post'), post('old')];
        expect(prependUniqueSocialPosts(live, [post('generated')]).map(item => item.id))
            .toEqual(['generated', 'user-post', 'old']);
    });

    it('updates a post from the latest feed instead of a stale request snapshot', () => {
        const userComment = comment('user-comment', 'user');
        const result = updateSocialPost([post('p', [userComment])], 'p', current => ({
            ...current,
            comments: mergeSocialComments(current.comments, [comment('ai-comment')]),
        }));
        expect(result.post?.comments.map(item => item.id)).toEqual(['user-comment', 'ai-comment']);
    });

    it('does not duplicate a retried comment result', () => {
        const existing = comment('same');
        expect(mergeSocialComments([existing], [existing])).toEqual([existing]);
    });

    it('deduplicates IDs inside the same incoming batch, without dropping distinct posts or comments', () => {
        const incomingPosts = [post('new'), post('new'), post('other')];
        expect(prependUniqueSocialPosts([post('old')], incomingPosts).map(item => item.id))
            .toEqual(['new', 'other', 'old']);
        const incomingComments = [comment('first'), comment('first'), comment('second')];
        expect(mergeSocialComments([comment('old')], incomingComments).map(item => item.id))
            .toEqual(['old', 'first', 'second']);
    });

    it('keeps multiple distinct replies by one character while suppressing replays', () => {
        const first = { ...comment('c1', 'character'), authorCharId: 'char-1', content: '第一句' };
        const second = { ...comment('c2', 'character'), authorCharId: 'char-1', content: '再聊一轮' };
        expect(uniqueGeneratedSocialComments([first], [first, second])).toEqual([second]);
    });

    it('allows the same short reply in different branches or public character handles', () => {
        const first = { ...comment('r1', 'character'), authorName: '大号', authorCharId: 'char-a', parentCommentId: 'q1', content: '嗯' };
        const nextBranch = { ...comment('r2', 'character'), authorName: '大号', authorCharId: 'char-a', parentCommentId: 'q2', content: '嗯' };
        const differentHandle = { ...comment('r3', 'character'), authorName: '马甲', authorCharId: 'char-a', parentCommentId: 'q1', content: '嗯' };
        const replay = { ...comment('r4', 'character'), authorName: '大号', authorCharId: 'char-a', parentCommentId: 'q1', content: '嗯' };
        expect(uniqueGeneratedSocialComments([first], [nextBranch, differentHandle, replay]))
            .toEqual([nextBranch, differentHandle]);
    });

    it('toggles a local comment like without creating a negative count', () => {
        const liked = toggleSocialCommentLike(comment('c'));
        expect(liked).toMatchObject({ isLiked: true, likes: 1 });
        expect(toggleSocialCommentLike(liked)).toMatchObject({ isLiked: false, likes: 0 });
    });

    it('keeps recorded user likes and collections consistent with actual account actors', () => {
        const existing = {
            ...post('mine'), likes: 1,
            likedByAccountIds: ['stranger:a'], collectedByAccountIds: ['stranger:b'],
        };
        const liked = toggleSocialPostLike(existing);
        expect(liked).toMatchObject({ isLiked: true, likes: 2 });
        expect(liked.likedByAccountIds).toEqual(['stranger:a', 'user']);
        const unliked = toggleSocialPostLike(liked);
        expect(unliked.likedByAccountIds).toEqual(['stranger:a']);
        expect(unliked.likes).toBe(1);

        const saved = toggleSocialPostCollection(existing);
        expect(saved.collectedByAccountIds).toEqual(['stranger:b', 'user']);
        const unsaved = toggleSocialPostCollection(saved);
        expect(unsaved.collectedByAccountIds).toEqual(['stranger:b']);

        const likedComment = toggleSocialCommentLike(comment('c'));
        expect(likedComment.likedByAccountIds).toEqual(['user']);
        expect(toggleSocialCommentLike(likedComment).likedByAccountIds).toEqual([]);
    });

    it('only permits deleting the user\'s own posts (legacy names remain compatible)', () => {
        expect(canDeleteSocialPost({ ...post('own'), authorType: 'user' }, 'Me')).toBe(true);
        expect(canDeleteSocialPost({ ...post('npc'), authorType: 'stranger' }, 'Me')).toBe(false);
        expect(canDeleteSocialPost({ ...post('legacy'), authorName: 'Me' }, 'Me')).toBe(true);
    });
});

describe('Spark publish topic normalization', () => {
    it('keeps up to six unique tags and never falls back to a fake user tag', async () => {
        const { parseSparkPublishTags } = await import('./socialFeedMerge');
        expect(parseSparkPublishTags(' #插画,绘画 插画，画师 ')).toEqual(['插画', '绘画', '画师']);
        expect(parseSparkPublishTags('')).toEqual(['日常']);
        expect(parseSparkPublishTags('a b c d e f g')).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    });
});

describe('Spark reply-request batching cost and routing', () => {
    it('combines nearby comments on the same post into one request', async () => {
        const { takeSparkCommentReplyBatch } = await import('./socialFeedMerge');
        const queued = [
            { post: { id: 'postA' }, content: '先问1', parentCommentId: 'c1' },
            { post: { id: 'postA' }, content: '补充2', parentCommentId: 'c2' },
            { post: { id: 'postB' }, content: '另一个帖子', parentCommentId: 'c3' },
        ];
        const batch = takeSparkCommentReplyBatch(queued);
        expect(batch.jobs.map(x => x.parentCommentId)).toEqual(['c1','c2']);
        expect(batch.remaining.map(x => x.parentCommentId)).toEqual(['c3']);
    });
    it('caps a burst to four comments to limit response tokens', async () => {
        const { takeSparkCommentReplyBatch } = await import('./socialFeedMerge');
        const queued = Array.from({ length: 9 }, (_, i) => ({ post: { id: 'same' }, parentCommentId: String(i) }));
        expect(takeSparkCommentReplyBatch(queued).jobs).toHaveLength(4);
        expect(takeSparkCommentReplyBatch(queued).remaining).toHaveLength(5);
    });
});

describe('Spark draft cleanup after durable publish', () => {
    it('only clears the same draft, not a new draft written during an in-flight publish', async () => {
        const { canClearSparkPublishedDraft } = await import('./socialFeedMerge');
        const submitted = '{"title":"第一篇","content":"已经发布"}';
        const nextDraft = '{"title":"第二篇","content":"正在编辑"}';
        expect(canClearSparkPublishedDraft(submitted, submitted)).toBe(true);
        expect(canClearSparkPublishedDraft(submitted, nextDraft)).toBe(false);
        expect(canClearSparkPublishedDraft(null, nextDraft)).toBe(false);
        expect(canClearSparkPublishedDraft(null, null)).toBe(true);
    });
});

describe('Spark delete fences across asynchronous writes', () => {
    it('blocks late mutations while delete is pending and keeps the fence after success', async () => {
        const { deleteSparkPostWithFence } = await import('./socialFeedMerge');
        const fences = new Set<string>();
        let completeDelete!: () => void;
        const operation = deleteSparkPostWithFence('deleted', fences, () => new Promise<void>(resolve => {
            completeDelete = resolve;
        }));
        expect(fences.has('deleted')).toBe(true);
        expect(await deleteSparkPostWithFence('deleted', fences, async () => { throw new Error('duplicate delete'); })).toBe(false);
        completeDelete();
        expect(await operation).toBe(true);
        expect(fences.has('deleted')).toBe(true);
        expect(deleteSparkPostWithFence('deleted', fences, async () => {})).resolves.toBe(false);
    });

    it('releases the fence after a rejected IndexedDB delete so edits remain available', async () => {
        const { deleteSparkPostWithFence } = await import('./socialFeedMerge');
        const fences = new Set<string>();
        await expect(deleteSparkPostWithFence('still-here', fences, async () => {
            throw new Error('transaction aborted');
        })).rejects.toThrow('transaction aborted');
        expect(fences.has('still-here')).toBe(false);
        expect(await deleteSparkPostWithFence('still-here', fences, async () => {})).toBe(true);
    });
});

describe('Spark failed-write recovery snapshots', () => {
    it('accepts valid backups and rejects malformed keys and payloads', async () => {
        const { parseSparkUnsavedPostEdits } = await import('./socialFeedMerge');
        expect(parseSparkUnsavedPostEdits('invalid json')).toEqual({});
        expect(parseSparkUnsavedPostEdits(JSON.stringify({
            good: post('good'), impostor: post('another'), bad: { id: 'bad', content: 'missing fields' },
        }))).toEqual({ good: post('good') });
    });

    it('preserves newly persisted comments when an old failed edit is explicitly recovered', async () => {
        const { mergeSparkRecoveredPost } = await import('./socialFeedMerge');
        const durable = post('p', [comment('old'), comment('late')]);
        const recovered = { ...post('p', [comment('old'), comment('unsaved')]), isCollected: true };
        const merged = mergeSparkRecoveredPost(durable, recovered);
        expect(merged.comments.map(item => item.id)).toEqual(['old', 'unsaved', 'late']);
        expect(merged.isCollected).toBe(true);
        expect(mergeSparkRecoveredPost(post('other'), recovered).id).toBe('other');
    });
});

describe('Spark explicit recovery cannot undo deletion', () => {
    it('saves a currently visible failed new post only after manual retry', async () => {
        const { selectSparkRecoverablePost } = await import('./socialFeedMerge');
        const unsaved = post('new');
        expect(selectSparkRecoverablePost(undefined, unsaved, unsaved, true)).toBe(unsaved);
        expect(selectSparkRecoverablePost(undefined, unsaved, undefined, true)).toBeUndefined();
    });
    it('never revives a deleted post from a previous-session backup', async () => {
        const { selectSparkRecoverablePost } = await import('./socialFeedMerge');
        const cached = post('deleted');
        expect(selectSparkRecoverablePost(undefined, cached, undefined, false)).toBeUndefined();
        const durable = post('still-here', [comment('later')]);
        const recovered = selectSparkRecoverablePost(durable, { ...durable, comments: [] }, undefined, false);
        expect(recovered?.comments.map(item => item.id)).toEqual(['later']);
    });
});

describe('Spark delayed settings hydration', () => {
    it('does not overwrite profile/background fields edited while IndexedDB is loading', async () => {
        const { keepSparkLiveEdit } = await import('./socialFeedMerge');
        const initial = { name: '新用户', bio: '' };
        const edited = { ...initial, name: '正在编辑' };
        const saved = { name: '旧快照', bio: '旧简介' };
        expect(keepSparkLiveEdit(initial, edited, saved)).toBe(edited);
        expect(keepSparkLiveEdit(initial, initial, saved)).toBe(saved);
        expect(keepSparkLiveEdit('', '刚选的背景', '旧背景')).toBe('刚选的背景');
    });
});
