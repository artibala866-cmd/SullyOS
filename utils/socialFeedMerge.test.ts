import { describe, expect, it } from 'vitest';
import type { SocialComment, SocialPost } from '../types';
import { canDeleteSocialPost, mergeSocialComments, prependUniqueSocialPosts, toggleSocialCommentLike, updateSocialPost } from './socialFeedMerge';

const post = (id: string, comments: SocialComment[] = []): SocialPost => ({
    id,
    authorName: 'author',
    authorAvatar: '',
    title: id,
    content: id,
    images: ['✨'],
    likes: 0,
    isCollected: false,
    isLiked: false,
    comments,
    timestamp: 1,
    tags: [],
    bgStyle: '',
});

const comment = (id: string, authorType: SocialComment['authorType'] = 'stranger'): SocialComment => ({
    id,
    authorName: id,
    authorAvatar: '',
    content: id,
    likes: 0,
    isCharacter: false,
    authorType,
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
});


describe('Spark ownership and comment reactions', () => {
    it('only allows deleting user-authored posts, with a legacy ownership fallback', () => {
        expect(canDeleteSocialPost(post('not-owned'), '雨的账号')).toBe(false);
        const own = { ...post('own'), authorName: '雨的账号', authorType: 'user' as const };
        const legacyOwn = { ...post('legacy-own'), authorName: '雨的账号' };
        const characterPost = { ...post('character'), authorName: '角色马甲', authorType: 'character' as const };
        const strangerPost = { ...post('stranger'), authorName: '路人', authorType: 'stranger' as const };
        expect(canDeleteSocialPost(own, '雨的账号')).toBe(true);
        expect(canDeleteSocialPost(legacyOwn, '雨的账号')).toBe(true);
        expect(canDeleteSocialPost(characterPost, '雨的账号')).toBe(false);
        expect(canDeleteSocialPost(strangerPost, '雨的账号')).toBe(false);
    });

    it('toggles a comment like on and off without changing other comments', () => {
        const original = post('p', [comment('c1'), comment('c2')]);
        const liked = toggleSocialCommentLike(original, 'c1');
        expect(liked.comments[0]).toMatchObject({ isLiked: true, likes: 1 });
        expect(liked.comments[1]).toEqual(original.comments[1]);
        const unliked = toggleSocialCommentLike(liked, 'c1');
        expect(unliked.comments[0]).toMatchObject({ isLiked: false, likes: 0 });
    });

    it('does not create a like or count change when the target comment is missing', () => {
        const original = post('p', [comment('c1')]);
        expect(toggleSocialCommentLike(original, 'missing')).toBe(original);
    });
});
