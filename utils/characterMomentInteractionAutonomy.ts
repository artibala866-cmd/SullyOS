import type { CharacterProfile } from '../types';
import { readNpcProfiles } from './characterPhoneNpcs';
import { isCharacterPhoneAutonomyEnabled } from './characterPhoneAutonomy';
import {
  readCharacterMoments, addMomentComment, setMomentLike,
  type CharacterMoment,
} from './characterPhoneMoments';
import { recordCharacterLifeEvent } from './characterLifeEvents';
import { safeResponseJson, extractContent } from './safeApi';

/** Relationship-grounded social reactions for the character's existing Moments.
 * No fabricated User comments and no free-form anonymous participants.
 * Replies must target comments already persisted before this AI round.
 */
type Api = { baseUrl: string; apiKey: string; model: string };
const key = (charId: string) => 'sully_moments_interactions_v1:' + charId;
const locks = new Set<string>();
const MAX_POST_COMMENTS = 12;
type State = { day: string; actions: number; attempts: number; lastAttempt: number; lastByPost: Record<string, number> };
function stateFor(charId: string, now: number): State {
  const day = new Date(now).toLocaleDateString('en-CA');
  try {
    const parsed = JSON.parse(localStorage.getItem(key(charId)) || '{}');
    return {
      day, actions: parsed.day === day && Number.isFinite(parsed.actions) ? parsed.actions : 0,
      attempts: parsed.day === day && Number.isFinite(parsed.attempts) ? parsed.attempts : 0,
      lastAttempt: Number.isFinite(parsed.lastAttempt) ? parsed.lastAttempt : 0,
      lastByPost: parsed.lastByPost && typeof parsed.lastByPost === 'object' ? parsed.lastByPost : {},
    };
  } catch { return { day, actions: 0, attempts: 0, lastAttempt: 0, lastByPost: {} }; }
}
function storeState(charId: string, state: State) {
  localStorage.setItem(key(charId), JSON.stringify(state));
}
function selectPost(
  posts: CharacterMoment[], state: State, now: number, known: Set<string>,
): CharacterMoment | undefined {
  const eligible = posts.filter(post =>
    !post.deletedAt && post.visibility === 'all' &&
    now - post.createdAt <= 3 * 86400000 && post.createdAt <= now &&
    known.has(post.authorId) &&
    (post.comments || []).filter(c => !c.deletedAt).length < MAX_POST_COMMENTS &&
    now - (state.lastByPost[post.id] || 0) >= 2 * 3600000
  );
  // A recent real User comment (or a new NPC reply to Char) is a stronger
  // reason to revisit an existing discussion than another generic fresh post.
  const score = (post: CharacterMoment) => {
    const comments = (post.comments || []).filter(c => !c.deletedAt &&
      c.createdAt > (state.lastByPost[post.id] || 0));
    const userReply = comments.some(c => c.authorId === 'user');
    const npcToOwner = post.authorId === post.characterId &&
      comments.some(c => c.authorId !== 'user' && c.authorId !== post.characterId);
    return (userReply ? 4 : 0) + (npcToOwner ? 2 : 0);
  };
  return eligible.sort((a, b) => score(b) - score(a) || b.createdAt - a.createdAt)[0];
}

