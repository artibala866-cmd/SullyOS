import React, {useEffect,useState} from 'react';
import {readPhonePower} from '../../utils/characterPhonePower';
export default function PhoneStatusBar({characterId,showBattery=true}:{characterId:string;showBattery?:boolean}){
  const [now,setNow]=useState(()=>Date.now());
  const [power,setPower]=useState(()=>readPhonePower(characterId));
  useEffect(()=>{setPower(readPhonePower(characterId));const id=window.setInterval(()=>{const time=Date.now();setNow(time);setPower(readPhonePower(characterId,time));},60000);return()=>clearInterval(id);},[characterId]);
  const time=new Date(now).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
  return <div className="flex shrink-0 items-center justify-between bg-[#ededed] px-5 pb-2 pt-3 text-[13px] text-[#222]">
    <time>{time}</time>
    <div className="flex items-center gap-2" title={'模拟设备：'+power.model+' · '+power.level+'%'+(power.charging?' 充电中':'')}>
      <span className="text-[10px] font-semibold">4G</span>
      <span className="flex h-3 items-end gap-[2px]" aria-label="信号"><i className="h-1 w-[3px] bg-current"/><i className="h-1.5 w-[3px] bg-current"/><i className="h-2 w-[3px] bg-current"/><i className="h-3 w-[3px] bg-current"/></span>
      <span aria-label="Wi-Fi" className="text-sm">◕</span>
      {showBattery&&<>
        <span className="relative inline-flex h-3 w-6 items-center rounded-[3px] border border-current p-[2px]" aria-label={'电量 '+power.level+'%'}><span className="absolute -right-[3px] h-1.5 w-[2px] rounded-r bg-current"/><span className="h-full rounded-[1px] bg-current" style={{width:power.level+'%'}}/></span>
        {power.charging&&<span className="text-[11px]">⚡</span>}
        <span className="text-[10px] tabular-nums">{power.level}%</span>
      </>}
    </div>
  </div>;
}
