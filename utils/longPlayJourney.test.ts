// @vitest-environment jsdom
// A seven-day, deterministic, offline long-play journey.  This exercises real
// persistence and feature functions, not a real paid LLM or its prose quality.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../types';
import type { MemoryNode } from './memoryPalace/types';
import { DB } from './db';
import {
  createStoryTheaterDraft, formatStoryTheaterExport, storyTheaterThreadId,
} from './storyTheater';
import { commitStoryArchiveBatch } from './storyTheaterArchive';
import { deleteStoryTheaterData } from './storyTheaterDeletion';
import { loadStoryVectorRecall, listStoryVectorMemories, selectStoryVectorRecall } from './storyTheaterVectorMemory';
import { MemoryNodeDB, MemoryVectorDB } from './memoryPalace/db';
import { writePhoneAutonomyPreferences, canUsePhoneApiBudget } from './characterPhoneApiBudget';
import { saveNpcProfiles } from './characterPhoneNpcs';
import { readCharacterPhoneChats } from './characterPhoneChats';
import { readCharacterMoments } from './characterPhoneMoments';
import { applyChatPhoneEvents } from './phoneChatPiggyback';

const tag = 'seven-day-long-play-v1';
const storyAId = tag + '-rain';
const storyBId = tag + '-train';
const charA = tag + '-actor-rain';
const charB = tag + '-actor-train';
const npcId = tag + '-npc';
const memoryId = tag + '-vector';
const base = new Date('2026-11-02T12:00:00.000Z').getTime();
const dayMs = 24 * 60 * 60_000;
const allMessageIds: number[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await DB.deleteMessages(allMessageIds.splice(0));
  for (const id of [storyAId, storyBId]) {
    const existing = (await DB.getStoryTheaters()).find(s => s.id === id);
    if (existing) await deleteStoryTheaterData(existing);
  }
  await MemoryVectorDB.delete(memoryId);
  await MemoryNodeDB.delete(memoryId);
  for (const characterId of [charA, charB]) {
    const session = await DB.getMusicListeningSession(characterId);
    if (session?.active) await DB.transitionMusicListeningSession(characterId, 'end', session.sessionId);
    for (const key of Object.keys(localStorage)) {
      if (key.endsWith(':' + characterId) || key.includes(characterId)) localStorage.removeItem(key);
    }
  }
});

