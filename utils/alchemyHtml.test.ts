// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildAlchemySandboxDocument } from './alchemyHtml';
import { parseStoryRegexImport } from './storyRegexImport';
import { applyStoryRegex } from './storyRegex';
import { alchemyInstructions, alchemyRulesFor, alchemyRulesForMeeting } from './alchemyRegex';

describe('Native Nuoji HTML templates: actual browser document, not a preview shell', () => {
    it('preserves original CSS keyframes, SVG, native tab selectors and layout', () => {
        const source = '<div style="height:480px;position:relative">'
            + '<style>@keyframes ctgv{0%,90%{transform:rotate(0)}93%{transform:rotate(5deg)}}'
            + '#ct1:checked~.ct-w .cp1{display:flex}</style>'
            + '<input id="ct1" type="radio" name="ct" checked>'
            + '<label for="ct1">查看判决</label>'
            + '<div class="ct-w"><div class="cp1"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg></div></div>'
            + '</div>';
        const frame = buildAlchemySandboxDocument(source);
        expect(frame.hasVisibleContent).toBe(true);
        expect(frame.srcDoc).toContain('@keyframes ctgv{0%,90%');
        expect(frame.srcDoc).toContain('#ct1:checked~.ct-w .cp1');
        expect(frame.srcDoc).toContain('height:480px');
        expect(frame.srcDoc).toContain('<input id="ct1" type="radio"');
        expect(frame.srcDoc).toContain('<label for="ct1"');
        expect(frame.srcDoc).toContain('<svg ');
        expect(frame.srcDoc).toContain('Content-Security-Policy');
        expect(frame.srcDoc).toContain("connect-src 'none'");
    });

    it('converts WeChat packet click into a native label toggle and scratch-card bootstrap into a local runtime', () => {
        const source = '<div><input type="checkbox" class="wx-hb-chk">'
            + '<label class="wx-hb-bubble" onclick="this.previousElementSibling.checked=true">打开红包</label>'
            + '<div><canvas width="240" height="100"></canvas>'
            + '<img src="x" onerror="function init(){wrap.querySelector(\'canvas\').getContext(\'2d\')}"></div></div>';
        const frame = buildAlchemySandboxDocument(source);
        expect(frame.srcDoc).toContain('for="alchemy-toggle-1"');
        expect(frame.srcDoc).toContain('id="alchemy-toggle-1"');
        expect(frame.srcDoc).toContain('data-alchemy-scratch="1"');
        expect(frame.srcDoc).toContain('pointerdown');
        expect(frame.srcDoc).toContain('getImageData');
        expect(frame.srcDoc).toContain('onclick=');
        expect(frame.srcDoc).not.toContain('onerror=');
    });

    it('runs imported local script interactions only in a network-blocked opaque sandbox', () => {
        const source = '<div class="main">原始卡片</div>'
            + '<script>window.attack=true</script><iframe src="https://example.invalid/"></iframe>'
            + '<img src="https://example.invalid/track.png" onerror="fetch(\'https://example.invalid/\')">';
        const frame = buildAlchemySandboxDocument(source);
        expect(frame.srcDoc).toContain('原始卡片');
        expect(frame.srcDoc).toContain('window.attack=true');
        expect(frame.srcDoc).toContain('onerror=');
        expect(frame.srcDoc).toContain("script-src 'unsafe-inline'");
        expect(frame.srcDoc).toContain("connect-src 'none'");
        expect(frame.srcDoc).toContain("form-action 'none'");
        expect(frame.srcDoc).not.toContain('<iframe');
        expect(frame.srcDoc).toContain("img-src data: blob:");
        expect(frame.srcDoc).toContain("frame-src 'none'");
    });

    it('keeps authored buttons functional and measures content instead of the growing iframe viewport', () => {
        const source = '<div style="width:420px"><button onclick="this.textContent=\'已打开\'">打开</button>'
            + '<details><summary>展开</summary><p>完整内容</p></details></div>';
        const frame = buildAlchemySandboxDocument(source);
        expect(frame.srcDoc).toContain('this.textContent');
        expect(frame.srcDoc).toContain('<details>');
        expect(frame.srcDoc).toContain('overflow-x:auto');
        expect(frame.srcDoc).toContain('element.scrollHeight');
        expect(frame.srcDoc).not.toContain('document.documentElement.scrollHeight');
        expect(frame.srcDoc).toContain('MutationObserver');
    });

    it('retains the original imported alchemy fields and automatically renders a matching JSON template', () => {
        const original = {
            name: '小法庭', pattern: '<court>([\\s\\S]*?)</court>', flags: 'g',
            replacement: '', role: 'both', scope: 'global', scenes: ['chat'],
            order: 4, enabled: 1, isHtmlTemplate: true, renderMode: 'iframe',
            parseMode: 'json', applyOnDisplay: 1, applyOnPrompt: 0,
            triggerEnabled: 0, triggerKeywords: '',
            category: '互动', trim: 0, minDepth: null, maxDepth: null,
            aiPrompt: '请在自然生气时输出 JSON 法庭卡片',
            htmlTemplate: '<div class="court"><h2>{{1.title}}</h2></div>',
            cssScope: '.court{background:#eee}',
        };
        const parsed = parseStoryRegexImport(JSON.stringify([original]));
        expect(parsed).toMatchObject({ rejected: 0 });
        const [rule] = parsed.rules;
        expect(rule.source?.originalRule).toEqual(original);
        expect(rule.source?.renderMode).toBe('iframe');
        expect(rule.parseMode).toBe('json');
        expect(rule.role).toBe('both');
        expect(rule.order).toBe(4);
        expect(rule.source?.scenes).toEqual(['chat']);
        expect(alchemyInstructions([rule], 'online', {}, '正常聊天')).toEqual([original.aiPrompt]);
        const result = applyStoryRegex('<court>{"title":"委屈裁决"}</court>',
            alchemyRulesFor([rule], 'online'), 'display');
        expect(result.cards).toHaveLength(1);
        expect(result.cards[0].html).toContain('委屈裁决');
        const frame = buildAlchemySandboxDocument(result.cards[0].html);
        expect(frame.srcDoc).toContain('background:#eee');
        expect(frame.srcDoc).toContain('<h2>委屈裁决</h2>');
        expect(alchemyRulesForMeeting([rule])).toEqual([]);
    });
});
