import type { CharacterProfile, UserProfile, GroupProfile, RealtimeConfig, Message } from '../types';
import { DB } from './db';
import { ChatPrompts } from './chatPrompts';

/** Use the exact private-chat prompt builder instead of a second imitation persona. */
export async function buildCharacterPhoneContext(
  char: CharacterProfile,
  user: UserProfile,
  groups: GroupProfile[],
  realtimeConfig?: RealtimeConfig,
): Promise<{ systemPrompt: string; privateMessages: Message[] }> {
  const all = await DB.getMessagesByCharId(char.id, true);
  const privateMessages = all.filter(m => !m.groupId && (m.role === 'user' || m.role === 'assistant'))
    .sort((a,b) => a.timestamp - b.timestamp);
  const systemPrompt = await ChatPrompts.buildSystemPrompt(
    char, user, groups, [], [], privateMessages.slice(-80), realtimeConfig,
  );
  return { systemPrompt, privateMessages };
}
