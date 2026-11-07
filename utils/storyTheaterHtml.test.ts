// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseStoryDisplayBlocks } from './storyTheater';
import { hasStoryHtmlLayout, sanitizeStoryScopedCss, sanitizeStoryTheaterHtml } from './storyTheaterHtml';

describe('剧情小剧场：酒馆嵌套结构、HTML/CSS 和安全退化', () => {
    it('把带 HTML 和两层 details 的小剧场隔离为一段附录，前后正文顺序不变', () => {
        const raw = '<content>正文开始。<sidestory><details data-fate="side_theater">'
            + '<summary>剧场标题</summary><div class="panel" style="color:purple">'
            + '<details><summary>内层秘密</summary><p>内层完整内容</p></details>'
            + '<table><tr><td>表格A</td><td>表格B</td></tr></table>'
            + '</div></details></sidestory>正文结束。</content>';
        const blocks = parseStoryDisplayBlocks(raw, true);
        expect(blocks.map(b => b.kind)).toEqual(['story', 'tavern-extra', 'story']);
        expect(blocks[0].text).toBe('正文开始。');
        expect(blocks[1].text).toContain('内层完整内容');
        expect(blocks[1].text).toContain('表格A');
        expect(blocks[1].text).toContain('表格B');
        expect(blocks[1].htmlSource).toContain('<table>');
        expect(blocks[2].text).toBe('正文结束。');
        expect(blocks.filter(b => b.kind === 'story').map(b => b.text).join('')).not.toContain('内层完整内容');
    });

    it('可以识别 details 的摘要、剧情选项和旁支剧场，并保留未见过的折叠附件', () => {
        const input = '<content>叙事.'
            + '<details data-info="archive"><summary>摘要</summary><p>事件完整摘要</p></details>'
            + '<details data-fate="destiny"><summary>命运</summary><p>选择甲</p></details>'
            + '<details data-fate="side_theater"><summary>幕间</summary><p>番外文字</p></details>'
            + '<details><summary>另一段附录</summary><div><b>作者额外内容</b></div></details>'
            + '落幕。</content>';
        const blocks = parseStoryDisplayBlocks(input, true);
        expect(blocks.map(b => b.kind)).toEqual(['story', 'tavern-extra', 'tavern-extra', 'tavern-extra', 'tavern-extra', 'story']);
        expect(blocks.slice(1, 5).map(b => b.title)).toEqual(['剧情摘要', '剧情选项', '小剧场附录', '另一段附录']);
        expect(blocks[4].text).toContain('作者额外内容');
    });

    it('带结构化 mt_ai/mt_user 的酒馆小剧场变成原生消息卡片，叙事不被拆成伪聊天', () => {
        const mixed = '<story_text>窗外下雨。</story_text><sidestory>'
            + '<mt_title>午夜频道</mt_title>'
            + '<mt_ai><name>系统</name><text>雨又下起来了。</text></mt_ai>'
            + '<mt_user><name>角色</name><text>听到了。</text></mt_user>'
            + '</sidestory><RandomTheater>不是对话卡片，仅是幕间散文。</RandomTheater>';
        const blocks = parseStoryDisplayBlocks(mixed, true);
        expect(blocks.map(b => b.kind)).toEqual(['story', 'theater', 'tavern-extra']);
        expect(blocks[1].theater?.messages.map(m => m.text)).toEqual(['雨又下起来了。', '听到了。']);
        expect(blocks[2].text).toContain('不是对话卡片');
        expect(blocks[2].theater).toBeUndefined();
    });

    it('常见 HTML 卡片、表格和样式保留在隔离布局，不污染原生剧情模式', () => {
        const raw = '<style>.panel{background-color:#faf1fa}.panel p{color:#734}</style>'
            + '<div class="panel"><h3>剧场标题</h3><p>附录正文</p>'
            + '<table><tr><th>名字</th></tr><tr><td>角色A</td></tr></table></div>';
        const result = parseStoryDisplayBlocks(raw, true);
        expect(result.map(b => b.kind)).toEqual(['html']);
        expect(result[0].htmlSource).toContain('<style>');
        const clean = sanitizeStoryTheaterHtml(result[0].htmlSource!);
        expect(clean.srcDoc).toContain('.story-theater-html-content .panel{background-color:#faf1fa}');
        expect(clean.srcDoc).toContain('<table>');
        expect(clean.srcDoc).toContain('角色A');
        expect(clean.srcDoc).toContain('Content-Security-Policy');
        expect(hasStoryHtmlLayout(raw)).toBe(true);
        const native = parseStoryDisplayBlocks(raw, false);
        expect(native.every(block => block.kind !== 'html')).toBe(true);
    });

    it('可见正文与纯样式/危险脚本区分，不把空白冒充已转换成功', () => {
        const raw = '<sidestory><script>window.intrusion=true</script><style>.x{color:red}</style></sidestory>';
        const parsed = parseStoryDisplayBlocks(raw, true);
        // Pure scripts/styles are neither executed nor displayed as content.
        expect(parsed.every(b => b.kind !== 'story' || !b.text.includes('intrusion'))).toBe(true);
        const stripped = sanitizeStoryTheaterHtml('<script>window.intrusion=true</script><style>.x{color:red}</style>');
        expect(stripped.hasVisibleContent).toBe(false);
        expect(stripped.srcDoc).not.toContain('window.intrusion');
        const standalone = sanitizeStoryTheaterHtml('<div><img src="data:image/png;base64,aGVsbG8="></div>');
        expect(standalone.hasVisibleContent).toBe(true);
    });

    it('过滤 XSS 与恶意 CSS：脚本、事件、跨框架、导入、链接及可执行协议均不保留', () => {
        const hostile = '<style>@import url(https://evil.test/x.css);'
            + '.safe{color:#123456;background-image:url(https://evil.test/x)}'
            + '.good{border-radius:8px}</style>'
            + '<div class="safe" onclick="steal()" style="color:red;background-image:url(javascript:steal())">'
            + '安全正文<img src="javascript:alert(1)" onerror="evil()"><a href="javascript:alert(2)">链接字样</a>'
            + '<script>alert("boom")</script><iframe src="https://evil.test/frame"></iframe>'
            + '<svg onload="evil()"><text>svg 内容</text></svg><form action="https://evil.test"><input></form>'
            + '</div>';
        const clean = sanitizeStoryTheaterHtml(hostile);
        expect(clean.srcDoc).toContain('安全正文');
        expect(clean.srcDoc).toContain('链接字样');
        expect(clean.srcDoc).toContain('style="color:red"');
        expect(clean.srcDoc).toContain('.story-theater-html-content .good{border-radius:8px}');
        expect(clean.srcDoc).not.toContain('onclick=');
        expect(clean.srcDoc).not.toContain('onerror=');
        expect(clean.srcDoc).not.toContain('evil()');
        expect(clean.srcDoc).not.toContain('alert("boom")');
        expect(clean.srcDoc).not.toContain('javascript:alert');
        expect(clean.srcDoc).not.toContain('<iframe');
        expect(clean.srcDoc).not.toContain('<svg');
        expect(clean.srcDoc).not.toContain('<form');
        expect(clean.srcDoc).not.toContain('@import');
        expect(clean.srcDoc).not.toContain('https://evil.test');
        expect(sanitizeStoryScopedCss('body{color:red}.x{color:blue}@import url(https://evil.test);')).not.toContain('@import');
    });

    it('原生 <mini_theater> 若包含完整 HTML 布局，沿用折叠剧场且不丢美化正文', () => {
        const raw = '<mini_theater><div class="theater" style="border-radius:12px">'
            + '<h3>原生 HTML 小剧场</h3><p>人物还在舞台上</p></div></mini_theater>';
        const blocks = parseStoryDisplayBlocks(raw, false);
        expect(blocks).toHaveLength(1);
        expect(blocks[0].kind).toBe('html');
        expect(blocks[0].title).toBe('幕间剧场');
        expect(blocks[0].htmlSource).toContain('<h3>原生 HTML 小剧场</h3>');
        const safe = sanitizeStoryTheaterHtml(blocks[0].htmlSource!);
        expect(safe.srcDoc).toContain('人物还在舞台上');
        expect(safe.srcDoc).toContain('style="border-radius:12px"');
    });

    it('恶意 CSS 不能把作者正文悄悄隐藏，危险脚本也不进入纯文本保底', () => {
        const css = sanitizeStoryScopedCss('.hide{display:none;opacity:0;font-size:0px;color:green}');
        expect(css).not.toContain('display:none');
        expect(css).not.toContain('opacity:0');
        expect(css).not.toContain('font-size:0px');
        expect(css).toContain('color:green');
        const blocks = parseStoryDisplayBlocks(
            '<sidestory><div>可读的正文<script>secretPayload()</script></div></sidestory>', true,
        );
        expect(blocks[0].text).toContain('可读的正文');
        expect(blocks[0].text).not.toContain('secretPayload');
    });

    it('短篇小剧场沙箱不会撑出半屏空白，长篇仍可在限定高度内阅读', () => {
        const short = sanitizeStoryTheaterHtml(
            '<div><h3>短篇剧场</h3><p>一句台词。</p><details><summary>可展开附录</summary><p>隐藏的长说明</p></details></div>',
        );
        const long = sanitizeStoryTheaterHtml(
            '<div>' + Array.from({ length: 90 }, (_, index) => '<p>故事段落 ' + index + '：延续人物的剧情内容。</p>').join('') + '</div>',
        );
        expect(short.estimatedHeight).toBeGreaterThanOrEqual(76);
        expect(short.estimatedHeight).toBeLessThanOrEqual(160);
        expect(long.estimatedHeight).toBeGreaterThan(short.estimatedHeight);
        expect(long.estimatedHeight).toBeLessThanOrEqual(520);
        expect(short.srcDoc).toContain('隐藏的长说明');
    });

    it('超大 HTML 附录不能只显示前半段，必须退回完整可读正文', () => {
        const large = '<sidestory><div>' + '很长的作者正文。'.repeat(18000) + '尾部必须保留</div></sidestory>';
        const parsed = parseStoryDisplayBlocks(large, true);
        expect(parsed).toHaveLength(1);
        expect(parsed[0].text).toContain('尾部必须保留');
        const safe = sanitizeStoryTheaterHtml(parsed[0].htmlSource!);
        expect(safe.hasVisibleContent).toBe(false);
        expect(safe.text).toContain('完整文字');
    });

    it('未识别的旧式标签退回可读文字，不更改模型历史或原生迷你剧场协议', () => {
        const blocks = parseStoryDisplayBlocks('<unknown_theater>最重要的正文<b>不能丢</b></unknown_theater>', true);
        expect(blocks.map(b => b.text).join('')).toContain('最重要的正文');
        expect(blocks.map(b => b.text).join('')).toContain('不能丢');
        const native = parseStoryDisplayBlocks('<mini_theater><mt_title>原生</mt_title>'
            + '<mt_ai><name>助手</name><text>原生消息</text></mt_ai></mini_theater>', false);
        expect(native[0].kind).toBe('theater');
        expect(native[0].theater?.messages[0].text).toBe('原生消息');
    });
});
