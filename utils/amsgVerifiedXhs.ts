import type {ToolCallRecord} from './agenticToolFeedback';
export const VERIFIED_XHS_ACTIONS=['xhs_search','xhs_browse','xhs_detail'] as const;
export type VerifiedXhsAction=typeof VERIFIED_XHS_ACTIONS[number];
export function isVerifiedXhsAction(value:unknown):value is VerifiedXhsAction{
 return typeof value==='string'&&VERIFIED_XHS_ACTIONS.some(action=>action===value);
}
/** Structured success receipt. A real remote request returning no note is
 * not proof the character viewed or successfully searched note content.
 * Never infer tool success from the model's narrative.
 */
export function verifiedXhsToolSucceeded(name:string,result:unknown):boolean{
  return isVerifiedXhsAction(name) && !!result && typeof result==='object'
    && (result as {ok?:unknown}).ok===true;
}
/** Only an actual success, not AI text nor a failed/unreachable MCP call. */
export function extractVerifiedXhsActions(calls:readonly ToolCallRecord[]):VerifiedXhsAction[]{
 const set=new Set<VerifiedXhsAction>();
 for(const call of calls)if(call.ran===true&&isVerifiedXhsAction(call.name))set.add(call.name);
 return [...set];
}
