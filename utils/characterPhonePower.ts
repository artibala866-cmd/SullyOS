export type PhonePower={level:number;charging:boolean;updatedAt:number;model:string};

type StoredPhonePower=PhonePower&{
  /** Keeps sub-percent changes; rounding every status-bar tick would freeze the battery. */
  preciseLevel?:number;
  /** Persistent daytime charging session when the virtual phone reaches a critical level. */
  recoveryCharging?:boolean;
};

const keyFor=(characterId:string)=>'sully_char_phone_power_v1:'+characterId;
const models=['iPhone 15','iPhone 16 Pro','Pixel 9','Galaxy S24','Xiaomi 14','OPPO Find X7'];
const MINUTE=60_000;
const STEP=15*MINUTE;
const MAX_CATCHUP=7*24*60*MINUTE;

const clamp=(value:number)=>Math.max(0,Math.min(100,value));

function hashCharacterId(id:string):number{
  let hash=2166136261;
  for(let i=0;i<id.length;i++)hash=Math.imul(hash^id.charCodeAt(i),16777619);
  return hash>>>0;
}

/** Virtual owner generally plugs their phone in overnight, without any random switches. */
function scheduledCharging(timestamp:number):boolean{
  const hour=new Date(timestamp).getHours();
  return hour>=23||hour<7;
}
function hourlyDrain(timestamp:number):number{
  const hour=new Date(timestamp).getHours();
  // Heavier evening screen use, lighter early morning/background use.
  return hour>=17&&hour<23?3.4:hour>=10&&hour<17?3.0:2.2;
}
function initialPower(characterId:string,now:number):StoredPhonePower{
  const hash=hashCharacterId(characterId);
  const initial=55+(hash%31);
  return {
    level:initial,preciseLevel:initial,charging:scheduledCharging(now),
    updatedAt:now,model:models[hash%models.length],recoveryCharging:false,
  };
}

/**
 * Advances only by elapsed real time: charging 23:00–07:00, gentle discharge
 * otherwise, and an emergency daytime top-up if remaining charge is critical.
 * A 15-minute segment limit correctly handles charge boundaries and changes
 * less than 1% even if PhoneStatusBar polls every minute.
 */
export function readPhonePower(characterId:string,now=Date.now()):PhonePower{
  const key=keyFor(characterId);
  const safeNow=Number.isFinite(now)?now:Date.now();
  let stored:StoredPhonePower|undefined;
  try{
    const parsed=JSON.parse(localStorage.getItem(key)||'null');
    if(parsed&&typeof parsed==='object'&&Number.isFinite(parsed.level)&&Number.isFinite(parsed.updatedAt)){
      stored=parsed as StoredPhonePower;
    }
  }catch{}
  if(!stored)stored=initialPower(characterId,safeNow);

  const hash=hashCharacterId(characterId);
  const model=typeof stored.model==='string'&&stored.model.trim()
    ?stored.model:models[hash%models.length];
  let precise=clamp(Number.isFinite(stored.preciseLevel)?stored.preciseLevel!:stored.level);
  let recovery=stored.recoveryCharging===true;
  const lastTime=Math.max(0,stored.updatedAt);
  // Ignore clock rollback so that opening the screen never rewinds the power state.
  const target=Math.max(lastTime,safeNow);
  let cursor=Math.max(lastTime,target-MAX_CATCHUP);

  while(cursor<target){
    const next=Math.min(target,(Math.floor(cursor/STEP)+1)*STEP);
    const hours=(next-cursor)/3_600_000;
    const overnight=scheduledCharging(cursor);
    if(!overnight&&!recovery&&precise<=15)recovery=true;
    const charging=overnight||recovery;
    precise=clamp(precise+(charging?(overnight?27:23):-hourlyDrain(cursor))*hours);
    if(recovery&&precise>=85)recovery=false;
    cursor=next;
  }

  const overnight=scheduledCharging(target);
  if(!overnight&&!recovery&&precise<=15)recovery=true;
  const charging=overnight||recovery;
  const next:StoredPhonePower={
    level:Math.round(precise),preciseLevel:precise,charging,
    updatedAt:target,model,recoveryCharging:recovery,
  };
  try{localStorage.setItem(key,JSON.stringify(next));}catch{}
  return {level:next.level,charging:next.charging,updatedAt:next.updatedAt,model:next.model};
}
