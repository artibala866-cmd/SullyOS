/**
 * Single, shared budget for every autonomous Char-phone LLM request:
 * NPC WeChat, social bootstrap, NPC Moments, comments, Baidu and self profile.
 *
 * Manual, explicit User actions keep their original on-demand API semantics.
 * Do not use this guard for the User-facing AMSG 2.0 engine.
 */
export type PhoneApiPace = 'economy' | 'balanced';
export type PhoneAutonomyPreferences = {
  pace: PhoneApiPace;
  browserAutoEnabled: boolean;
  selfProfileAutoEnabled: boolean;
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
};
const SETTINGS_PREFIX = 'sully_char_phone_api_preferences_v1:';
const BUDGET_PREFIX = 'sully_char_phone_api_budget_v1:';
export const CHARACTER_PHONE_API_SETTINGS_CHANGED = 'sully:character-phone-api-settings-changed';
export const CHARACTER_PHONE_API_BUDGET_CHANGED = 'sully:character-phone-api-budget-changed';
const PER_DAY: Record<PhoneApiPace, number> = {
  economy: 6,
  balanced: 12,
};
const MIN_INTERVAL: Record<PhoneApiPace, number> = {
  economy: 65 * 60_000,
  balanced: 35 * 60_000,
};

const defaults = ():PhoneAutonomyPreferences => ({
  pace:'economy',
  browserAutoEnabled:true,
  selfProfileAutoEnabled:true,
});
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
      pace:raw?.pace==='balanced'?'balanced':'economy',
      browserAutoEnabled:raw?.browserAutoEnabled!==false,
      selfProfileAutoEnabled:raw?.selfProfileAutoEnabled!==false,
    };
  } catch {return defaults();}
}
export function writePhoneAutonomyPreferences(characterId:string, updates:Partial<PhoneAutonomyPreferences>):PhoneAutonomyPreferences {
  if (!characterId) throw new Error('Missing Char ID');
  const old=readPhoneAutonomyPreferences(characterId);
  const next:PhoneAutonomyPreferences = {
    pace:updates.pace==='balanced'?'balanced':updates.pace==='economy'?'economy':old.pace,
    browserAutoEnabled:typeof updates.browserAutoEnabled==='boolean'?updates.browserAutoEnabled:old.browserAutoEnabled,
    selfProfileAutoEnabled:typeof updates.selfProfileAutoEnabled==='boolean'?updates.selfProfileAutoEnabled:old.selfProfileAutoEnabled,
  };
  localStorage.setItem(SETTINGS_PREFIX+characterId,JSON.stringify(next));
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
  const pace=readPhoneAutonomyPreferences(characterId).pace;
  const state=readState(characterId,now);
  const limit=PER_DAY[pace];
  return {
    ...state,pace,limit,
    remaining:Math.max(0,limit-state.requests),
    nextAllowedAt:state.requests>=limit?new Date(new Date(now).setHours(24,0,0,0)).getTime()
      :state.lastRequestAt?state.lastRequestAt+MIN_INTERVAL[pace]:now,
  };
}
export function canUsePhoneApiBudget(characterId:string,now=Date.now()):boolean {
  if (!characterId || typeof localStorage==='undefined') return false;
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
