import React,{useEffect,useState} from 'react';
import {DB} from '../../utils/db';
import type {GalleryImage} from '../../types';
export default function CharacterPhoneGallery({characterId}:{characterId:string}){
  const [photos,setPhotos]=useState<GalleryImage[]>([]);
  const [selected,setSelected]=useState<GalleryImage|null>(null);
  useEffect(()=>{let live=true;DB.getGalleryImages(characterId).then(v=>{if(live)setPhotos(v);}).catch(()=>{});return()=>{live=false;};},[characterId]);
  return <section className="min-h-full bg-white p-3">
    <div className="mb-3 text-sm text-gray-500">角色相册 · {photos.length} 张</div>
    <div className="grid grid-cols-3 gap-1">{photos.map(p=><button key={p.id} onClick={()=>setSelected(p)} className="aspect-square overflow-hidden bg-gray-100"><img src={p.url} alt="相册照片" className="h-full w-full object-cover" loading="lazy"/></button>)}</div>
    {!photos.length&&<p className="p-8 text-center text-sm text-gray-400">暂无照片</p>}
    {selected&&<div className="fixed inset-0 z-[1100] flex flex-col bg-black/95" onClick={()=>setSelected(null)}><button className="p-5 text-left text-white">返回相册</button><img src={selected.url} alt="相册大图" className="min-h-0 flex-1 object-contain"/></div>}
  </section>;
}
