import { describe, it, expect } from 'vitest';
import { DB } from './db';

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
