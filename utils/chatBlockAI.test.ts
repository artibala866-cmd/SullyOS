import { describe, it, expect } from 'vitest';
import type { CharacterProfile, Message } from '../types';
import { changeChatBlock, configureCharacterBlocking } from './chatBlock';
import {
  extractCharacterBlockDirective, buildCharacterBlockAutonomyInstruction,
  buildPrivateChatBlockHistoryContext, buildForgivenessMessages,
  forgivenessCooldownRemaining, parseForgivenessDecision,
  CHAR_BLOCK_FORGIVENESS_COOLDOWN_MS,
} from './chatBlockAI';

const character = (chatBlock?: CharacterProfile['chatBlock']): CharacterProfile => ({
  id: 'c1', name: '阿星', systemPrompt: '敏感但理性，重视信任和界限', worldview: '普通现代日常',
  chatBlock,
} as CharacterProfile);
const rows = [
  { id: 1, charId: 'c1', role: 'user', type: 'text', content: '我们之前很要好', timestamp: 100 },
  { id: 2, charId: 'c1', role: 'assistant', type: 'text', content: '我知道', timestamp: 200 },
  { id: 3, charId: 'c1', role: 'user', type: 'text', content: '拒收内容是秘密', timestamp: 300, metadata: { chatBlockRejected: true } },
] as Message[];

describe('糯叽机双向拉黑 AI 适配，不扩展其他系统', () => {
  it('不将普通争吵、单行引用或没有权限的角色误判为自主拉黑', () => {
    expect(extractCharacterBlockDirective('你不要跟我吵了').reason).toBeNull();
    expect(extractCharacterBlockDirective('你刚刚说[BLOCK_USER:开玩笑]对吗？').reason).toBeNull();
    expect(buildCharacterBlockAutonomyInstruction(configureCharacterBlocking(undefined, false))).toBe('');
    expect(buildCharacterBlockAutonomyInstruction(changeChatBlock(undefined, 'user', true, { at: 10 }))).toBe('');
  });
  it('仅提取原版的独立动作行，保留自然回复且不泄露内部标签', () => {
    const parsed = extractCharacterBlockDirective('我需要停止这段对话。\n[BLOCK_USER:严重欺骗与背叛]');
    expect(parsed).toEqual({ text: '我需要停止这段对话。', reason: '严重欺骗与背叛' });
    expect(extractCharacterBlockDirective('[BLOCK_USER:持续伤害]')).toEqual({ text: '', reason: '持续伤害' });
    expect(extractCharacterBlockDirective('你好\n[UNBLOCK_USER]')).toEqual({ text: '你好\n[UNBLOCK_USER]', reason: null });
  });
  it('角色只在正常未拉黑私聊得到自主权限，不改变用户自带人设', () => {
    const prompt = buildCharacterBlockAutonomyInstruction();
    expect(prompt).toContain('严重背叛');
    expect(prompt).toContain('普通争执');
    expect(prompt).toContain('[BLOCK_USER:');
    const state = changeChatBlock(undefined, 'character', true, { at: 100, reason: '欺骗' });
    expect(buildCharacterBlockAutonomyInstruction(state)).toBe('');
    expect(buildPrivateChatBlockHistoryContext(state, 100 + 60_000)).toContain('欺骗');
  });
  it('求原谅只看到真实送达的历史，绝不让角色补读拒收气泡', () => {
    const blocked = changeChatBlock(undefined, 'character', true, { at: 400, reason: '严重不信任' });
    const request = buildForgivenessMessages(character(blocked), '用户', rows, 400 + 60_000);
    const payload = JSON.stringify(request);
    expect(payload).toContain('我们之前很要好');
    expect(payload).toContain('我知道');
    expect(payload).toContain('严重不信任');
    expect(payload).not.toContain('拒收内容是秘密');
    expect(payload).toContain('解除');
  });
  it('30 分钟冷却只限制角色拉黑方向的成功求原谅判断', () => {
    const blocked = changeChatBlock(undefined, 'character', true, { at: 100 });
    expect(forgivenessCooldownRemaining(blocked, 200)).toBe(0);
    const checked = { ...blocked, lastForgivenessCheckAt: 200 };
    expect(forgivenessCooldownRemaining(checked, 200)).toBe(CHAR_BLOCK_FORGIVENESS_COOLDOWN_MS);
    expect(forgivenessCooldownRemaining(checked, 200 + CHAR_BLOCK_FORGIVENESS_COOLDOWN_MS)).toBe(0);
    const next = changeChatBlock(checked, 'character', false, { at: 300 });
    expect(next.lastForgivenessCheckAt).toBeUndefined();
    const reblocked = changeChatBlock(next, 'character', true, { at: 400, reason: '新一轮冲突' });
    expect(forgivenessCooldownRemaining(reblocked, 401)).toBe(0);
  });
  it('没有有效结构化决策时不假装角色拒绝或直接解除拉黑', () => {
    expect(parseForgivenessDecision('{"decision":"unblock","sign":"我愿意再谈谈"}'))
      .toEqual({ decision: 'unblock', sign: '我愿意再谈谈', valid: true });
    expect(parseForgivenessDecision('{"decision":"keep","sign":"再给我一点时间"}'))
      .toEqual({ decision: 'keep', sign: '再给我一点时间', valid: true });
    expect(parseForgivenessDecision('模型连接出错').valid).toBe(false);
    expect(parseForgivenessDecision('{"decision":"maybe"}').valid).toBe(false);
  });
});
