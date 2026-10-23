import React, {useState} from 'react';
export default function PhoneAvatar({src,name,className=''}:{src?:string;name:string;className?:string}) {
  const [failed,setFailed]=useState(false);
  const valid=typeof src==='string'&&src.trim().length>0&&!failed;
  return <span className={'flex shrink-0 items-center justify-center overflow-hidden bg-[#cbd2d6] text-[#58636b] '+className}>
    {valid?<img src={src} alt={name+'头像'} className="h-full w-full object-cover" onError={()=>setFailed(true)}/>:<span>{name.slice(0,1)}</span>}
  </span>;
}
