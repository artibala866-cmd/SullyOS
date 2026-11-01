import { describe, it, expect } from 'vitest';
import type { CharacterProfile, Message } from '../types';
import { changeChatBlock, configureCharacterBlocking } from './chatBlock';
import {
  extractCharacterBlockDirective, extractCharacterBlockAction, buildInPersonCharBlockInstruction,
  buildFirstPostUnblockOpeningInstruction, buildCharacterBlockAutonomyInstruction,
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
    expect(extractCharacterBlockDirective('你好\n[UNBLOCK_USER]')).toEqual({ text: '你好', reason: null });
  });
  it('原版在线 JSON 和离线指令都能识别，普通引用与小号专用 main 不生效', () => {
    expect(extractCharacterBlockAction('我需要冷静。\\n{"t":"block_user","reason":"严重越界"}'))
      .toEqual({ text: '我需要冷静。', action: { kind: 'block', reason: '严重越界' } });
    expect(extractCharacterBlockAction('再见。\\n{"t":"unblock_user"}'))
      .toEqual({ text: '再见。', action: { kind: 'unblock' } });
    expect(extractCharacterBlockAction('再见。\\n[UNBLOCK_USER]'))
      .toEqual({ text: '再见。', action: { kind: 'unblock' } });
    expect(extractCharacterBlockAction('"[UNBLOCK_USER]"').action).toBeNull();
    expect(extractCharacterBlockAction('{"t":"unblock_user","main":true}').action).toBeNull();
    expect(extractCharacterBlockAction('普通消息里出现 [BLOCK_USER:玩笑] 不触发').action).toBeNull();
  });
  it('糯米机现有见面可识别拉黑关系，但只有角色能解除自己发起的拉黑', () => {
    const charBlocked = changeChatBlock(undefined, 'character', true, { at: 100, reason: '无法信任' });
    expect(buildInPersonCharBlockInstruction(charBlocked, '小明')).toContain('无法信任');
    expect(buildInPersonCharBlockInstruction(charBlocked, '小明')).toContain('[UNBLOCK_USER]');
    const userBlocked = changeChatBlock(undefined, 'user', true, { at: 100 });
    expect(buildInPersonCharBlockInstruction(userBlocked, '小明')).toContain('不能替用户解除拉黑');
    expect(buildInPersonCharBlockInstruction(undefined)).toBe('');
  });
  it('解封后首条是 Char 主动新消息，不回答拉黑前旧话题，也不假装看过被拒收内容', () => {
    const prompt = buildFirstPostUnblockOpeningInstruction('小明', '严重误会', 90);
    expect(prompt).toContain('主动');
    expect(prompt).toContain('严重误会');
    expect(prompt).toContain('90分钟');
    expect(prompt).toContain('不能重复');
    expect(prompt).toContain('没看到');
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
    const afterBlock = [{ id: 4, charId: 'c1', role: 'assistant', type: 'text', content: '封锁之后意外的消息', timestamp: 900 } as Message];
    expect(JSON.stringify(buildForgivenessMessages(character(blocked), '用户', [...rows, ...afterBlock], 1_000)))
      .not.toContain('封锁之后意外的消息');
    expect(payload).toContain('解除');
  });
  it('30 分钟冷却只限制角色拉黑方向的成功求原谅判断', () => {
    const blocked = changeChatBlock(undefined, 'character', true, { at: 100 });
    expect(forgivenessCooldownRemaining(blocked, 200)).toBe(CHAR_BLOCK_FORGIVENESS_COOLDOWN_MS - 100);
    const checked = { ...blocked, lastForgivenessCheckAt: 200 };
    expect(forgivenessCooldownRemaining(checked, 200)).toBe(CHAR_BLOCK_FORGIVENESS_COOLDOWN_MS);
    expect(forgivenessCooldownRemaining(checked, 200 + CHAR_BLOCK_FORGIVENESS_COOLDOWN_MS)).toBe(0);
    const next = changeChatBlock(checked, 'character', false, { at: 300 });
    expect(next.lastForgivenessCheckAt).toBeUndefined();
    const reblocked = changeChatBlock(next, 'character', true, { at: 400, reason: '新一轮冲突' });
    expect(forgivenessCooldownRemaining(reblocked, 401)).toBe(CHAR_BLOCK_FORGIVENESS_COOLDOWN_MS - 1);
  });
  it('原版 stay/unblock 决策会解析心软度、内心状态与未发送草稿', () => {
    expect(parseForgivenessDecision('{"decision":"unblock","softness":87,"thought":"开始心软","status":"有些犹豫","sign":"把手机放在桌上","draft":"我想再聊聊"}'))
      .toEqual({ decision: 'unblock', sign: '把手机放在桌上', softness: 87, thought: '开始心软', status: '有些犹豫', draft: '我想再聊聊', valid: true });
    expect(parseForgivenessDecision('{"decision":"stay","softness":3,"sign":"不想说话"}').decision).toBe('stay');
    expect(parseForgivenessDecision('{"decision":"stay","softness":150}').softness).toBe(100);
    expect(parseForgivenessDecision('模型连接出错').valid).toBe(false);
    expect(parseForgivenessDecision('{"decision":"maybe"}').valid).toBe(false);
    expect(parseForgivenessDecision('{"decision":"keep"}').valid).toBe(false);
  });
});
