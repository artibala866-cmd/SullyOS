import { buildCharacterLifeFacts } from './characterLifeContext';
import type { CharacterProfile, UserProfile, GroupProfile, RealtimeConfig, Message } from '../types';
import { ContextBuilder } from './context';
import { loadCharacterContextMessages } from './chatContextRange';
import { formatMessageForPrompt } from './messageFormat';
import { isRejectedPrivateMessage } from './chatBlock';

/** Share persona, worldbooks and the authorized history range, not Chat's tool/output protocol.
 * Reading the phone must never launch a second user reply or a recall LLM.
 */
export async function buildCharacterPhoneContext(
  char: CharacterProfile,
  user: UserProfile,
  _groups: GroupProfile[],
  _realtimeConfig?: RealtimeConfig,
): Promise<{ systemPrompt: string; privateMessages: Message[] }> {
  const privateMessages = (await loadCharacterContextMessages(char)).filter(m =>
    !m.groupId && (m.role === 'user' || m.role === 'assistant') && !isRejectedPrivateMessage(m));
  const history = privateMessages.map(message => ({
    role: message.role, content: formatMessageForPrompt(message, char.name, user.name),
  }));
  const context = await ContextBuilder.buildCharacterContext({char, user, history});
  const systemPrompt = context.coreContext + buildCharacterLifeFacts(char) + (context.history.length
    ? '\n【与 User 已保存的私聊背景】\n' + context.history.map(m => String(m.content)).join('\n')
    : '')
      + '\n以上是既有交流背景，不是本轮手机收件人。当前手机任务的接收人、动作和输出格式由本轮请求指定，不在这里代替 User 发言。不得向 NPC 转述 User 的私聊原文或未公开隐私；有私聊上下文不等于获得公开授权。';
  return { systemPrompt, privateMessages };
}
