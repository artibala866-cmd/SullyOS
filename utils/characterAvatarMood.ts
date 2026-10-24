import {
  activateCharacterAvatar, readCharacterAvatarLibrary,
  type CharacterAvatarEntry,
} from './characterAvatarLibrary';
import { readPhoneAutonomyPreferences } from './characterPhoneApiBudget';
import { isCharacterPhoneAutonomyEnabled } from './characterPhoneAutonomy';

type AvatarMood = 'bright' | 'quiet' | 'melancholy' | 'serious' | 'tired' | 'focused';
const moods: Record<AvatarMood,{ context:RegExp; image:RegExp }> = {
  bright:{
    context:/开心|高兴|兴奋|愉快|快乐|欢喜|笑|喜悦|活泼|幸福|期待/,
    image:/笑|微笑|开心|明亮|阳光|活泼|俏皮|元气|开朗|雀跃/,
  },
  quiet:{
    context:/平静|宁静|安静|轻松|温柔|悠闲|放松|惬意|安心|淡然/,
    image:/安静|温柔|宁静|平和|放松|柔和|淡然|闲适|自然/,
  },
  melancholy:{
    context:/难过|悲伤|低落|失落|孤独|沮丧|委屈|难受|伤心|不安/,
    image:/悲伤|低落|忧郁|落寞|孤独|忧伤|泪|难过|黯然|愁/,
  },
  serious:{
    context:/生气|愤怒|不满|烦躁|冷淡|严肃|不悦|恼火|沉重|紧张/,
    image:/严肃|冷淡|生气|皱眉|紧绷|冷峻|认真|不悦|凝重/,
  },
  tired:{
    context:/疲惫|累了|疲倦|困倦|困了|想睡|睡意|熬夜|乏力/,
    image:/疲惫|困倦|闭眼|睡|慵懒|倦怠|打哈欠|昏昏/,
  },
  focused:{
    context:/专注|集中|工作|加班|努力|认真|学习|写作|读书|钻研|思考/,
    image:/专注|集中|认真|学习|办公|看书|阅读|工作|写字|思考|沉思/,
  },
};
const locks=new Set<string>();
const COOLDOWN=2*3600_000;

/** Zero-extra-token preference based on TWO saved AI outputs:
 * real inner-state emotion + actual vision descriptions of saved avatars.
 * Unclear mood/caption means no change. The periodic LLM selector remains
 * available for nuanced choices, but most reactions need no network calls.
 */
export function findAvatarForMood(
  entries:CharacterAvatarEntry[],currentId:string|undefined,moodText:string,
):CharacterAvatarEntry|undefined {
  const input=moodText.slice(0,1300);
  if(!input.trim())return undefined;
  const matching=Object.entries(moods).filter(([,rule])=>rule.context.test(input)) as
    Array<[AvatarMood,{context:RegExp;image:RegExp}]>;
  if(matching.length!==1)return undefined;
  const [,rule]=matching[0];
  const candidates=entries.filter(entry=>entry.visionDescription &&
    rule.image.test(entry.visionDescription));
  if(!candidates.length)return undefined;
  // An already suitable avatar should remain in place; don't rotate
  // identical-mood photos merely because a new emotion evaluation arrived.
  if(candidates.some(e=>e.id===currentId))return undefined;
  return candidates[0];
}

export async function chooseAvatarFromSavedMood(
  charId:string,
  currentInnerState:string,
  apply:(image:string)=>Promise<void>,
  now=Date.now(),
):Promise<boolean> {
  if(!charId || !currentInnerState.trim() ||
      !isCharacterPhoneAutonomyEnabled(charId) ||
      !readPhoneAutonomyPreferences(charId).selfProfileAutoEnabled ||
      locks.has(charId))return false;
  const library=readCharacterAvatarLibrary(charId);
  if(!library.autonomousEnabled ||
      (library.lastChangedAt && now-library.lastChangedAt<COOLDOWN))return false;
  const candidate=findAvatarForMood(library.entries,library.activeId,currentInnerState);
  if(!candidate)return false;
  locks.add(charId);
  try {
    // Apply the canonical CharacterProfile avatar first. Never set library
    // activeId on a failed profile update.
    await apply(candidate.image);
    return !!activateCharacterAvatar(charId,candidate.id,true);
  }catch(error) {
    console.warn('[CharacterAvatarMood] mood selection skipped',error);
    return false;
  }finally{locks.delete(charId);}
}
