import React from 'react';
import PhoneAvatar from './PhoneAvatar';
import type { PhoneMessage } from '../../utils/characterPhoneIdentity';

export default function PhoneChatBubbles({messages,ownerAvatar,contactAvatar,ownerName,contactName}:{messages:PhoneMessage[];ownerAvatar?:string;contactAvatar?:string;ownerName:string;contactName:string}) {
  return <div className="space-y-3 px-4 py-5">{messages.map((m,i)=>{
    const owner=m.speaker?.role==='owner';
    const avatar=owner?ownerAvatar:contactAvatar;
    const label=owner?ownerName:contactName;
    const stamp=m.createdAt;
    const previous=messages[i-1]?.createdAt;
    const showTime=!!stamp&&(i===0||!previous||stamp-previous>5*60*1000);
    return <React.Fragment key={i}>
      {showTime&&<div className="py-2 text-center text-xs text-[#aaa]">{new Date(stamp).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</div>}
      <div className={'flex items-start gap-2.5 '+(owner?'flex-row-reverse':'')}>
        <PhoneAvatar key={avatar||label} src={avatar} name={label} className="h-10 w-10 rounded text-sm"/>
        <div className={'relative max-w-[76%] whitespace-pre-wrap break-words rounded-md px-3 py-2 text-[15px] leading-relaxed '+(owner?'bg-[#95ec69]':'bg-white')}>
          <span className={'absolute top-3 h-2.5 w-2.5 rotate-45 '+(owner?'-right-1 bg-[#95ec69]':'-left-1 bg-white')}/>
          <span className="relative">{m.text}</span>
        </div>
      </div>
    </React.Fragment>;
  })}</div>;
}
