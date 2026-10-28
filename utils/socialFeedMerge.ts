import type { SocialComment, SocialPost } from '../types';

/**
 * Prepend a generated batch without replacing anything that arrived while the
 * request was in flight. IDs are unique in normal use; the guard also makes a
 * retried response idempotent.
 */
export function prependUniqueSocialPosts(current: SocialPost[], incoming: SocialPost[]): SocialPost[] {
    const existingIds = new Set(current.map(post => post.id));
    const fresh = incoming.filter(post => {
        if (existingIds.has(post.id)) return false;
        existingIds.add(post.id);
        return true;
    });
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
    const fresh = incoming.filter(comment => {
        if (existingIds.has(comment.id)) return false;
        existingIds.add(comment.id);
        return true;
    });
    return fresh.length > 0 ? [...current, ...fresh] : current;
}

/** Visibility and destructive permissions must be evaluated from the persisted author type. */
export function canDeleteSocialPost(post: SocialPost, userHandle: string): boolean {
    return post.authorType === 'user' || (!post.authorType && post.authorName === userHandle);
}

/** A comment can only receive one local like, and a second tap reverses it. */
export function toggleSocialCommentLike(comment: SocialComment): SocialComment {
    const wasLiked = !!comment.isLiked;
    const likedByAccountIds = new Set(comment.likedByAccountIds || []);
    if (wasLiked) likedByAccountIds.delete('user');
    else likedByAccountIds.add('user');
    return {
        ...comment, isLiked: !wasLiked,
        likes: Math.max(0, (comment.likes || 0) + (wasLiked ? -1 : 1)),
        likedByAccountIds: [...likedByAccountIds],
    };
}

/** Remove replayed AI messages, not repeated speakers: public conversations may continue. */
export function uniqueGeneratedSocialComments(current: SocialComment[], incoming: SocialComment[]): SocialComment[] {
    const identity = (comment: SocialComment) =>
        (comment.authorCharId ? comment.authorCharId + ':' : '') +
        comment.authorName.trim().toLocaleLowerCase() + '\u0000' +
        (comment.parentCommentId || '') + '\u0000' + comment.content.trim();
    const seen = new Set(current.map(identity));
    return incoming.filter(comment => {
        const key = identity(comment);
        if (!comment.content.trim() || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/** Normalize an editor's topic tags; keep valid unique tags and a sensible empty fallback. */
export function parseSparkPublishTags(input: string): string[] {
    const tags = input.split(/[#,，\s]+/g).map(value => value.trim().slice(0, 24)).filter(Boolean);
    const unique = [...new Set(tags)];
    return unique.length ? unique.slice(0, 6) : ['日常'];
}

/** Collapse adjacent quick user comments on one post into a single reply-generation request. */
export function takeSparkCommentReplyBatch<T extends { post: { id: string } }>(
    queue: T[], max = 4,
): { jobs: T[]; remaining: T[] } {
    if (!queue.length) return { jobs: [], remaining: queue };
    const id = queue[0].post.id;
    const limit = Math.max(1, Math.min(4, Math.floor(max) || 1));
    let n = 0;
    for (const item of queue) {
        if (n >= limit || item.post.id !== id) break;
        n++;
    }
    return { jobs: queue.slice(0, n), remaining: queue.slice(n) };
}

/** A completed post publish may clear only the draft captured for that publish. */
export function canClearSparkPublishedDraft(submitted: string | null, latest: string | null): boolean {
    return submitted === latest;
}

/** Publishing may finish after either the editor or durable draft has changed.
 * A missing/unreadable draft must not be interpreted as safe to clear.
 */
export function canClearSparkPublishedEditorDraft(
    submittedEditor: string,
    currentEditor: string,
    submittedCache: string | null,
    latestCache: string | null,
): boolean {
    return submittedCache !== null &&
        submittedEditor === currentEditor &&
        canClearSparkPublishedDraft(submittedCache, latestCache);
}

/** Mirror user post actions in actor lists used by real profile statistics. */
export function toggleSocialPostLike(post: SocialPost): SocialPost {
    const isLiked = !post.isLiked;
    const likedByAccountIds = new Set(post.likedByAccountIds || []);
    if (isLiked) likedByAccountIds.add('user');
    else likedByAccountIds.delete('user');
    return {
        ...post, isLiked, likedByAccountIds: [...likedByAccountIds],
        likes: Math.max(0, (post.likes || 0) + (isLiked ? 1 : -1)),
    };
}

export function toggleSocialPostCollection(post: SocialPost): SocialPost {
    const isCollected = !post.isCollected;
    const collectedByAccountIds = new Set(post.collectedByAccountIds || []);
    if (isCollected) collectedByAccountIds.add('user');
    else collectedByAccountIds.delete('user');
    return { ...post, isCollected, collectedByAccountIds: [...collectedByAccountIds] };
}

/**
 * Fence one post before awaiting IndexedDB deletion. Writes arriving during
 * that transaction must not queue a later put() which resurrects the post.
 * Failed deletes release the fence; confirmed deletes retain it.
 */
export async function deleteSparkPostWithFence(
    postId: string, fencedIds: Set<string>, remove: () => Promise<void>,
): Promise<boolean> {
    if (fencedIds.has(postId)) return false;
    fencedIds.add(postId);
    try {
        await remove();
        return true;
    } catch (error) {
        fencedIds.delete(postId);
        throw error;
    }
}

/** An optional emergency cache; never auto-replay a failed put over IndexedDB. */
export function parseSparkUnsavedPostEdits(raw: string | null): Record<string, SocialPost> {
    if (!raw) return {};
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        const result: Record<string, SocialPost> = {};
        for (const [key, value] of Object.entries(parsed)) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
            const post = value as Partial<SocialPost>;
            if (!key || key !== post.id || typeof post.title !== 'string' ||
                typeof post.content !== 'string' || !Array.isArray(post.comments) ||
                !Array.isArray(post.images) || !Array.isArray(post.tags)) continue;
            result[key] = post as SocialPost;
        }
        return result;
    } catch { return {}; }
}

/** Merge the recovered edit with comments that might have committed afterward. */
export function mergeSparkRecoveredPost(durable: SocialPost, recovered: SocialPost): SocialPost {
    if (durable.id !== recovered.id) return durable;
    return {
        ...durable, ...recovered,
        comments: mergeSocialComments(recovered.comments || [], durable.comments || []),
    };
}

/** Manual recovery never recreates a missing post from a previous session. */
export function selectSparkRecoverablePost(
    durable: SocialPost | undefined, cached: SocialPost,
    currentLive: SocialPost | undefined, failedInThisSession: boolean,
): SocialPost | undefined {
    if (failedInThisSession && currentLive?.id === cached.id) return currentLive;
    if (!durable || durable.id !== cached.id) return undefined;
    return mergeSparkRecoveredPost(durable, cached);
}

/** Use an async saved snapshot only while the value is still what hydration saw. */
export function keepSparkLiveEdit<T>(atLoadStart: T, current: T, saved: T): T {
    return Object.is(current, atLoadStart) ? saved : current;
}
