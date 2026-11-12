// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Message, StoryTheaterEntry } from '../types';
import { DB } from './db';
import {
  createBlankStoryPreset, createStoryTheaterDraft, formatStoryTheaterExport,
  parseStoryTheaterPreset, resolveStoryPresetImport, storyArchiveAtFloor,
  storyTheaterThreadId, normalizeStoryTheater, compileStoryPreset,
} from './storyTheater';
import { alchemyRulesFor, alchemyRulesForMeeting, setAlchemyFolderTargets } from './alchemyRegex';
import { applyStoryRegex, readStoryRegexRules } from './storyRegex';
import { parseStoryRegexImport, exportStoryAlchemyRules, mergeStoryRegexImport } from './storyRegexImport';

const scope = 'human-chaos-20261112-';
const makeStory = (suffix: string, presetId: string, now = 100): StoryTheaterEntry =>
  ({ ...createStoryTheaterDraft(now), id: scope + suffix, title: '雨夜分歧·' + suffix,
    characterIds: ['actor-a'], presetId, readingBatchSize: 20 });
const makePreset = (name: string, text: string) => {
  const doc = createBlankStoryPreset(name).document;
  return JSON.stringify({ ...doc, prompts: doc.prompts.map((p, i) =>
    i === 0 ? { ...p, content: text } : p) });
};
const textAlchemy = (name: string, pattern: string, replacement: string, extras: Record<string, unknown> = {}) => ({
  name, pattern, replacement, enabled: true, applyOnDisplay: true, applyOnPrompt: true,
  role: 'both', ...extras,
});

