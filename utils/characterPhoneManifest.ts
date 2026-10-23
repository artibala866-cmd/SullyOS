/** Character-owned phone app manifest. Never changes another character's launcher. */
export type PhoneAppId='wechat'|'memo'|'gallery'|'calls'|'sms'|'browser';
export type PhoneManifest={characterId:string;appIds:PhoneAppId[];createdAt:number;updatedAt:number};
const key=(id:string)=>'sully_character_phone_manifest_v1:'+id;
const allowed:PhoneAppId[]=['wechat','memo','gallery','calls','sms','browser'];
export function readPhoneManifest(characterId:string):PhoneManifest|null{
 try{const x=JSON.parse(localStorage.getItem(key(characterId))||'null');if(x?.characterId!==characterId||!Array.isArray(x.appIds))return null;return {...x,appIds:x.appIds.filter((v:PhoneAppId)=>allowed.includes(v))};}catch{return null;}
}
export function savePhoneManifest(manifest:PhoneManifest):boolean{
 if(!manifest.characterId)return false;
 const ids=[...new Set(manifest.appIds.filter(id=>allowed.includes(id)))];
 if(!ids.length)return false;
 try{localStorage.setItem(key(manifest.characterId),JSON.stringify({...manifest,appIds:ids}));return true;}catch{return false;}
}
