// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { StoryTheaterPresetDocument, StoryTheaterPresetPrompt } from '../types';
import { convertSillyTavernChatPreset } from './storySillyTavernImport';
import { restoreStoryTavernLegacyGroups } from './storyTavernLegacyGroups';
import { getStoryPresetPromptGroups, getStoryTavernAuthorSections, selectStoryTavernAuthorOption, recognizeTavernPromptHeading, moveStoryPresetPromptToGroup, addStoryPresetGroup, storyTavernHeadingTitle, storyPresetPromptKind, isStoryPresetBrowseVisible } from './storyTheater';

const prompt = (name: string, content = '', enabled = true, marker?: StoryTheaterPresetPrompt['marker']): StoryTheaterPresetPrompt => ({
    id: 'st-' + name, name, role: 'system', enabled, content, ...(marker ? { marker } : {}),
});
const document = (prompts: StoryTheaterPresetPrompt[]): StoryTheaterPresetDocument => ({
    name: '真实酒馆格式', sourceFormat: 'sillytavern', prompts,
    generation: { temperature: 1, topP: 1, frequencyPenalty: 0, presencePenalty: 0, maxTokens: 4096 },
} as StoryTheaterPresetDocument);

describe('酒馆预设浏览分类：明确标题，而不是所有空内容', () => {
    it('五份上传预设代表性分隔语法与正文不为空的标题', () => {
        const names = [
            '<==语言▣▣设置==>', '💙📌——↓世界活化↓——', '❤️📌==⬇️美学指导⬇️==',
            '--------文风----', '----- Think 开始', '——📌人物塑造——', '╓破限头部',
            '---USER设置---', '---COT开始---',
        ];
        for (const name of names) expect(recognizeTavernPromptHeading(prompt(name, '作者在标题里也写了正文'))).toBeDefined();
        expect(recognizeTavernPromptHeading(prompt('❤️📌==⬆️美学指导⬆️==', '收尾规则'))?.edge).toBe('end');
        expect(recognizeTavernPromptHeading(prompt('--------/文风-------', '结束规则'))?.edge).toBe('end');
        expect(recognizeTavernPromptHeading(prompt('---COT结束---', '结束规则'))?.edge).toBe('end');
    });
    it('空内容本身绝不是分类，禁误判旧 placeholder、空自缝、标准连接位', () => {
        for (const name of ['Main Prompt', 'Persona Description', '留给你缝', '🩵小剧场-留给你缝', '自缝文风放置处', '空条目', 'Chat History', 'None']) {
            expect(recognizeTavernPromptHeading(prompt(name, '', false))).toBeUndefined();
        }
        expect(recognizeTavernPromptHeading(prompt('---世界书设置---', '', true, 'world_before'))).toBeUndefined();
        expect(recognizeTavernPromptHeading(prompt('---世界书设置---', '', true))).toBeDefined();
        expect(recognizeTavernPromptHeading(prompt('随便的标签', ''))).toBeUndefined();
    });
    it('373 条宝宝我是char式格式自动分区后所有提示词只出现一次，原始内容/开关/顺序都不变', () => {
        const names = ['抢话','语言','视角','结尾','剧情','对话','人称','情绪','亲密'];
        const prompts = Array.from({length:373}, (_, i) =>
            i > 0 && i % 37 === 0
                ? { ...prompt('<==' + names[(i / 37 - 1) % names.length] + '▣▣设置==>'), id:'st-row-' + i }
                : { ...prompt(i % 19 === 0 ? '留给你缝' : '开关 '+i, i % 19 === 0 ? '' : '规则内容 '+i, i % 3 === 0), id:'st-row-' + i });
        const doc = document(prompts);
        const before = JSON.stringify(doc);
        const groups = getStoryPresetPromptGroups(doc);
        expect(groups.length).toBeGreaterThan(8);
        expect(groups.length).toBeLessThan(24);
        expect(groups.flatMap(group => group.promptIds)).toEqual(prompts.map(p => p.id));
        expect(new Set(groups.flatMap(group => group.promptIds)).size).toBe(373);
        expect(groups.every(group => group.autoGrouped === true)).toBe(true);
        expect(groups.some(group => group.label.includes('语言'))).toBe(true);
        expect(JSON.stringify(doc)).toBe(before);
        expect(moveStoryPresetPromptToGroup(doc, prompts[0].id, groups[2].key)).toBe(doc);
    });
    it('冥王星嵌套起止区间仍完整保留正文、分段位置和标准动态槽位', () => {
        const names = [
            ['说明别开','文字'], ['==⬇️美学指导⬇️==','这是作者的实际提示词'],
            ['电影创作','正文'], ['==⬆️美学指导⬆️==','关闭段落'],
            ['==⬇️叙事素材⬇️==','素材规则'],
            ['——↓世界活化↓——',''],['世界活化','规则'],
            ['——↑世界活化↑——',''],['Chat History',''],
            ['==⬆️叙事素材⬆️==','尾注'],
        ];
        const prompts = names.map(([name,content],i)=>({...prompt(name,content),id:'st-p'+i}));
        prompts[8].marker = 'history';
        const doc=document(prompts), snapshot=JSON.stringify(doc);
        const groups=getStoryPresetPromptGroups(doc);
        expect(groups.flatMap(g=>g.promptIds)).toEqual(prompts.map(p=>p.id));
        expect(groups.find(g=>g.label.includes('美学指导'))?.promptIds).toContain('st-p1');
        expect(groups.some(g=>g.promptIds.includes('st-p8'))).toBe(true);
        expect(JSON.stringify(doc)).toBe(snapshot);
    });
    it('无作者分隔标题的普通酒馆预设只显示一个浏览区，不凭空分组', () => {
        const doc = document([prompt('常规规则','有内容'),prompt('Main Prompt'),prompt('第3条','内容')]);
        const groups = getStoryPresetPromptGroups(doc);
        expect(groups).toHaveLength(1);
        expect(groups[0].promptIds).toEqual(doc.prompts.map(p=>p.id));
    });
    it('用户主动新建真实分组后仍可把酒馆条目移入，不会误写入虚拟分组', () => {
        const doc = document([prompt('---语言设置---','约束'),prompt('角色规则','正文'),prompt('自定义规则','补充')]);
        const withSection = addStoryPresetGroup(doc,'自己的分组');
        const real = getStoryPresetPromptGroups(withSection).find(group => group.customSectionId);
        expect(real).toBeDefined();
        const moved = moveStoryPresetPromptToGroup(withSection,doc.prompts[1].id,real!.key);
        expect(moved).not.toBe(withSection);
        expect(moved.prompts.find(p => p.id === doc.prompts[1].id)?.content).toBe('正文');
        expect(moved.prompts.filter(p => p.section?.edge === 'start')).toHaveLength(1);
        expect(moved.prompts.map(p => p.id).sort()).toEqual(withSection.prompts.map(p => p.id).sort());
        expect(getStoryPresetPromptGroups(moved).find(g => g.customSectionId)?.promptIds).toContain(doc.prompts[1].id);
    });
    it('原生糯米机内置分组与自定义条目规则不受酒馆分类影响', () => {
        const doc = { ...document([prompt('<==语言▣▣设置==>'),prompt('通常规则','文字')]), sourceFormat: undefined };
        const groups = getStoryPresetPromptGroups(doc);
        expect(groups).toHaveLength(1);
        expect(groups[0].label).toBe('自定义条目');
        expect(groups[0].autoGrouped).toBeUndefined();
    });
    it('导入 Chat Completion 后分类只显示在界面，重复序列化不生成新的 section 或改写 prompt_order', () => {
        const input = {
            prompts: [
                {identifier:'start',name:'---语言设置---',role:'system',content:'语言限制',marker:false},
                {identifier:'normal',name:'一般规则',role:'system',content:'正文'},
                {identifier:'empty',name:'Main Prompt',role:'system',content:'',marker:false},
            ],
            prompt_order: [{ character_id: 100001, order:[
                {identifier:'start',enabled:true},{identifier:'normal',enabled:false},{identifier:'empty',enabled:false},
            ]}],
        };
        const original = JSON.stringify(input);
        const doc = convertSillyTavernChatPreset(input,'原格式.json');
        const before = JSON.stringify(doc);
        const groups = getStoryPresetPromptGroups(doc);
        expect(groups.flatMap(g=>g.promptIds)).toEqual(doc.prompts.map(p=>p.id));
        expect(doc.prompts.map(p=>p.enabled)).toEqual([true,false,false]);
        expect(doc.prompts.every(p=>!p.section)).toBe(true);
        expect(JSON.stringify(doc)).toBe(before);
        expect(JSON.stringify(input)).toBe(original);
    });
    it('新酒馆 memberIdentifiers 分组按原始顺序显示，跨组不混条目', () => {
        const p = [prompt('甲','字 A'), prompt('乙','字 B'), prompt('丙','字 C'),
            prompt('丁','字 D'), prompt('戊','字 E')];
        const doc = {
            ...document(p),
            tavernEntryGroups: [
                { id: 'group-a', name: '作者甲区', memberIdentifiers: ['甲', '丙', '戊'] },
                { id: 'group-b', name: '作者乙区', memberIdentifiers: ['乙', '丁'] },
            ],
        };
        const before = JSON.stringify(doc);
        const groups = getStoryPresetPromptGroups(doc);
        expect(groups.flatMap(group => group.promptIds)).toEqual(p.map(item => item.id));
        expect(groups.map(group => group.label)).toEqual(['作者甲区','作者乙区','作者甲区','作者乙区','作者甲区']);
        expect(groups.every(group => group.autoGrouped)).toBe(true);
        expect(JSON.stringify(doc)).toBe(before);
    });

    it('新酒馆 start/end 边界有效才采用，失效边界安全回退', () => {
        const p = [prompt('前','A'), prompt('起',''), prompt('中','B'), prompt('止',''), prompt('后','C')];
        const doc = { ...document(p), tavernEntryGroups: [
            { id: 'range', name: '小说章节', startIdentifier: '起', endIdentifier: '止' },
            { id: 'invalid', name: '错误区间', startIdentifier: 'missing', endIdentifier: '止' },
        ] };
        const groups = getStoryPresetPromptGroups(doc);
        expect(groups.flatMap(group => group.promptIds)).toEqual(p.map(item => item.id));
        expect(groups.find(group => group.label === '小说章节')?.promptIds).toEqual(['st-起','st-中','st-止']);
        expect(groups.some(group => group.label === '错误区间')).toBe(false);
    });

    it('竖线标题与上下选一菜单按结构分段，原作选择只切换本区', () => {
        const p = [prompt('|—设置—|'), prompt('基础项','A'),
            prompt('▾▿▾▼选一▼▾▿▾'), prompt('选项甲','规则 A',true),
            prompt('选项乙','规则 B',false), prompt('▴▵▲选一▲▴▵▴'),
            prompt('|—下一节—|'), prompt('独立规则','C',true)];
        const doc = document(p), before = JSON.stringify(doc);
        expect(recognizeTavernPromptHeading(p[0])?.edge).toBe('divider');
        expect(recognizeTavernPromptHeading(p[2])?.edge).toBe('start');
        expect(recognizeTavernPromptHeading(p[5])?.edge).toBe('end');
        const groups = getStoryPresetPromptGroups(doc);
        expect(groups.flatMap(g => g.promptIds)).toEqual(p.map(x => x.id));
        const section = getStoryTavernAuthorSections(doc).find(s => s.label === '选一');
        expect(section?.options.map(option => option.id)).toEqual(['st-选项甲','st-选项乙']);
        expect(section?.single).toBe(true);
        const changed = selectStoryTavernAuthorOption(doc, section!.key, 'st-选项乙');
        expect(changed.prompts.map(x => x.content)).toEqual(p.map(x => x.content));
        expect(changed.prompts.find(x => x.id === 'st-选项甲')?.enabled).toBe(false);
        expect(changed.prompts.find(x => x.id === 'st-选项乙')?.enabled).toBe(true);
        expect(changed.prompts.find(x => x.id === 'st-独立规则')?.enabled).toBe(true);
        expect(JSON.stringify(doc)).toBe(before);
    });

    it('原作者选一名称形成独立选项组，正文原封不动', () => {
        const doc = document([
            prompt('🔸（选一）复述模式-扩写','<x>任意内容</x>',true),
            prompt('🔸（选一）复述模式-承接','<y>其它正文</y>',false),
            prompt('旁支必开','独立正文',true),
        ]);
        const section = getStoryTavernAuthorSections(doc).find(s => s.label === '复述模式');
        expect(section?.single).toBe(true);
        const changed = selectStoryTavernAuthorOption(doc, section!.key, 'st-🔸（选一）复述模式-承接');
        expect(changed.prompts.map(p => p.enabled)).toEqual([false,true,true]);
        expect(changed.prompts.map(p => p.content)).toEqual(doc.prompts.map(p => p.content));
    });

    it('超长装饰标题提取可读名称，空装饰不生成伪分类', () => {
        const names = [
            ['━━━━━━✨【世界书设置】✨━━━━━━', '世界书设置', 'divider'],
            ['╔━━━✦【叙事规则】✦━━━╗', '叙事规则', 'start'],
            ['╚━━━✦【叙事规则】✦━━━╝', '叙事规则', 'end'],
            ['✧━━━━━━━━━━━【写作 / 文风】━━━━━━━━━━━✧', '写作 / 文风', 'divider'],
            ['#====📚【语言设置】📚====#', '语言设置', 'divider'],
            ['--------文风----', '文风', 'divider'],
            ['<==抢话▣▣权限==>', '抢话权限', 'start'],
            ['┏╔拖拖📚文风╗┓', '拖拖文风', 'start'],
            ['▾▿▾▼选一▼▾▿▾', '选一', 'start'],
        ] as const;
        for (const [name, title, edge] of names) {
            expect(recognizeTavernPromptHeading(prompt(name))?.label, name).toBe(title);
            expect(recognizeTavernPromptHeading(prompt(name))?.edge, name).toBe(edge);
        }
        const veryLong = '━━'.repeat(75) + '【真实大标题】' + '═'.repeat(80);
        expect(recognizeTavernPromptHeading(prompt(veryLong))?.label).toBe('真实大标题');
        for (const name of [
            '━━━━━━✧✦✨━━━━━━', '----', '╭──────╮', '普通条目', '正文列表-作者A',
        ]) expect(recognizeTavernPromptHeading(prompt(name))).toBeUndefined();
        expect(storyTavernHeadingTitle('写作风格 [择一]')).toBe('写作风格 [择一]');
    });

    it('分组仅为界面视图：装饰标题成为分区名，空行被隐藏但没有删改任何条目', () => {
        const entries = [
            prompt('━━━━━━✨【世界书设置】✨━━━━━━', ''),
            prompt('空设置预留', ' \n\n '),
            prompt('世界观规则', '真实世界观规则', true),
            prompt('空白分隔条', '━━━━━━', false),
            prompt('备注', '<!-- 只有注释 -->', false),
            prompt('✧━━━━━━━━【剧情节奏】━━━━━━━━✧', ''),
            prompt('剧情节拍', '真正的节奏设定', true),
            prompt('╔━━━━【标题空区】━━━━╗', ''),
        ];
        const doc = document(entries), snapshot = JSON.stringify(doc);
        const groups = getStoryPresetPromptGroups(doc);
        expect(groups.flatMap(g => g.promptIds)).toEqual(entries.map(p => p.id));
        expect(groups.map(g => g.label)).toContain('世界书设置');
        expect(groups.map(g => g.label)).toContain('剧情节奏');
        const section = groups.find(g => g.label === '世界书设置')!;
        const members = entries.filter(p => section.promptIds.includes(p.id));
        expect(members.filter(isStoryPresetBrowseVisible).map(p => p.name)).toEqual(['世界观规则']);
        expect(storyPresetPromptKind(entries[3])).toBe('structure');
        expect(storyPresetPromptKind(entries[4])).toBe('empty');
        expect(entries.filter(isStoryPresetBrowseVisible).map(p => p.name)).toEqual(['世界观规则','剧情节拍']);
        expect(JSON.stringify(doc)).toBe(snapshot);
    });

    it('装饰标题带有真正规则正文时不把它当作空行吞掉；纯 XML 外壳不展示', () => {
        const withText = prompt('═══【写作须知】═══','必须遵守人物背景，不改变作者规则');
        const withXml = prompt('════【开始包裹】════','<writer>');
        const withEmptyXml = prompt('════【结束包裹】════','</writer>');
        const blank = prompt('════【另一区】════','');
        expect(recognizeTavernPromptHeading(withText)?.label).toBe('写作须知');
        expect(storyPresetPromptKind(withText)).toBe('content');
        expect(isStoryPresetBrowseVisible(withText)).toBe(true);
        expect(isStoryPresetBrowseVisible(withXml)).toBe(false);
        expect(isStoryPresetBrowseVisible(withEmptyXml)).toBe(false);
        expect(isStoryPresetBrowseVisible(blank)).toBe(false);
    });

    it('作者元数据长标题仅用于显示时清洗，不改变成员关系、顺序或原始名字', () => {
        const items = [prompt('甲','规则A'),prompt('乙','规则B')];
        const doc = {
            ...document(items),
            tavernEntryGroups: [{id:'original-id',name:'━━━━━━【作者风格】━━━━━━',memberIdentifiers:['甲','乙']}],
        };
        const snapshot = JSON.stringify(doc);
        const group = getStoryPresetPromptGroups(doc);
        expect(group).toHaveLength(1);
        expect(group[0].label).toBe('作者风格');
        const choices = getStoryTavernAuthorSections(doc);
        expect(choices.find(s => s.key === 'entry:original-id')?.label).toBe('作者风格');
        expect(JSON.stringify(doc)).toBe(snapshot);
    });

});


