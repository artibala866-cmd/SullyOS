/** Local-only Char phone wallpaper and desktop widget settings. No AI or image generation. */
export type PhoneAppearance = {
  preset:'mist'|'paper'|'graphite';
  wallpaper:string;
  polaroidLeft:string;
  polaroidRight:string;
  quote:string;
  caption:string;
  location:string;
  anniversary:string;
};
export const PHONE_APPEARANCE_CHANGED='sully:character-phone-appearance-changed';
const PREFIX='sully_character_phone_appearance_v1:';
const defaults=():PhoneAppearance=>({preset:'mist',wallpaper:'',polaroidLeft:'',polaroidRight:'',quote:'',caption:'',location:'',anniversary:''});
const isLocalImage=(src:unknown):src is string =>
  typeof src==='string' && /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(src) && src.length<900000;
const sanitizeImage=(src:unknown):string=>isLocalImage(src)?src:'';
export function readPhoneAppearance(characterId:string):PhoneAppearance {
  if(!characterId||typeof localStorage==='undefined')return defaults();
  try{
    const raw=JSON.parse(localStorage.getItem(PREFIX+characterId)||'null');
    return {
      preset:raw?.preset==='paper'||raw?.preset==='graphite'?raw.preset:'mist',
      wallpaper:sanitizeImage(raw?.wallpaper),
      polaroidLeft:sanitizeImage(raw?.polaroidLeft),
      polaroidRight:sanitizeImage(raw?.polaroidRight),
      quote:typeof raw?.quote==='string'?raw.quote.slice(0,120):'',
      caption:typeof raw?.caption==='string'?raw.caption.slice(0,72):'',
      location:typeof raw?.location==='string'?raw.location.slice(0,36):'',
      anniversary:typeof raw?.anniversary==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(raw.anniversary)?raw.anniversary:'',
    };
  }catch{return defaults();}
}
export function savePhoneAppearance(characterId:string,updates:Partial<PhoneAppearance>):PhoneAppearance {
  if(!characterId||typeof localStorage==='undefined')throw new Error('没有可用的角色存档');
  const original=readPhoneAppearance(characterId);
  const candidate={...original,...updates};
  const sanitized:PhoneAppearance={
    preset:candidate.preset==='paper'||candidate.preset==='graphite'?candidate.preset:'mist',
    wallpaper:sanitizeImage(candidate.wallpaper),polaroidLeft:sanitizeImage(candidate.polaroidLeft),
    polaroidRight:sanitizeImage(candidate.polaroidRight),
    quote:String(candidate.quote||'').slice(0,120),
    caption:String(candidate.caption||'').slice(0,72),
    location:String(candidate.location||'').slice(0,36),
    anniversary:/^\d{4}-\d{2}-\d{2}$/.test(candidate.anniversary||'')?candidate.anniversary:'',
  };
  localStorage.setItem(PREFIX+characterId,JSON.stringify(sanitized));
  if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent(PHONE_APPEARANCE_CHANGED,{detail:{characterId}}));
  return sanitized;
}
export function relationshipDayCount(date:string,now=new Date()):number|null {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;
  const [y,m,d]=date.split('-').map(Number);
  const anchor=new Date(y,m-1,d);
  if(anchor.getFullYear()!==y||anchor.getMonth()!==m-1||anchor.getDate()!==d)return null;
  const today=Date.UTC(now.getFullYear(),now.getMonth(),now.getDate());
  const since=Date.UTC(y,m-1,d);
  return since>today?null:Math.floor((today-since)/86400000)+1;
}
/** Compress a user-picked local photo before saving, preserving localStorage quotas. */
export async function compressPhoneAppearanceImage(file:File):Promise<string> {
  if(!file.type.startsWith('image/'))throw new Error('请选择图片文件');
  if(file.size>12*1024*1024)throw new Error('图片太大，请选择小于 12MB 的照片');
  const objectUrl=URL.createObjectURL(file);
  try{
    const img=new Image();
    img.src=objectUrl;
    await img.decode();
    const ratio=Math.min(1,1000/Math.max(img.width,img.height));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(img.width*ratio));
    canvas.height=Math.max(1,Math.round(img.height*ratio));
    const context=canvas.getContext('2d');
    if(!context)throw new Error('无法处理照片');
    context.drawImage(img,0,0,canvas.width,canvas.height);
    const result=canvas.toDataURL('image/jpeg',0.72);
    if(!isLocalImage(result))throw new Error('照片压缩后仍过大');
    return result;
  }finally{URL.revokeObjectURL(objectUrl);}
}
