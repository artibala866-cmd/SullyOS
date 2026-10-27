import type { SocialComment, SocialPost } from '../types';

/**
 * Prepend a generated batch without replacing anything that arrived while the
 * request was in flight. IDs are unique in normal use; the guard also makes a
 * retried response idempotent.
 */
export function prependUniqueSocialPosts(current: SocialPost[], incoming: SocialPost[]): SocialPost[] {
    const existingIds = new Set(current.map(post => post.id));
    const fresh = incoming.filter(post => !existingIds.has(post.id));
    return fresh.length > 0 ? [...fresh, ...current] : current;
}

/** Replace one post using the latest version currently in the feed. */
export function updateSocialPost(
    current: SocialPost[],
    postId: string,
    updater: (post: SocialPost) => SocialPost,
): { feed: SocialPost[]; post?: SocialPost } {
    let updated: SocialPost | undefined;
    const feed = current.map(post => {
        if (post.id !== postId) return post;
        updated = updater(post);
        return updated;
    });
    return { feed: updated ? feed : current, post: updated };
}

/**
 * AI comments can finish after the user has already left a comment. Keep the
 * live comments and append only genuinely new generated entries.
 */
export function mergeSocialComments(current: SocialComment[], incoming: SocialComment[]): SocialComment[] {
    const existingIds = new Set(current.map(comment => comment.id));
    const fresh = incoming.filter(comment => !existingIds.has(comment.id));
    return fresh.length > 0 ? [...current, ...fresh] : current;
}

/** Only the local user's own posts may be deleted from the community feed. */
export function canDeleteSocialPost(post: SocialPost, socialProfileName: string): boolean {
    if (post.authorType === 'user') return true;
    if (post.authorType) return false;
    // Legacy posts predate explicit authorType; preserve ownership for old user posts.
    return post.authorName === socialProfileName;
}

/** Toggle the local user's like on a comment and keep its count in sync. */
export function toggleSocialCommentLike(post: SocialPost, commentId: string): SocialPost {
    let changed = false;
    const comments = (post.comments || []).map(comment => {
        if (comment.id !== commentId) return comment;
        changed = true;
        const wasLiked = comment.isLiked === true;
        const currentLikes = Number.isFinite(comment.likes) ? Math.max(0, comment.likes) : 0;
        return {
            ...comment,
            isLiked: !wasLiked,
            likes: Math.max(0, currentLikes + (wasLiked ? -1 : 1)),
        };
    });
    return changed ? { ...post, comments } : post;
}
