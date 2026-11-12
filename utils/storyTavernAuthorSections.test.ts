import { describe, expect, it } from 'vitest';
import {
    BUILTIN_NIGHT_SCREENING_PRESET, compileStoryPreset, getStoryTavernAuthorSections,
    parseStoryTheaterPreset, resolveStoryPresetImport, selectStoryTavernAuthorOption, storyPresetPromptKind,
} from './storyTheater';

type Entry = { id: string; name: string; content: string; enabled: boolean; role?: 'system' | 'assistant' | 'user' };
const make = (filename: string, entries: Entry[], sourceGroups: any[] = []) => parseStoryTheaterPreset(JSON.stringify({
    prompts: entries.map(p => ({ identifier: p.id, name: p.name, role: p.role || 'system', content: p.content })),
    prompt_order: [{ character_id: 100001, order: entries.map(p => ({ identifier: p.id, enabled: p.enabled })) }],
    extensions: { entryGrouping: sourceGroups, regex_scripts: [{ disabled: false, findRegex: '[abc]' }] },
}), filename);
const compiled = (preset: ReturnType<typeof make>) =>
    compileStoryPreset({ preset, slots: { actors: '角色资料', persona: '身份',
        scenario: '剧情', worldBefore: '', worldAfter: '', history: '' },
    userName: '用户', characterNames: ['角色'] }).messages.map(msg => msg.content).join('\n');

