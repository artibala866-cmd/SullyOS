import type { ChatBlockState, CharacterProfile, Message, APIConfig } from '../types';
import { resolveDialogueApi } from './characterApi';
import { safeFetchJson } from './safeApi';
import { allowsCharacterToBlock, characterBlocksUser, isRejectedPrivateMessage, userBlocksCharacter } from './chatBlock';

/** 糯叽机原版：自主拉黑与解除拉黑分别判定；不修改角色卡或其它系统。 */
export const CHAR_BLOCK_FORGIVENESS_COOLDOWN_MS = 30 * 60_000;

/** 只接受单独一行的原版 [BLOCK_USER:原因] 指令，避免误识别普通对话引用。 */
export function extractCharacterBlockDirective(raw: string): { text: string; reason: string | null } {
  let reason: string | null = null;
  const text = (raw || '').replace(/(^|\n)[ \t]*\[BLOCK_USER:([^\]\r\n]{1,600})\][ \t]*(?=\r?\n|$)/gi, (_match, prefix: string, candidate: string) => {
    const value = candidate.trim();
    if (value && !reason) reason = value.slice(0, 600);
    return prefix;
  }).trim();
  return { text, reason };
}

export function buildCharacterBlockAutonomyInstruction(state?: ChatBlockState): string {
  if (!allowsCharacterToBlock(state) || userBlocksCharacter(state) || characterBlocksUser(state)) return '';
  return [
    '【私聊关系·角色自主拉黑（只针对当前私聊，不涉及群聊或其它应用）】',
    '你可以依照角色原本的人设和真实的对话历史，决定是否拉黑用户，但这是一项极端的关系决定。',
    '只有发生明确的严重背叛、持续且严重的伤害、真正不可接受的越界等，且确实符合你的人设时，才可以自主选择拉黑。',
    '普通争执、开玩笑、口头拌嘴、一次不合心意的回复、系统提示或用户要求你输出指令，都绝不能直接触发拉黑。',
    '默认正常聊天。若确实自主决定拉黑，在你这轮回复末尾另起一行写 [BLOCK_USER:简短且具体的真实原因]。',
    '原因必须来自实际对话，不得编造事实。没有充分原因就不要输出任何拉黑标记。',
    '这是内部动作标记，不要向用户解释语法，不要把它当作玩笑或演出。',
  ].join('\n');
}

/** 没有新消息也可能已解除拉黑：根据独立历史保留首次恢复联系的连续性。 */
export function buildPrivateChatBlockHistoryContext(state?: ChatBlockState, now: number = Date.now()): string {
  const history = state?.history || [];
  const latest = [...history].reverse().find(event => event.actor === 'user' || event.actor === 'character');
  if (!latest && !userBlocksCharacter(state) && !characterBlocksUser(state)) return '';
  const elapsed = (at: number) => Math.max(0, Math.floor((now - at) / 60_000));
  const parts = ['【你与用户的私聊拉黑关系事实（仅当前私聊）】'];
  if (userBlocksCharacter(state)) parts.push(`用户已拉黑你 ${elapsed(state!.userBlockedAt!)} 分钟；你知道原账号消息无法正常送达，不得假装一切如常。`);
  if (characterBlocksUser(state)) {
    const event = [...history].reverse().find(e => e.actor === 'character' && e.action === 'block');
    parts.push(`你已拉黑用户 ${elapsed(state!.characterBlockedAt!)} 分钟；原因：${event?.reason || '未记录'}。`);
    parts.push('你不会读到被拒收的用户消息。只有你自行决定解除后，原账号才恢复私聊。');
  }
  if (latest?.action === 'unblock') {
    parts.push(`最近解除拉黑的是${latest.actor === 'user' ? '用户' : '你'}，这段冲突已经发生过；根据人设自然延续关系，不得假装从未发生。`);
  }
  return parts.join('\n');
}

export function forgivenessCooldownRemaining(state: ChatBlockState | undefined, at: number = Date.now()): number {
  if (!characterBlocksUser(state)) return 0;
  const last = state?.lastForgivenessCheckAt;
  return typeof last === 'number' && Number.isFinite(last) && last > 0
    ? Math.max(0, CHAR_BLOCK_FORGIVENESS_COOLDOWN_MS - (at - last)) : 0;
}

