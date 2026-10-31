export type CharacterStyle='modern'|'legacy'|'illustrated';
export const CHARACTER_STYLE_KEY='sully-home3d-character-style';
// Fresh installs use the noticeably illustrated look. A saved 'modern' value
// stays an explicit rollback choice; never reset someone's selected style.
const clean=(value:unknown):CharacterStyle=>value==='legacy'?'legacy':value==='modern'?'modern':'illustrated';
const read=():CharacterStyle=>{try{return clean(localStorage.getItem(CHARACTER_STYLE_KEY));}catch{return 'modern';}};
let style=read();
let persisted=true;
const listeners=new Set<()=>void>();
const emit=()=>{for(const listener of listeners)listener();};
const storage=(event:StorageEvent)=>{if(event.key!==null&&event.key!==CHARACTER_STYLE_KEY)return;const next=event.key===null?'illustrated':clean(event.newValue);if(next!==style){style=next;emit();}};
export const getCharacterStyle=()=>style;
export function setCharacterStyle(value:CharacterStyle){
 const next=clean(value);try{localStorage.setItem(CHARACTER_STYLE_KEY,next);persisted=true;}catch{persisted=false;}
 if(next!==style){style=next;emit();}
}
export function subscribeCharacterStyle(listener:()=>void){
 if(!listeners.size){if(persisted)style=read();if(typeof window!=='undefined')window.addEventListener('storage',storage);}
 listeners.add(listener);
 return ()=>{listeners.delete(listener);if(!listeners.size&&typeof window!=='undefined')window.removeEventListener('storage',storage);};
}
