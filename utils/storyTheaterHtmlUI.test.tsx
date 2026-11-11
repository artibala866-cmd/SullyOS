// @vitest-environment jsdom
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../context/OSContext', () => ({
    useOS: () => ({ theme: { storyAppearance: { preset: 'none' } } }),
}));
import { SafeStoryHtml, StoryOutput } from '../components/date/story/StoryTheaterSession';

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
        expect(markup).toContain('sandbox="allow-scripts"');
        expect(markup).not.toContain('allow-same-origin');
        expect(markup).toContain('sully-story-template-scroll');
        expect(markup).toContain('srcDoc=');
        expect(markup).toContain('小剧场正文');
        expect(markup).not.toContain('onclick=');
        expect(markup).not.toContain('window.injected');
        expect(markup).toContain('Content-Security-Policy');
    });
    it('多张剧情 HTML 卡片仅共享一个窗口监听，尺寸消息不会引起其他楼层重绘', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        const add = vi.spyOn(window, 'addEventListener');
        const remove = vi.spyOn(window, 'removeEventListener');
        try {
            await act(async () => root.render(<>
                <SafeStoryHtml source='<p>卡片甲</p>' fallback='' title='卡片甲' />
                <SafeStoryHtml source='<p>卡片乙</p>' fallback='' title='卡片乙' />
            </>));
            const frames = host.querySelectorAll<HTMLIFrameElement>('iframe');
            expect(frames.length).toBe(2);
            expect(add.mock.calls.filter(([type]) => type === 'message')).toHaveLength(1);
            const initialOtherHeight = frames[1].style.height;
            await act(async () => window.dispatchEvent(new MessageEvent('message', {
                source: frames[0].contentWindow, data: { type: 'sully-story-template-height', height: 430 },
            })));
            expect(frames[0].style.height).toBe('430px');
            expect(frames[1].style.height).toBe(initialOtherHeight);
        } finally {
            await act(async () => root.unmount());
            expect(remove.mock.calls.filter(([type]) => type === 'message')).toHaveLength(1);
            add.mockRestore();
            remove.mockRestore();
            host.remove();
        }
    });
    it('模板正文刷新时保留已测量高度，避免旧楼层瞬间塌缩再展开', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        try {
            await act(async () => root.render(<SafeStoryHtml source='<p>原正文</p>' fallback='' title='正文' />));
            const frame = host.querySelector('iframe')!;
            await act(async () => window.dispatchEvent(new MessageEvent('message', {
                source: frame.contentWindow, data: { type: 'sully-story-template-height', height: 520 },
            })));
            expect(frame.style.height).toBe('520px');
            await act(async () => root.render(<SafeStoryHtml source='<p>新正文新正文</p>' fallback='' title='正文' />));
            expect(host.querySelector('iframe')).toBe(frame);
            expect(frame.style.height).toBe('520px');
        } finally {
            await act(async () => root.unmount());
            host.remove();
        }
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