describe('各作者原生分组的真实行为：不把宝宝我是char套给其他作者', () => {
    it('智能区分空白、Lite无效占位、结构包裹与真实规则，不删除原文或重排', () => {
        const entries: Entry[] = [
            { id: 'blank', name: '留空', content: '   ', enabled: true },
            { id: 'comment', name: '注释', content: '<!--作者备注-->', enabled: false },
            { id: 'lite', name: '扩展未包含', content: '[Lite未包含此扩展.]', enabled: true },
            { id: 'xml', name: 'XML 开头', content: '<branch>', enabled: true },
            { id: 'headline', name: '<==文风▣▣说明==>', content: '作者实际补充规则，不能隐藏', enabled: true },
            { id: 'real-lite', name: '可选补充规则', content: 'Lite未包含此扩展，但作者另有独立要求', enabled: true },
            { id: 'macro', name: '变量选择', content: '{{setvar::tone::暖光}}', enabled: true },
            { id: 'rule', name: '原作者正文', content: '这里是作者真正的写作要求', enabled: false },
        ];
        const preset = make('原作空条目与有用预设.json', entries, [
            { id: 'choices', name: '自选模块', memberIdentifiers: entries.map(entry => entry.id) },
        ]);
        expect(preset.document.prompts.map(storyPresetPromptKind))
            .toEqual(['empty', 'empty', 'placeholder', 'structure', 'content', 'content', 'content', 'content']);
        const section = getStoryTavernAuthorSections(preset.document).find(item => item.label === '自选模块');
        expect(section?.options.map(option => option.id)).toEqual(['st-real-lite', 'st-macro', 'st-rule']);
        expect(preset.document.prompts.map(prompt => prompt.content)).toEqual(entries.map(entry => entry.content));
        expect(preset.document.prompts.map(prompt => prompt.enabled)).toEqual(entries.map(entry => entry.enabled));
    });
    it('完全陌生的分组名与选项名：读取结构化作者元数据，真实互斥，不套内置预设按钮', () => {
        const p = make('从未见过的作者-梦境.json', [
            { id: 'a', name: '晨星', content: 'ONLY-CARD-DAWN', enabled: true },
            { id: 'b', name: '晦夜', content: 'ONLY-CARD-DUSK', enabled: false },
            { id: 'base', name: '必开底座', content: 'NEVER-REMOVE-CORE', enabled: true },
        ], [
            { id: 'dream', name: '月潮调色盘（任选其一）', memberIdentifiers: ['a', 'b'] },
            { id: 'core', name: '预设头部', memberIdentifiers: ['base'] },
        ]);
        const sections = getStoryTavernAuthorSections(p.document);
        const dream = sections.find(section => section.label.includes('月潮调色盘'));
        expect(dream?.options.map(option => option.label)).toEqual(['晨星', '晦夜']);
        expect(dream?.single).toBe(true);
        expect(sections.some(section => section.label === '预设头部')).toBe(false);
        const switched = selectStoryTavernAuthorOption(p.document, dream!.key, 'st-b');
        expect(switched.prompts.find(prompt => prompt.id === 'st-a')?.enabled).toBe(false);
        expect(switched.prompts.find(prompt => prompt.id === 'st-b')?.enabled).toBe(true);
        const sent = compiled({ ...p, document: switched });
        expect(sent).toContain('ONLY-CARD-DUSK');
        expect(sent).not.toContain('ONLY-CARD-DAWN');
        expect(sent).toContain('NEVER-REMOVE-CORE');
        expect(JSON.stringify(sections)).not.toContain('汽水日常');
    });

    it('陌生的独立功能开关：一个已开启，不代表整组必须互斥', () => {
        const p = make('未知模块.json', [
            { id: 'a', name: '星河扫描', content: 'STAR-SCAN-ENABLED', enabled: true },
            { id: 'b', name: '逆光存档', content: 'BACKLIGHT-ARCHIVE', enabled: false },
            { id: 'c', name: '余辉归档', content: 'AFTERGLOW-NOTE', enabled: false },
        ], [{ id: 'arbitrary', name: '星海电台', memberIdentifiers: ['a', 'b', 'c'] }]);
        const sec = getStoryTavernAuthorSections(p.document).find(section => section.label === '星海电台')!;
        expect(sec?.single).toBe(false);
        const both = selectStoryTavernAuthorOption(p.document, sec.key, 'st-b');
        expect(both.prompts.find(prompt => prompt.id === 'st-a')?.enabled).toBe(true);
        expect(both.prompts.find(prompt => prompt.id === 'st-b')?.enabled).toBe(true);
        const sent = compiled({ ...p, document: both });
        expect(sent).toContain('STAR-SCAN-ENABLED');
        expect(sent).toContain('BACKLIGHT-ARCHIVE');
        const original = selectStoryTavernAuthorOption(both, sec.key, 'st-b');
        expect(original.prompts.find(prompt => prompt.id === 'st-b')?.enabled).toBe(false);
        expect(original.prompts.find(prompt => prompt.id === 'st-a')?.enabled).toBe(true);
    });

    it('完全未知的装饰标题：即使不含文风/人称等关键词，也能找到作者真实模块', () => {
        const p = make('从未见过的装饰标题.json', [
            { id: 'start', name: '╭── 星屿仪式 ──╮', content: '章节边界', enabled: true },
            { id: 'a', name: '青柠色', content: 'AUTHOR-TINT-LIME', enabled: true },
            { id: 'b', name: '静谧蓝', content: 'AUTHOR-TINT-BLUE', enabled: false },
            { id: 'end', name: '╰── 星屿仪式 ──╯', content: '章节收束', enabled: true },
        ]);
        const sec = getStoryTavernAuthorSections(p.document).find(section => section.label === '星屿仪式');
        expect(sec?.options.map(option => option.label)).toEqual(['青柠色', '静谧蓝']);
        expect(sec?.options.some(option => option.id === 'st-start')).toBe(false);
    });

    it('无元数据无分隔标题：纯新造变量名与同前缀条目仍能分组，切换值要到达模型', () => {
        const p = make('完全未知变量方言.json', [
            { id: 'a', name: '霓光方案', content: '{{setvar::starlightInk::紫罗兰}}', enabled: true },
            { id: 'b', name: '烛照方案', content: '{{setvar::starlightInk::冬青蓝}}', enabled: false },
            { id: 'client', name: '故事正文', content: 'WRITER-INSTRUCTION: {{getvar::starlightInk}}', enabled: true },
            { id: 'first', name: '绘色：雾绿', content: 'EXTRA-MIST-GREEN', enabled: false },
            { id: 'second', name: '绘色：暖橙', content: 'EXTRA-WARM-ORANGE', enabled: false },
        ]);
        const sections = getStoryTavernAuthorSections(p.document);
        const variable = sections.find(s => s.label === 'starlightInk')!;
        expect(variable?.options).toHaveLength(2);
        expect(variable?.options.find(x => x.id === 'st-a')?.preview).toBe('紫罗兰');
        const before = compiled(p);
        expect(before).toContain('WRITER-INSTRUCTION: 紫罗兰');
        const changed = selectStoryTavernAuthorOption(p.document, variable.key, 'st-b');
        const after = compiled({ ...p, document: changed });
        expect(after).toContain('WRITER-INSTRUCTION: 冬青蓝');
        expect(after).not.toContain('WRITER-INSTRUCTION: 紫罗兰');
        const prefix = sections.find(s => s.label === '绘色')!;
        expect(prefix?.options.map(x => x.label)).toEqual(['绘色：雾绿', '绘色：暖橙']);
    });

    it('陌生作者的 XML 选项外壳：点击元数据分组时补开关闭的首尾标签，实际随规则发送', () => {
        const p = make('虚构的异星作者.json', [
            { id: 'head', name: '奇梦开端', content: '<astral_mode>', enabled: false },
            { id: 'choice', name: '暮光方案', content: 'ASTRAL-ON-CHOICE', enabled: false },
            { id: 'tail', name: '奇梦闭合', content: '</astral_mode>', enabled: false },
        ], [{ id: 'alien', name: '波形梦境开关', startIdentifier: 'head', endIdentifier: 'tail' }]);
        const sec = getStoryTavernAuthorSections(p.document).find(s => s.label === '波形梦境开关')!;
        expect(sec?.options.map(x => x.label)).toEqual(['暮光方案']);
        const changed = selectStoryTavernAuthorOption(p.document, sec.key, 'st-choice');
        expect(changed.prompts.filter(x => x.enabled).map(x => x.id))
            .toEqual(['st-head', 'st-choice', 'st-tail']);
        const sent = compiled({ ...p, document: changed });
        expect(sent).toContain('<astral_mode>');
        expect(sent).toContain('ASTRAL-ON-CHOICE');
        expect(sent).toContain('</astral_mode>');
        const roundtrip = parseStoryTheaterPreset(JSON.stringify(changed), '保存重进.json');
        expect(getStoryTavernAuthorSections(roundtrip.document).some(x => x.label === '波形梦境开关')).toBe(true);
    });

    it('旧版已导入 MoM 预设重新导入时原地补齐作者分组，不复制和不重置原 ID、开关', () => {
        const source = make('老MoM.json', [
            { id: 'first', name: '文风-原版', content: '原作者旧选择 A', enabled: true },
            { id: 'second', name: '文风-新方案', content: '原作者候选 B', enabled: false },
        ], [{ id: 'from-author', name: '小说文风', memberIdentifiers: ['first', 'second'] }]);
        const { tavernEntryGroups: _old, ...legacyDoc } = source.document;
        const prior = { ...source, id: 'existing-user-preset', document: legacyDoc };
        const resolved = resolveStoryPresetImport(source, [prior]);
        expect(resolved.duplicate).toBe(true);
        expect(resolved.upgraded).toBe(true);
        expect(resolved.preset.id).toBe('existing-user-preset');
        expect(resolved.preset.document.prompts).toEqual(prior.document.prompts);
        expect(getStoryTavernAuthorSections(resolved.preset.document).some(s => s.label === '小说文风')).toBe(true);
        const repeat = resolveStoryPresetImport(source, [resolved.preset]);
        expect(repeat.duplicate).toBe(true);
        expect(repeat.upgraded).toBeUndefined();
    });

    it('蛾摩拉：优先采用作者元数据，小说类型、小说文风互不串组；保存后重读仍能切换', () => {
        const entries: Entry[] = [
            { id: 'genre1', name: '群像', content: '原作群像 A', enabled: true },
            { id: 'genre2', name: '言情', content: '原作言情 B', enabled: false },
            { id: 'style1', name: '文风-恋爱喜剧@电波系', content: '作者原文恋爱喜剧 C', enabled: true },
            { id: 'style2', name: '文风-诗童话', content: '作者原文诗童话 D', enabled: false },
            { id: 'must', name: 'set-不要关', content: '原作核心不动 E', enabled: true },
        ];
        const groups = [
            { id: 'novel-genre', name: '小说类型（选一）', memberIdentifiers: ['genre1', 'genre2'] },
            { id: 'novel-style', name: '小说文风（选一）', memberIdentifiers: ['style1', 'style2'] },
            { id: 'author-header', name: '预设头部', memberIdentifiers: ['must'] },
        ];
        const preset = make('蛾摩拉2.3-GC.json', entries, groups);
        const sections = getStoryTavernAuthorSections(preset.document);
        const titles = sections.map(s => s.label);
        expect(titles).toContain('小说类型（选一）');
        expect(titles).toContain('小说文风（选一）');
        expect(titles).not.toContain('预设头部');
        const style = sections.find(s => s.label === '小说文风（选一）')!;
        expect(style.options.map(x => x.label)).toEqual(['文风-恋爱喜剧@电波系', '文风-诗童话']);
        const switched = selectStoryTavernAuthorOption(preset.document, style.key, 'st-style2');
        expect(switched.prompts.find(p => p.id === 'st-style1')?.enabled).toBe(false);
        expect(switched.prompts.find(p => p.id === 'st-style2')?.enabled).toBe(true);
        expect(switched.prompts.find(p => p.id === 'st-genre1')?.enabled).toBe(true);
        expect(switched.prompts.find(p => p.id === 'st-must')?.enabled).toBe(true);
        const reopened = parseStoryTheaterPreset(JSON.stringify(switched), '重进.json');
        expect(getStoryTavernAuthorSections(reopened.document).find(s => s.label === '小说文风（选一）')?.options.length).toBe(2);
        const output = compiled({ ...preset, document: reopened.document });
        expect(output).toContain('作者原文诗童话 D');
        expect(output).not.toContain('作者原文恋爱喜剧 C');
        expect(output).toContain('原作核心不动 E');
        expect(JSON.stringify(reopened.document)).not.toContain('[abc]');
    });

    it('象牙塔：从 start/end 标识识别作者小剧场分组，不需要固定内置选项', () => {
        const p = make('象牙塔2.3.json', [
            { id: 'start', name: '╔小剧场开启╗', content: '<theater>', enabled: true },
            { id: 'aurora', name: '🎪极光交互小剧场', content: '作者极光小剧场 A', enabled: false },
            { id: 'plain', name: '🎪简约文字小剧场', content: '作者简约小剧场 B', enabled: true },
            { id: 'end', name: '╚小剧场结束╝', content: '</theater>', enabled: true },
            { id: 'base', name: '核心规则不要关', content: '基础剧情设定 C', enabled: true },
        ], [{ id: 'theater-source', name: '🎪小剧场（选一）', startIdentifier: 'start', endIdentifier: 'end' }]);
        const section = getStoryTavernAuthorSections(p.document).find(s => s.label === '🎪小剧场（选一）')!;
        expect(section.options.map(o => o.label)).toEqual(['🎪极光交互小剧场', '🎪简约文字小剧场']);
        const changed = selectStoryTavernAuthorOption(p.document, section.key, 'st-aurora');
        expect(changed.prompts.find(o => o.id === 'st-aurora')?.enabled).toBe(true);
        expect(changed.prompts.find(o => o.id === 'st-plain')?.enabled).toBe(false);
        expect(changed.prompts.find(o => o.id === 'st-base')?.enabled).toBe(true);
    });

    it('MoM5.40 默认关闭的可选文风：能开启也能关闭，不能误当作者必选', () => {
        const p = make('MoM5.40-可选风格.json', [
            { id: 'head', name: '——📌⬇️文风区⬇️——', content: '<writing_style>', enabled: true },
            { id: 'light', name: '⌨️轻松文风', content: '作者轻松文风', enabled: false },
            { id: 'dark', name: '⌨️现实文风', content: '作者现实文风', enabled: false },
            { id: 'end', name: '——📌⬆️文风区⬆️——', content: '</writing_style>', enabled: true },
        ]);
        const section = getStoryTavernAuthorSections(p.document).find(s => s.options.some(o => o.id === 'st-light'))!;
        expect(section.single).toBe(false);
        const on = selectStoryTavernAuthorOption(p.document, section.key, 'st-light');
        expect(on.prompts.find(x => x.id === 'st-light')?.enabled).toBe(true);
        const off = selectStoryTavernAuthorOption(on, section.key, 'st-light');
        expect(off.prompts.find(x => x.id === 'st-light')?.enabled).toBe(false);
        expect(off.prompts.find(x => x.id === 'st-head')?.enabled).toBe(true);
    });

    it('MoM5.40：同组的四选一小剧场切换，不应关闭独立开启的随机小剧场', () => {
        const p = make('MoM5.40.json', [
            { id: 'open', name: '===💡⬇️小剧场区⬇️💡===', content: '<theater>', enabled: true },
            { id: 'a', name: '💡4选1🌌 极光小剧场@电波系', content: '原作者极光 A', enabled: true },
            { id: 'b', name: '💡4选1❄️小回小剧场@小回', content: '原作者小回 B', enabled: false },
            { id: 'random', name: '🔦完全随机小剧场', content: '原作者随机 C', enabled: true },
            { id: 'close', name: '===⬆️小剧场区⬆️===', content: '</theater>', enabled: true },
        ]);
        const section = getStoryTavernAuthorSections(p.document).find(s => /小剧场/.test(s.label) && s.options.some(o => o.id === 'st-b'))!;
        expect(section).toBeDefined();
        const result = selectStoryTavernAuthorOption(p.document, section.key, 'st-b');
        expect(result.prompts.find(o => o.id === 'st-a')?.enabled).toBe(false);
        expect(result.prompts.find(o => o.id === 'st-b')?.enabled).toBe(true);
        expect(result.prompts.find(o => o.id === 'st-random')?.enabled).toBe(true);
    });

    it('Phantasm：文风择一不能误关可叠加风格、修辞白描与表现手法', () => {
        const p = make('Phantasm1.81.json', [
            { id: 'head', name: '▍文风 [择一]', content: '选一个主文风', enabled: true },
            { id: 'default', name: '📘轻快自然', content: '原作者轻快 A', enabled: true },
            { id: 'alt', name: '📘慢活治愈', content: '原作者治愈 B', enabled: false },
            { id: 'overlay', name: '📒轻小说 [可叠加]', content: '原作者叠加 C', enabled: true },
            { id: 'tech', name: '✏ 表现&修辞手法', content: '修辞说明 D', enabled: true },
            { id: 'plain', name: '📙白描', content: '作者白描 E', enabled: true },
            { id: 'next', name: '▍功能&守则', content: '以下其他功能', enabled: true },
        ]);
        const section = getStoryTavernAuthorSections(p.document).find(s => /文风/.test(s.label) && s.options.some(o => o.id === 'st-alt'))!;
        expect(section).toBeDefined();
        expect(section.single).toBe(true);
        const separate = getStoryTavernAuthorSections(p.document);
        expect(separate.some(s => s.label === '可叠加文体' && s.options.some(o => o.id === 'st-overlay'))).toBe(true);
        expect(separate.some(s => s.label.includes('表现&修辞手法') && s.options.some(o => o.id === 'st-plain'))).toBe(true);
        expect(section.options.some(o => o.id === 'st-overlay')).toBe(false);
        const changed = selectStoryTavernAuthorOption(p.document, section.key, 'st-alt');
        expect(changed.prompts.find(o => o.id === 'st-default')?.enabled).toBe(false);
        expect(changed.prompts.find(o => o.id === 'st-alt')?.enabled).toBe(true);
        expect(changed.prompts.find(o => o.id === 'st-overlay')?.enabled).toBe(true);
        expect(changed.prompts.find(o => o.id === 'st-plain')?.enabled).toBe(true);
        const output = compiled({ ...p, document: changed });
        expect(output).toContain('原作者治愈 B');
        expect(output).toContain('原作者叠加 C');
        expect(output).toContain('作者白描 E');
        expect(output).not.toContain('原作者轻快 A');
    });

    it('老预设：宝宝、冥王星、Akover、Mur、Janus具有不同来源类别；原生内置不被修改', () => {
        const cases = [
            { name: '宝宝我是char', heading: '<==抢话▣▣权限==>', a: '▢不抢', b: '▢微量', expect: /抢话/ },
            { name: '冥王星', heading: '——📌⬇️文风选择⬇️——', a: '💛文风-港风', b: '💛文风-古风', expect: /文风/ },
            { name: 'Akover', heading: '——🗂️文风设置——', a: '✅主文风: 严肃', b: '✅主文风: 轻小说', expect: /文风/ },
            { name: 'Mur 鹿鹿', heading: '--------文风----', a: '文风', b: '自缝文风放置处', expect: /文风/ },
            { name: 'Janus', heading: '---文风模式2选1---', a: '👻动态-内置文风', b: '👻固态-自定义文风', expect: /文风/ },
        ];
        for (const [index, item] of cases.entries()) {
            const p = make(item.name + '.json', [
                { id: 'h', name: item.heading, content: '作者标题', enabled: true },
                { id: 'one', name: item.a, content: '原作者内容A' + index, enabled: true },
                { id: 'two', name: item.b, content: '原作者内容B' + index, enabled: false },
            ]);
            const sections = getStoryTavernAuthorSections(p.document);
            expect(sections.some(s => item.expect.test(s.label)
                || s.options.some(o => item.expect.test(o.label)))).toBe(true);
            expect(JSON.stringify(sections)).not.toContain('汽水日常');
        }
        expect(getStoryTavernAuthorSections(BUILTIN_NIGHT_SCREENING_PRESET.document)).toEqual([]);
    });
    it('普通作者分组不能因刚好一项开启而擅自成为单选', () => {
        const preset=make('普通作者配置.json',[
            {id:'a',name:'晨色',content:'不是用来推断单选的作者正文',enabled:true},
            {id:'b',name:'暮色',content:'即使正文出现排他字眼也不表示格式声明',enabled:false},
            {id:'core',name:'核心规则',content:'其它设置',enabled:true},
        ],[{id:'styles',name:'小说文风',memberIdentifiers:['a','b']}]);
        const sections=getStoryTavernAuthorSections(preset.document);
        const sec=sections.find(x=>x.label==='小说文风')!;
        expect(sec.single).toBe(false);
        expect(sec.options.map(x=>x.enabled)).toEqual([true,false]);
        const next=selectStoryTavernAuthorOption(preset.document,sec.key,'st-b');
        expect(next.prompts.map(p=>p.enabled)).toEqual([true,true,true]);
        expect(preset.document.prompts.map(p=>p.enabled)).toEqual([true,false,true]);
    });

    it('酒馆装饰标题尾注每单仅一可精准识别，只动本组的原作者开关', () => {
        const preset=make('作者全新装饰标题.json',[
            {id:'head',name:'┌ 酒标 ┐每单仅一',content:'<tag>',enabled:true},
            {id:'a',name:'第一种',content:'作者格式A',enabled:true},
            {id:'b',name:'第二种',content:'作者格式B',enabled:false},
            {id:'tail',name:'└ 酒标 ┘',content:'</tag>',enabled:true},
            {id:'unrelated',name:'独立开关',content:'不属于本组',enabled:true},
        ],[{id:'label',name:'酒标',startIdentifier:'head',endIdentifier:'tail'}]);
        const section=getStoryTavernAuthorSections(preset.document).find(x=>x.label==='酒标')!;
        expect(section.single).toBe(true);
        expect(section.options.map(x=>x.id)).toEqual(['st-a','st-b']);
        const changed=selectStoryTavernAuthorOption(preset.document,section.key,'st-b');
        expect(changed.prompts.map(p=>p.enabled)).toEqual([true,false,true,true,true]);
    });

    it('没有明显单选标志：共同 XML/变量名也不误关，只有本人点击才改变开关', () => {
        const preset=make('文字内容完全不同但格式相同.json',[
            {id:'a',name:'方案：星',content:'<rule name="tone">第一种正文</rule>',enabled:true},
            {id:'b',name:'方案：月',content:'<rule name="tone">第二种正文</rule>',enabled:false},
            {id:'stable',name:'主线正文',content:'常驻',enabled:true},
        ],[{id:'mode',name:'方案',memberIdentifiers:['a','b']}]);
        const sec=getStoryTavernAuthorSections(preset.document).find(x=>x.label==='方案')!;
        expect(sec.single).toBe(false);
        const changed=selectStoryTavernAuthorOption(preset.document,sec.key,'st-b');
        expect(changed.prompts.map(p=>p.enabled)).toEqual([true,true,true]);
        expect(changed.prompts.map(p=>p.content)).toEqual(preset.document.prompts.map(p=>p.content));
    });

    it('原作者即使同时打开两个互斥选项，导入时仍按作者原样保留，不主动纠正', () => {
        const preset=make('作者状态优先.json',[
            {id:'a',name:'第一选项',content:'正文A',enabled:true},
            {id:'b',name:'第二选项',content:'正文B',enabled:true},
            {id:'c',name:'第三选项',content:'正文C',enabled:false},
        ],[{id:'choose',name:'作者声明（选一）',memberIdentifiers:['a','b','c']}]);
        const sec=getStoryTavernAuthorSections(preset.document)[0];
        expect(sec.single).toBe(true);
        expect(sec.options.map(x=>x.enabled)).toEqual([true,true,false]);
        const changed=selectStoryTavernAuthorOption(preset.document,sec.key,'st-c');
        expect(changed.prompts.map(p=>p.enabled)).toEqual([false,false,true]);
    });

});
