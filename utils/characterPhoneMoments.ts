/** Char-owned Moments ledger. No AI calls or invented events on read. */
export type MomentOrigin = 'char' | 'real-mode' | 'amsg2';
export type MomentVisibility = 'all' | 'selected' | 'private';
export interface MomentLike { actorId: string; createdAt: number }
export interface MomentComment { id: string; authorId: string; text: string; createdAt: number; replyToId?: string; deletedAt?: number }
export interface MomentMedia { id: string; url: string; source: 'generated' | 'uploaded' | 'linked'; prompt?: string }
export interface MomentProvenance { eventIds?: string[]; sourceMessageIds?: string[]; decision?: 'event-triggered' | 'spontaneous' | 'assisted'; imageIsIllustrative?: boolean }
export interface CharacterMoment {
  id: string;
  characterId: string;
  authorId: string;
  origin: MomentOrigin;
  text: string;
  imageUrls: string[];
  media?: MomentMedia[];
  likes?: MomentLike[];
  comments?: MomentComment[];
  provenance?: MomentProvenance;
  createdAt: number;
  visibility: MomentVisibility;
  visibleTo?: string[];
  quote?: { threadId: string; messageIds: string[]; excerpt: string; redacted: boolean };
  deletedAt?: number;
  deletedBy?: 'char' | 'user';
}
export const CHARACTER_MOMENTS_CHANGED = 'sully:character-moments-changed';
const key = (characterId: string) => 'sully_character_moments_v1:' + characterId;
export function readCharacterMoments(characterId: string): CharacterMoment[] {
  if (!characterId || typeof localStorage === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key(characterId)) || '[]');
    return Array.isArray(parsed) ? parsed.filter((p): p is CharacterMoment =>
      !!p && typeof p.id === 'string' && p.characterId === characterId &&
      p.authorId === characterId && typeof p.text === 'string' &&
      Array.isArray(p.imageUrls) && Number.isFinite(p.createdAt)
    ).sort((a,b)=>b.createdAt-a.createdAt) : [];
  } catch { return []; }
}
function save(characterId: string, posts: CharacterMoment[]): boolean {
  try {
    localStorage.setItem(key(characterId), JSON.stringify(posts));
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CHARACTER_MOMENTS_CHANGED,{detail:{characterId}}));
    return true;
  } catch { return false; }
}
export function publishCharacterMoment(input: Omit<CharacterMoment,'id'|'createdAt'|'authorId'> & { id?: string; createdAt?: number }): CharacterMoment | null {
  if (!input.characterId || (!input.text.trim() && !input.imageUrls.length && !input.media?.length && !input.quote)) return null;
  if (input.visibility === 'selected' && !input.visibleTo?.length) return null;
  if (input.imageUrls.length > 9 || (input.media?.length || 0) > 9) return null;
  const post: CharacterMoment = {...input,id:input.id||crypto.randomUUID(),createdAt:input.createdAt||Date.now(),authorId:input.characterId};
  const old=readCharacterMoments(input.characterId);
  if(old.some(p=>p.id===post.id)) return null;
  // An event can motivate only one post, including when the first post was later soft-deleted.
  // Enforce this at persistence level so concurrent decision paths cannot simply rely on UI guards.
  const eventIds = post.provenance?.eventIds || [];
  if (eventIds.length && old.some(p => p.provenance?.eventIds?.some(id => eventIds.includes(id)))) return null;
  return save(input.characterId,[post,...old]) ? post : null;
}
export function deleteCharacterMoment(characterId: string, postId: string, actor: 'char'|'user'): boolean {
  const posts=readCharacterMoments(characterId);
  const target=posts.find(p=>p.id===postId);
  if(!target || target.deletedAt) return false;
  return save(characterId,posts.map(p=>p.id===postId?{...p,deletedAt:Date.now(),deletedBy:actor}:p));
}

/** Interactions use stable identity IDs, never nicknames. */
export function setMomentLike(characterId: string, postId: string, actorId: string, liked: boolean): boolean {
  if (!actorId) return false;
  const posts = readCharacterMoments(characterId);
  const target = posts.find(p => p.id === postId && !p.deletedAt);
  if (!target) return false;
  const current = target.likes || [];
  const likes = liked ? (current.some(l => l.actorId === actorId) ? current : [...current, {actorId,createdAt:Date.now()}]) : current.filter(l => l.actorId !== actorId);
  return save(characterId,posts.map(p=>p.id===postId?{...p,likes}:p));
}
export function addMomentComment(characterId: string, postId: string, comment: MomentComment): boolean {
  if (!comment.id || !comment.authorId || !comment.text.trim() || !Number.isFinite(comment.createdAt)) return false;
  const posts = readCharacterMoments(characterId);
  const target = posts.find(p => p.id === postId && !p.deletedAt);
  if (!target || (target.comments||[]).some(c=>c.id===comment.id)) return false;
  if (comment.replyToId && !(target.comments||[]).some(c=>c.id===comment.replyToId && !c.deletedAt)) return false;
  return save(characterId,posts.map(p=>p.id===postId?{...p,comments:[...(p.comments||[]),comment]}:p));
}
export function deleteMomentComment(characterId: string, postId: string, commentId: string, actorId: string): boolean {
  const posts=readCharacterMoments(characterId);
  const target=posts.find(p=>p.id===postId && !p.deletedAt);
  const comment=target?.comments?.find(c=>c.id===commentId && !c.deletedAt);
  if(!comment || comment.authorId!==actorId) return false;
  return save(characterId,posts.map(p=>p.id===postId?{...p,comments:(p.comments||[]).map(c=>c.id===commentId?{...c,deletedAt:Date.now()}:c)}:p));
}
