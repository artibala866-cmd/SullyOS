import { describe, expect, it } from 'vitest';
import type { SocialComment, SocialPost } from '../types';
import { canDeleteSocialPost, mergeSocialComments, prependUniqueSocialPosts, toggleSocialCommentLike, uniqueGeneratedSocialComments, updateSocialPost } from './socialFeedMerge';

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

    it('keeps multiple distinct replies by one character while suppressing replays', () => {
        const first = { ...comment('c1', 'character'), authorCharId: 'char-1', content: '第一句' };
        const second = { ...comment('c2', 'character'), authorCharId: 'char-1', content: '再聊一轮' };
        expect(uniqueGeneratedSocialComments([first], [first, second])).toEqual([second]);
    });

    it('toggles a local comment like without creating a negative count', () => {
        const liked = toggleSocialCommentLike(comment('c'));
        expect(liked).toMatchObject({ isLiked: true, likes: 1 });
        expect(toggleSocialCommentLike(liked)).toMatchObject({ isLiked: false, likes: 0 });
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
