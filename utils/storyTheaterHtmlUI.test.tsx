// @vitest-environment jsdom
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../context/OSContext', () => ({
    useOS: () => ({ theme: { storyAppearance: { preset: 'none' } } }),
}));
import { StoryOutput } from '../components/date/story/StoryTheaterSession';

describe('实际剧情输出组件的酒馆 HTML 兼容保护', () => {
    it('嵌套小剧场原封不动归入既有折叠模块，HTML 只进 sandbox iframe', () => {
        const content = '<content>正常剧情开始。'
            + '<sidestory><details data-fate="side_theater"><summary>午夜小剧场</summary>'
            + '<style>.pretty{border-radius:12px}</style>'
            + '<div class="pretty" onclick="attack()"><p>小剧场正文</p>'
            + '<script>window.injected=true</script></div>'
            + '</details></sidestory>正常剧情结束。</content>';
        const markup = renderToStaticMarkup(React.createElement(StoryOutput, {
            content, affinityInputs: [], fromTavern: true,
        }));
        expect(markup).toContain('正常剧情开始');
        expect(markup).toContain('正常剧情结束');
        expect(markup).toContain('酒馆小剧场');
        expect(markup).toContain('<iframe');
        expect(markup).toContain('sandbox=""');
        expect(markup).toContain('srcDoc=');
        expect(markup).toContain('小剧场正文');
        expect(markup).not.toContain('onclick=');
        expect(markup).not.toContain('window.injected');
        expect(markup).toContain('Content-Security-Policy');
    });
    it('原生小剧场保持现有聊天气泡，不新增 iframe', () => {
        const content = '<mini_theater><mt_title>原生频道</mt_title>'
            + '<mt_ai><name>甲</name><text>左侧消息</text></mt_ai>'
            + '<mt_user><name>乙</name><text>右侧消息</text></mt_user></mini_theater>';
        const markup = renderToStaticMarkup(React.createElement(StoryOutput, {
            content, affinityInputs: [], fromTavern: false,
        }));
        expect(markup).toContain('原生频道');
        expect(markup).toContain('左侧消息');
        expect(markup).toContain('右侧消息');
        expect(markup).not.toContain('<iframe');
    });
});