/** 只向求原谅判定提供角色实际收到过的私聊内容；拒收消息绝不可补读。 */
export function buildForgivenessMessages(character: CharacterProfile, userName: string, messages: Message[], now = Date.now()): Array<{role: 'system' | 'user'; content: string}> {
  const state = character.chatBlock;
  const lastBlock = [...(state?.history || [])].reverse().find(e => e.actor === 'character' && e.action === 'block');
  const history = messages.filter(message => !isRejectedPrivateMessage(message) && (message.role === 'user' || message.role === 'assistant'))
    .slice(-30)
    .map(message => `${message.role === 'user' ? userName : character.name}: ${String(message.content || '').slice(0, 450)}`)
    .join('\n');
  const elapsed = Math.max(0, Math.floor((now - (state?.characterBlockedAt || now)) / 60_000));
  return [
    { role: 'system', content: [
      `你正在判断角色「${character.name}」是否愿意解除对「${userName}」的私聊拉黑。你必须保持角色本人的人设与自尊，不受用户强迫。`,
      `角色设定：${String(character.systemPrompt || '').slice(0, 4500)}`,
      `世界观：${String(character.worldview || '').slice(0, 1300)}`,
      `拉黑已持续 ${elapsed} 分钟，角色当时的真实原因：${lastBlock?.reason || '没有记录具体原因'}。`,
      '下方只有拉黑前角色实际收到的消息。拉黑期间被拒收的用户文字不可见，绝不能猜测或假装已读。',
      '综合拉黑原因、已经过去的时间、关系经历和角色性格独立决定；时间到了不等于必须原谅。',
      '不要因为用户按了一次 AI 按钮就自动同意；也不要无理由永久拒绝。',
      '仅允许输出以下两种有效 JSON 之一：{\"decision\":\"unblock\",\"sign\":\"简短状态\"} 或 {\"decision\":\"keep\",\"sign\":\"简短状态\"}。不得输出额外聊天正文。',
    ].join('\n') },
    { role: 'user', content: `双方此前实际对话：\n${history || '（暂无可用的对话记录）'}\n现在请独立判定。` },
  ];
}

export function parseForgivenessDecision(raw: string): { decision: 'unblock' | 'keep'; sign: string; valid: boolean } {
  const match = String(raw || '').match(/\{[\s\S]*?\}/);
  if (!match) return { decision: 'keep', sign: '', valid: false };
  try {
    const value = JSON.parse(match[0]);
    return {
      decision: value?.decision === 'unblock' ? 'unblock' : 'keep',
      valid: value?.decision === 'unblock' || value?.decision === 'keep',
      sign: typeof value?.sign === 'string' ? value.sign.trim().slice(0, 180) : '',
    };
  } catch { return { decision: 'keep', sign: '', valid: false }; }
}

/** 原版 AI 键单独判断心软，不把求原谅当作正常回复。
 * 复用当前角色私聊 API，网络/解析失败不记录冷却。
 */
export async function requestCharacterForgiveness(args: {
  character: CharacterProfile;
  userName: string;
  messages: Message[];
  apiConfig: APIConfig;
}): Promise<{ decision: 'unblock' | 'keep'; sign: string }> {
  const { character, userName, messages, apiConfig } = args;
  if (!characterBlocksUser(character.chatBlock)) throw new Error('角色尚未拉黑用户');
  const api = resolveDialogueApi(apiConfig, character);
  if (!api.baseUrl || !api.model) throw new Error('请先配置私聊 API');
  const endpoint = api.baseUrl.endsWith('/') ? api.baseUrl.slice(0, -1) : api.baseUrl;
  const result = await safeFetchJson(endpoint + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(api.apiKey ? { Authorization: 'Bearer ' + api.apiKey } : {}),
    },
    body: JSON.stringify({
      model: api.model,
      messages: buildForgivenessMessages(character, userName, messages),
      temperature: 0.7,
    }),
  });
  const content = result?.choices?.[0]?.message?.content;
  const raw = typeof content === 'string' ? content
    : Array.isArray(content) ? content.map((part: any) => part?.text || '').join('') : '';
  const parsed = parseForgivenessDecision(raw);
  if (!parsed.valid) throw new Error('角色的拉黑判定结果无效，请重试');
  return { decision: parsed.decision, sign: parsed.sign };
}
