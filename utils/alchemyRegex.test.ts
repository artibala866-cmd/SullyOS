import { describe, expect, it } from 'vitest';
import { alchemyDomain, alchemyRulesFor, alchemyInstructions, alchemySubcategory } from './alchemyRegex';
import { applyStoryRegex, type StoryRegexRule } from './storyRegex';
import { mergeStoryRegexImport, parseStoryRegexImport } from './storyRegexImport';

const rule = (change: Partial<StoryRegexRule> = {}): StoryRegexRule => ({
    id: 'rule-' + (change.name || 'generic'), name: '文字规则', enabled: true, presetId: '',
    kind: 'filter', pattern: 'abc', flags: 'g', replacement: '', display: true,
    history: false, instruction: '', ...change,
});

describe('Alchemy online/offline separation and zero-API local recognition', () => {
    it('automatically assigns legacy HTML to online and prose filters to offline without mutating originals', () => {
        const beauty = rule({ name: '微信红包', kind: 'template',
            pattern: '<redpacket>(.*?)</redpacket>', replacement: '<article>{{$1}}</article>' });
        const prose = rule({ name: 'WS8.3-词汇级禁令', pattern: '草莓|情绪' });
        const saved = [beauty, prose];
        expect(saved.map(alchemyDomain)).toEqual(['online', 'offline']);
        expect(alchemyRulesFor(saved, 'online')).toEqual([beauty]);
        expect(alchemyRulesFor(saved, 'offline')).toEqual([prose]);
        const result = applyStoryRegex('<redpacket>红包</redpacket>', alchemyRulesFor(saved, 'online'), 'display');
        expect(result.cards).toHaveLength(1);
        expect(result.cards[0].html).toContain('红包');
        expect(applyStoryRegex('<redpacket>红包</redpacket>', alchemyRulesFor(saved, 'offline'), 'display').cards).toHaveLength(0);
    });

    it('explicit classifications override filter kind and preset scoping never leaks into meeting', () => {
        const onlineText = rule({ domain: 'online', name: '气泡润饰', pattern: '你好', replacement: '哈喽' });
        const offlinePreset = rule({ domain: 'offline', presetId: 'story-1', name: '专属线下规则' });
        const offlineGlobal = rule({ domain: 'offline', name: '全线下规则' });
        const rules = [onlineText, offlinePreset, offlineGlobal];
        expect(alchemyRulesFor(rules, 'online')).toEqual([onlineText]);
        expect(alchemyRulesFor(rules, 'offline')).toEqual([offlineGlobal]);
        expect(alchemyRulesFor(rules, 'offline', 'story-1')).toEqual([offlinePreset, offlineGlobal]);
    });

    it('auto-organizes the original two JSON file sets into readable small categories', () => {
        const names = ['小法庭','豆包','弹幕','刮彩票','微信红包','番茄小剧场'];
        expect(names.map(name => alchemySubcategory(rule({ name, kind: 'template' }))))
            .toEqual(['法庭互动','聊天模拟','弹幕','互动礼物','互动礼物','小剧场']);
        const other = ['WS8.3-核心指令','WS8.3-词汇级禁令',
            'WS8.3-句式级禁令','WS8.3-环境描写禁令','WS8.3-人物细节禁令',
            'WS8.3-言情八股禁令','WS8.3-弹性禁令'];
        expect(other.map(name => alchemySubcategory(rule({ name }))))
            .toEqual(['核心指令','词汇清理','句式清理','环境描写','人物细节','言情表达','表达与结尾']);
        expect(alchemySubcategory(rule({ name: '自建美化', subcategory: '我自己的分类' })))
            .toBe('我自己的分类');
    });

    it('only explicitly requested online cards inject format instructions in the existing API call', () => {
        const court = rule({ name: '小法庭', domain: 'online', kind: 'template',
            instruction: '输出 <court> JSON', source: { triggerKeywords: [] } });
        const packet = rule({ name: '微信红包', domain: 'online', kind: 'template',
            instruction: '输出 <redpacket> JSON', source: { triggerKeywords: [] } });
        const theater = rule({ name: '番茄小剧场', domain: 'online', kind: 'template',
            instruction: '输出 <minitheater> JSON', source: { triggerKeywords: [] } });
        const rules = [court, packet, theater];
        expect(alchemyInstructions(rules, 'online', {}, '刚回家')).toEqual([]);
        expect(alchemyInstructions(rules, 'online', {}, '给我发一个红包')).toEqual(['输出 <redpacket> JSON']);
        expect(alchemyInstructions(rules, 'online', {}, '暂停剧情，写个小剧场')).toEqual(['输出 <minitheater> JSON']);
        expect(alchemyInstructions(rules, 'offline', {}, '发红包')).toEqual([]);
    });

    it('conservatively preserves ambiguous short words in original eight-part prose filter', () => {
        const broad = rule({
            name: 'WS8.3-词汇级禁令(误伤保护)', domain: 'offline',
            source: { category: '八股净化' }, pattern: '(情绪|草莓|压死骆驼的最后一根稻草)',
        });
        const text = '我正在整理情绪，想吃草莓；压死骆驼的最后一根稻草并不是今天。';
        const safe = applyStoryRegex(text, [broad], 'display').text;
        expect(safe).toContain('整理情绪');
        expect(safe).toContain('吃草莓');
        expect(safe).not.toContain('压死骆驼的最后一根稻草');
        const strict = applyStoryRegex(text, [{ ...broad, source: { smartFilter: false } }], 'display').text;
        expect(strict).not.toContain('草莓');
        expect(strict).not.toContain('情绪');
        const exception = applyStoryRegex(text, [{
            ...broad,
            source: { smartFilter: false, protectWords: ['草莓'] },
        }], 'display').text;
        expect(exception).toContain('吃草莓');
        expect(exception).not.toContain('整理情绪');
        // Only display changed; same plain text is kept for role memory/history.
        expect(applyStoryRegex(text, [broad], 'history').text).toBe(text);
    });

    it('reimporting old rules upgrades group/category without creating duplicates', () => {
        const [imported] = parseStoryRegexImport(JSON.stringify({
            name: '小法庭', pattern: '<court>(.*?)</court>',
            isHtmlTemplate: true, htmlTemplate: '<div>{{$1}}</div>', aiPrompt: '法庭格式',
            category: '互动卡片', order: 2,
        })).rules;
        const newer = { ...imported, domain: 'online' as const, importGroup: '糯叽叽 HTML 模板 6 则', subcategory: '互动卡片' };
        const before = { ...imported, order: undefined, source: {
            ...imported.source, category: undefined,
        } };
        const result = mergeStoryRegexImport([before], [newer], '');
        expect(result.added).toBe(0);
        expect(result.updated).toBe(1);
        expect(result.rules).toHaveLength(1);
        expect(result.rules[0].enabled).toBe(before.enabled);
        expect(result.rules[0].importGroup).toBe('糯叽叽 HTML 模板 6 则');
        expect(mergeStoryRegexImport(result.rules, [newer], '')).toMatchObject({ added: 0, duplicates: 1 });
    });
});
