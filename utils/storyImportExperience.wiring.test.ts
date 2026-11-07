import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The browser fixture exercises the real controls. These guards prevent
// a future UI refactor from silently reintroducing risky import shortcuts.
const editor = readFileSync(new URL('../components/date/story/StoryTheaterEditor.tsx', import.meta.url), 'utf8');
const session = readFileSync(new URL('../components/date/story/StoryTheaterSession.tsx', import.meta.url), 'utf8');
const storyHome = readFileSync(new URL('../components/date/story/StoryTheater.tsx', import.meta.url), 'utf8');
const presetMaker = readFileSync(new URL('../components/date/story/StoryPresetMaker.tsx', import.meta.url), 'utf8');

describe('剧情导入的真实使用约束', () => {
    it('多文件导入只加入预设库，不擅自切换正在玩的剧情预设', () => {
        expect(editor).toContain('if (files.length === 1) {');
        expect(editor).toContain('setPresetImportFeedback(files.length === 1');
        expect(editor).toContain('当前剧情预设未改变');
        expect(editor).toContain('presetImportLock.current = true');
        expect(editor).toContain("if (presetImportLock.current) {");
    });

    it('见面首页也阻止用户重复点击导致多批次预设同时导入', () => {
        expect(storyHome).toContain('presetBatchLock.current = true');
        expect(storyHome).toContain('if (!files.length || presetBatchLock.current) return');
        expect(storyHome).toContain('disabled={presetBatchBusy}');
        expect(storyHome).toContain('原有剧情没有被自动改动');
    });

    it('正在被剧情引用的导入预设不能直接删除，编辑时必须提示全局连锁影响', () => {
        expect(storyHome).toContain('const referenced = (await DB.getStoryTheaters()).filter');
        expect(storyHome).toContain('if (referenced.length) {');
        expect(presetMaker).toContain('usedByStoryCount > 0');
        expect(presetMaker).toContain('会改变这些剧情之后的续写规则');
        expect(presetMaker).toContain('复制为独立预设');
        expect(presetMaker).toContain('确认删除');
    });

    it('几十份开场白能按标题和角色筛选，选中项在筛选过程中不会凭空消失', () => {
        expect(editor).toContain("aria-label='搜索已有开场白'");
        expect(editor).toContain('matchingGreetingChoices.map');
        expect(editor).toContain('return [selectedGreeting, ...matched]');
        expect(editor).toContain("setGreetingSearch('')");
    });

    it('长开场白明确告知上下文风险；归档原文明确为只读，不诱导危险编辑', () => {
        expect(editor).toContain('selectedGreeting.content.length > 12000');
        expect(editor).toContain('后续上下文长度');
        expect(session).toContain('已归档楼层仅供回看');
    });
});
