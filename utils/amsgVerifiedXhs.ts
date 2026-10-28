import type {ToolCallRecord} from './agenticToolFeedback';
export const VERIFIED_XHS_ACTIONS=['xhs_search','xhs_browse','xhs_detail'] as const;
export type VerifiedXhsAction=typeof VERIFIED_XHS_ACTIONS[number];
export function isVerifiedXhsAction(value:unknown):value is VerifiedXhsAction{
 return typeof value==='string'&&VERIFIED_XHS_ACTIONS.some(action=>action===value);
}
/** Only an actual success, not AI text nor a failed/unreachable MCP call. */
export function extractVerifiedXhsActions(calls:readonly ToolCallRecord[]):VerifiedXhsAction[]{
 const set=new Set<VerifiedXhsAction>();
 for(const call of calls)if(call.ran===true&&isVerifiedXhsAction(call.name))set.add(call.name);
 return [...set];
}
