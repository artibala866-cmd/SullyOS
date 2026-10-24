/**
 * Legacy avatar backfill is automatic and can become expensive.
 * Keep a distinct, conservative vision budget: two images per modal mount,
 * maximum three background vision attempts per Char per local calendar day.
 * User-initiated new image uploads are explicit and not silently blocked.
 */
const PREFIX='sully_character_avatar_vision_backfill_v1:';
export function reserveAvatarVisionBackfill(characterId:string,now=Date.now()):boolean {
  if(!characterId || typeof localStorage==='undefined')return false;
  const date=new Date(now);
  const day=[date.getFullYear(),date.getMonth()+1,date.getDate()].join('-');
  try{
    const previous=JSON.parse(localStorage.getItem(PREFIX+characterId)||'null');
    const attempts=previous?.day===day && Number.isFinite(previous.attempts)?previous.attempts:0;
    if(attempts>=3)return false;
    localStorage.setItem(PREFIX+characterId,JSON.stringify({day,attempts:attempts+1}));
    return true;
  }catch{return false;}
}
