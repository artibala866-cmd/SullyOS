import { describe, it, expect } from 'vitest';
import { DB } from './db';
import { changeChatBlock } from './chatBlock';
import { applyCharacterForgivenessDecision } from './chatBlockAI';
import type { CharacterProfile } from '../types';

describe('原版独立心软判定：历史读取是真正的拉黑前最后十二条', () => {
  it('超过 100 条拒收内容与已归档水位都不能挤掉拉黑前对话', async () => {
    const charId = 'forgiveness-archive-preblock-' + Date.now();
    const blockedAt = 100_000;
    for (let index = 0; index < 15; index++) {
      await DB.saveMessage({ charId, timestamp: 10_000 + index,
        role: index % 2 ? 'assistant' : 'user', type: 'text',
        content: '拉黑前第' + index + '条' });
    }
    const old = await DB.getRecentMessagesByCharId(charId, 20, true);
    localStorage.setItem('mp_lastMsgId_' + charId, String(old[old.length - 1].id));
    // 在原账号被拉黑后产生很多只能由 user 本地看到的拒收记录。
    for (let index = 0; index < 105; index++) {
      await DB.saveMessage({ charId, timestamp: blockedAt + 1 + index,
        role: 'user', type: 'text', content: '拒收秘密' + index,
        metadata: { chatBlockRejected: true } });
    }
    await DB.saveMessage({ charId, timestamp: 20_000,
      role: 'assistant', type: 'text', content: '线下见面内容', metadata: { source: 'date' } });
    await DB.saveMessage({ charId, timestamp: 20_001,
      role: 'assistant', type: 'image', content: '图片不送给心软判断' });
    await DB.saveMessage({ charId: 'forgiveness-other-character', timestamp: 20_002,
      role: 'user', type: 'text', content: '其他角色的秘密' });
    expect(await DB.getRecentMessagesByCharId(charId, 100)).toHaveLength(100);
    const result = await DB.getLastPrivateTextsBefore(charId, blockedAt, 12);
    expect(result).toHaveLength(12);
    expect(result[0].content).toBe('拉黑前第3条');
    expect(result[11].content).toBe('拉黑前第14条');
    expect(result.every(item => item.timestamp < blockedAt)).toBe(true);
    const joined = result.map(item => item.content).join(' ');
    expect(joined).not.toContain('拒收秘密');
    expect(joined).not.toContain('线下见面');
    expect(joined).not.toContain('其他角色的秘密');
    localStorage.removeItem('mp_lastMsgId_' + charId);
  });
});

describe('角色自主心软的持久化和视角隔离', () => {
  it('草稿、心软度和独处小剧场跨 DB 重读仍在，但从未伪装成聊天消息', async () => {
    const id = 'forgiveness-persisted-' + Date.now();
    const blocked = changeChatBlock(undefined, 'character', true, { at: 10, reason: '严重伤害' });
    const updated = applyCharacterForgivenessDecision(blocked, 10, {
      decision: 'stay', softness: 37, thought: '我可能想得太多了', status: '很安静',
      sign: '把屏幕扣下', draft: '我想和你谈谈',
      theater: { title: '深夜的草稿箱', body: '他看着草稿，久久没有发送。' },
    }, 1_800_100)!;
    await DB.saveCharacter({ id, name: '测试角色', avatar: '', chatBlock: updated } as CharacterProfile);
    const fromDB = await DB.getCharacter(id);
    expect(fromDB?.chatBlock?.forgivenessSoftness).toBe(37);
    expect(fromDB?.chatBlock?.lastForgivenessThought).toBe('我可能想得太多了');
    expect(fromDB?.chatBlock?.forgivenessDrafts?.[0].text).toBe('我想和你谈谈');
    expect(fromDB?.chatBlock?.forgivenessScenes?.[0].title).toBe('深夜的草稿箱');
    expect(await DB.getMessagesByCharId(id, true)).toEqual([]);
    const repeated = changeChatBlock(changeChatBlock(updated, 'character', false, { at: 2_000_000 }),
      'character', true, { at: 2_000_100, reason: '第二次冲突' });
    expect(repeated.forgivenessDrafts?.[0].text).toBe('我想和你谈谈');
    expect(repeated.forgivenessScenes?.[0].title).toBe('深夜的草稿箱');
  });
});
