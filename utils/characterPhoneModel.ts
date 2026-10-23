/** V2 phone domain model: independent of AI prompts and UI. */
export type PhoneContactKind = 'user' | 'char' | 'npc' | 'group' | 'service';
export type PhoneMessageKind = 'text' | 'notice' | 'payment' | 'draft';
export interface PhoneContactV2 {
  id: string;
  kind: PhoneContactKind;
  displayName: string;
  linkedCharacterId?: string;
  profileId?: string;
}
export interface PhoneMessageV2 {
  id: string;
  threadId: string;
  speakerId: string;
  kind: PhoneMessageKind;
  text: string;
  timestamp: number;
  /** Real private-chat messages reference their source; never regenerate them. */
  sourceMessageId?: number;
  paymentId?: string;
  sent: boolean;
}
export interface PhoneThreadV2 {
  id: string;
  contactId: string;
  messages: PhoneMessageV2[];
  deletedAt?: number;
}
export interface PhoneLedgerEntry {
  id: string;
  characterId: string;
  direction: 'income' | 'expense';
  amountCents: number;
  currency: string;
  timestamp: number;
  merchant: string;
  threadId?: string;
}
export const phoneOwnerId = (characterId: string) => 'owner:' + characterId;
export const phoneUserId = (characterId: string) => 'user:' + characterId;
export const phoneContactId = (kind: PhoneContactKind, id: string) => kind + ':' + id;
export function validatePhoneContact(contact: PhoneContactV2): boolean {
  return !!contact.id && !!contact.displayName.trim() &&
    (contact.kind !== 'char' || !!contact.linkedCharacterId);
}
export function mergePhoneThreads(previous: PhoneThreadV2[], incoming: PhoneThreadV2[]): PhoneThreadV2[] {
  const map = new Map(previous.map(t => [t.id, t]));
  for (const thread of incoming) {
    const old = map.get(thread.id);
    if (old?.deletedAt) continue;
    if (!old) { map.set(thread.id, thread); continue; }
    const seen = new Set(old.messages.map(m => m.id));
    map.set(thread.id, { ...old, messages: [...old.messages, ...thread.messages.filter(m => !seen.has(m.id))] });
  }
  return [...map.values()];
}
