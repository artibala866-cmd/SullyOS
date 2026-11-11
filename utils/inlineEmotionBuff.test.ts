import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildInlineEmotionInstruction, extractInlineEmotion, stripInlineEmotion, INLINE_EMOTION_OPEN, INLINE_EMOTION_CLOSE } from './inlineEmotionBuff';

describe('private chat: one-call inline Buff', () => {
    it('keeps the real dialogue, extracting only the hidden JSON for the existing Buff parser', () => {
        const raw = '{"changed":true,"buffs":[{"id":"calm","name":"平静","label":"松弛","intensity":2}],"injection":"正在放松","innerState":"现在轻松多了"}';
        const response = `晚饭吃过啦！\n${INLINE_EMOTION_OPEN}\n${raw}\n${INLINE_EMOTION_CLOSE}`;
        expect(extractInlineEmotion(response)).toEqual({ content: '晚饭吃过啦！', raw });
    });

    it('does not invent a second attempt when the model forgets or truncates the hidden state', () => {
        expect(extractInlineEmotion('一句正常回复。')).toEqual({ content: '一句正常回复。', raw: null });
        expect(extractInlineEmotion(`一句正常回复。\n${INLINE_EMOTION_OPEN}{"changed":true`)).toEqual({
            content: '一句正常回复。', raw: null,
        });
    });

    it('does not reveal a partially streamed tag or JSON as a chat bubble', () => {
        expect(stripInlineEmotion('你好，<SULLY_EMO')).toBe('你好，');
        expect(stripInlineEmotion(`你好，\n${INLINE_EMOTION_OPEN}{"changed":true`)).toBe('你好，');
        expect(stripInlineEmotion('<div>正常 HTML</div>')).toBe('<div>正常 HTML</div>');
    });

    it('provides a compact schema with unchanged-state output and existing buffs, without API credentials', () => {
        const prompt = buildInlineEmotionInstruction({ name: '角色', activeBuffs: [
            { id: 'calm', name: 'calm', label: '平静', intensity: 2 },
        ] } as any);
        expect(prompt).toContain(INLINE_EMOTION_OPEN);
        expect(prompt).toContain(INLINE_EMOTION_CLOSE);
        expect(prompt).toContain('"changed":false');
        expect(prompt).toContain('"label":"平静"');
        expect(prompt).not.toMatch(/apiKey|baseUrl|chat\/completions/);
    });

    it('wires both private-chat routes to one main call and prevents a separate emotion request', () => {
        const hook = readFileSync('hooks/useChatAI.ts', 'utf8');
        const mainReply = hook.slice(hook.indexOf('export function useChatAI'));
        expect(mainReply).toContain('buildInlineEmotionInstruction(charForGen)');
        expect(mainReply).toContain('applyEmotionEvalRaw(inlineEmotion.raw!, charForGen)');
        expect(mainReply).toContain('computeStreamPreviewBubbles(stripInlineEmotion(fullText))');
        expect(mainReply).not.toMatch(/fireLocalEmotionEval|cloudEmotionEval|evaluateEmotionBackground\(/);
        const worker = readFileSync('worker/amsg/src/index.ts', 'utf8');
        expect(worker).toContain('inlineEmotionEnabled: instant &&');
        expect(worker).toContain('lastMeta.amsgEmotionUpdate = inlineEmotion.raw');
    });
});
