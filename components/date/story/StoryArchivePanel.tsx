import React,{useEffect,useMemo,useRef,useState} from 'react';
import {ArrowClockwise,ArrowLeft,ArrowUUpLeft,Check,Checks,Square,DownloadSimple,Plus,Selection,SpinnerGap,UserPlus,X} from '@phosphor-icons/react';
import type {Message,StoryTheaterArchive,StoryTheaterArchiveStrategy,StoryTheaterEntry,StoryTheaterMask} from '../../../types';
import {useOS} from '../../../context/OSContext';
import {resolveStoryTheaterMask,storyTheaterThreadId} from '../../../utils/storyTheater';
import {convertStoryArchiveToMemory,storyMemoryDate} from '../../../utils/storyTheaterMemoryConversion';
import {shareOrDownloadFile} from '../../../utils/shareExport';
import {StoryAppearanceButton} from './StoryTheaterTheme';
import {archiveStoryFloorRange,regenerateStoryArchiveSummary,revokeStoryArchive,storyArchiveFloors,storyArchiveReplacementSet} from '../../../utils/storyTheaterArchive';
import {DB} from '../../../utils/db';
import {runStoryArchiveOperation} from '../../../utils/storyTheaterBackground';

export function ArchiveIcon({label,onClick,disabled,children}:{label:string;onClick:()=>void;disabled?:boolean;children:React.ReactNode}){
 return <button type='button' aria-label={label} title={label} disabled={disabled} onClick={onClick}
  className='inline-grid h-10 w-10 shrink-0 place-items-center rounded-full text-violet-700 hover:bg-violet-100 focus-visible:outline focus-visible:outline-violet-400 disabled:opacity-30'>{children}</button>;
}