describe('剧情真实游玩式交叉压力：不触碰用户存档', () => {
  it('两条剧情轮换预设，连续重导入、作者更新、同名冲突后不串档', async () => {
    const file = '现实游玩-跨剧情.json';
    const first = parseStoryTheaterPreset(makePreset('雨夜预设', '只能看到故事A'), file, 10);
    const identical = parseStoryTheaterPreset(makePreset('雨夜预设', '只能看到故事A'), file, 20);
    const changed = parseStoryTheaterPreset(makePreset('雨夜预设', '只能看到故事B'), file, 30);
    const savedIds: string[] = [];
    try {
      const [a, b, c] = await Promise.all([
        DB.importStoryTheaterPreset(first),
        DB.importStoryTheaterPreset(identical),
        DB.importStoryTheaterPreset(changed),
      ]);
      savedIds.push(a.preset.id, c.preset.id);
      expect(a.duplicate).toBe(false);
      expect(b.duplicate).toBe(true);
      expect(a.preset.id).toBe(b.preset.id);
      expect(c.duplicate).toBe(false);
      expect(c.preset.id).not.toBe(a.preset.id);
      expect(c.preset.name).toContain('导入 2');
      const storyA = makeStory('a', a.preset.id);
      const storyB = makeStory('b', c.preset.id);
      await Promise.all([DB.saveStoryTheater(storyA), DB.saveStoryTheater(storyB)]);
      await DB.saveStoryTheater({ ...storyA, presetId: c.preset.id, updatedAt: 500 });
      const rows = await DB.getStoryTheaters();
      expect(rows.find(row => row.id === storyA.id)?.presetId).toBe(c.preset.id);
      expect(rows.find(row => row.id === storyB.id)?.presetId).toBe(c.preset.id);
      expect((await DB.getStoryTheaterPresets()).find(p => p.id === a.preset.id)?.document.prompts[0].content)
        .toBe('只能看到故事A');
      const sameNameNew = parseStoryTheaterPreset(makePreset('雨夜预设', '只能看到故事B'), file, 31);
      expect(resolveStoryPresetImport(sameNameNew, await DB.getStoryTheaterPresets()).preset.id).toBe(c.preset.id);
      const compiled = compileStoryPreset({ preset: c.preset,
        slots: { actors: '角色A', persona: '玩家', scenario: '雨夜', worldBefore: '', worldAfter: '', history: '' },
        userName: '玩家', characterNames: ['角色A'] });
      expect(compiled.messages.map(m => m.content).join('\n')).toContain('只能看到故事B');
      expect(compiled.messages.map(m => m.content).join('\n')).not.toContain('只能看到故事A');
    } finally {
      await DB.deleteStoryTheater(scope + 'a');
      await DB.deleteStoryTheater(scope + 'b');
      for (const id of savedIds) await DB.deleteStoryTheaterPreset(id);
    }
  });

  it('连续240楼，穿插隐藏注释和旧楼层归档，切回阅读与导出仍保留全部原文', async () => {
    const story = makeStory('long', 'builtin-night-screening');
    const thread = storyTheaterThreadId(story.id);
    const ids: number[] = [];
    await DB.saveStoryTheater(story);
    try {
      // 120个来回而非空档：玩家推进/AI剧情/重复剧情标签/不同长短/隐藏段。
      for (let i = 0; i < 240; i++) {
        const content = '第' + (i + 1) + '楼·' +
          (i % 2 ? '林星解释上一次的误会。' : '玩家提及旧事并要求继续。') +
          ('同一雨夜细节。').repeat(i % 19 + 1) +
          (i % 7 === 0 ? '<ooc>作者私下备注' + i + '</ooc>' : '');
        ids.push(await DB.saveMessage({
          charId: thread, role: i % 2 ? 'assistant' : 'user', type: 'text', content,
          timestamp: 1700000000000 + i, metadata: { source: 'story_theater', theaterId: story.id },
        }));
      }
      const summaries = [{ id: scope + 'box', strategy: 'summary' as const,
        fromMessageId: ids[3], toMessageId: ids[199], messageCount: 197,
        summary: '雨夜误会终于说清', createdAt: 1700000000200 }];
      await DB.saveStoryTheater({ ...story, archives: summaries });
      const all = (await DB.getMessagesByCharId(thread, true))
        .filter(m => m.metadata?.source === 'story_theater').sort((a, b) => a.id - b.id);
      const recent = await DB.getRecentMessagesWithCount(thread, 20, m => m.metadata?.source === 'story_theater');
      expect(all).toHaveLength(240);
      expect(recent.messages).toHaveLength(20);
      expect(recent.totalCount).toBe(240);
      expect(storyArchiveAtFloor(summaries, ids[90])?.summary).toBe('雨夜误会终于说清');
      expect(storyArchiveAtFloor(summaries, ids[220])).toBeUndefined();
      const input = '<ooc>隐藏的创作备注</ooc>还记得这场雨吗';
      const rules = parseStoryRegexImport(JSON.stringify(textAlchemy('隐藏作者备注', '<ooc>[\\s\\S]*?</ooc>', ''))).rules;
      const cleaned = applyStoryRegex(input, rules, 'history').text;
      expect(cleaned).toBe('还记得这场雨吗');
      const exported = formatStoryTheaterExport(story, '玩家', ['林星'], all, 1700000100000);
      expect(exported).toContain('第1楼');
      expect(exported).toContain('第240楼');
      expect(exported).toContain('作者私下备注0');
      expect(exported.match(/第\d+楼/g)?.length).toBe(240);
      expect((await DB.getMessagesByCharId(thread, true))[0].content).toContain('作者私下备注0');
    } finally {
      await DB.deleteMessages(ids);
      await DB.deleteStoryTheater(story.id);
    }
  });

  it('正则同时混用“剧情专属/见面专属/私聊与剧情共用/HTML模板”，切预设不偷跑', () => {
    const source = [
      textAlchemy('只改A剧情', '雨天', '阴天'),
      textAlchemy('只改见面', '雨天', '大晴天'),
      textAlchemy('私聊剧情共用', '再见', '回见'),
      { name: '私聊小卡片', pattern: '<card>(.*?)</card>',
        htmlTemplate: '<article>{{$1}}</article>', isHtmlTemplate: true,
        applyOnDisplay: true, enabled: true },
    ];
    const [storyOnly, meetingOnly, both, card] = parseStoryRegexImport(JSON.stringify(source)).rules;
    const rules = [
      { ...storyOnly, presetId: 'A', targets: ['offline'] as const as any,
        offlineScenes: ['story'] as const as any },
      { ...meetingOnly, targets: ['offline'] as const as any,
        offlineScenes: ['meeting'] as const as any },
      { ...both, targets: ['online', 'offline'] as const as any,
        offlineScenes: ['story', 'meeting'] as const as any },
      { ...card, targets: ['online'] as const as any },
    ];
    const a = alchemyRulesFor(rules, 'offline', 'A');
    const b = alchemyRulesFor(rules, 'offline', 'B');
    const meet = alchemyRulesForMeeting(rules);
    const chat = alchemyRulesFor(rules, 'online');
    expect(a.map(r => r.name)).toEqual(['只改A剧情', '私聊剧情共用']);
    expect(b.map(r => r.name)).toEqual(['私聊剧情共用']);
    expect(meet.map(r => r.name)).toEqual(['只改见面', '私聊剧情共用']);
    expect(chat.map(r => r.name)).toEqual(['私聊剧情共用', '私聊小卡片']);
    expect(applyStoryRegex('雨天，再见。', a, 'display').text).toBe('阴天，回见。');
    expect(applyStoryRegex('雨天，再见。', b, 'display').text).toBe('雨天，回见。');
    expect(applyStoryRegex('雨天，再见。', meet, 'display').text).toBe('大晴天，回见。');
    expect(applyStoryRegex('<card>手机消息</card>', chat, 'display').cards).toHaveLength(1);
    expect(applyStoryRegex('<card>手机消息</card>', a, 'display').cards).toHaveLength(0);
    const switched = setAlchemyFolderTargets(
      [{ ...storyOnly, importGroup: '自选规则', targets: ['offline'] }],
      '自选规则', new Set([storyOnly.id]), ['online']);
    expect(alchemyRulesFor(switched, 'offline', 'A')).toHaveLength(0);
    expect(alchemyRulesFor(switched, 'online')).toHaveLength(1);
  });

  it('多种正则冲突并带角色/楼层限制，旧正文不变，只处理指定显示或请求内容', () => {
    const imported = parseStoryRegexImport(JSON.stringify([
      textAlchemy('先删注释', '<ooc>[\\s\\S]*?</ooc>', '', { order: 1 }),
      textAlchemy('再替换台词', '再见', '晚安', { order: 2 }),
      textAlchemy('只限制用户当前楼', '我回来了', '我来了', {
        role: 'user', minDepth: 0, maxDepth: 0, order: 3 }),
      textAlchemy('只在请求历史过滤', '\\[秘密\\]', '', {
        applyOnDisplay: false, applyOnPrompt: true, order: 4 }),
      textAlchemy('关闭的规则不能起效', '晚安', '错误替换', { enabled: false, order: 5 }),
    ]));
    expect(imported.rejected).toBe(0);
    const raw = '<ooc>作者备注</ooc>我回来了，再见。[秘密]';
    const userNow = { text: raw, role: 'user' as const, depth: 0 };
    const userOld = { text: raw, role: 'user' as const, depth: 90 };
    const assistantNow = { text: raw, role: 'assistant' as const, depth: 0 };
    const shown = applyStoryRegex(userNow, imported.rules, 'display');
    expect(shown.text).toBe('我来了，晚安。[秘密]');
    expect(applyStoryRegex(userOld, imported.rules, 'display').text).toBe('我回来了，晚安。[秘密]');
    expect(applyStoryRegex(assistantNow, imported.rules, 'display').text).toBe('我回来了，晚安。[秘密]');
    expect(applyStoryRegex(userNow, imported.rules, 'history').text).toBe('我来了，晚安。');
    expect(raw).toContain('作者备注');
  });

  it('导出炼金术再导回，重复几次不增殖规则，不把曾经关闭的过滤重新开启', () => {
    const rules = parseStoryRegexImport(JSON.stringify([
      textAlchemy('文字清理', '旧术语', '新术语', { enabled: false, order: 4,
        replacement: ['新术语', '备用术语'], triggerEnabled: true, triggerKeywords: ['术语'] }),
      { name: '小剧场模板', pattern: '<scene>([\\s\\S]*?)</scene>',
        htmlTemplate: '<section><h2>故事</h2>{{$1}}</section>', isHtmlTemplate: true,
        aiPrompt: '在适当场景输出scene', parseMode: 'text', enabled: true },
    ])).rules;
    const exported = exportStoryAlchemyRules(rules);
    const reread = parseStoryRegexImport(exported).rules;
    expect(reread).toHaveLength(2);
    expect(reread[0].enabled).toBe(false);
    expect(reread[0].replacementChoices).toEqual(['备用术语']);
    expect(reread[1].kind).toBe('template');
    const one = mergeStoryRegexImport([], reread, '');
    const two = mergeStoryRegexImport(one.rules, parseStoryRegexImport(exported).rules, '');
    const three = mergeStoryRegexImport(two.rules, parseStoryRegexImport(exported).rules, '');
    expect(one.added).toBe(2);
    expect(two.added).toBe(0);
    expect(three.added).toBe(0);
    expect(three.rules).toHaveLength(2);
    expect(readStoryRegexRules(JSON.stringify(three.rules))[0].enabled).toBe(false);
  });

  it('换身份、老存档异常值、旧预设覆盖，保存后不改变角色及另一份剧情', async () => {
    const first = { ...makeStory('identity', 'A'), mask: { type: 'character' as const, id: 'actor-b' },
      selectedWorldbookIds: ['book', 'book', '', 'book-2'],
      readingBatchSize: 999, archiveAfter: 5, archiveKeepRecent: 99 };
    const normalized = normalizeStoryTheater(first);
    expect(normalized.selectedWorldbookIds).toEqual(['book', 'book-2']);
    expect(normalized.readingBatchSize).toBe(100);
    expect(normalized.archiveKeepRecent).toBe(4);
    await DB.saveStoryTheater(normalized);
    try {
      const reset = normalizeStoryTheater({ ...normalized, mask: { type: 'user' }, presetId: 'B' });
      await DB.saveStoryTheater(reset);
      const reloaded = (await DB.getStoryTheaters()).find(s => s.id === reset.id)!;
      expect(reloaded.mask).toEqual({ type: 'user' });
      expect(reloaded.presetId).toBe('B');
      expect(reloaded.characterIds).toEqual(['actor-a']);
      expect(reloaded.selectedWorldbookIds).toEqual(['book', 'book-2']);
    } finally {
      await DB.deleteStoryTheater(first.id);
    }
  });
});
