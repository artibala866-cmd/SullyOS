/** Per-character rhythm for NPC interactions on the Char-owned Moments feed. */
export type MomentInteractionPace='quiet'|'balanced'|'lively';
export type MomentInteractionPreferences={
 enabled:boolean;
 pace:MomentInteractionPace;
 intervalMinutes:number;
};
const KEY=(id:string)=>'sully_moment_interaction_preferences_v1:'+id;
export const MOMENT_INTERACTION_SETTINGS_CHANGED='sully:moment-interaction-settings-changed';
const paceValid=(v:unknown):v is MomentInteractionPace=>v==='quiet'||v==='balanced'||v==='lively';
const minute=(v:unknown,fallback:number)=>typeof v==='number'&&Number.isFinite(v)?Math.min(1440,Math.max(15,Math.round(v))):fallback;
export function readMomentInteractionPreferences(id:string):MomentInteractionPreferences{
 const defaults:MomentInteractionPreferences={enabled:true,pace:'balanced',intervalMinutes:120};
 if(!id||typeof localStorage==='undefined')return defaults;
 try{
  const row=JSON.parse(localStorage.getItem(KEY(id))||'null');
  return {
   enabled:row?.enabled!==false,
   pace:paceValid(row?.pace)?row.pace:defaults.pace,
   intervalMinutes:minute(row?.intervalMinutes,defaults.intervalMinutes),
  };
 }catch{return defaults;}
}
export function writeMomentInteractionPreferences(id:string,patch:Partial<MomentInteractionPreferences>):MomentInteractionPreferences{
 if(!id)throw Error('缺少角色');
 const old=readMomentInteractionPreferences(id),next={
  enabled:typeof patch.enabled==='boolean'?patch.enabled:old.enabled,
  pace:paceValid(patch.pace)?patch.pace:old.pace,
  intervalMinutes:minute(patch.intervalMinutes,old.intervalMinutes),
 };
 localStorage.setItem(KEY(id),JSON.stringify(next));
 if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent(MOMENT_INTERACTION_SETTINGS_CHANGED,{detail:{characterId:id}}));
 return next;
}
export const MOMENT_INTERACTION_LIMITS={
 quiet:{dailyActions:4,dailyAttempts:6,maxPostComments:4,maxActionsPerCall:1},
 balanced:{dailyActions:8,dailyAttempts:10,maxPostComments:8,maxActionsPerCall:2},
 lively:{dailyActions:12,dailyAttempts:16,maxPostComments:12,maxActionsPerCall:3},
} as const;
export function momentCommentFingerprint(value:string):string{
 return value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu,'').trim();
}
/**
 * Each person gets at most one opening comment + one answer per post;
 * no replying to a reply, no same target answered twice by the same actor.
 * A parent comment may receive replies from separate acquaintances.
 */
export function allowMomentComment(
 comments:Array<{authorId:string;text:string;replyToId?:string;id:string;deletedAt?:number}>,
 actorId:string,text:string,replyToId?:string,
):boolean{
 const active=comments.filter(c=>!c.deletedAt),normalized=momentCommentFingerprint(text);
 if(!normalized || active.some(c=>momentCommentFingerprint(c.text)===normalized))return false;
 const mine=active.filter(c=>c.authorId===actorId);
 if(mine.length>=2)return false;
 if(!replyToId)return !mine.some(c=>!c.replyToId);
 const target=active.find(c=>c.id===replyToId);
 if(!target||target.authorId===actorId||!!target.replyToId)return false;
 return !mine.some(c=>c.replyToId===replyToId || !!c.replyToId);
}
