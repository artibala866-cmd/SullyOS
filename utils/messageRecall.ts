/**
 * Private-chat message recall actions, extracted from model output before bubble
 * rendering. This is a message mutation, NOT a new proactive message/API call.
 * Keep memory recall [[RECALL:YYYY-MM]] in its existing separate namespace.
 */
export type CharacterRecallStep =
    | { kind: 'text'; content: string }
    | { kind: 'recall'; original: string };

const RECALL_ACTION = /\[\[MESSAGE_RECALL:([\s\S]*?)\]\]|\{\s*"t"\s*:\s*"recall"\s*,\s*"orig"\s*:\s*"((?:\\.|[^"\\])*)"\s*\}/gi;

export function splitCharacterRecallOutput(input: string): CharacterRecallStep[] {
    if (!input) return [];
    const steps: CharacterRecallStep[] = [];
    const matcher = new RegExp(RECALL_ACTION.source, 'gi');
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(input)) !== null) {
        if (match.index > cursor) steps.push({ kind: 'text', content: input.slice(cursor, match.index) });
        let original = (match[1] || '').trim();
        if (match[2] !== undefined) {
            try {
                const directive = JSON.parse(match[0]) as { t?: string; orig?: string };
                original = typeof directive.orig === 'string' ? directive.orig.trim() : '';
            } catch { original = ''; }
        }
        if (original) steps.push({ kind: 'recall', original });
        cursor = matcher.lastIndex;
    }
    if (cursor < input.length) steps.push({ kind: 'text', content: input.slice(cursor) });
    return steps.length ? steps : [{ kind: 'text', content: input }];
}
