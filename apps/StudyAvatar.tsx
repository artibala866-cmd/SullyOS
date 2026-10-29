import React,{useState} from 'react';
import TokenImg from '../components/os/TokenImg';
import {isImageValue} from '../utils/blobRef';

/** Real character portrait with graceful support for legacy emoji and missing blobs. */
interface StudyAvatarProps{
  value?:string|null;
  name:string;
  className?:string;
}
export default function StudyAvatar({value,name,className='h-full w-full'}:StudyAvatarProps){
  const [broken,setBroken]=useState<string|null>(null);
  const textValue=typeof value==='string'&&!isImageValue(value)&&value.length<=24?value:'';
  const imageValue=isImageValue(value)?value:null;
  const canShowImage=!!imageValue&&broken!==imageValue;
  return canShowImage
    ? <TokenImg value={imageValue} alt={name+' 的头像'} loading="lazy"
        onError={()=>setBroken(imageValue)}
        className={className+' object-cover bg-neutral-200'}/>
    : <span role="img" aria-label={name+' 的头像'}
        className={className+' grid place-items-center overflow-hidden rounded-full bg-neutral-200 font-serif text-xl text-neutral-700'}>
        {textValue||name.slice(0,1)||'✦'}
      </span>;
}
