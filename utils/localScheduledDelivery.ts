import type { CharacterProfile } from '../types';

/**
 * 旧的 [schedule_message] 指令会留下本地定时消息，它不归 1.0 / 2.0 的任务表管理。
 * 三条入口都被用户明确关闭时，历史遗留定时消息不能再成为“幽灵主动发言”。
 *
 * 仅认 scheduleFeatureEnabled === false（用户明确关过），避免老角色未设置
 * 日程选项时被意外清掉本来约定好的定时消息。
 */
export const shouldSuppressLocalScheduledDelivery = (
  char: Pick<CharacterProfile, 'scheduleFeatureEnabled' | 'proactiveConfig' | 'activeMsg2Config'>,
): boolean => char.scheduleFeatureEnabled === false
  && char.proactiveConfig?.enabled !== true
  && char.activeMsg2Config?.enabled !== true;
