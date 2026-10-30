/** Stage 4: one explicitly permitted NPC-phone reply may ride an EXISTING
 * AMSG2 automatic contact LLM request, without an extra API call or timer.
 * Worker-safe pure leaf: never read browser localStorage in this module.
 */
export const CLOUD_PHONE_RESULT_KIND = 'cloud-phone-reply-v1';
export const CLOUD_PHONE_STATE_KEY = 'cloud_phone_last_reply_attempt';
/** Preserve a bounded history, not only the newest ID: otherwise two
 * different NPC threads alternately arriving could re-bill an old reply. */
export function readCloudPhoneAttemptIds(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter((x): x is string =>
      typeof x === 'string' && x.startsWith('cloud-npc:')).slice(-16);
  } catch { /* pre-stage4 single-id representation */ }
  return value.startsWith('cloud-npc:') ? [value] : [];
}
export function rememberCloudPhoneAttempt(value: string | null | undefined, id: string): string {
  return JSON.stringify([...readCloudPhoneAttemptIds(value).filter(x => x !== id), id].slice(-16));
}
export const CLOUD_PHONE_TAG = '[[CLOUD_PHONE_REPLY:';
export const MAX_CLOUD_PHONE_AGE_MS = 72 * 60 * 60_000;
export type CloudPhoneOpportunity = {
  contactId: string;
  contactName: string;
  threadId: string;
  sourceKey: string;
  replyToAt: number;
  replyToCount: number;
  replyToText: string;
  revision: number;
  clearRevision: number;
  /** Only saved phone lines, uploaded when the owner explicitly enabled piggyback. */
  history: Array<{ speaker: 'owner' | 'contact'; text: string }>;
};
export type CloudPhoneReply = { content: string; messages: string[] };
export const isCloudPhoneOpportunityFresh = (
  candidate: CloudPhoneOpportunity | null | undefined, now: number,
): candidate is CloudPhoneOpportunity => !!candidate &&
  typeof candidate.sourceKey === 'string' && candidate.sourceKey.startsWith('reply:') &&
  !!candidate.contactId && !!candidate.threadId && !!candidate.contactName &&
  Number.isSafeInteger(candidate.replyToCount) && candidate.replyToCount > 0 &&
  Number.isSafeInteger(candidate.replyToAt) && candidate.replyToAt > 0 &&
  now >= candidate.replyToAt + 7 * 60_000 &&
  now - candidate.replyToAt <= MAX_CLOUD_PHONE_AGE_MS &&
  typeof candidate.replyToText === 'string' && !!candidate.replyToText.trim() &&
  Array.isArray(candidate.history) && candidate.history.length > 0 &&
  Number.isSafeInteger(candidate.revision) && candidate.revision >= 0 &&
  Number.isSafeInteger(candidate.clearRevision) && candidate.clearRevision >= 0;

export function cloudPhoneReplyId(charId: string, candidate: CloudPhoneOpportunity): string {
  // Never put the raw inbox message or a private contact's name in a state key.
  let hash = 2166136261;
  const key = charId + ':' + candidate.sourceKey;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619) >>> 0;
  return 'cloud-npc:' + hash.toString(16).padStart(8, '0') + ':' + candidate.replyToAt;
}
export function cloudPhoneInstruction(candidate: CloudPhoneOpportunity): string {
  return [
    '',
    '【仅本轮允许的角色手机·NPC 微信回复（与给用户的主动消息独立）】',
    '角色手机里有一条已经真实保存、尚未回复的虚构 NPC 消息。你可以顺便用同一次生成回应它；这是可选动作，不能凭空造新联系或假装现实中的人发来消息。',
    '联系人：' + candidate.contactName.slice(0, 50),
    '双方最近已保存的微信内容：' + JSON.stringify(candidate.history.slice(-5)).slice(0, 1100),
    '最后一条 NPC 原话：' + candidate.replyToText.slice(0, 260),
    '如果角色愿意回复，另起一行添加 [[CLOUD_PHONE_REPLY:{"messages":["角色发给 NPC 的一句短微信"]}]]，最多两条，每条 160 字；只写角色自己发的，不得替 NPC 回答。',
    '如果不回复 NPC，就不要输出这个标记。给用户的主动消息仍独立判断，没合适内容可输出 [[SILENT]]；此 NPC 标记是内部数据，绝不可向用户说明。',
  ].join('\n');
}
/** Strip every internal marker from the user-visible response, EVEN if the
 * model returned malformed JSON or the feature is not authorized. Never
 * convert a phone reply into a private-chat message to the user.
 */
export function extractCloudPhoneReply(raw: string, allowed: boolean): CloudPhoneReply {
  const pattern = /\[\[CLOUD_PHONE_REPLY:([\s\S]*?)\]\]/g;
  let messages: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw)) !== null) {
    if (!allowed || messages.length || match[1].length > 1600) continue;
    try {
      const parsed: unknown = JSON.parse(match[1]);
      const lines = (parsed as { messages?: unknown } | null)?.messages;
      if (Array.isArray(lines) && lines.length > 0 && lines.length <= 2 &&
        lines.every(x => typeof x === 'string' && x.trim().length > 0 && x.length <= 160)) {
        messages = lines.map(x => (x as string).trim());
      }
    } catch { /* No phone side effect from malformed model output. */ }
  }
  const content = raw.replace(/\[\[CLOUD_PHONE_REPLY:[\s\S]*?\]\]/g, '')
    .replace(/\[\[CLOUD_PHONE_REPLY:[\s\S]*$/g, '').trim() || '[[SILENT]]';
  return { content, messages };
}

export type CloudPhoneResult = {
  resultKind: typeof CLOUD_PHONE_RESULT_KIND; charId: string; id: string;
  contactId: string; threadId: string; sourceKey: string;
  replyToAt: number; replyToCount: number; replyToText: string;
  revision: number; clearRevision: number; occurredAt: number;
  messages: string[];
};
export function parseCloudPhoneResult(value: unknown): CloudPhoneResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const x = value as Record<string, unknown>;
  if (x.resultKind !== CLOUD_PHONE_RESULT_KIND ||
    ![x.charId,x.id,x.contactId,x.threadId,x.sourceKey].every(s => typeof s === 'string' && !!s) ||
    !Number.isSafeInteger(x.replyToAt) || !Number.isSafeInteger(x.replyToCount) ||
    !Number.isSafeInteger(x.revision) || !Number.isSafeInteger(x.clearRevision) ||
    !Number.isSafeInteger(x.occurredAt) || (x.occurredAt as number) <= 0 ||
    (x.replyToAt as number) <= 0 || (x.replyToCount as number) <= 0 ||
    (x.revision as number) < 0 || (x.clearRevision as number) < 0 ||
    typeof x.replyToText !== 'string' || !x.replyToText.trim() ||
    x.replyToText.length > 300 ||
    !Array.isArray(x.messages) || x.messages.length < 1 || x.messages.length > 2 ||
    !x.messages.every(m => typeof m === 'string' && !!m.trim() && m.length <= 160)) return null;
  return x as CloudPhoneResult;
}
