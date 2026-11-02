import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyAssistantPostProcessing, type PostProcessCtx } from './applyAssistantPostProcessing';
import { DB } from './db';
import { changeChatBlock, didCharReplyFailDuringGeneration, userBlocksCharacter } from './chatBlock';
import type { ChatBlockState } from '../types';

const context = (id: string): PostProcessCtx => ({
  char: { id, name: '测试角色' } as PostProcessCtx['char'],
  userProfile: { name: '用户' } as PostProcessCtx['userProfile'],
  emojis: [], contextMsgs: [], fullMessages: [], initialData: {}, historyMsgCount: 0,
  xhsCaches: { xsecTokenCache: new Map(), noteTitleCache: new Map(),
    commentUserIdCache: new Map(), commentAuthorNameCache: new Map(), commentParentIdCache: new Map() },
  api: { baseUrl: 'http://localhost:0', headers: {},
    effectiveApi: { baseUrl: 'http://localhost:0', apiKey: '', model: 'test' } },
  hooks: { setMessages: vi.fn(), addToast: vi.fn() },
  instantRender: true,
});

afterEach(() => vi.restoreAllMocks());

describe('拉黑发生在分条回复期间的实际落库', () => {
  it('第一条已送达，第二条前拉黑、第三条前解除，失败历史不回溯变化', async () => {
    const id = 'block-during-bubbles';
    let state: ChatBlockState | undefined;
    let count = 0;
    const save = DB.saveMessage;
    vi.spyOn(DB, 'saveMessage').mockImplementation(async message => {
      const result = await save(message);
      if (message.charId === id && message.role === 'assistant') {
        count++;
        if (count === 1) state = changeChatBlock(state, 'user', true, { at: 100 });
        if (count === 2) state = changeChatBlock(state, 'user', false, { at: 200 });
      }
      return result;
    });
    await applyAssistantPostProcessing('第一条消息\n第二条消息\n第三条消息', {
      ...context(id),
      messageSendFailedByUserBlock: () => didCharReplyFailDuringGeneration(false, userBlocksCharacter(state), state, 50, 1000),
    });
    const messages = (await DB.getRecentMessagesByCharId(id, 20)).filter(m => m.role === 'assistant');
    expect(messages.map(m => m.content)).toEqual(['第一条消息', '第二条消息', '第三条消息']);
    expect(messages.map(m => m.metadata?.chatBlockSendFailed === true)).toEqual([false, true, true]);
    expect(userBlocksCharacter(state)).toBe(false);
  });
  it.each([false, true])('云端固定发送结果 %s 仍保持每条一致，不按收件时刻重算', async failed => {
    const id = 'block-cloud-bubbles-' + failed;
    await applyAssistantPostProcessing('云端第一条\n云端第二条', { ...context(id), messageSendFailedByUserBlock: failed });
    const messages = (await DB.getRecentMessagesByCharId(id, 20)).filter(m => m.role === 'assistant');
    expect(messages).toHaveLength(2);
    expect(messages.every(m => (m.metadata?.chatBlockSendFailed === true) === failed)).toBe(true);
  });
});
