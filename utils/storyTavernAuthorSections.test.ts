import { describe, expect, it } from 'vitest';
import {
    BUILTIN_NIGHT_SCREENING_PRESET, compileStoryPreset, getStoryTavernAuthorSections,
    parseStoryTheaterPreset, selectStoryTavernAuthorOption,
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
    it('蛾摩拉：优先采用作者元数据，小说类型、小说文风互不串组；保存后重读仍能切换', () => {
        const entries: Entry[] = [
            { id: 'genre1', name: '群像', content: '原作群像 A', enabled: true },
            { id: 'genre2', name: '言情', content: '原作言情 B', enabled: false },
            { id: 'style1', name: '文风-恋爱喜剧@电波系', content: '作者原文恋爱喜剧 C', enabled: true },
            { id: 'style2', name: '文风-诗童话', content: '作者原文诗童话 D', enabled: false },
            { id: 'must', name: 'set-不要关', content: '原作核心不动 E', enabled: true },
        ];
        const groups = [
            { id: 'novel-genre', name: '小说类型', memberIdentifiers: ['genre1', 'genre2'] },
            { id: 'novel-style', name: '小说文风', memberIdentifiers: ['style1', 'style2'] },
            { id: 'author-header', name: '预设头部', memberIdentifiers: ['must'] },
        ];
        const preset = make('蛾摩拉2.3-GC.json', entries, groups);
        const sections = getStoryTavernAuthorSections(preset.document);
        const titles = sections.map(s => s.label);
        expect(titles).toContain('小说类型');
        expect(titles).toContain('小说文风');
        expect(titles).not.toContain('预设头部');
        const style = sections.find(s => s.label === '小说文风')!;
        expect(style.options.map(x => x.label)).toEqual(['文风-恋爱喜剧@电波系', '文风-诗童话']);
        const switched = selectStoryTavernAuthorOption(preset.document, style.key, 'st-style2');
        expect(switched.prompts.find(p => p.id === 'st-style1')?.enabled).toBe(false);
        expect(switched.prompts.find(p => p.id === 'st-style2')?.enabled).toBe(true);
        expect(switched.prompts.find(p => p.id === 'st-genre1')?.enabled).toBe(true);
        expect(switched.prompts.find(p => p.id === 'st-must')?.enabled).toBe(true);
        const reopened = parseStoryTheaterPreset(JSON.stringify(switched), '重进.json');
        expect(getStoryTavernAuthorSections(reopened.document).find(s => s.label === '小说文风')?.options.length).toBe(2);
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
        ], [{ id: 'theater-source', name: '🎪小剧场', startIdentifier: 'start', endIdentifier: 'end' }]);
        const section = getStoryTavernAuthorSections(p.document).find(s => s.label === '🎪小剧场')!;
        expect(section.options.map(o => o.label)).toEqual(['🎪极光交互小剧场', '🎪简约文字小剧场']);
        const changed = selectStoryTavernAuthorOption(p.document, section.key, 'st-aurora');
        expect(changed.prompts.find(o => o.id === 'st-aurora')?.enabled).toBe(true);
        expect(changed.prompts.find(o => o.id === 'st-plain')?.enabled).toBe(false);
        expect(changed.prompts.find(o => o.id === 'st-base')?.enabled).toBe(true);
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
        expect(section.single).toBe(false);
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
});
