/** Stable identities for character-phone conversations.
 * Display names are NOT identifiers: user, owner Char, NPC and another Char can share a name.
 */
export type PhoneSpeaker = { role: 'owner' } | { role: 'user' } | { role: 'contact'; contactId: string };
export type PhoneMessage = { speaker: PhoneSpeaker; text: string; from?: string; createdAt?: number;
  /** A delivered cloud-side NPC turn; stable identity prevents outbox replay duplicates. */
  cloudSourceId?: string; };
export type PhoneThread = { contactId: string; messages: PhoneMessage[] };
export const speakerKey = (speaker: PhoneSpeaker): string =>
  speaker.role === 'contact' ? 'contact:' + speaker.contactId : speaker.role;
export const sameSpeaker = (a: PhoneSpeaker, b: PhoneSpeaker): boolean => speakerKey(a) === speakerKey(b);
export function parseGeneratedPhoneMessages(input: unknown, contactId: string): PhoneMessage[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 24).flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const m = item as Record<string, unknown>;
    if (typeof m.text !== 'string' || !m.text.trim()) return [];
    // No fallback to display-name matching. Ambiguous model output is rejected.
    const tag = m.speaker ?? m.role;
    const speaker: PhoneSpeaker | null = tag === 'owner' || tag === 'char' ? { role: 'owner' }
      : tag === 'contact' || tag === 'npc' ? { role: 'contact', contactId } : null;
    return speaker ? [{ speaker, text: m.text.slice(0, 600) }] : [];
  });
}
