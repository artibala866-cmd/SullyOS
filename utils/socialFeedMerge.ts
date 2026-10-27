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

/** Visibility and destructive permissions must be evaluated from the persisted author type. */
export function canDeleteSocialPost(post: SocialPost, userHandle: string): boolean {
    return post.authorType === 'user' || (!post.authorType && post.authorName === userHandle);
}

/** A comment can only receive one local like, and a second tap reverses it. */
export function toggleSocialCommentLike(comment: SocialComment): SocialComment {
    const wasLiked = !!comment.isLiked;
    return { ...comment, isLiked: !wasLiked, likes: Math.max(0, comment.likes + (wasLiked ? -1 : 1)) };
}

/** Remove replayed AI messages, not repeated speakers: public conversations may continue. */
export function uniqueGeneratedSocialComments(current: SocialComment[], incoming: SocialComment[]): SocialComment[] {
    const identity = (comment: SocialComment) =>
        (comment.authorCharId || comment.authorName.trim().toLocaleLowerCase()) + '\u0000' + comment.content.trim();
    const seen = new Set(current.map(identity));
    return incoming.filter(comment => {
        const key = identity(comment);
        if (!comment.content.trim() || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
