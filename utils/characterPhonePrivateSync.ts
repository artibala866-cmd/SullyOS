import { normalizeMessageContent } from './messageFormat';
import type { Message } from '../types';
import type { PhoneMessageV2, PhoneThreadV2 } from './characterPhoneModel';
import { phoneOwnerId, phoneUserId } from './characterPhoneModel';
/** Private chat is authoritative. Mirror its messages without AI rewriting. */
export function mirrorPrivateChat(characterId: string, messages: Message[]): PhoneThreadV2 {
  const threadId = 'private:' + characterId;
  const items: PhoneMessageV2[] = messages.filter(m =>
    m.charId === characterId && !m.groupId &&
    (m.role === 'assistant' || m.role === 'user') &&
    ['text','voice','image','emoji','interaction','transfer','music_card'].includes(m.type) && typeof m.content === 'string'
  ).sort((a,b) => a.id-b.id).map(m => ({
    id: 'private-msg:' + characterId + ':' + m.id,
    threadId, speakerId: m.role === 'user' ? phoneUserId(characterId) : phoneOwnerId(characterId),
    kind: 'text', text: m.type === 'text' ? m.content : normalizeMessageContent(m, 'Char', 'User'), timestamp: m.timestamp, sourceMessageId: m.id, sent: true,
  }));
  return { id: threadId, contactId: phoneUserId(characterId), messages: items };
}
