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
        // 多文件不调用 setDraft；仅单文件导入分支会写入 presetId。
        expect(editor).toContain('if (files.length === 1) {');
        expect(editor).toContain('presetId: imported.id');
        expect(editor).toContain('presetImportLock.current = true');
        expect(editor).toContain("if (presetImportLock.current) {");
    });

    it('见面首页也阻止用户重复点击导致多批次预设同时导入', () => {
        expect(storyHome).toContain('presetBatchLock.current = true');
        expect(storyHome).toContain('if (!files.length || presetBatchLock.current) return');
        expect(storyHome).toContain('disabled={presetBatchBusy}');
        // 检查数据流程而不是把冗长说明文案当成功能契约。
        expect(storyHome).toContain('if (await importPreset(file)) succeeded++');
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
        expect(editor).toContain('if (importTargetActor && !actor) {');
        expect(editor).toContain('原选定的导入角色已不在当前剧情中');
        expect(editor).toContain("aria-label='搜索剧情预设'");
        expect(editor).toContain('matchingPresets.map');
        expect(editor).toContain('return preset && !results.some(item => item.id === preset.id) ? [preset, ...results] : results');
    });

    it('长开场白提示上下文风险；归档只读回看不暴露编辑动作', () => {
        expect(editor).toContain('selectedGreeting.content.length > 12000');
        expect(editor).toContain('后续上下文长度');
        const archiveStart = session.indexOf('const archiveLabel = box?.strategy');
        const archiveEnd = session.indexOf('const floorBody = (() => {', archiveStart);
        expect(archiveStart).toBeGreaterThan(0);
        expect(archiveEnd).toBeGreaterThan(archiveStart);
        const archiveMarkup = session.slice(archiveStart, archiveEnd);
        expect(archiveMarkup).toContain('<details open={isExpanded}');
        expect(archiveMarkup).toContain('archivedRows.map((row, index) => <section');
        expect(archiveMarkup).not.toContain('pressHandlersFor(');
        expect(archiveMarkup).not.toContain('onClick={() => void send(');
    });
});
