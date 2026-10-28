/**
 * Single, shared budget for every autonomous Char-phone LLM request:
 * NPC WeChat, social bootstrap, NPC Moments, comments, Baidu and self profile.
 *
 * Manual, explicit User actions keep their original on-demand API semantics.
 * Do not use this guard for the User-facing AMSG 2.0 engine.
 */
export type PhoneApiPace = 'economy' | 'balanced' | 'active' | 'custom';
export type PhoneAutonomyPreferences = {
  pace: PhoneApiPace;
  customDailyLimit: number;
  customIntervalMinutes: number;
  browserAutoEnabled: boolean;
  selfProfileAutoEnabled: boolean;
  /** Master switch for separately billed autonomous phone LLM calls. */
  backgroundApiEnabled: boolean;
  /** Attach optional phone events to an existing User-facing reply; no second request. */
  chatPiggybackEnabled: boolean;
};
export type PhoneApiBudgetState = {
  day: string;
  requests: number;
  lastRequestAt: number;
};
export type PhoneApiBudgetInfo = PhoneApiBudgetState & {
  limit: number;
  nextAllowedAt: number;
  remaining: number;
  pace: PhoneApiPace;
  minIntervalMinutes: number;
};
const AUTONOMY_REVISION_PREFIX='sully_phone_autonomy_revision_v1:';
/** Persist a monotonic revision so a phone AI call started before an off/on
 * switch cycle cannot overwrite newly chosen phone autonomy preferences.
 * This is not an API request and stores no chat content.
 */
export function readPhoneAutonomyRevision(characterId:string):number{
  if(!characterId||typeof localStorage==='undefined')return 0;
  try{
    const x=Number(localStorage.getItem(AUTONOMY_REVISION_PREFIX+characterId));
    return Number.isSafeInteger(x)&&x>0?x:0;
  }catch{return 0;}
}
export function bumpPhoneAutonomyRevision(characterId:string):void{
  if(!characterId||typeof localStorage==='undefined')return;
  try{localStorage.setItem(AUTONOMY_REVISION_PREFIX+characterId,
    String(readPhoneAutonomyRevision(characterId)+1));}catch{/* private mode */}
}
const SETTINGS_PREFIX = 'sully_char_phone_api_preferences_v1:';
const BUDGET_PREFIX = 'sully_char_phone_api_budget_v1:';
export const CHARACTER_PHONE_API_SETTINGS_CHANGED = 'sully:character-phone-api-settings-changed';
export const CHARACTER_PHONE_API_BUDGET_CHANGED = 'sully:character-phone-api-budget-changed';
const PER_DAY: Record<PhoneApiPace, number> = {
  economy: 6,
  balanced: 12,
  active: 24,
  custom: 12,
};
const MIN_INTERVAL: Record<PhoneApiPace, number> = {
  economy: 65 * 60_000,
  balanced: 35 * 60_000,
  active: 15 * 60_000,
  custom: 35 * 60_000,
};

