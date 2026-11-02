// utils/amsgChatPresence.ts
/**
 * 同角色活跃会话租约（Heartbeat）— 纯常量、类型与解析/新鲜度判定。
 *
 * ⚠️ 叶子模块：会被 worker/amsg 打进 Cloudflare bundle，同时被浏览器侧
 * （amsgStateSync 的租约 timer / activeMsgClient 的 PUT）复用——不得 import
 * DB / React / 任何浏览器环境依赖（与 utils/amsg2ExpireGuard.ts 同一约束）。
 *
 * 语义：一轮真实用户消息进入生成流程时立即写 `amsg:char:<charId>/chat_presence`，
 * 等待角色回复期间每 15s 续租；成功/失败/中断后停止续租，远端值靠 45s TTL 自然失效。
 * 它只代表「正在和这个角色交互」，不是 App 在线状态。worker 对 expire AI 任务先检查
 * 新鲜租约，新鲜则 { skip: true }，再走 last-message 规则。
 */

export const AMSG_CHAT_PRESENCE_KEY = 'chat_presence';
export const CHAT_PRESENCE_HEARTBEAT_MS = 15_000;
export const CHAT_PRESENCE_TTL_MS = 45_000;

export interface AmsgChatPresence {
  v: 1;
  charId: string;
  /** 最近一次续租的 epoch ms。worker 以自己的 ctx.now 判断 TTL。 */
  activeAt: number;
  /** 最近一条真实用户消息，用于一次性任务的 anchor 规则。 */
  lastUserMessageAt: number | null;
}

export const parseAmsgChatPresence = (raw: string | undefined): AmsgChatPresence | null => {
  try {
    const value = raw ? JSON.parse(raw) : null;
    return value?.v === 1 && typeof value.charId === 'string' &&
      typeof value.activeAt === 'number' &&
      (value.lastUserMessageAt === null || typeof value.lastUserMessageAt === 'number')
      ? value as AmsgChatPresence : null;
  } catch {
    return null;
  }
};

/**
 * 最近一次真实用户发言已经比云端 fire_pack 更新时，不许继续基于旧对话生成
 * 定时主动消息。与 activeAt 是否仍在 45s 租约内无关：用户已经说过的新话
 * 即使在几小时前，也必须先写进完整上下文，再考虑主动开口。
 */
export const hasUnseenUserTurn = (
  presence: AmsgChatPresence | null | undefined,
  charId: string,
  packLastUserMessageAt: number | null,
): boolean => Boolean(
  presence?.charId === charId
  && typeof presence.lastUserMessageAt === 'number'
  && Number.isFinite(presence.lastUserMessageAt)
  && (packLastUserMessageAt == null || presence.lastUserMessageAt > packLastUserMessageAt)
);

export const isFreshChatPresence = (
  value: AmsgChatPresence | null | undefined,
  charId: string,
  nowMs: number,
): boolean => Boolean(
  value && value.v === 1 && value.charId === charId &&
  value.activeAt <= nowMs + 10_000 && nowMs - value.activeAt <= CHAT_PRESENCE_TTL_MS,
);
