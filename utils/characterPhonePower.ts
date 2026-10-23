export type PhonePower={level:number;charging:boolean;updatedAt:number;model:string};
const models=['iPhone 15','iPhone 16 Pro','Pixel 9','Galaxy S24','Xiaomi 14','OPPO Find X7'];
export function readPhonePower(characterId:string,now=Date.now()):PhonePower{
  const key='sully_char_phone_power_v1:'+characterId;
  let old:PhonePower|undefined;
  try{old=JSON.parse(localStorage.getItem(key)||'null')||undefined;}catch{}
  if(!old||!Number.isFinite(old.level)||!Number.isFinite(old.updatedAt)){
    old={level:Math.floor(35+Math.random()*61),charging:false,updatedAt:now,model:models[Math.floor(Math.random()*models.length)]};
  }
  const elapsed=Math.max(0,Math.min(72,(now-old.updatedAt)/3600000));
  let level=old.level;
  let charging=old.charging;
  if(elapsed>=0.15){
    level=Math.max(0,Math.min(100,level+(charging?19:-3.5)*elapsed));
    if(level<16&&!charging&&Math.random()<0.5)charging=true;
    if(level>=96&&charging)charging=false;
    if(Math.random()<Math.min(0.35,elapsed*0.025))charging=!charging;
  }
  const next={level:Math.round(level),charging,updatedAt:now,model:old.model||models[0]};
  try{localStorage.setItem(key,JSON.stringify(next));}catch{}
  return next;
}
