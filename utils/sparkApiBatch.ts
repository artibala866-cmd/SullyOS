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
        const charId = (item as { charId?: unknown }).charId;
        if (typeof charId !== 'string' || !allowed.has(charId) || seen.has(charId)) return false;
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
