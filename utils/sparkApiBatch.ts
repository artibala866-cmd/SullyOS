/** Pure contracts for minimizing Spark API calls without confusing character identities. */
export const SPARK_CHARACTER_BATCH_LIMIT = 8;

export function planSparkCharacterBatches<T>(items: readonly T[], limit = SPARK_CHARACTER_BATCH_LIMIT): T[][] {
    const batchSize = Math.max(1, Math.min(SPARK_CHARACTER_BATCH_LIMIT, Math.floor(limit) || 1));
    const result: T[][] = [];
    for (let index = 0; index < items.length; index += batchSize) {
        result.push(items.slice(index, index + batchSize));
    }
    return result;
}

/** Model outputs must not create posts for unknown or duplicate character IDs. */
export function selectSparkBatchCharacterResults<T extends { charId?: unknown }>(
    allowedIds: readonly string[], output: unknown,
): T[] {
    if (!Array.isArray(output)) return [];
    const allowed = new Set(allowedIds);
    const seen = new Set<string>();
    return output.filter((item: unknown): item is T => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
        const { charId, content } = item as { charId?: unknown; content?: unknown };
        // A malformed first row should not consume this character's single slot.
        // Keep the later valid row without requesting another paid generation.
        if (typeof charId !== 'string' || !allowed.has(charId) || seen.has(charId) ||
            typeof content !== 'string' || !content.trim()) return false;
        seen.add(charId);
        return true;
    });
}

/** Backward-compatible split: ordinary comment arrays and the combined post-publish object. */
export function parseSparkPostPublishBatch(value: unknown): { comments: unknown[]; incomingDMs: unknown[] } {
    if (Array.isArray(value)) return { comments: value, incomingDMs: [] };
    if (!value || typeof value !== 'object') return { comments: [], incomingDMs: [] };
    const parsed = value as { comments?: unknown; incomingDMs?: unknown };
    return {
        comments: Array.isArray(parsed.comments) ? parsed.comments : [],
        incomingDMs: Array.isArray(parsed.incomingDMs) ? parsed.incomingDMs : [],
    };
}

/** An already-paid initial batch counts as attempted even when no valid comments returned. */
export function needsSparkInitialCommentCall(post: {
    sparkInitialCommentsHandled?: boolean;
    comments?: Array<{ authorType?: string; authorId?: string }>;
}): boolean {
    if (post.sparkInitialCommentsHandled) return false;
    return !(post.comments || []).some(comment =>
        comment.authorType !== 'user' && comment.authorId !== 'user');
}
