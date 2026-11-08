/** Recover a valid JSON prefix from a response cut off during download.
 * JSON.parse still validates the entire retained prefix. Never search arbitrary
 * strings for "content" or accept a provider error as a completion.
 */
export function recoverTruncatedCompletionJson(raw: string): any | undefined {
    if (!raw.trimStart().startsWith('{')) return undefined;

    const closing: string[] = [];
    const checkpoints: Array<{ end: number; suffix: string }> = [];
    const remember = (end: number, quote = '') => {
        if (closing.length === 0) return;
        checkpoints.push({ end, suffix: quote + [...closing].reverse().join('') });
        if (checkpoints.length > 24) checkpoints.shift();
    };

    for (let index = 0; index < raw.length; index++) {
        const char = raw[index];
        if (char === '{' || char === '[') {
            closing.push(char === '{' ? '}' : ']');
            if (closing.length > 64) return undefined;
        } else if (char === '}' || char === ']') {
            if (closing.pop() !== char) return undefined;
            remember(index + 1);
        } else if (char === '"') {
            // A token ends at the next unescaped quote, invalid escape, or EOF.
            const stringToken = /(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*/y;
            stringToken.lastIndex = index + 1;
            stringToken.exec(raw);
            index = stringToken.lastIndex;
            if (raw[index] === '"') {
                remember(index + 1);
            } else {
                const tail = raw.slice(index);
                if (tail && !/^\\(?:u[0-9a-fA-F]{0,3})?$/.test(tail)) return undefined;
                remember(index, '"');
                break;
            }
        }
    }
    if (closing.length === 0) return undefined;

    for (const { end, suffix } of checkpoints.reverse()) {
        try {
            const parsed = JSON.parse(raw.slice(0, end) + suffix);
            if (Array.isArray(parsed?.choices) || Array.isArray(parsed?.candidates) || Array.isArray(parsed?.output)) return parsed;
        } catch { /* This checkpoint ended at a key or incomplete container. */ }
    }
    return undefined;
}
