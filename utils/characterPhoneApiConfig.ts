/** Per-character API routing for the fictional character's phone only.
 * This does not override private chat, AMSG, vision, or memory providers.
 * A disabled or incomplete override uses the original phone caller config.
 */
export type PhoneDialogueApi = { baseUrl: string; apiKey: string; model: string };
export type CharacterPhoneApiSettings = PhoneDialogueApi & { enabled: boolean };
const PREFIX = 'sully_character_phone_dialogue_api_v1:';
export const CHARACTER_PHONE_DIALOGUE_API_CHANGED = 'sully:character-phone-dialogue-api-changed';
const empty = ():CharacterPhoneApiSettings => ({
  enabled:false, baseUrl:'', apiKey:'', model:'',
});
export function readCharacterPhoneApiSettings(characterId:string):CharacterPhoneApiSettings {
  if (!characterId || typeof localStorage === 'undefined') return empty();
  try {
    const raw=JSON.parse(localStorage.getItem(PREFIX+characterId)||'null');
    return {
      enabled:raw?.enabled===true,
      baseUrl:typeof raw?.baseUrl==='string'?raw.baseUrl:'',
      apiKey:typeof raw?.apiKey==='string'?raw.apiKey:'',
      model:typeof raw?.model==='string'?raw.model:'',
    };
  }catch{return empty();}
}
export function writeCharacterPhoneApiSettings(
  characterId:string, updates:Partial<CharacterPhoneApiSettings>,
):CharacterPhoneApiSettings {
  if (!characterId || typeof localStorage === 'undefined') throw new Error('Missing Char ID');
  const old=readCharacterPhoneApiSettings(characterId);
  const next:CharacterPhoneApiSettings={
    enabled:typeof updates.enabled==='boolean'?updates.enabled:old.enabled,
    baseUrl:typeof updates.baseUrl==='string'?updates.baseUrl.trim():old.baseUrl,
    apiKey:typeof updates.apiKey==='string'?updates.apiKey.trim():old.apiKey,
    model:typeof updates.model==='string'?updates.model.trim():old.model,
  };
  localStorage.setItem(PREFIX+characterId,JSON.stringify(next));
  if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent(CHARACTER_PHONE_DIALOGUE_API_CHANGED,{
    detail:{characterId},
  }));
  return next;
}
export function resolveCharacterPhoneApi<T extends PhoneDialogueApi>(
  characterId:string, fallback:T,
):T {
  const own=readCharacterPhoneApiSettings(characterId);
  if (!own.enabled) return fallback;
  // No silently mixed credentials: all three fields must be provided together.
  if (!/^https?:\/\//i.test(own.baseUrl) || !own.apiKey || !own.model) return fallback;
  return {...fallback,baseUrl:own.baseUrl,apiKey:own.apiKey,model:own.model};
}
