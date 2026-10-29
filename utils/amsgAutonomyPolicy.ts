/** Unified wake gating for the existing AMSG2 cloud scheduler.
 * The app's real-person mode and Char phone share the same schedule truth.
 * Only applies to automatically-created contact opportunities, never to
 * user reminders or ordinary instant replies.
 */
import type {AmsgFireScene} from './amsgFireScene';
import {classifyLifeActivity} from './sullyLifeClock';
import {dayKeyInZone} from './amsgLimits';
import {nowInTimeZone} from './timezone';
import {parseScheduleStartMinutes} from './scheduleTime';

/** Only present-day, actually synced schedule facts are authoritative for
 * autonomous cloud contact. A phone closed for days cannot make new days
 * true by copying the last schedule forward.
 */
export function renderAutonomyCrossDayHint(
  scene:AmsgFireScene|null|undefined,nowMs:number,tzId:string,
):string{
  const today=dayKeyInZone(nowMs,tzId);
  if(scene?.dateKey===today&&scene.schedule?.slots?.length)return '';
  const known=scene?.dateKey && /^\d{4}-\d{2}-\d{2}$/.test(scene.dateKey)
    ? `（云端最后确认的日程日期为 ${scene.dateKey}，今天为 ${today}）` : '';
  return [
    '',
    '【自主联系：手机离线后的日程可信度】',
    '今天没有从角色手机确认的完整日程'+known+'。',
    '旧日程只能作为过去的计划，不代表今天仍在工作、睡觉、外出或已经做完某件事；不要将它滚动成新的今日经历。',
    '可承接确实已经保存的对话与带时间戳的生活事件，也可在真正配置的工具上自行检索；不得伪造未调用的工具、线下经历或手机内社交。',
    '如果找不到足够新鲜、符合角色性格的理由，直接输出 [[SILENT]]；不要为了赶上每日触发而强行发消息。',
  ].join('\n');
}
export const AUTONOMY_ACTIVE_CHAT_WINDOW_MS=12*60_000;
export type AutonomyWakeSkipReason='autonomy-chatting'|'autonomy-busy';
export function autonomyWakeSkipReason(args:{
  nowMs:number;lastUserMessageAt:number|null|undefined;
  scene:AmsgFireScene|null|undefined;tzId:string;
}):AutonomyWakeSkipReason|null{
  const {nowMs,lastUserMessageAt,scene,tzId}=args;
  if(typeof lastUserMessageAt==='number'&&Number.isFinite(lastUserMessageAt)
      &&lastUserMessageAt<=nowMs+10_000
      &&nowMs-lastUserMessageAt<AUTONOMY_ACTIVE_CHAT_WINDOW_MS) return 'autonomy-chatting';
  // Date of the snapshot MUST match the role's calendar day. The Worker
  // cannot read a phone-local schedule for a NEW day while phone is closed.
  if(!scene?.schedule?.slots?.length||scene.dateKey!==dayKeyInZone(nowMs,tzId))return null;
  const local=nowInTimeZone(tzId,new Date(nowMs));
  const minutes=local.getHours()*60+local.getMinutes();
  const current=scene.schedule.slots.map(s=>{
    const minute=parseScheduleStartMinutes(s.startTime);
    return minute!==null?{minute,activity:s.activity}:null;
  }).filter((s):s is {minute:number;activity:string}=>s!==null)
    .sort((a,b)=>a.minute-b.minute)
    .filter(s=>s.minute<=minutes).pop();
  if(current&&classifyLifeActivity(current.activity)!=='free')return 'autonomy-busy';
  return null;
}