export default function StoryArchivePanel({entry,masks,onBack,onUpdated,strategy='summary',children,locked=false}:{
 entry:StoryTheaterEntry;masks:StoryTheaterMask[];onBack:()=>void;onUpdated:(entry:StoryTheaterEntry)=>void;
 strategy?:StoryTheaterArchiveStrategy;children?:React.ReactNode;locked?:boolean;
}){
 const {characters,userProfile,apiConfig,memoryPalaceConfig,remoteVectorConfig,addToast}=useOS();
 const actors=characters.filter(char=>entry.characterIds.includes(char.id));
 const [charId,setCharId]=useState(actors[0]?.id??'');
 const [selected,setSelected]=useState<string[]>([]),[dates,setDates]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState('');
 const [regeneratingId,setRegeneratingId]=useState<string|null>(null);
 const [revokeTarget,setRevokeTarget]=useState<StoryTheaterArchive|null>(null);
 const running=useRef(false);
 const isVector=strategy==='vector';
 const allBoxes=useMemo(()=>entry.archives.filter(a=>a.strategy===strategy),[entry.archives,strategy]);
 const legacy=allBoxes.filter(box=>isVector&&!box.vectorMemoryIds);
 const boxes=allBoxes.filter(box=>!isVector||!!box.vectorMemoryIds||box===legacy[0]);
 const blocked=busy||locked;
 const [floors,setFloors]=useState<Message[]|null>(null);
 const [range,setRange]=useState<{first:string;last:string;replaceId?:string}|null>(null);
 const rangeSection=useRef<HTMLElement>(null);
 useEffect(()=>{
  let active=true;
  void DB.getMessagesByCharId(storyTheaterThreadId(entry.id),true).then(rows=>{
   if(active)setFloors(storyArchiveFloors(rows,entry.id));
  }).catch(e=>{if(active){setFloors([]);setError(e?.message||'读取剧情楼层失败');}});
  return()=>{active=false;};
 },[entry.id,entry.updatedAt]);
 const first=Number(range?.first),last=Number(range?.last);
 const chosenFloors=range&&floors&&Number.isSafeInteger(first)&&Number.isSafeInteger(last)
  &&first>=1&&last>=first&&last<=floors.length?floors.slice(first-1,last):[];
 const firstId=chosenFloors[0]?.id,lastId=chosenFloors.at(-1)?.id;
 const replacement=storyArchiveReplacementSet(entry.archives,boxes.find(box=>box.id===range?.replaceId));
 const overlaps=entry.archives.some(box=>!replacement.includes(box)
  &&firstId!==undefined&&lastId!==undefined&&firstId<=box.toMessageId&&box.fromMessageId<=lastId);
 const includesPending=!!chosenFloors.length&&last===floors?.length&&floors.at(-1)?.role==='user';
 const openRange=(id?:string)=>{
  const box=boxes.find(item=>item.id===id);
  const firstIndex=floors?.findIndex(row=>row.id===box?.fromMessageId)??-1;
  const lastIndex=floors?.findIndex(row=>row.id===box?.toMessageId)??-1;
  setError('');setStatus('');setRevokeTarget(null);
  setRange({first:firstIndex<0?'':String(firstIndex+1),last:lastIndex<0?'':String(lastIndex+1),replaceId:id});
 };
 useEffect(()=>{if(range)rangeSection.current?.scrollIntoView?.({block:'nearest'});},[!!range,range?.replaceId]);
 const saveRange=async()=>{
  if(running.current||locked||!range||!chosenFloors.length||overlaps||includesPending)return;
  running.current=true;setBusy(true);setError('');setStatus('正在整理所选楼层，原文仍可保留…');
  try{
   const updated=await archiveStoryFloorRange(entry.id,chosenFloors,apiConfig,range.replaceId,isVector?{
    embedding:memoryPalaceConfig.embedding,remote:remoteVectorConfig,
    fallbackApi:memoryPalaceConfig.lightLLM?.baseUrl?{...memoryPalaceConfig.lightLLM,apiKey:memoryPalaceConfig.lightLLM.apiKey??''}:undefined,
   }:undefined);
   onUpdated(updated);setRange(null);setStatus('所选楼层已整理，续写将使用新归档。');
   addToast('归档已保存','success');
  }catch(e:any){setError(e?.message||'归档失败，原文和旧摘要已保留');setStatus('');}
  finally{running.current=false;setBusy(false);}
 };
 const char=actors.find(c=>c.id===charId);
 const available=boxes.filter(box=>!box.memoryConversions?.[charId]);
 const chosen=boxes.filter(box=>selected.includes(box.id)&&!box.memoryConversions?.[charId]);
 const dateValid=(date?:string)=>{try{storyMemoryDate(date??'');return true;}catch{return false;}};
 const toggle=(id:string)=>setSelected(current=>current.includes(id)?current.filter(x=>x!==id):[...current,id]);
 const regenerate=async(id:string)=>{
  if(running.current)return;
  running.current=true;setBusy(true);setRegeneratingId(id);setError('');setStatus('正在从这个事件盒的原文重新总结…');
  try{
   const updated=await regenerateStoryArchiveSummary(entry.id,id,apiConfig);
   onUpdated(updated);setStatus('事件盒已重新总结，续写将使用新摘要。');addToast('事件盒已重新总结','success');
  }catch(e:any){setError(e?.message||'重新总结失败，旧摘要已保留，请重试');setStatus('');}
  finally{running.current=false;setBusy(false);setRegeneratingId(null);}
 };
 const revoke=async()=>{
  if(running.current||locked||!revokeTarget)return;
  running.current=true;setBusy(true);setError('');setStatus('');
  try{
   const updated=await revokeStoryArchive(entry.id,revokeTarget,remoteVectorConfig);
   onUpdated(updated);
   setSelected(current=>current.filter(id=>id!==revokeTarget.id));
   setDates(current=>Object.fromEntries(Object.entries(current).filter(([id])=>id!==revokeTarget.id)));
   if(range?.replaceId===revokeTarget.id)setRange(null);
   setRevokeTarget(null);
   setStatus('已撤销，可以重新选择这些楼层归档。恢复的原文不会再被自动归档。');
   addToast('归档已撤销','success');
  }catch(e:any){setError(e?.message||'撤销失败，摘要和原文已保留');}
  finally{running.current=false;setBusy(false);}
 };
 const convert=async()=>{
  if(running.current||!char||!chosen.length)return;
  if(chosen.some(box=>!dateValid(dates[box.id]))){setError('请为每个选中的事件盒填写记忆日期');return;}
  running.current=true;setBusy(true);setError('');
  let completed=0;
  try{
   // Converting an event box writes global actor memory, not story-private data.
   // Never use the per-story cheap summarizer for this shared-memory operation.
   const llm=memoryPalaceConfig.lightLLM?.baseUrl?memoryPalaceConfig.lightLLM:apiConfig;
   const identity=resolveStoryTheaterMask(entry.mask,userProfile,characters,masks);
   await runStoryArchiveOperation(entry.id,async()=>{
    for(const box of chosen){
     const result=await convertStoryArchiveToMemory({entryId:entry.id,archiveId:box.id,charId:char.id,date:dates[box.id],userName:userProfile.name||'用户',identityName:identity.name,llm,embedding:memoryPalaceConfig.embedding,remote:remoteVectorConfig,onProgress:text=>setStatus((completed+1)+'/'+chosen.length+' · '+text)});
     onUpdated(result.entry);completed++;
     setSelected(current=>current.filter(id=>id!==box.id));
    }
   });
   setStatus(`已完成 ${completed} 个事件盒；可以在${char.memoryPalaceEnabled?'记忆宫殿和神经链接':'神经链接'}查看。`);
   addToast('所选事件盒已转化为角色记忆','success');
  }catch(e:any){setError(`${completed?`已完成 ${completed} 个，未完成的仍保留选中。`:''}${e?.message||'转化失败，请重试'}`);setStatus('');}
  finally{running.current=false;setBusy(false);}
 };
 const exportSelected=async()=>{
  const rows=boxes.filter(b=>selected.includes(b.id));if(!rows.length)return;
  try{
   const content=[`剧情事件盒 · ${entry.title}`,...rows.map(box=>`\n===== 事件盒 ${boxes.indexOf(box)+1} · ${box.messageCount} 条原文 =====\n${box.summary}`)].join('\n');
   await shareOrDownloadFile({content,fileName:`${entry.title.replace(/[\\/:*?"<>|]/g,'_').slice(0,80)||'剧情'}-事件盒.txt`,mimeType:'text/plain;charset=utf-8',shareTitle:'剧情事件盒'});
  }catch(e:any){setError(e?.message||'导出失败，请重试');}
 };
 return <div className='h-full w-full flex flex-col bg-stone-100 text-slate-800'>
  <header className='story-safe-header shrink-0 border-b border-slate-200'>
   <div className='h-14 px-3 flex items-center gap-1'>
    <ArchiveIcon label='返回剧情' disabled={blocked} onClick={onBack}><ArrowLeft size={20}/></ArchiveIcon>
    <div className='min-w-0 flex-1'><p className='text-[10px] text-slate-500'>{isVector?'独立向量':'剧情事件盒'}</p><h1 className='truncate text-sm font-semibold'>{entry.title}</h1></div>
    <ArchiveIcon label='手动归档楼层' disabled={blocked||!floors?.length} onClick={()=>openRange()}><Plus size={21}/></ArchiveIcon>
    <StoryAppearanceButton/>
   </div>
  </header>
  <main className='story-page-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3'>
   <div className='max-w-2xl mx-auto space-y-3'>
    {range&&<section ref={rangeSection} className='space-y-2 rounded-xl border border-violet-200 bg-white p-3' aria-label='选择归档楼层'>
     <div className='flex items-center justify-between gap-2'>
      <h2 className='text-xs font-semibold'>{range.replaceId?'重选楼层':'归档楼层'} <span className='font-normal text-slate-500'>· 共 {floors?.length||0} 楼</span></h2>
      <div className='flex'>
       <ArchiveIcon label='开始整理' disabled={blocked||!chosenFloors.length||overlaps||includesPending} onClick={()=>void saveRange()}>{busy?<SpinnerGap size={18} className='animate-spin'/>:<Check size={19}/>}</ArchiveIcon>
       <ArchiveIcon label='取消选楼' disabled={blocked} onClick={()=>setRange(null)}><X size={17}/></ArchiveIcon>
      </div>
     </div>
     <div className='grid grid-cols-3 gap-2 text-[11px]'>
      <label>起始楼<input type='number' min={1} max={floors?.length} value={range.first} disabled={blocked} onChange={e=>setRange({...range,first:e.target.value})} className='mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5'/></label>
      <label>结束楼<input type='number' min={1} max={floors?.length} value={range.last} disabled={blocked} onChange={e=>setRange({...range,last:e.target.value})} className='mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5'/></label>
      <label>归档条数<input type='number' min={1} value={range.first&&range.last&&Number.isSafeInteger(first)&&Number.isSafeInteger(last)&&last>=first?last-first+1:''} disabled={blocked||!Number.isSafeInteger(first)||first<1} onChange={e=>setRange({...range,last:e.target.value?String(first+Number(e.target.value)-1):''})} className='mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5'/></label>
     </div>
     {range.first&&range.last&&!chosenFloors.length&&<p className='text-[11px] text-rose-600'>请输入有效的楼层范围。</p>}
     {chosenFloors.length>0&&<div className='space-y-1 text-[11px] leading-5 text-slate-500'>
      <p>第 {first} 至 {last} 楼，共 {chosenFloors.length} 条</p>
      <p className='truncate'>起 · {chosenFloors[0].content.replace(/<[^>]*>/g,'').trim()}</p>
      {chosenFloors.length>1&&<p className='truncate'>止 · {chosenFloors.at(-1)?.content.replace(/<[^>]*>/g,'').trim()}</p>}
     </div>}
     {overlaps&&<p className='text-[11px] text-rose-600'>与其他归档重叠，请调整范围。</p>}
     {includesPending&&<p className='text-[11px] text-rose-600'>最后一条推进尚未得到回复。</p>}
     {replacement.length>1&&<p className='text-[11px] text-amber-700'>旧向量按组存储。确认后重建所选楼层，其余旧归档楼层恢复原文。</p>}
     <p className='text-[10px] text-slate-500'>{isVector?'确认后调用总结与向量 API。':'确认后调用一次总结 API。'}</p>
    </section>}
    {error&&<p role='alert' className='text-xs leading-5 text-rose-600'>{error}</p>}
    {status&&<p role='status' className='text-xs leading-5 text-violet-700'>{status}</p>}
    {!boxes.length&&<p className='py-3 text-center text-xs text-slate-500'>{floors===null?'正在读取楼层…':'暂无归档，点右上角＋选择楼层'}</p>}
    {!isVector&&boxes.length>1&&<div className='flex items-center gap-1'>
     <p className='flex-1 text-[11px] text-slate-500'>共 {boxes.length} 个{selected.length>0?' · 选中 '+selected.length+' 个':''}</p>
     <ArchiveIcon label={selected.length?'取消全选':'全选'} disabled={blocked} onClick={()=>setSelected(selected.length?[]:boxes.map(box=>box.id))}>{selected.length?<Square size={17}/>:<Checks size={17}/>}</ArchiveIcon>
     {available.length<boxes.length&&<ArchiveIcon label='选择未转化' disabled={blocked||!available.length} onClick={()=>setSelected(available.map(box=>box.id))}><Selection size={17}/></ArchiveIcon>}
    </div>}
    {!isVector&&selected.length>0&&<div className='flex items-center justify-between gap-2'>
     <select aria-label='接收记忆的角色' disabled={blocked} value={charId} onChange={e=>{setCharId(e.target.value);setDates({});}} className='min-w-0 flex-1 rounded-lg border border-slate-200 bg-white p-2 text-xs'>
      {actors.map(actor=><option key={actor.id} value={actor.id}>{actor.name}</option>)}
     </select>
     <ArchiveIcon label='导出选中' disabled={blocked} onClick={()=>void exportSelected()}><DownloadSimple size={18}/></ArchiveIcon>
     <ArchiveIcon label='转为角色记忆' disabled={blocked||!char||!chosen.length||chosen.some(box=>!dateValid(dates[box.id]))} onClick={()=>void convert()}><UserPlus size={18}/></ArchiveIcon>
    </div>}
    <div className='divide-y divide-slate-200'>
     {boxes.map((box,index)=>{
      const checked=selected.includes(box.id),receipt=box.memoryConversions?.[charId];
      const firstFloor=floors?.findIndex(row=>row.id===box.fromMessageId)??-1;
      const lastFloor=floors?.findIndex(row=>row.id===box.toMessageId)??-1;
      const legacyBox=isVector&&!box.vectorMemoryIds;
      return <section key={box.id} className='py-2'>
       <div className='flex items-center gap-2'>
        {!isVector&&<input type='checkbox' aria-label={'选择事件盒 '+(index+1)} checked={checked} disabled={blocked} onChange={()=>toggle(box.id)} className='accent-violet-600'/>}
        <div className='min-w-0 flex-1'>
         <h2 className='truncate text-xs font-semibold'>{legacyBox?'旧向量归档':(isVector?'向量归档 ':'事件盒 ')+(index+1)}</h2>
         <p className='truncate text-[10px] text-slate-500'>{legacyBox&&legacy.length>1?legacy.length+' 段 · 按组处理':firstFloor>=0&&lastFloor>=0?'第 '+(firstFloor+1)+'–'+(lastFloor+1)+' 楼':box.messageCount+' 条原文'}{receipt?' · 已转化':''}</p>
        </div>
        {!isVector&&<ArchiveIcon label={'重新总结事件盒 '+(index+1)} disabled={blocked} onClick={()=>void regenerate(box.id)}>{regeneratingId===box.id?<SpinnerGap size={17} className='animate-spin'/>:<ArrowClockwise size={18}/>}</ArchiveIcon>}
        <ArchiveIcon label='重选楼层' disabled={blocked||!floors?.length} onClick={()=>openRange(box.id)}><Selection size={18}/></ArchiveIcon>
        <ArchiveIcon label='撤销归档' disabled={blocked} onClick={()=>{setRevokeTarget(box);setRange(null);setError('');setStatus('');}}><ArrowUUpLeft size={18}/></ArchiveIcon>
       </div>
       {!isVector&&<details className='pl-5 text-xs'><summary className='cursor-pointer py-1 text-slate-500'>摘要</summary><p className='whitespace-pre-wrap py-1 leading-6'>{box.summary||'暂无摘要'}</p></details>}
       {revokeTarget?.id===box.id&&<div className='mt-1 flex items-center gap-1 rounded-lg border border-rose-200 px-2' role='group' aria-label='确认撤销归档'>
        <p className='min-w-0 flex-1 text-[11px] text-slate-600'>{legacyBox&&legacy.length>1?'撤销整组旧向量，恢复原文？':'撤销这段归档，恢复原文？'}</p>
        <ArchiveIcon label='确认撤销' disabled={blocked} onClick={()=>void revoke()}><Check size={18}/></ArchiveIcon>
        <ArchiveIcon label='取消撤销' disabled={blocked} onClick={()=>setRevokeTarget(null)}><X size={17}/></ArchiveIcon>
       </div>}
       {!isVector&&checked&&!receipt&&<label className='mt-2 block pl-5 text-[11px]'>记忆日期<input type='date' aria-label={'事件盒 '+(index+1)+' 记忆日期'} disabled={blocked} value={dates[box.id]??''} onChange={e=>setDates(current=>({...current,[box.id]:e.target.value}))} className='ml-2 rounded-lg border border-slate-200 bg-white p-1.5'/></label>}
      </section>;
     })}
    </div>
    {children}
   </div>
  </main>
 </div>;
}
