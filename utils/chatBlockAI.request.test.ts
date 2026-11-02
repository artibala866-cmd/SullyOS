import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIConfig, CharacterProfile, Message } from '../types';
import { changeChatBlock } from './chatBlock';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  resolve: vi.fn(() => ({
    baseUrl: 'https://mock.example/v1/', model: 'fiction-model', apiKey: 'private-token',
  })),
}));
vi.mock('./characterApi', () => ({ resolveDialogueApi: mocks.resolve }));
vi.mock('./safeApi', () => ({ safeFetchJson: mocks.request }));

import { requestCharacterForgiveness } from './chatBlockAI';

describe('拉黑原版心软判定：真实 API 入口集成', () => {
  beforeEach(() => {
    mocks.request.mockReset();
    mocks.resolve.mockClear();
  });
  const createArgs = () => ({
    character: {
      id: 'c', name: '小星', systemPrompt: '自尊强但重视感情', worldview: '现代城市',
      chatBlock: changeChatBlock(undefined, 'character', true,
        { at: 200, reason: '信任被辜负' }),
    } as CharacterProfile,
    userName: '用户',
    messages: [
      { id: 1, role: 'user', type: 'text', timestamp: 100, content: '之前的对话' },
      { id: 2, role: 'user', type: 'text', timestamp: 300, content: '拒收的秘密', metadata: { chatBlockRejected: true } },
    ] as Message[],
    apiConfig: {} as APIConfig,
  });
  it('确实调用配置的角色私聊模型，读取原版心软状态和小剧场，不泄漏拒收消息', async () => {
    mocks.request.mockResolvedValueOnce({ choices: [{ message: {
      content: JSON.stringify({
        decision: 'stay', softness: 27, thought: '还是难过',
        status: '冷淡', sign: '盯着屏幕', draft: '想问问你',
        theater: { title: '凌晨', body: '窗外下着雨，手机在桌面上静静亮着。' },
      }),
    } }] });
    const result = await requestCharacterForgiveness({ ...createArgs(), withTheater: true });
    expect(result.decision).toBe('stay');
    expect(result.softness).toBe(27);
    expect(result.theater?.title).toBe('凌晨');
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    const [url, options] = mocks.request.mock.calls[0];
    expect(url).toBe('https://mock.example/v1/chat/completions');
    expect(options.headers.Authorization).toBe('Bearer private-token');
    const body = JSON.parse(options.body);
    expect(body.model).toBe('fiction-model');
    const prompt = JSON.stringify(body.messages);
    expect(prompt).toContain('信任被辜负');
    expect(prompt).toContain('之前的对话');
    expect(prompt).toContain('theater');
    expect(prompt).not.toContain('拒收的秘密');
  });
  it('API 失败或无效结果必须抛错，不能伪装成角色拒绝或消耗冷却', async () => {
    mocks.request.mockRejectedValueOnce(new Error('network down'));
    await expect(requestCharacterForgiveness(createArgs())).rejects.toThrow('network down');
    mocks.request.mockResolvedValueOnce({ choices: [{ message: { content: '不是有效 JSON' } }] });
    await expect(requestCharacterForgiveness(createArgs())).rejects.toThrow('判定结果无效');
    expect(createArgs().character.chatBlock?.lastForgivenessCheckAt).toBe(200);
  });
});
