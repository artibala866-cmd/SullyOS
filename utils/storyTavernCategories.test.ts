// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { StoryTheaterPresetDocument, StoryTheaterPresetPrompt } from '../types';
import { convertSillyTavernChatPreset } from './storySillyTavernImport';
import { getStoryPresetPromptGroups, recognizeTavernPromptHeading, moveStoryPresetPromptToGroup, addStoryPresetGroup } from './storyTheater';

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
});
