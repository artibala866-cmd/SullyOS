import { describe, expect, it } from 'vitest';
import { alchemyDomain, alchemyRulesFor, alchemyInstructions, alchemySubcategory, alchemyRuleAppliesTo, alchemyRuleTargets, removeAlchemyRule, removeAlchemyFolderSection, alchemyFolderTargetSelection, setAlchemyFolderTargets, alchemyRulesForMeeting } from './alchemyRegex';
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
        // A story-preset binding never silently authorizes a meeting.
        expect(alchemyRulesForMeeting(rules)).toEqual([offlineGlobal]);
    });

    it('separates story/meeting choices and allows an explicit meeting opt-in even with a story preset', () => {
        const storyOnly = rule({ id: 'story-only', domain: 'offline', presetId: 'story-1' });
        const both = rule({ id: 'both-scenes', domain: 'offline', presetId: 'story-1',
            offlineScenes: ['story', 'meeting'] });
        const meetingOnly = rule({ id: 'meeting-only', domain: 'offline', presetId: 'story-1',
            offlineScenes: ['meeting'] });
        const global = rule({ id: 'global', domain: 'offline' });
        const saved = [storyOnly, both, meetingOnly, global];
        expect(alchemyRulesForMeeting(saved)).toEqual([both, meetingOnly, global]);
        expect(alchemyRulesFor(saved, 'offline', 'story-1')).toEqual([storyOnly, both, global]);
        expect(alchemyRulesFor(saved, 'offline')).toEqual([global]);
    });

    it('applies isolated story and meeting rules to old display and future request history', () => {
        const storyOnly = rule({ id: 's', name: '剧情专属', domain: 'offline',
            targets: ['offline'], offlineScenes: ['story'], presetId: 'novel',
            pattern: '线下标记', replacement: '剧情文字', history: true });
        const meetingOnly = rule({ id: 'm', name: '见面专属', domain: 'offline',
            targets: ['offline'], offlineScenes: ['meeting'], presetId: 'novel',
            pattern: '线下标记', replacement: '见面文字', history: true });
        const universal = rule({ id: 'b', name: '双方生效', domain: 'offline',
            targets: ['offline'], offlineScenes: ['story', 'meeting'],
            pattern: '共同标记', replacement: '正常内容', history: true });
        const saved = [storyOnly, meetingOnly, universal];
        const source = '线下标记；共同标记';
        for (const stage of ['display', 'history'] as const) {
            expect(applyStoryRegex(source, alchemyRulesFor(saved, 'offline', 'novel'), stage).text)
                .toBe('剧情文字；正常内容');
            expect(applyStoryRegex(source, alchemyRulesForMeeting(saved), stage).text)
                .toBe('见面文字；正常内容');
            expect(applyStoryRegex(source, alchemyRulesFor(saved, 'offline', 'other'), stage).text)
                .toBe('线下标记；正常内容');
        }
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

    it('enables text rules independently online, offline or in both, keeping legacy defaults', () => {
        const both = rule({ id: 'both', name: '双方规则', domain: 'offline',
            targets: ['online', 'offline'], history: true, instruction: '遵守格式' });
        const online = rule({ id: 'only-online', name: '仅线上', domain: 'online', targets: ['online'] });
        const offline = rule({ id: 'only-offline', name: '仅线下', domain: 'offline', targets: ['offline'] });
        const oldOffline = rule({ id: 'old', name: '旧八股补丁' });
        const disabled = rule({ id: 'off', name: '关闭', targets: ['online', 'offline'], enabled: false });
        const html = rule({ id: 'beauty', name: '美化模板', kind: 'template', targets: ['offline'],
            replacement: '<section>{{$1}}</section>' });
        const all = [both, online, offline, oldOffline, disabled, html];
        expect(alchemyRuleTargets(both)).toEqual(['online', 'offline']);
        expect(alchemyRuleTargets(oldOffline)).toEqual(['offline']);
        expect(alchemyRuleTargets(html)).toEqual(['online']);
        expect(alchemyRuleAppliesTo(html, 'offline')).toBe(false);
        expect(alchemyRulesFor(all, 'online').map(x => x.id)).toEqual(['both', 'only-online', 'beauty']);
        expect(alchemyRulesFor(all, 'offline').map(x => x.id)).toEqual(['both', 'only-offline', 'old']);
        expect(alchemyInstructions([both], 'online', {}, '晚上好')).toEqual(['遵守格式']);
        expect(alchemyInstructions([both], 'offline', {}, '晚上好')).toEqual(['遵守格式']);
    });

    it('deletes by ID and limits a folder deletion to its visible category', () => {
        const one = rule({ id: 'one', name: '同名规则', importGroup: '混合文件', targets: ['online', 'offline'] });
        const two = rule({ id: 'two', name: '另一个过滤', importGroup: '混合文件' });
        const card = rule({ id: 'card', name: '礼物卡', importGroup: '混合文件', kind: 'template' });
        const elsewhere = rule({ id: 'elsewhere', name: '同名规则', importGroup: '其他文件' });
        const all = [one, two, card, elsewhere];
        expect(removeAlchemyRule(all, one.id).map(x => x.id)).toEqual(['two', 'card', 'elsewhere']);
        expect(removeAlchemyFolderSection(all, '混合文件', 'rules', new Set(['one', 'two', 'card'])).map(x => x.id))
            .toEqual(['card', 'elsewhere']);
        expect(removeAlchemyFolderSection(all, '混合文件', 'beauty', new Set(['card'])).map(x => x.id))
            .toEqual(['one', 'two', 'elsewhere']);
        expect(removeAlchemyFolderSection(all, '混合文件', 'rules', new Set())).toEqual(all);
    });

    it('switches a whole imported rule folder online, offline or both without touching other groups or user switches', () => {
        const a = rule({ id: 'a', importGroup: '八股补丁', domain: 'offline',
            presetId: 'tavern-A', source: { protectWords: ['草莓'] } });
        const b = rule({ id: 'b', importGroup: '八股补丁', targets: ['online'],
            enabled: false, subcategory: '句式清理' });
        const other = rule({ id: 'c', importGroup: '别的补丁', targets: ['online'] });
        const beauty = rule({ id: 'card', kind: 'template', importGroup: '八股补丁',
            replacement: '<div>{{$1}}</div>', targets: ['online'] });
        const rules = [a, b, other, beauty];
        expect(alchemyFolderTargetSelection([a, b])).toBe('mixed');
        const ids = new Set(['a', 'b', 'card', 'c']);
        const both = setAlchemyFolderTargets(rules, '八股补丁', ids, ['online', 'offline']);
        expect(alchemyFolderTargetSelection(both.filter(x => x.kind === 'filter' && x.importGroup === '八股补丁'))).toBe('both');
        expect(alchemyRulesFor(both, 'online').map(x => x.id)).toEqual(['a', 'c', 'card']);
        expect(alchemyRulesFor(both, 'offline', 'tavern-A').map(x => x.id)).toEqual(['a']);
        expect(both[1].enabled).toBe(false);
        expect(both[0].presetId).toBe('tavern-A');
        expect(both[0].source?.protectWords).toEqual(['草莓']);
        expect(both[2]).toBe(other);
        expect(both[3]).toBe(beauty);
        const online = setAlchemyFolderTargets(both, '八股补丁', ids, ['online']);
        expect(alchemyFolderTargetSelection(online.slice(0, 2))).toBe('online');
        expect(alchemyRulesFor(online, 'offline', 'tavern-A')).toEqual([]);
        const offline = setAlchemyFolderTargets(online, '八股补丁', ids, ['offline']);
        expect(alchemyFolderTargetSelection(offline.slice(0, 2))).toBe('offline');
        expect(alchemyRulesFor(offline, 'online').map(x => x.id)).toEqual(['c', 'card']);
        expect(rules[0].targets).toBeUndefined();
        expect(() => setAlchemyFolderTargets(rules, '八股补丁', ids, [])).toThrow('至少选择一个');
    });

    it('does not duplicate rules when reimported after selecting both online and offline', () => {
        const original = rule({ name: '过滤标签', pattern: '<debug>(.*?)</debug>', domain: 'offline',
            importGroup: '我的原文件' });
        const modified = { ...original, targets: ['online', 'offline'] as Array<'online' | 'offline'>,
            source: { smartFilter: false, protectWords: ['情绪'] }, enabled: false };
        const imported = { ...original, id: 'new-import-id', domain: 'online' as const,
            importGroup: '我的原文件' };
        const merged = mergeStoryRegexImport([modified], [imported], '');
        expect(merged.added).toBe(0);
        expect(merged.duplicates).toBe(1);
        expect(merged.rules[0].targets).toEqual(['online', 'offline']);
        expect(merged.rules[0].enabled).toBe(false);
        expect(merged.rules[0].source?.protectWords).toEqual(['情绪']);
    });

    it('native imported HTML format prompts are automatic within the existing call', () => {
        const base = rule({ kind: 'template', name: '小法庭',
            pattern: '<court>([\\s\\S]*?)</court>',
            replacement: '<article>{{1.title}}</article>',
            parseMode: 'json', source: { triggerEnabled: false, renderMode: 'iframe' },
            instruction: '遇到委屈或生气时输出 <court> JSON' });
        expect(alchemyInstructions([base], 'online', {}, '我刚刚回家')).toEqual([
            '遇到委屈或生气时输出 <court> JSON',
        ]);
        const explicit = { ...base, source: {
            ...base.source, triggerEnabled: true, triggerKeywords: ['番外'],
        } };
        expect(alchemyInstructions([explicit], 'online', {}, '我刚刚回家')).toEqual([]);
        expect(alchemyInstructions([explicit], 'online', {}, '写个番外')).toHaveLength(1);
        expect(alchemyInstructions([base], 'offline', {}, '写个番外')).toEqual([]);
        expect(applyStoryRegex('<court>{"title":"原生法庭"}</court>',
            [base], 'display').cards[0].html).toContain('原生法庭');
        expect(applyStoryRegex('<court>{"title":"原生法庭"}</court>',
            [{ ...base, display: false }], 'display').cards).toHaveLength(0);
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

    it('executes imported regex exactly instead of guessing what a short word means', () => {
        const broad = rule({
            name: 'WS8.3-词汇级禁令', domain: 'offline',
            source: { category: '八股净化', smartFilter: true },
            pattern: '(情绪|草莓|压死骆驼的最后一根稻草)',
        });
        const text = '我正在整理情绪，想吃草莓；压死骆驼的最后一根稻草并不是今天。';
        const expected = '我正在整理，想吃；并不是今天。';
        expect(applyStoryRegex(text, [broad], 'display').text).toBe(expected);
        // Previously saved smartFilter values must have no effect anymore.
        for (const savedFlag of [false, true, undefined]) {
            const stored = { ...broad, source: { ...broad.source, smartFilter: savedFlag } };
            expect(applyStoryRegex(text, [stored], 'display').text).toBe(expected);
        }
        // Author-provided explicit protected words are not a heuristic.
        const protectedRule = { ...broad, source: { protectWords: ['草莓'] } };
        expect(applyStoryRegex(text, [protectedRule], 'display').text)
            .toBe('我正在整理，想吃草莓；并不是今天。');
        expect(applyStoryRegex(text, [broad], 'history').text).toBe(text);
    });

    it('matches literal and figurative wording only according to the imported expression', () => {
        const broad = rule({
            name: 'WS8.3-词汇级禁令', domain: 'offline',
            source: { category: '八股净化' }, display: true, history: true,
            pattern: '(像草莓一样|刚洗干净的一盒草莓|草莓蛋糕)',
        });
        const original = '她端来刚洗干净的一盒草莓，吃完后又做了草莓蛋糕。她的嘴唇像草莓一样红。';
        const expected = original.replace(/像草莓一样|刚洗干净的一盒草莓|草莓蛋糕/g, '');
        for (const stage of ['display', 'history'] as const) {
            const result = applyStoryRegex(original, [broad], stage);
            expect(result.text).toBe(expected);
            expect(result.matches).toBe(3);
        }
        const bare = { ...broad, pattern: '草莓', source: { smartFilter: true } };
        expect(applyStoryRegex(original, [bare], 'display').text)
            .toBe(original.replace(/草莓/g, ''));
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
