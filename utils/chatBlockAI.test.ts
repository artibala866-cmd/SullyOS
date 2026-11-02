import { describe, it, expect } from 'vitest';
import type { CharacterProfile, Message } from '../types';
import { changeChatBlock, configureCharacterBlocking } from './chatBlock';
import {
  extractCharacterBlockDirective, extractCharacterBlockAction, buildInPersonCharBlockInstruction,
  buildFirstPostUnblockOpeningInstruction, buildCharacterBlockAutonomyInstruction,
  buildPrivateChatBlockHistoryContext, buildForgivenessMessages,
  forgivenessCooldownRemaining, parseForgivenessDecision, extractForgivenessJson, applyCharacterForgivenessDecision,
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
    expect(buildCharacterBlockAutonomyInstruction(changeChatBlock(undefined, 'user', true, { at: 10 }))).toContain('严重背叛');
    // 用户拉黑 Char 不会删除 Char 自己的拉黑权限；发生严重越界后可进入双方互拉黑。
    const both = changeChatBlock(changeChatBlock(undefined, 'user', true, { at: 10 }), 'character', true, { at: 20, reason: '越界' });
    expect(buildCharacterBlockAutonomyInstruction(both)).toBe('');
    expect(buildPrivateChatBlockHistoryContext(changeChatBlock(undefined, 'user', true, { at: 10 }), 300)).toContain('依然可以读到用户新发来的话');
  });
  it('仅提取原版的独立动作行，保留自然回复且不泄露内部标签', () => {
    const parsed = extractCharacterBlockDirective('我需要停止这段对话。\n[BLOCK_USER:严重欺骗与背叛]');
    expect(parsed).toEqual({ text: '我需要停止这段对话。', reason: '严重欺骗与背叛' });
    expect(extractCharacterBlockDirective('[BLOCK_USER:持续伤害]')).toEqual({ text: '', reason: '持续伤害' });
    expect(extractCharacterBlockDirective('你好\n[UNBLOCK_USER]')).toEqual({ text: '你好', reason: null });
  });
  it('原版在线 JSON 和离线指令都能识别，普通引用与小号专用 main 不生效', () => {
    expect(extractCharacterBlockAction('我需要冷静。\n{"t":"block_user","reason":"严重越界"}'))
      .toEqual({ text: '我需要冷静。', action: { kind: 'block', reason: '严重越界' } });
    expect(extractCharacterBlockAction('再见。\n{"t":"unblock_user"}'))
      .toEqual({ text: '再见。', action: { kind: 'unblock' } });
    expect(extractCharacterBlockAction('再见。\n[UNBLOCK_USER]'))
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
  it('双向同时拉黑时 Char 不能假装看到了被自己拒收的消息', () => {
    const userBlock = changeChatBlock(undefined, 'user', true, { at: 100 });
    const both = changeChatBlock(userBlock, 'character', true, { at: 200, reason: '信任破裂' });
    const context = buildPrivateChatBlockHistoryContext(both, 300);
    expect(context).toContain('互相拉黑');
    expect(context).toContain('无法读取');
    expect(context).not.toContain('你依然可以读到用户新发来的话');
    const scene = buildInPersonCharBlockInstruction(userBlock, '小明');
    expect(scene).toContain('能读到用户主动发来的话');
    expect(scene).not.toContain('不知道用户是否尝试发送');
    expect(buildInPersonCharBlockInstruction(both, '小明')).toContain('被你拒收的用户消息');
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
    // 从旧存档导入、没有 lastCheck，也不能刚拉黑就立即启动求原谅。
    expect(forgivenessCooldownRemaining({ characterBlockedAt: 400 }, 401)).toBe(CHAR_BLOCK_FORGIVENESS_COOLDOWN_MS - 1);
    // 旧一轮留下的 lastCheck 不得穿透新一轮冷却。
    expect(forgivenessCooldownRemaining({ characterBlockedAt: 400, lastForgivenessCheckAt: 200 }, 401))
      .toBe(CHAR_BLOCK_FORGIVENESS_COOLDOWN_MS - 1);
  });
  it('Char 自己可以解除自己的拉黑，即使用户也拉黑了他；旧判定不能解除新一轮拉黑', () => {
    const first = changeChatBlock(undefined, 'character', true, { at: 100, reason: '信任破裂' });
    const both = changeChatBlock(first, 'user', true, { at: 110 });
    const judgement = { decision: 'unblock' as const, softness: 65, sign: '犹豫着放下手机',
      thought: '我想试一试', status: '迟疑', draft: '你还在吗' };
    const released = applyCharacterForgivenessDecision(both, 100, judgement, 200)!;
    expect(released.characterBlockedAt).toBeUndefined();
    expect(released.userBlockedAt).toBe(110);
    expect(released.lastForgivenessThought).toBe('我想试一试');
    expect(released.forgivenessDrafts?.[0].text).toBe('你还在吗');
    const newBlock = changeChatBlock(released, 'character', true, { at: 300, reason: '再次越界' });
    expect(applyCharacterForgivenessDecision(newBlock, 100, judgement, 400)).toBe(newBlock);
    const staying = applyCharacterForgivenessDecision(newBlock, 300, { ...judgement, decision: 'stay' }, 500)!;
    expect(staying.characterBlockedAt).toBe(300);
    expect(staying.forgivenessSoftness).toBe(65);
    expect(staying.lastForgivenessCheckAt).toBe(500);
    expect(staying.forgivenessScenes || []).toEqual([]);
    const sceneDecision = { ...judgement, decision: 'stay' as const,
      theater: { title: '停在草稿箱', body: '他把手机扣在桌上，几次打开未发送的草稿。' } };
    const withScene = applyCharacterForgivenessDecision(newBlock, 300, sceneDecision, 501)!;
    expect(withScene.forgivenessScenes).toEqual([{
      at: 501, blockedAt: 300, title: '停在草稿箱',
      body: '他把手机扣在桌上，几次打开未发送的草稿。',
    }]);
    const nextBlock = changeChatBlock(withScene, 'character', false, { at: 502 });
    const anotherBlock = changeChatBlock(nextBlock, 'character', true, { at: 503, reason: '另一个原因' });
    expect(anotherBlock.forgivenessScenes).toEqual(withScene.forgivenessScenes);
    expect(anotherBlock.forgivenessDrafts).toEqual(withScene.forgivenessDrafts);
    expect(anotherBlock.forgivenessSoftness).toBe(65);
  });
  it('即使 40 条事件已裁剪拉黑动作，AI 仍记得真实拉黑原因', () => {
    let state = changeChatBlock(undefined, 'character', true, { at: 100, reason: '故意欺骗我' });
    for (let i = 0; i < 44; i++) state = changeChatBlock(state, 'user', i % 2 === 0, { at: 101 + i });
    expect(state.history?.some(e => e.actor === 'character' && e.action === 'block')).toBe(false);
    expect(state.lastCharacterBlockReason).toBe('故意欺骗我');
    const request = JSON.stringify(buildForgivenessMessages(character(state), '用户', rows, 10_000_000));
    expect(request).toContain('故意欺骗我');
    expect(buildPrivateChatBlockHistoryContext(state)).toContain('故意欺骗我');
    expect(buildInPersonCharBlockInstruction(state)).toContain('故意欺骗我');
  });
  it('原版 stay/unblock 决策会解析心软度、内心状态与未发送草稿', () => {
    expect(parseForgivenessDecision('{"decision":"unblock","softness":87,"thought":"开始心软","status":"有些犹豫","sign":"把手机放在桌上","draft":"我想再聊聊"}'))
      .toEqual({ decision: 'unblock', sign: '把手机放在桌上', softness: 87, thought: '开始心软', status: '有些犹豫', draft: '我想再聊聊', theater: null, valid: true });
    expect(parseForgivenessDecision('{"decision":"stay","softness":3,"sign":"不想说话"}').decision).toBe('stay');
    expect(parseForgivenessDecision('{"decision":"stay","softness":150}').softness).toBe(100);
    expect(parseForgivenessDecision('模型连接出错').valid).toBe(false);
    expect(parseForgivenessDecision('{"decision":"maybe"}').valid).toBe(false);
    expect(parseForgivenessDecision('{"decision":"keep"}').valid).toBe(false);
    const prompt = buildForgivenessMessages(character(changeChatBlock(undefined, 'character', true,
      { at: 100, reason: '欺骗' })), '用户', rows, 10_000_000, true);
    expect(prompt[0].content).toContain('theater');
    expect(prompt[0].content).toContain('第三人称独处片段');
    expect(buildForgivenessMessages(character(changeChatBlock(undefined, 'character', true,
      { at: 100, reason: '欺骗' })), '用户', rows, 10_000_000, false)[0].content).toContain('不要生成 theater 字段');
  });
  it('解析完整的嵌套剧场 JSON：引号/大括号/围栏不会中途截断', () => {
    const response = [
      '```json',
      '{"decision":"stay","softness":17,"thought":"他想起了那段 \\"对不起\\"。",',
      '"status":"今天不回","sign":"翻看{照片}","draft":"想说的话",',
      '"theater":{"title":"没发出的字","body":"他写下 \\"你还好吗\\"，又删掉。{草稿}留在屏幕上。"}}',
      '```',
    ].join('\n');
    expect(extractForgivenessJson(response)).toContain('"theater"');
    const parsed = parseForgivenessDecision(response);
    expect(parsed.valid).toBe(true);
    expect(parsed.decision).toBe('stay');
    expect(parsed.softness).toBe(17);
    expect(parsed.theater?.title).toBe('没发出的字');
    expect(parsed.theater?.body).toContain('{草稿}');
    const withExtraExample = '模型前言示例 {"foo":"bar"}\\n' + response;
    expect(parseForgivenessDecision(withExtraExample).decision).toBe('stay');
    expect(parseForgivenessDecision(withExtraExample).theater?.title).toBe('没发出的字');
    expect(parseForgivenessDecision('{"decision":"stay","theater":{"body":"未关闭"}').valid).toBe(false);
    expect(parseForgivenessDecision('{"decision":"stay","softness":"NaN","theater":{}').valid).toBe(false);
  });
  it('任何独处片段都不能改写收到的私聊，空草稿不伪造一条送达消息', () => {
    const state = changeChatBlock(undefined, 'character', true, { at: 10 });
    const check = applyCharacterForgivenessDecision(state, 10, {
      decision: 'stay', thought: '试探', status: '冷淡', sign: '盯着屏幕',
      draft: '', theater: { title: '无声', body: '他只是看着屏幕。' }, softness: 20,
    }, 2_000)!;
    expect(check.forgivenessDrafts).toEqual([]);
    expect(check.forgivenessScenes?.[0].body).toBe('他只是看着屏幕。');
    expect(check.characterBlockedAt).toBe(10);
    expect(check.forgivenessSoftness).toBe(20);
  });
});
