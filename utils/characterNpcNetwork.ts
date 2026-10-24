import {
  addDiscoveredContact, readNpcProfiles, saveNpcProfiles,
  CHARACTER_PHONE_CONTACT_CHANGED, type NpcProfile,
} from './characterPhoneNpcs';
import { queuePendingContact, readPendingContacts } from './characterPhoneRequests';
import type { PhoneMessage } from './characterPhoneIdentity';

/** Character-owned social identity resolver.
 * User, phone owner and NPC identities are never matched by display name alone.
 * Stable IDs are preferred; name+relationship is only a legacy migration fallback.
 */
export type NpcDiscovery = {
  contactId?: string;
  name: string;
  nickname?: string;
  realName?: string;
  identity?: string;
  personality?: string;
  relationship?: string;
  background?: string;
  speechStyle?: string;
  boundary?: string;
  origin?: 'known' | 'introduced' | 'stranger' | 'suggested';
  evidence?: 'worldbook' | 'character' | 'social' | 'suggested';
};

const compact = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';
const norm = (value: string): string => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, '');
const knownRoles = /^(妈妈|母亲|爸爸|父亲|哥哥|姐姐|弟弟|妹妹|家人|同事|同学|朋友|上司|邻居|老师|导师|室友|伴侣|恋人)/;

export function findKnownNpc(
  profiles: NpcProfile[], discovery: Pick<NpcDiscovery, 'contactId' | 'name' | 'realName' | 'identity' | 'relationship'>,
): NpcProfile | undefined {
  if (discovery.contactId) {
    const exact = profiles.find(p => p.id === discovery.contactId);
    if (exact) return exact;
  }
  const name = norm(discovery.realName || discovery.name);
  if (!name) return undefined;
  const candidates = profiles.filter(p =>
    norm(p.realName || p.name) === name ||
    (discovery.realName && norm(p.name) === norm(discovery.name)) ||
    (discovery.realName && norm(p.realName || '') === norm(discovery.realName)));
  if (candidates.length !== 1) return undefined;
  const match = candidates[0];
  const identity = norm(discovery.identity || '');
  const relation = norm(discovery.relationship || '');
  if (identity && norm(match.identity) && identity !== norm(match.identity) &&
      relation && norm(match.relationship) && relation !== norm(match.relationship)) return undefined;
  return match;
}

