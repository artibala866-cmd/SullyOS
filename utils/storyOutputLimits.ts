export const STORY_MIN_OUTPUT_TOKENS = 256;
export const STORY_DEFAULT_OUTPUT_TOKENS = 30_000;

export function normalizeStoryOutputTokens(value: unknown, fallback = STORY_DEFAULT_OUTPUT_TOKENS): number {
    const parsed = typeof value === 'number' || (typeof value === 'string' && value.trim()) ? Number(value) : NaN;
    const tokens = Number.isFinite(parsed) ? parsed : fallback;
    return Math.round(Math.max(STORY_MIN_OUTPUT_TOKENS, tokens));
}