describe('新旧 MoM 静态分组索引', () => {
    it('新格式 baibaiToolkit 的分组和原作者开关按结构导入，不读取正文决定分类', () => {
        const source = {
            prompts: [
                { identifier:'cover', name:'装饰头', role:'system', content:'' },
                { identifier:'a', name:'作者选项 A', role:'system', content:'实际规则 A' },
                { identifier:'b', name:'作者选项 B', role:'system', content:'实际规则 B' },
                { identifier:'end', name:'结束', role:'system', content:'' },
            ],
            prompt_order:[{ character_id:100001, order:[
                {identifier:'cover',enabled:true},{identifier:'a',enabled:false},
                {identifier:'b',enabled:true},{identifier:'end',enabled:true},
            ]}],
            extensions:{ baibaiToolkit:{ presetPromptGroups:{
                groups:[{id:'g',name:'原作者选项组',order:0}],
                prompts:{a:{groupId:'g'},b:{groupId:'g'}},
            } } },
        };
        const doc=convertSillyTavernChatPreset(source,'只读格式');
        expect(doc.prompts.map(p=>[p.id,p.enabled])).toEqual([
            ['st-cover',true],['st-a',false],['st-b',true],['st-end',true],
        ]);
        expect(doc.tavernEntryGroups).toEqual([{id:'g',name:'原作者选项组',memberIdentifiers:['a','b']}]);
        expect(getStoryPresetPromptGroups(doc).some(group=>group.label==='原作者选项组')).toBe(true);
        expect(getStoryTavernAuthorSections(doc).some(section=>section.label==='原作者选项组'
            && section.options.length===2 && section.options[1].enabled)).toBe(true);
    });

    it('旧版已导入的作者预设打开即恢复分组，不重导入、不更改条目或开关', () => {
        const ids = [
            'main','c9dacfb9-b212-44f7-baab-4f3db5825094',
            '9127d7ed-d487-46c8-b625-f1e9a4926c2e',
            '953c9c21-04e2-4a25-a75d-93972dd2da2f',
            'enhanceDefinitions','3fe6a008-6461-4c7d-a0f2-22485de32f10',
            '2eb0c2a5-2268-487e-8334-5fc682a19618',
            '8749e431-0ff1-4a6a-8cf6-22007893f3b8',
            '2737906a-b24f-4490-be43-29a9ba74f099',
            '6f73e0d4-393f-4559-a220-410441b00213',
            '4a78eafe-e8be-4d37-a399-cb4143b4ccb3',
            'd765cb08-9a66-4140-a50e-072ca02b79f6',
            '3e9839d3-4d8c-411a-bed6-720f108d9b7e',
            '71434afb-9b07-45ce-a8f7-752db48eebb9',
            'c95caf99-d2a5-4f93-bf96-55b8b782d51d',
            'c43b64e6-e3a0-4e67-a545-19aaab643700',
        ];
        // The two extra anchors are placed inside real sections, not after
        // the final sentinel, to preserve the original author's order.
        const anchors = new Set(ids.slice(-2));
        const old = document(ids.slice(0,-2).flatMap(id => [
            { id:'st-'+id,name:'原始项',content:'原始文本',enabled:id!=='main',role:'system' as const },
            ...(id==='953c9c21-04e2-4a25-a75d-93972dd2da2f' ? [
                {id:'st-c95caf99-d2a5-4f93-bf96-55b8b782d51d',name:'中间项',content:'正文',enabled:false,role:'system' as const}
            ]:[]),
            ...(id==='6f73e0d4-393f-4559-a220-410441b00213' ? [
                {id:'st-c43b64e6-e3a0-4e67-a545-19aaab643700',name:'中间项',content:'正文',enabled:true,role:'system' as const}
            ]:[]),
        ]));
        expect(anchors.size).toBe(2);
        const baseline=old.prompts.map(p=>({ ...p }));
        const upgraded=restoreStoryTavernLegacyGroups(old);
        expect(upgraded.tavernEntryGroups?.some(group=>group.name==='文风')).toBe(true);
        expect(upgraded.tavernEntryGroups?.some(group=>group.name==='选一：思维链（预制）')).toBe(true);
        expect(upgraded.prompts).toEqual(baseline);
        expect(restoreStoryTavernLegacyGroups(upgraded)).toBe(upgraded);
        expect(restoreStoryTavernLegacyGroups(document([prompt('无关预设', '正文')]))).toEqual(document([prompt('无关预设', '正文')]));
    });
});