export function registerDiscoveredNpc(
  characterId: string,
  raw: NpcDiscovery,
  options: { conversationEstablished?: boolean; blockedNames?: string[] } = {},
): { status: 'existing' | 'added' | 'pending' | 'ignored'; profile?: NpcProfile } {
  const name = compact(raw.name, 40);
  // An LLM can hallucinate a phone contact using the real User's nickname.
  // Name guard complements stable IDs; never duplicate User or Char as an NPC.
  const forbidden = (options.blockedNames || []).some(block =>
    !!block?.trim() && (norm(name) === norm(block) ||
      (!!raw.realName && norm(raw.realName) === norm(block))));
  if (!characterId || !name || forbidden || norm(name) === norm(characterId) ||
      /^(user|char|用户|手机主人)$/i.test(name))
    return { status: 'ignored' };
  const original = readNpcProfiles(characterId);
  const existing = findKnownNpc(original, { ...raw, name });
  if (existing) {
    // User-edited name, relationship and existing identity are authoritative.
    // Fill missing AI-provided social traits, never replace manual profile fields.
    const patch = {
      ...existing,
      speechStyle: existing.speechStyle || compact(raw.speechStyle, 160),
      boundary: existing.boundary || compact(raw.boundary, 160),
    };
    if (JSON.stringify(patch) !== JSON.stringify(existing)) {
      saveNpcProfiles(characterId, original.map(p => p.id === existing.id ? patch : p));
      window.dispatchEvent(new CustomEvent(CHARACTER_PHONE_CONTACT_CHANGED, { detail: { characterId, contactId: existing.id } }));
    }
    return { status: 'existing', profile: patch };
  }
  const pending = readPendingContacts(characterId);
  const alreadyPending = pending.find(p => (raw.contactId && p.id === raw.contactId) ||
    (norm(p.realName || p.nickname) === norm(raw.realName || name) &&
      norm(p.relationship) === norm(raw.relationship || '普通认识')));
  if (alreadyPending) return { status: 'pending' };

  const relationship = compact(raw.relationship, 160) || '普通认识';
  const identity = compact(raw.identity, 160) || '生活圈联系人';
  const personality = compact(raw.personality, 400) || '说话自然，有自己的事情要忙';
  const background = compact(raw.background, 600) || '与角色生活圈相关的人物';
  const proposedId = compact(raw.contactId, 128);
  // Do not let LLM supply IDs that collide with user or owner identity.
  const id = proposedId.startsWith('generated:') && !original.some(p => p.id === proposedId)
    ? proposedId : 'generated:' + crypto.randomUUID();
  const isKnown = raw.origin === 'known' && (raw.evidence === 'worldbook' || raw.evidence === 'character');
  const isEstablished = options.conversationEstablished && raw.origin !== 'stranger';
  const hasKnownRelationship = knownRoles.test(relationship);
  // New acquaintances may be proposed, but a model-generated "relative" or
  // "partner" must never silently become established family/romance.
  const highTrustRole = /父|母|爸|妈|家人|兄|弟|姐|妹|亲属|恋人|伴侣|丈夫|妻子|爱人|配偶|男友|女友/;
  const shouldAdd = isKnown ||
    (!!isEstablished && !highTrustRole.test(relationship)) ||
    (raw.origin === 'introduced' && hasKnownRelationship && !highTrustRole.test(relationship));

  if (!shouldAdd) {
    queuePendingContact(characterId, {
      id, nickname: compact(raw.nickname, 40) || name,
      realName: compact(raw.realName, 40), identity, personality,
      relationship, background, createdAt: Date.now(), source: 'chat',
    });
    return { status: 'pending' };
  }
  const profile: NpcProfile = {
    id, name, nickname: compact(raw.nickname, 40) || name,
    realName: compact(raw.realName, 40),
    identity, personality, relationship, background,
    speechStyle: compact(raw.speechStyle, 160),
    boundary: compact(raw.boundary, 160),
    originEvidence: raw.evidence || 'social',
    source: 'generated', createdAt: Date.now(),
  };
  return addDiscoveredContact(characterId, profile).added
    ? { status: 'added', profile } : { status: 'ignored' };
}

/** Relationship continuity after a *saved* phone exchange; never edits character cards. */
export function noteNpcInteraction(
  characterId: string, contactId: string, at = Date.now(), savedMessages: PhoneMessage[] = [],
): void {
  const old = readNpcProfiles(characterId);
  const p = old.find(row => row.id === contactId);
  if (!p || !Number.isFinite(at) || at <= (p.lastInteractedAt || 0)) return;
  // Only retain unresolved-topic hints actually present in saved chat messages.
  // "We discussed tomorrow" is evidence of discussion, not proof that the
  // future meeting occurred. No extra LLM call or invented relationship state.
  const meaningful = savedMessages.filter(m =>
    typeof m.text === 'string' && m.text.trim().length >= 10 &&
    /明天|后天|下周|约|见面|吵|生气|道歉|考试|项目|工作|借|还|搬|旅行|医院|电话|重要|秘密|承诺|安排|计划|改天|下次|周末/.test(m.text)
  ).slice(-2);
  const addedNotes = meaningful.map(m =>
    '[' + new Date(at).toLocaleDateString('zh-CN') + '微信提及] ' +
    (m.speaker.role === 'owner' ? 'Char：' : 'NPC：') + m.text.trim().slice(0, 125));
  const oldNotes = (p.relationshipNotes || '').split('\n').filter(Boolean);
  const nextNotes = [...oldNotes, ...addedNotes.filter(note => !oldNotes.includes(note))]
    .slice(-6).join('\n').slice(-1000);
  const next: NpcProfile = {
    ...p, lastInteractedAt: at, interactionCount: Math.min(10000, (p.interactionCount || 0) + 1),
    ...(nextNotes ? { relationshipNotes: nextNotes } : {}),
  };
  try {
    saveNpcProfiles(characterId, old.map(row => row.id === contactId ? next : row));
    window.dispatchEvent(new CustomEvent(CHARACTER_PHONE_CONTACT_CHANGED, { detail: { characterId, contactId } }));
  } catch { /* Chat storage stays authoritative if profile metadata cannot update */ }
}
