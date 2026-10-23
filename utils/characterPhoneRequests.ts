export interface PendingPhoneContact {
  id: string;
  nickname: string;
  realName: string;
  identity: string;
  personality: string;
  relationship: string;
  background: string;
  createdAt: number;
  source: 'chat' | 'xiaohongshu';
  linkedCharacterId?: string;
}
const storageKey = (id: string) => 'sully_phone_pending_contacts_v1:' + id;
export function readPendingContacts(id: string): PendingPhoneContact[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(storageKey(id)) || '[]');
    return Array.isArray(data) ? data.filter((x): x is PendingPhoneContact => !!x && typeof x.id === 'string' && typeof x.nickname === 'string') : [];
  } catch { return []; }
}
export function writePendingContacts(id: string, contacts: PendingPhoneContact[]): void {
  localStorage.setItem(storageKey(id), JSON.stringify(contacts));
}
