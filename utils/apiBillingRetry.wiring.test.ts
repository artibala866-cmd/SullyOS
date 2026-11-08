import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

describe('billing safety across settings, chat and background evaluation', () => {
    const chat = read('../hooks/useChatAI.ts');
    const independentSettings = read('../components/character/CharacterApiPanel.tsx');
    const commonSettings = read('../apps/Settings.tsx');

    it('does not send a paid chat completion from either API connection test button', () => {
        expect(independentSettings).toContain('checkApiConnectionWithoutGeneration');
        expect(independentSettings).not.toContain('/chat/completions');
        expect(commonSettings).toContain('checkApiConnectionWithoutGeneration');
        const testButton = commonSettings.slice(commonSettings.indexOf('免费检查 API 连通性') - 1500);
        expect(testButton).not.toContain("messages: [{ role: 'user', content: 'Hi' }]");
    });

    it('does not retry failed emotion evaluations and does not launch them before the main result', () => {
        const start = chat.indexOf('export async function evaluateEmotionBackground(');
        const end = chat.indexOf('interface UseChatAIProps', start);
        expect(start).toBeGreaterThan(0);
        expect(end).toBeGreaterThan(start);
        const evaluation = chat.slice(start, end);
        expect(evaluation.match(/safeFetchJson\(/g)).toHaveLength(1);
        expect(evaluation).not.toContain('retrying non-stream');
        const initialReply = chat.indexOf("purpose: '聊天回复' }, streamHooks");
        const scheduleEval = chat.indexOf('fireLocalEmotionEval?.();', initialReply);
        expect(initialReply).toBeGreaterThan(0);
        expect(scheduleEval).toBeGreaterThan(initialReply);
        const beforeMainRequest = chat.slice(chat.indexOf('const streamHooks:', initialReply - 7000), initialReply);
        expect(beforeMainRequest).not.toContain('fireLocalEmotionEval?.();');
    });

    it('warns that paid vision/image generation tests can still charge on failure', () => {
        expect(commonSettings).toContain('即使失败或返回内容不可用，中转也可能计费');
        expect(read('../components/settings/ImageApiSettingsPanel.tsx')).toContain('失败或图片无法读取时也可能扣费');
    });
});
