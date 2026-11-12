// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseStoryDisplayBlocks, parseStoryTheaterPreset, compileStoryPreset, looksLikeLegacyTavernStoryOutput } from './storyTheater';
import { adaptTavernWritingInterlude, sanitizeStoryTheaterHtml } from './storyTheaterHtml';

// Synthetic protocol fragments from the user's five files. Their creative
// prose, full prompts and third-party regex implementations stay private.
const blocks = (value: string) => parseStoryDisplayBlocks(value, true);
const visible = (value: string) => blocks(value).map(b => b.text).join('\n');
const fields = '[Header|片刻留白|MIDNIGHT][Tags|静夜|书信|雨声]'
    + '[Meta|凌晨|车站|二人][Content|一封旧信放在桌面。]'
    + '[Dialogue|有人敲门|她应了一声|风吹动纸页|门外静下来]'
    + '[Quote|我们仍有故事|The story continues.]';

describe('万事成真 ECoT 与 MoM 附录兼容', () => {
    it('ECoT 单独折叠，正文、摘要、选项各成块', () => {
        const raw = '<ECoT>先检查人物关系和世界背景。</ECoT>'
            + '<content>真正的剧情正文。</content>'
            + '<meow_FM>serial:001\\nplot:先前事件</meow_FM>'
            + '<branches><details><summary>剧情选项</summary>A.继续交谈</details></branches>';
        const result = blocks(raw);
        expect(result.map(block => block.kind)).toEqual(['thinking', 'story', 'tavern-extra', 'tavern-extra']);
        expect(result[0].text).toContain('人物关系');
        expect(result[1].text).toBe('真正的剧情正文。');
        expect(result[2].title).toBe('剧情摘要');
        expect(result[2].text).toContain('先前事件');
        expect(result[3].title).toBe('剧情选项');
        expect(result[3].text).toContain('继续交谈');
        expect(result[1].text).not.toContain('人物关系');
    });
    it('缺少 </ECoT> 时在 <content> 边界恢复，正文不会被吞', () => {
        const result = blocks('<ECoT>思考段落未闭合<content>真实正文保留下来。</content>');
        expect(result.map(block => block.kind)).toEqual(['thinking', 'story']);
        expect(result[0].text).toBe('思考段落未闭合');
        expect(result[1].text).toBe('真实正文保留下来。');
    });
    it('只有未闭合 ECoT 时保留折叠思考，不把思考误作正文', () => {
        expect(blocks('<ECoT>尚未完成的草稿').map(block => block.kind)).toEqual(['thinking']);
        expect(looksLikeLegacyTavernStoryOutput('<ECoT>以前的思考</ECoT>')).toBe(true);
    });
    it('标准思考格式与原生剧情显示互不影响', () => {
        expect(blocks('<think>独立思考</think><content>正文</content>').map(block => block.kind)).toEqual(['thinking', 'story']);
        expect(parseStoryDisplayBlocks('<story_text>原生正文</story_text>', false).map(block => block.kind)).toEqual(['story']);
    });
});

