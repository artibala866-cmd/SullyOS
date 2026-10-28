/** Unified wake gating for the existing AMSG2 cloud scheduler.
 * The app's real-person mode and Char phone share the same schedule truth.
 * Only applies to automatically-created contact opportunities, never to
 * user reminders or ordinary instant replies.
 */
import type {AmsgFireScene} from './amsgFireScene';
import {classifyLifeActivity} from './sullyLifeClock';
import {dayKeyInZone} from './amsgLimits';
import {nowInTimeZone} from './timezone';

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
    const m=/^(\d{1,2}):(\d{2})$/.exec(s.startTime);
    return m?{minute:Number(m[1])*60+Number(m[2]),activity:s.activity}:null;
  }).filter((s):s is {minute:number;activity:string}=>s!==null)
    .sort((a,b)=>a.minute-b.minute)
    .filter(s=>s.minute<=minutes).pop();
  if(current&&classifyLifeActivity(current.activity)!=='free')return 'autonomy-busy';
  return null;
}