const defaults = ():PhoneAutonomyPreferences => ({
  pace:'economy',
  customDailyLimit:12,
  customIntervalMinutes:35,
  browserAutoEnabled:true,
  selfProfileAutoEnabled:true,
  backgroundApiEnabled:true,
  chatPiggybackEnabled:false,
});
function boundedInteger(value:unknown,fallback:number,min:number,max:number):number {
  return typeof value==='number' && Number.isFinite(value)
    ?Math.min(max,Math.max(min,Math.round(value))):fallback;
}
function validPace(value:unknown):value is PhoneApiPace {
  return value==='economy'||value==='balanced'||value==='active'||value==='custom';
}
function today(now:number) {
  const d=new Date(now);
  // Device-local calendar day, same as other phone autonomy state.
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
}
export function readPhoneAutonomyPreferences(characterId:string):PhoneAutonomyPreferences {
  if (!characterId || typeof localStorage === 'undefined') return defaults();
  try {
    const raw=JSON.parse(localStorage.getItem(SETTINGS_PREFIX+characterId)||'null');
    return {
      pace:validPace(raw?.pace)?raw.pace:'economy',
      customDailyLimit:boundedInteger(raw?.customDailyLimit,12,1,100),
      customIntervalMinutes:boundedInteger(raw?.customIntervalMinutes,35,5,180),
      browserAutoEnabled:raw?.browserAutoEnabled!==false,
      selfProfileAutoEnabled:raw?.selfProfileAutoEnabled!==false,
      backgroundApiEnabled:raw?.backgroundApiEnabled!==false,
      chatPiggybackEnabled:raw?.chatPiggybackEnabled===true,
    };
  } catch {return defaults();}
}
export function writePhoneAutonomyPreferences(characterId:string, updates:Partial<PhoneAutonomyPreferences>):PhoneAutonomyPreferences {
  if (!characterId) throw new Error('Missing Char ID');
  const old=readPhoneAutonomyPreferences(characterId);
  const next:PhoneAutonomyPreferences = {
    pace:validPace(updates.pace)?updates.pace:old.pace,
    customDailyLimit:boundedInteger(updates.customDailyLimit,old.customDailyLimit,1,100),
    customIntervalMinutes:boundedInteger(updates.customIntervalMinutes,old.customIntervalMinutes,5,180),
    browserAutoEnabled:typeof updates.browserAutoEnabled==='boolean'?updates.browserAutoEnabled:old.browserAutoEnabled,
    selfProfileAutoEnabled:typeof updates.selfProfileAutoEnabled==='boolean'?updates.selfProfileAutoEnabled:old.selfProfileAutoEnabled,
    backgroundApiEnabled:typeof updates.backgroundApiEnabled==='boolean'?updates.backgroundApiEnabled:old.backgroundApiEnabled,
    chatPiggybackEnabled:typeof updates.chatPiggybackEnabled==='boolean'?updates.chatPiggybackEnabled:old.chatPiggybackEnabled,
  };
  localStorage.setItem(SETTINGS_PREFIX+characterId,JSON.stringify(next));
  bumpPhoneAutonomyRevision(characterId);
  if (typeof window!=='undefined') window.dispatchEvent(new CustomEvent(CHARACTER_PHONE_API_SETTINGS_CHANGED,{
    detail:{characterId},
  }));
  return next;
}
function readState(characterId:string, now:number):PhoneApiBudgetState {
  const day=today(now);
  try {
    const raw=JSON.parse(localStorage.getItem(BUDGET_PREFIX+characterId)||'null');
    return {
      day,
      requests:raw?.day===day && Number.isSafeInteger(raw.requests)&&raw.requests>=0?raw.requests:0,
      lastRequestAt:Number.isFinite(raw?.lastRequestAt)?raw.lastRequestAt:0,
    };
  } catch {return {day,requests:0,lastRequestAt:0};}
}
export function readPhoneApiBudget(characterId:string, now=Date.now()):PhoneApiBudgetInfo {
  const prefs=readPhoneAutonomyPreferences(characterId);
  const pace=prefs.pace;
  const state=readState(characterId,now);
  const limit=pace==='custom'?prefs.customDailyLimit:PER_DAY[pace];
  const minIntervalMinutes=pace==='custom'?prefs.customIntervalMinutes:MIN_INTERVAL[pace]/60_000;
  return {
    ...state,pace,limit,minIntervalMinutes,
    remaining:Math.max(0,limit-state.requests),
    nextAllowedAt:state.requests>=limit?new Date(new Date(now).setHours(24,0,0,0)).getTime()
      :state.lastRequestAt?state.lastRequestAt+minIntervalMinutes*60_000:now,
  };
}
export function canUsePhoneApiBudget(characterId:string,now=Date.now()):boolean {
  if (!characterId || typeof localStorage==='undefined' || !readPhoneAutonomyPreferences(characterId).backgroundApiEnabled) return false;
  const budget=readPhoneApiBudget(characterId,now);
  return budget.remaining>0 && now>=budget.nextAllowedAt;
}
/** Reserve immediately before fetch, after any cheap local eligibility checks.
 * A failed network call still counts to protect against retry storms.
 */
export function reservePhoneApiBudget(characterId:string,now=Date.now()):boolean {
  if (!canUsePhoneApiBudget(characterId,now)) return false;
  const state=readState(characterId,now);
  try {
    localStorage.setItem(BUDGET_PREFIX+characterId,JSON.stringify({
      day:state.day, requests:state.requests+1,lastRequestAt:now,
    } satisfies PhoneApiBudgetState));
    if (typeof window!=='undefined') window.dispatchEvent(new CustomEvent(CHARACTER_PHONE_API_BUDGET_CHANGED,{
      detail:{characterId},
    }));
    return true;
  } catch {return false;}
}
