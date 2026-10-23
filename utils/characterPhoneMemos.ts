export type MemoCategory='thought'|'daily'|'expense'|'idea'|'about-user'|'unsent';
export type CharacterMemoEntry={id:string;characterId:string;category:MemoCategory;title?:string;body:string;createdAt:number;sourceEventIds?:string[];private?:boolean;expense?:{amount:number;currency:string;label:string}};
export const CHARACTER_MEMOS_CHANGED='sully:character-memos-changed';
const key=(id:string)=>'sully_character_memo_entries_v1:'+id;
export function readCharacterMemos(characterId:string):CharacterMemoEntry[]{
  try{const value=JSON.parse(localStorage.getItem(key(characterId))||'[]');return Array.isArray(value)?value.filter((v:CharacterMemoEntry)=>v&&v.characterId===characterId&&typeof v.body==='string').sort((a:CharacterMemoEntry,b:CharacterMemoEntry)=>b.createdAt-a.createdAt):[];}catch{return [];}
}
export function appendCharacterMemo(input:Omit<CharacterMemoEntry,'id'|'createdAt'> & {id?:string;createdAt?:number}):CharacterMemoEntry|null{
  if(!input.characterId||!input.body?.trim())return null;
  const current=readCharacterMemos(input.characterId);
  if(input.sourceEventIds?.length&&current.some(m=>m.sourceEventIds?.some(id=>input.sourceEventIds!.includes(id))))return null;
  const entry:CharacterMemoEntry={...input,id:input.id||crypto.randomUUID(),createdAt:input.createdAt||Date.now(),body:input.body.trim()};
  try{localStorage.setItem(key(input.characterId),JSON.stringify([entry,...current].slice(0,500)));window.dispatchEvent(new CustomEvent(CHARACTER_MEMOS_CHANGED,{detail:{characterId:input.characterId}}));return entry;}catch{return null;}
}

export function updateCharacterMemo(characterId:string,id:string,patch:Partial<Pick<CharacterMemoEntry,'body'|'title'|'category'|'sourceEventIds'>>):boolean{
 const entries=readCharacterMemos(characterId);const i=entries.findIndex(e=>e.id===id);if(i<0)return false;
 entries[i]={...entries[i],...patch,id,characterId};
 try{localStorage.setItem(key(characterId),JSON.stringify(entries));window.dispatchEvent(new CustomEvent(CHARACTER_MEMOS_CHANGED,{detail:{characterId}}));return true;}catch{return false;}
}
export function removeCharacterMemo(characterId:string,id:string):boolean{
 const entries=readCharacterMemos(characterId);if(!entries.some(e=>e.id===id))return false;
 try{localStorage.setItem(key(characterId),JSON.stringify(entries.filter(e=>e.id!==id)));window.dispatchEvent(new CustomEvent(CHARACTER_MEMOS_CHANGED,{detail:{characterId}}));return true;}catch{return false;}
}