describe('七天跨功能真实使用顺序（离线模拟 AI 输出）', () => {
  it('7 天约 500 楼：剧情/私聊/微信/朋友圈/一起听/事件盒/独立向量相互切换，状态不串', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(base);
    let rain = { ...createStoryTheaterDraft(base), id: storyAId, title: '七天雨夜',
      characterIds: [charA], archiveStrategy: 'summary' as const };
    let train = { ...createStoryTheaterDraft(base), id: storyBId, title: '月台的秘密',
      characterIds: [charB], archiveStrategy: 'vector' as const };
    await DB.saveStoryTheater(rain);
    await DB.saveStoryTheater(train);
    saveNpcProfiles(charA, [{
      id: npcId, name: '书店同事', personality: '寡言', identity: '同事',
      relationship: '普通朋友', background: '只知道书店库存', source: 'generated', createdAt: base,
    }]);
    writePhoneAutonomyPreferences(charA, { backgroundApiEnabled: false, chatPiggybackEnabled: true });
    writePhoneAutonomyPreferences(charB, { backgroundApiEnabled: false, chatPiggybackEnabled: false });
    expect(canUsePhoneApiBudget(charA)).toBe(false);
    expect(canUsePhoneApiBudget(charB)).toBe(false);

    let firstSession = '';
    let latestSession = '';
    const rainIds: number[] = [];
    const trainIds: number[] = [];
    const normalRainIds: number[] = [];
    const normalTrainIds: number[] = [];
    let phoneInteractions = 0;
    for (let day = 0; day < 7; day++) {
      vi.setSystemTime(base + day * dayMs + 3600000);
      for (let i = 0; i < 60; i++) {
        const floor = day * 60 + i;
        const role = i % 2 ? 'assistant' as const : 'user' as const;
        const clue = floor === 3
          ? '玩家把银色钥匙藏在书店第三层，只有玩家知情；周五之前不能告诉林星。'
          : floor === 8 ? '林星承诺在第七天返回月台，但尚未兑现。'
          : floor === 198 ? '林星误以为钥匙在桌上，玩家没有承认。'
          : floor === 404 ? '玩家故意试探：钥匙是不是在桌上？'
          : '第' + floor + '楼，' + (role === 'user' ? '玩家推动雨夜剧情。' : '林星回应当前场景。');
        const id = await DB.saveMessage({
          charId: storyTheaterThreadId(rain.id), role, type: 'text',
          timestamp: Date.now() + i, content: clue,
          metadata: { source: 'story_theater', theaterId: rain.id },
        });
        rainIds.push(id);
        if (i % 6 === 0) {
          const tid = await DB.saveMessage({
            charId: storyTheaterThreadId(train.id), role: 'user', type: 'text',
            timestamp: Date.now() + i, content: '月台剧情：第' + floor + '个场景（与雨夜不共享秘密）',
            metadata: { source: 'story_theater', theaterId: train.id },
          });
          trainIds.push(tid);
        }
        if (i % 10 === 0) {
          const pid = await DB.saveMessage({
            charId: charA, role: 'user', type: 'text',
            timestamp: Date.now() + i, content: '普通私聊第' + floor + '次，不应被剧情归档或删除。',
          });
          normalRainIds.push(pid);
        }
        if (i % 15 === 0) {
          normalTrainIds.push(await DB.saveMessage({
            charId: charB, role: 'assistant', type: 'text',
            timestamp: Date.now() + i, content: '另一位角色的普通私聊第' + floor + '次。',
          }));
        }
      }

      // Phone sidecar is a product flow; disabling background API must not
      // disable events already piggybacked on an intentional chat response.
      const phone = {
        chats: [{ contactId: npcId, messages: [
          { speaker: 'owner', text: '第' + (day + 1) + '天，书店照常营业。' },
          { speaker: 'contact', text: '明白，记得关灯。' },
        ] }],
        moment: { publish: day % 2 === 0, text: '第' + (day + 1) + '天的雨夜手记。',
          comments: [{ authorId: npcId, text: '雨又下了。' }] },
      };
      const added = applyChatPhoneEvents(charA, phone, Date.now());
      expect(added).toBeGreaterThanOrEqual(2);
      phoneInteractions += added;
      expect(applyChatPhoneEvents(charA, phone, Date.now())).toBe(0);
      expect(applyChatPhoneEvents(charB, phone, Date.now())).toBe(0);
      expect(readCharacterPhoneChats(charB)).toHaveLength(0);

      if (day === 1) {
        // Actual archive transaction, not merely assigning an archive array.
        const saved = await DB.getMessagesByCharId(storyTheaterThreadId(rain.id), true);
        const batch = saved.filter(row => rainIds.slice(0, 120).includes(row.id));
        expect(batch).toHaveLength(120);
        rain = await commitStoryArchiveBatch(rain, batch, {
          id: tag + '-summary', strategy: 'summary',
          fromMessageId: batch[0].id, toMessageId: batch[119].id,
          messageCount: 120, summary: '银色钥匙在书店第三层，只有玩家知情；林星承诺第七天返回月台。',
          createdAt: Date.now(),
        });
      }
      if (day === 2) {
        const invited = await DB.createMusicListeningInvite({
          charId: charA, role: 'assistant', type: 'system', content: '一起听吗？',
          metadata: { musicListenInvite: true, inviter: 'char', status: 'pending', invitedAt: Date.now() },
        });
        expect(invited.status).toBe('created');
        const accepted = await DB.resolveMusicListeningInvite(charA, 'char', {
          charId: charA, role: 'user', type: 'system', content: '好，一起听',
          metadata: { accepted: true },
        }, invited.messageId);
        expect(accepted.resolved).toBe(true);
        firstSession = (await DB.getMusicListeningSession(charA))!.sessionId;
      }
      if (day === 3) {
        const rows = await DB.getMessagesByCharId(storyTheaterThreadId(train.id), true);
        const batch = rows.slice(0, 30);
        const node: MemoryNode = {
          id: memoryId, charId: storyTheaterThreadId(train.id),
          content: '月台剧情只记录：红色围巾属于列车员。雨夜的银色钥匙不属于这条剧情。',
          room: 'living_room', tags: ['剧情'], importance: 7, mood: 'neutral',
          embedded: true, createdAt: Date.now(), lastAccessedAt: Date.now(), accessCount: 0,
        };
        await MemoryNodeDB.save(node);
        await MemoryVectorDB.save({
          memoryId, charId: storyTheaterThreadId(train.id),
          vector: [0.75, 0.25], dimensions: 2, model: 'offline-fixture',
        });
        train = await commitStoryArchiveBatch(train, batch, {
          id: tag + '-vectorbox', strategy: 'vector',
          fromMessageId: batch[0].id, toMessageId: batch[29].id,
          messageCount: 30, vectorMemoryIds: [memoryId], createdAt: Date.now(),
        });
        expect((await DB.transitionMusicListeningSession(charA, 'join'))?.sessionId).toBe(firstSession);
      }
      if (day === 5) {
        expect((await DB.transitionMusicListeningSession(charA, 'end', firstSession))?.active).toBe(false);
        latestSession = (await DB.transitionMusicListeningSession(charA, 'join'))!.sessionId;
        expect(latestSession).not.toBe(firstSession);
        expect(await DB.transitionMusicListeningSession(charA, 'end', firstSession))
          .toMatchObject({ active: true, changed: false, sessionId: latestSession });
      }
      // Re-entering a saved story every evening must not change any counts.
      const resumed = (await DB.getStoryTheaters()).find(row => row.id === rain.id)!;
      const tail = await DB.getRecentMessagesWithCount(storyTheaterThreadId(resumed.id), 20,
        m => m.metadata?.source === 'story_theater');
      expect(tail.totalCount).toBe((day + 1) * 60);
      expect(tail.messages).toHaveLength(20);
      expect((await DB.getMessagesByCharId(charA, true)).filter(m => m.role === 'user')).toHaveLength((day + 1) * 6 + (day >= 2 ? 1 : 0));
    }

    const allRain = await DB.getMessagesByCharId(storyTheaterThreadId(rain.id), true);
    const allTrain = await DB.getMessagesByCharId(storyTheaterThreadId(train.id), true);
    expect(allRain.filter(m => m.metadata?.source === 'story_theater')).toHaveLength(420);
    expect(allTrain.filter(m => m.metadata?.source === 'story_theater')).toHaveLength(70);
    expect((await DB.getStoryTheaters()).find(s => s.id === rain.id)?.archives).toHaveLength(1);
    expect(allRain.find(m => m.id === rainIds[3])?.content).toContain('只有玩家知情');
    expect(allRain.find(m => m.id === rainIds[3])?.metadata?.theaterArchived).toBe(true);
    expect(formatStoryTheaterExport(rain, '玩家', ['林星'], allRain, Date.now())).toContain('银色钥匙');
    expect(formatStoryTheaterExport(rain, '玩家', ['林星'], allRain, Date.now())).toContain('钥匙是不是在桌上？');

    const recalled = await loadStoryVectorRecall(train, trainIds[trainIds.length - 1] + 1);
    const selected = await selectStoryVectorRecall(recalled, '红色围巾');
    expect(selected.text).toContain('红色围巾属于列车员');
    expect(selected.text).not.toContain('只有玩家知情');
    expect(selected.archiveIds.has(tag + '-vectorbox')).toBe(true);
    expect(await listStoryVectorMemories(rain.id)).toHaveLength(0);
    expect(readCharacterPhoneChats(charA)[0].messages).toHaveLength(14);
    expect(readCharacterMoments(charA).length).toBeGreaterThanOrEqual(1);
    expect(phoneInteractions).toBeGreaterThanOrEqual(14);
    expect((await DB.getMusicListeningSession(charA))?.sessionId).toBe(latestSession);
    expect((await DB.getMusicListeningSession(charB))?.active).not.toBe(true);

    // User deletes only the second story; its memories must disappear, but
    // the first story, private chat, phone and music may not be collateral.
    const removed = await deleteStoryTheaterData(train);
    expect(removed.deletedVectorCount).toBe(1);
    expect(await listStoryVectorMemories(train.id)).toHaveLength(0);
    expect(await DB.getMessagesByCharId(storyTheaterThreadId(train.id), true)).toHaveLength(0);
    expect(await DB.getMessagesByCharId(storyTheaterThreadId(rain.id), true)).toHaveLength(420);
    expect((await DB.getMessagesByCharId(charA, true)).filter(m => m.role === 'user')).toHaveLength(43);
    expect((await DB.getMessagesByCharId(charB, true)).filter(m => m.role === 'assistant')).toHaveLength(28);
    expect(readCharacterPhoneChats(charA)[0].messages).toHaveLength(14);
    expect((await DB.getMusicListeningSession(charA))?.active).toBe(true);
    expect((await DB.transitionMusicListeningSession(charA, 'end', latestSession))?.active).toBe(false);

    allMessageIds.push(...rainIds, ...trainIds, ...normalRainIds, ...normalTrainIds);
    console.log('LONG_PLAY_OFFLINE_PASS: 7 simulated days; 490 story floors; 70 ordinary chat floors; phone + music + archive + vector recall + isolated deletion; paid AI calls=0');
  }, 90_000);
});
