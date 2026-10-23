import React, { useEffect, useState } from 'react';
import { useBlobRefUrl } from '../../utils/blobRef';

export default function PhoneAvatar({src,name,className=''}:{src?:string;name:string;className?:string}) {
  const resolvedSrc = useBlobRefUrl(src);
  const [failed,setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src, resolvedSrc]);
  const valid = typeof resolvedSrc === 'string' && resolvedSrc.trim().length > 0 && !failed;
  return <span className={'flex shrink-0 items-center justify-center overflow-hidden bg-[#cbd2d6] text-[#58636b] '+className}>
    {valid ? <img src={resolvedSrc} alt={name+'头像'} className="h-full w-full object-cover" onError={()=>setFailed(true)}/> : <span>{name.slice(0,1)}</span>}
  </span>;
}