export async function runCharacterMomentInteractionAutonomy(input: {
  char: CharacterProfile;
  api: Api;
}): Promise<'acted' | 'skipped' | 'unavailable' | 'failed'> {
  const { char, api } = input;
  if (!char?.id || !api?.apiKey || !api.baseUrl || !api.model ||
    typeof document === 'undefined' || document.visibilityState !== 'visible' ||
    !isCharacterPhoneAutonomyEnabled(char.id)) return 'unavailable';
  if (locks.has(char.id)) return 'skipped';
  locks.add(char.id);
  const now = Date.now();
  try {
    const state = stateFor(char.id, now);
    if (state.actions >= 10 || state.attempts >= 12 || now - state.lastAttempt < 20 * 60_000) return 'skipped';
    const contacts = readNpcProfiles(char.id);
    if (!contacts.length) return 'skipped';
    const known = new Set([char.id, ...contacts.map(p => p.id)]);
    const post = selectPost(readCharacterMoments(char.id), state, now, known);
    if (!post) return 'skipped';
    state.lastAttempt = now;
    state.attempts++;
    state.lastByPost[post.id] = now;
    storeState(char.id, state);
    // The owner and saved contacts share a social circle. Exclude the
    // author and User from generated actors; User posts no synthetic replies.
    const authorContact = contacts.find(p => p.id === post.authorId);
    // Char knows their contacts; that does NOT imply every NPC in the phone
    // knows every other NPC. Cross-NPC reactions need an explicit mutual edge.
    const visibleContacts = post.authorId === char.id ? contacts :
      contacts.filter(p => p.id !== post.authorId &&
        !!authorContact?.mutualContactIds?.includes(p.id) &&
        !!p.mutualContactIds?.includes(post.authorId));
    const actors = [
      { id: char.id, name: char.name, role: 'phone-owner', personality: (char.systemPrompt || '').slice(0, 900) },
      ...visibleContacts.map(p => ({
        id: p.id, name: p.name, role: p.relationship,
        personality: [p.personality, p.speechStyle, p.boundary].filter(Boolean).join('；').slice(0, 650),
      })),
    ].slice(0, 12);
    if (!actors.length) return 'skipped';
    const publicComments = (post.comments || []).filter(c => !c.deletedAt).slice(-12);
    const response = await fetch(api.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + api.apiKey },
      body: JSON.stringify({ model: api.model, stream: false, temperature: 0.75, messages: [
        { role: 'system', content: `你为虚构角色手机中的微信朋友圈做一轮自然互动决策。
这里的帖子与评论已经真实保存在角色手机中，不要凭空增添 User 发言，不要杜撰私人聊天作为公开评论。
发帖作者：${post.authorId === char.id ? char.name : contacts.find(p => p.id === post.authorId)?.name || '好友'}；正文：${post.text.slice(0, 1400)}
评论区（含唯一 ID）：${JSON.stringify(publicComments.map(c => ({ id: c.id, authorId: c.authorId, text: c.text, replyToId: c.replyToId }))).slice(0, 3500)}
可以参与的人（唯一ID，不是昵称）：${JSON.stringify(actors).slice(0, 6000)}
这是一轮一两个自然动作，不是写整场戏；允许没人有反应。
NPC 只有真实在主人通讯录的人可以参与。关系冷淡的人可以不留言，不能每人轮流表扬。
允许点赞、直接评论帖子、回复已经存在且未删除的评论；发帖作者只能回复已经存在的别人的评论，不可给自己点赞或发自言自语的顶层评论。
回复时 replyToId 必须精确复制已有评论ID，不能引用本轮尚未生成的评论。
要符合角色关系和说话习惯；不能制造冲突人设的新事实或替User发消息。
只能返回JSON：{"actions":[{"actorId":"参与人ID","type":"like|comment","text":"评论文字，点赞留空","replyToId":"回复已有评论ID，可留空"}]}。
每轮最多2个动作；如果没必要互动，返回空数组。` },
        { role: 'user', content: '根据帖子、已存在评论和熟人关系，决定这一轮自然发生的互动。' },
      ] }),
    });
    const json = await safeResponseJson(response);
    if (!response.ok) throw new Error(json?.error?.message || 'HTTP ' + response.status);
    const raw = extractContent(json).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.actions)) return 'skipped';
    let changed = 0;
    // Recheck live post after the request: the user might have deleted it.
    for (const action of parsed.actions.slice(0, 2)) {
      if (!action || typeof action.actorId !== 'string' ||
        !actors.some(a => a.id === action.actorId) || action.actorId === 'user') continue;
      const live = readCharacterMoments(char.id).find(p => p.id === post.id && !p.deletedAt);
      if (!live || live.visibility !== 'all' ||
        (live.comments || []).filter(c => !c.deletedAt).length >= MAX_POST_COMMENTS) break;
      const actor = actors.find(a => a.id === action.actorId)!;
      // Authors may answer *existing* comments on their own post, but may not
      // like their own post or fabricate a top-level self-comment.
      if (actor.id === post.authorId &&
          (action.type !== 'comment' || !action.replyToId)) continue;
      if (action.type === 'like') {
        if ((live.likes || []).some(l => l.actorId === actor.id)) continue;
        if (setMomentLike(char.id, post.id, actor.id, true)) changed++;
        continue;
      }
      if (action.type !== 'comment' || typeof action.text !== 'string' || !action.text.trim()) continue;
      const text = action.text.trim().slice(0, 280);
      const replyToId = typeof action.replyToId === 'string' ? action.replyToId.trim() : '';
      const target = replyToId ? publicComments.find(c => c.id === replyToId) : null;
      // A reply to a removed or nonexistent public comment is invalid.
      if (replyToId && (!target || !(live.comments || []).some(c => c.id === replyToId && !c.deletedAt))) continue;
      if (target?.authorId === actor.id) continue; // no automatic self-conversations
      if ((live.comments || []).some(c => c.authorId === actor.id && c.text.trim() === text)) continue;
      const commentId = crypto.randomUUID();
      if (addMomentComment(char.id, post.id, {
        id: commentId, authorId: actor.id, text, createdAt: Date.now(),
        ...(replyToId ? { replyToId } : {}),
      })) {
        changed++;
        recordCharacterLifeEvent({
          id: 'moment-comment:' + commentId, characterId: char.id, kind: 'moment-comment',
          occurredAt: Date.now(), source: 'phone',
          contactId: actor.id, relatedMessageId: post.id,
          summary: actor.name + '在朋友圈' + (replyToId ? '回复评论' : '留言') + '：' + text,
        });
      }
    }
    if (changed) {
      const next = stateFor(char.id, Date.now());
      next.actions += changed;
      storeState(char.id, next);
    }
    return changed ? 'acted' : 'skipped';
  } catch (error) {
    console.warn('[MomentsAutonomy] reaction skipped', error);
    return 'failed';
  } finally { locks.delete(char.id); }
}