describe('真实酒馆五份预设的输出格式交叉审计', () => {
    it('冥王星 RandomTheater 和 Episode 各自成折叠附录，正文不被吞掉', () => {
        const raw = '<content>正文开头。</content>'
            + '<RandomTheater><details><summary>随机剧场</summary><div style="color:purple">小剧场一号</div></details></RandomTheater>'
            + '<Episode><details><summary>主题剧场</summary><div>小剧场二号</div></details></Episode>'
            + '<content>正文结尾。</content>';
        const found = blocks(raw);
        expect(found.map(b => b.kind)).toEqual(['story','tavern-extra','tavern-extra','story']);
        expect(found[1].text).toContain('小剧场一号');
        expect(found[2].text).toContain('小剧场二号');
        expect(found[2].htmlSource).toContain('<div>');
        expect(found[0].text).toBe('正文开头。');
        expect(found[3].text).toBe('正文结尾。');
    });
    it('Akover 小剧场多折叠、draft 摘要和 microlist 均和正文隔离', () => {
        const raw = '<thinking>内部推演</thinking><content>小说正文。</content>'
            + '<draft><details><summary>摘要</summary>故事记录<details><summary>伏笔</summary>重要线索</details></details></draft>'
            + '<microlist>之后去书店</microlist>'
            + '<sidestory><details><summary>第一幕</summary><div>剧场一</div></details>'
            + '<details><summary>第二幕</summary><table><tr><td>剧场二</td></tr></table></details></sidestory>';
        const found = blocks(raw);
        expect(found.map(b => b.kind)).toEqual(['thinking','story','tavern-extra','tavern-extra','tavern-extra']);
        expect(found[4].text).toContain('剧场一');
        expect(found[4].text).toContain('剧场二');
        expect(found[4].htmlSource).toContain('<table>');
        expect(found[2].text).toContain('重要线索');
        expect(found[3].text).toContain('之后去书店');
        expect(found[1].text).toBe('小说正文。');
    });
    it('Akover 的 Header/Tags/Meta/Content/Dialogue/Quote 美化可无正则运行', () => {
        const found = blocks('<content>剧情。</content><writing_interlude>' + fields + '</writing_interlude>');
        expect(found.map(b => b.kind)).toEqual(['story','tavern-extra']);
        expect(found[1].htmlSource).toContain('story-tavern-writing-interlude');
        const safe = sanitizeStoryTheaterHtml(found[1].htmlSource!);
        for(const part of ['片刻留白','MIDNIGHT','静夜','书信','雨声','凌晨','车站','二人',
            '一封旧信放在桌面。','有人敲门','她应了一声','风吹动纸页','门外静下来','我们仍有故事','The story continues.']) {
            expect(safe.text).toContain(part);
        }
        // Only the product-owned, nonce-locked height/touch bridge is present.
        // Tavern-authored scripts and event handlers remain forbidden.
        expect(safe.srcDoc).toContain('<script nonce="sully-story-template-runtime">');
        expect(safe.srcDoc).not.toContain('allow-same-origin');
        expect(safe.srcDoc).not.toContain('onerror=');
    });
    it('未识别或字段数不完整的写作间隙必须回退正文，不能删字', () => {
        expect(adaptTavernWritingInterlude('[Header|题目|Title][Content|不能丢]')).toBeUndefined();
        expect(adaptTavernWritingInterlude(fields + '多余的作者正文')).toBeUndefined();
        expect(visible('<writing_interlude>[Content|不完整也保留]</writing_interlude>')).toContain('不完整也保留');
    });
    it('Mur 多层摘要及 Janus 无专属小剧场标签时不捏造剧场', () => {
        const mur = blocks('<content>剧情。</content><abstract_format>'
            + '<details><summary>摘要</summary>人物行动<details><summary>伏笔</summary>线索</details></details>'
            + '</abstract_format>');
        expect(mur.map(b => b.kind)).toEqual(['story','tavern-extra']);
        expect(mur[1].text).toContain('线索');
        const janus = blocks('[OUTPUT_STRUCTURE]本轮没有小剧场，只有剧情。');
        expect(janus.map(b => b.kind)).toEqual(['story']);
        expect(janus[0].text).toContain('只有剧情');
    });
    it('宝宝我是char 的存档/选项/小剧场标记独立保留', () => {
        const found = blocks('<content>正文。</content>'
            + '<details data-info="archive"><summary>摘要</summary>核心摘要</details>'
            + '<details data-fate="destiny"><summary>选择</summary>未来道路</details>'
            + '<details data-fate="side_theater"><summary>剧场</summary><div>幕间正文</div></details>');
        expect(found.map(b => b.title)).toEqual([undefined, '剧情摘要', '剧情选项', '小剧场附录']);
        expect(found[3].htmlSource).toContain('幕间正文');
    });
    it('切换剧情预设后，旧消息按实际标签识别而不是被当前预设类型改写', () => {
        expect(looksLikeLegacyTavernStoryOutput('<sidestory><details>旧番外</details></sidestory>')).toBe(true);
        expect(looksLikeLegacyTavernStoryOutput('<content>旧酒馆正文</content>')).toBe(true);
        expect(looksLikeLegacyTavernStoryOutput('<Episode><details><summary>主题</summary>内容</details></Episode>')).toBe(true);
        expect(looksLikeLegacyTavernStoryOutput('<details data-info="archive">剧情档案</details>')).toBe(true);
        expect(looksLikeLegacyTavernStoryOutput('<mini_theater><mt_ai><name>原生角色</name><text>说话</text></mt_ai></mini_theater>')).toBe(false);
        expect(looksLikeLegacyTavernStoryOutput('没有任何标记的旧小说正文')).toBe(false);
    });

    it('预设自带正则只告警，不执行替换或写入剧情发送内容', () => {
        const fixture = JSON.stringify({
            prompts: [
                {identifier:'main',role:'system',content:'输出 <sidestory>作者原有的规则</sidestory>'},
                {identifier:'chatHistory',role:'system',marker:true,content:''},
            ],prompt_order:[{character_id:100001,order:[
                {identifier:'main',enabled:true},{identifier:'chatHistory',enabled:true},
            ]}],extensions:{regex_scripts:[{scriptName:'不执行的脚本',disabled:false,
                placement:[2],findRegex:'/(.*)/s',replaceString:'<script>attack()</script>'}]},
        });
        const preset = parseStoryTheaterPreset(fixture,'包含扩展.json');
        expect(preset.document.importWarnings?.join('')).toContain('启用正则');
        const compiled = compileStoryPreset({preset,userName:'用户',characterNames:['故事角色'],
            slots:{actors:'人物资料',persona:'身份',scenario:'剧情',worldBefore:'',worldAfter:'',history:''}});
        const result = compiled.messages.map(m=>m.content).join('\n');
        expect(result).toContain('作者原有的规则');
        expect(result).not.toContain('attack()');
    });
    it('两套独立小剧场自己的 CSS 不串场，防止导入多个作者美化造成错乱', () => {
        const found = blocks(
            '<sidestory><style>.box{color:red}</style><div class="box">第一个剧场</div></sidestory>'
            + '<sidestory><style>.box{color:blue}</style><div class="box">第二个剧场</div></sidestory>',
        );
        expect(found.map(b => b.kind)).toEqual(['tavern-extra','tavern-extra']);
        const first = sanitizeStoryTheaterHtml(found[0].htmlSource!).srcDoc;
        const second = sanitizeStoryTheaterHtml(found[1].htmlSource!).srcDoc;
        expect(first).toContain('.story-theater-html-content .box{color:red}');
        expect(first).not.toContain('.box{color:blue}');
        expect(second).toContain('.story-theater-html-content .box{color:blue}');
        expect(second).not.toContain('.box{color:red}');
    });
    it('安全 HTML 保留 details open，但拒绝远程图片、事件处理器和脚本', () => {
        const safe = sanitizeStoryTheaterHtml(
            '<details open><summary>打开</summary><p>内部正文</p></details>'
            + '<img src="https://tracker.invalid/secret.png" onerror="attack()">'
            + '<img src="data:image/png;base64,aGVsbG8="><script>steal()</script>',
        );
        expect(safe.srcDoc).toContain('<details open>');
        expect(safe.srcDoc).toContain('内部正文');
        expect(safe.srcDoc).not.toContain('tracker.invalid');
        expect(safe.srcDoc).toContain('[外部图片未加载]');
        expect(safe.srcDoc).not.toContain('onerror=');
        expect(safe.srcDoc).not.toContain('steal()');
        expect(safe.srcDoc).toContain('data:image/png;base64,aGVsbG8=');
        expect(safe.srcDoc).toContain('img-src data:');
    });
    it('作者代码围栏的 HTML 美化在沙箱中显示，隐藏格式符号', () => {
        const ticks=String.fromCharCode(96).repeat(3);
        const raw='<sidestory>' + ticks + 'html\n<div style="color:purple"><p>装饰文字</p></div>\n' + ticks + '</sidestory>';
        const found=blocks(raw);
        expect(found).toHaveLength(1);
        const safe=sanitizeStoryTheaterHtml(found[0].htmlSource!);
        expect(safe.text).toContain('装饰文字');
        expect(safe.text).not.toContain(ticks + 'html');
        expect(safe.srcDoc).toContain('style="color:purple"');
    });
});
