/** Default for the author-editable story archive save ceiling. */
export const STORY_ARCHIVE_DEFAULT_GUIDE_MAX_CHARS = 0;

/** A value of 0 (also the default) means unlimited; explicit saved values are preserved. */
export function normalizeStoryArchiveGuideMaxChars(value: unknown): number {
    if (value === undefined || value === null || value === '') return STORY_ARCHIVE_DEFAULT_GUIDE_MAX_CHARS;
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) return STORY_ARCHIVE_DEFAULT_GUIDE_MAX_CHARS;
    return parsed;
}

/** Split for embedding transport without discarding even one code point or cutting surrogate pairs. */
export function splitStoryArchiveVectorText(content: string, maxChars: number): string[] {
    if (!Number.isSafeInteger(maxChars) || maxChars < 2) throw new Error('无效的向量分段容量');
    const points = Array.from(content);
    const chunks: string[] = [];
    for (let start = 0; start < points.length;) {
        let end = start;
        let codeUnits = 0;
        while (end < points.length && codeUnits + points[end].length <= maxChars) {
            codeUnits += points[end].length;
            end++;
        }
        if (end === start) throw new Error('向量容量无法容纳完整字符');
        let boundary = end;
        if (end < points.length) {
            const earliest = start + Math.floor((end - start) * 0.7);
            for (let index = end - 1; index >= earliest; index--) {
                if (/[。！？；\n]/u.test(points[index])) {
                    boundary = index + 1;
                    break;
                }
            }
        }
        chunks.push(points.slice(start, boundary).join(''));
        start = boundary;
    }
    return chunks;
}
