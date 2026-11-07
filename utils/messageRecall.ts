/**
 * Private-chat message recall actions, extracted from model output before bubble
 * rendering. This is a message mutation, NOT a new proactive message/API call.
 * Keep memory recall [[RECALL:YYYY-MM]] in its existing separate namespace.
 */
import type { Message } from '../types';

// Keep the user's manual recall limited to messages they actually sent.
// Payment receipts, app cards and system effects must not masquerade as
// a reversible send: recalling a message cannot undo an actual transfer.
const RECALLABLE_USER_TYPES: ReadonlySet<Message['type']> =
    new Set(['text', 'voice', 'image', 'emoji', 'interaction']);

export function canUserRecallPrivateMessage(message: Message | null | undefined): boolean {
    return !!message
        && message.role === 'user'
        && !message.groupId
        && RECALLABLE_USER_TYPES.has(message.type)
        && !message.metadata?.recalledAt;
}

export type CharacterRecallStep =
    | { kind: 'text'; content: string }
    | { kind: 'recall'; original: string };

const RECALL_ACTION = /\[\[MESSAGE_RECALL:([\s\S]*?)\]\]|\[MESSAGE_RECALL:([^\]\r\n]*)\]|\{\s*"t"\s*:\s*"recall"\s*,\s*"orig"\s*:\s*"((?:\\.|[^"\\])*)"\s*\}/gi;

export interface CharacterRecallDirective { original: string; start: number; end: number; }
export function findCharacterRecallDirectives(input: string): CharacterRecallDirective[] {
    const result: CharacterRecallDirective[] = [];
    const re = new RegExp(RECALL_ACTION.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(input)) !== null) {
        let original = (m[1] || m[2] || '').trim();
        if (m[3] !== undefined) {
            try {
                const obj = JSON.parse(m[0]) as { orig?: unknown };
                original = typeof obj.orig === 'string' ? obj.orig.trim() : '';
            } catch { original = ''; }
        }
        result.push({ original, start: m.index, end: re.lastIndex });
    }
    return result;
}
export function splitCharacterRecallOutput(input: string): CharacterRecallStep[] {
    if (!input) return [];
    const directives = findCharacterRecallDirectives(input);
    if (!directives.length) return [{ kind: 'text', content: input }];
    const steps: CharacterRecallStep[] = [];
    let cursor = 0;
    for (const item of directives) {
        if (item.start > cursor) steps.push({ kind: 'text', content: input.slice(cursor, item.start) });
        if (item.original) steps.push({ kind: 'recall', original: item.original });
        cursor = item.end;
    }
    if (cursor < input.length) steps.push({ kind: 'text', content: input.slice(cursor) });
    return steps;
}
