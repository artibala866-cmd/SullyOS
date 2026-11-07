import { describe, expect, it } from 'vitest';
import { findCharacterRecallDirectives, splitCharacterRecallOutput } from './messageRecall';

describe('private chat message recall directive', () => {
    it('retains speech order while allowing a message from this very response to be recalled', () => {
        expect(splitCharacterRecallOutput('喜欢你\n[[MESSAGE_RECALL:喜欢你]]\n……你少自恋')).toEqual([
            { kind: 'text', content: '喜欢你\n' },
            { kind: 'recall', original: '喜欢你' },
            { kind: 'text', content: '\n……你少自恋' },
        ]);
    });
    it('reports positions of control actions for accurate streaming order', () => {
        const source = '嗯\n[[MESSAGE_RECALL:嗯]]\n再说';
        const actions = findCharacterRecallDirectives(source);
        expect(actions).toHaveLength(1);
        expect(source.slice(actions[0].start, actions[0].end)).toBe('[[MESSAGE_RECALL:嗯]]');
    });
    it('accepts the original structured form without showing it as a chat bubble', () => {
        expect(splitCharacterRecallOutput('我说错了\n{"t":"recall","orig":"我说错了"}')).toEqual([
            { kind: 'text', content: '我说错了\n' },
            { kind: 'recall', original: '我说错了' },
        ]);
    });
    it('does not mistake monthly memory retrieval for message recall', () => {
        expect(splitCharacterRecallOutput('[[RECALL:2026-10]]')).toEqual([
            { kind: 'text', content: '[[RECALL:2026-10]]' },
        ]);
    });
    it('keeps normal messages and ignored empty directives harmless', () => {
        expect(splitCharacterRecallOutput('你好')).toEqual([{ kind: 'text', content: '你好' }]);
        expect(splitCharacterRecallOutput('[[MESSAGE_RECALL:]]')).toEqual([]);
    });
    it('keeps consecutive recalls in order without imposing a frequency gate', () => {
        expect(splitCharacterRecallOutput('[[MESSAGE_RECALL:A]][[MESSAGE_RECALL:B]]')).toEqual([
            { kind: 'recall', original: 'A' }, { kind: 'recall', original: 'B' },
        ]);
    });
    it('parses escaped characters in the structured form without corrupting the target', () => {
        const literal = '他说"再见"';
        const output = '{"t":"recall","orig":' + JSON.stringify(literal) + '}';
        expect(splitCharacterRecallOutput(output)).toEqual([{ kind: 'recall', original: literal }]);
    });
});
