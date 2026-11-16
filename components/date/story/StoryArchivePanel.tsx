import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {ArrowClockwise,ArrowLeft,Check,Checks,Square,DownloadSimple,Plus,Selection,SpinnerGap,UserPlus,X,MagnifyingGlass,ListNumbers,ArrowUUpLeft,CaretDown,ClockCounterClockwise} from '@phosphor-icons/react';
import type {Message,StoryTheaterArchive,StoryTheaterArchiveStrategy,StoryTheaterEntry,StoryTheaterMask} from '../../../types';
import {useLocalBackHandler} from '../../../hooks/useLocalBackHandler';
import {useOS} from '../../../context/OSContext';
import {resolveStoryTheaterMask,storyTheaterThreadId} from '../../../utils/storyTheater';
import {convertStoryArchiveToMemory,storyMemoryDate} from '../../../utils/storyTheaterMemoryConversion';
import {shareOrDownloadFile} from '../../../utils/shareExport';
import {StoryAppearanceButton} from './StoryTheaterTheme';
import {archiveStoryFloorRange,regenerateStoryArchiveSummary,revokeStoryArchive,storyArchiveFloors,storyArchiveReplacementSet,splitStoryArchiveBatches,type StoryArchiveProgress} from '../../../utils/storyTheaterArchive';
import {DB} from '../../../utils/db';
import {runStoryArchiveOperation} from '../../../utils/storyTheaterBackground';
import {storyArchiveReadableLines,storyArchiveSourceTimes} from '../../../utils/storyArchiveFacts';

export function ArchiveIcon({label,onClick,disabled,children}:{label:string;onClick:()=>void;disabled?:boolean;children:React.ReactNode}){
 return <button type='button' aria-label={label} title={label} disabled={disabled} onClick={onClick}
  className='story-memory-icon-button inline-grid h-11 w-11 shrink-0 place-items-center rounded-full text-violet-700 hover:bg-violet-100 focus-visible:outline focus-visible:outline-violet-400 disabled:opacity-30'>{children}</button>;
}

export default function StoryArchivePanel({entry,masks,onBack,onUpdated,strategy='summary',children,vectorSearch,locked=false,onFloorsLoaded}:{
 entry:StoryTheaterEntry;masks:StoryTheaterMask[];onBack:()=>void;onUpdated:(entry:StoryTheaterEntry)=>void;
 strategy?:StoryTheaterArchiveStrategy;children?:React.ReactNode;vectorSearch?:React.ReactNode;locked?:boolean;onFloorsLoaded?:(floors:Message[])=>void;
}){
 const {characters,userProfile,apiConfig,memoryPalaceConfig,remoteVectorConfig,addToast}=useOS();
 const actors=characters.filter(char=>entry.characterIds.includes(char.id));
 const [charId,setCharId]=useState(actors[0]?.id??'');
 const [selected,setSelected]=useState<string[]>([]),[dates,setDates]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState('');
 const [regeneratingId,setRegeneratingId]=useState<string|null>(null);
 const [revokeTarget,setRevokeTarget]=useState<StoryTheaterArchive|null>(null);
 const running=useRef(false);
 const completedBatches=useRef(new Map<string,string>());
 const incompleteBatches=useRef(new Set<string>());
 const [rangeProgress,setRangeProgress]=useState<StoryArchiveProgress|null>(null);
 const [rangeFailure,setRangeFailure]=useState('');
 const [rangeBusy,setRangeBusy]=useState(false);
 const rangeActions=useRef<HTMLDivElement>(null);
 const isVector=strategy==='vector';
 const allBoxes=useMemo(()=>entry.archives.filter(a=>a.strategy===strategy),[entry.archives,strategy]);
 const legacy=allBoxes.filter(box=>isVector&&!box.vectorMemoryIds);
 const boxes=allBoxes.filter(box=>!isVector||!!box.vectorMemoryIds||box===legacy[0]);
 const blocked=busy||locked;
 const [floors,setFloors]=useState<Message[]|null>(null);
 const [range,setRange]=useState<{first:string;last:string;replaceId?:string}|null>(null);
 const rangeSection=useRef<HTMLElement>(null);
 const scrollRef=useRef<HTMLElement>(null);
 useLayoutEffect(()=>{
  const scroller=scrollRef.current, actions=rangeActions.current;
  if(!rangeFailure||!scroller||!actions)return;
  const viewport=window.visualViewport;
  const bottom=Math.min(scroller.getBoundingClientRect().bottom,viewport?viewport.offsetTop+viewport.height:window.innerHeight);
  const overflow=actions.getBoundingClientRect().bottom-bottom+12;
  if(overflow>0)scroller.scrollTop+=overflow;
 },[rangeFailure]);
 const tabScroll=useRef({vector:0,archives:0});
 const [tab,setTab]=useState<'vector'|'archives'>('vector');
 const [archiveQuery,setArchiveQuery]=useState('');
 const hasTabs=isVector&&!!children;
 const showingArchives=!hasTabs||tab==='archives';
 const switchTab=(next:'vector'|'archives')=>{
  if(tab===next)return;
  tabScroll.current[tab]=scrollRef.current?.scrollTop??0;
  setTab(next);
 };
 useLocalBackHandler(()=>{
  // The appearance sheet has its own return handler.
  if(document.getElementById('story-appearance-title'))return false;
  if(blocked)return true;
  if(revokeTarget)setRevokeTarget(null);
  else if(range&&showingArchives)setRange(null);
  else if(hasTabs&&tab==='archives')switchTab('vector');
  else onBack();
  return true;
 },25);
 useLayoutEffect(()=>{
  if(scrollRef.current)scrollRef.current.scrollTop=tabScroll.current[tab];
 },[tab]);
 useEffect(()=>{
  let active=true;
  void DB.getMessagesByCharId(storyTheaterThreadId(entry.id),true).then(rows=>{
   if(active){
    const storyFloors=storyArchiveFloors(rows,entry.id);
    setFloors(storyFloors);
    onFloorsLoaded?.(storyFloors);
   }
  }).catch(e=>{if(active){setFloors([]);onFloorsLoaded?.([]);setError(e?.message||'读取剧情楼层失败');}});
  return()=>{active=false;};
 },[entry.id,entry.updatedAt,onFloorsLoaded]);
 const first=Number(range?.first),last=Number(range?.last);
 const chosenFloors=range&&floors&&Number.isSafeInteger(first)&&Number.isSafeInteger(last)
  &&first>=1&&last>=first&&last<=floors.length?floors.slice(first-1,last):[];
 const firstId=chosenFloors[0]?.id,lastId=chosenFloors.at(-1)?.id;
 const replacement=storyArchiveReplacementSet(entry.archives,boxes.find(box=>box.id===range?.replaceId));
 const recentRange=useMemo(()=>{
  if(!floors?.length)return null;
  let last=floors.length-1;
  const occupied=(index:number)=>entry.archives.some(box=>box.fromMessageId<=floors[index].id&&floors[index].id<=box.toMessageId);
  if(floors[last].role==='user')last--;
  while(last>=0&&occupied(last))last--;
  if(last<0)return null;
  let first=last;
  while(first>0&&!occupied(first-1))first--;
  return {first:String(first+1),last:String(last+1)};
 },[floors,entry.archives]);
 const overlaps=entry.archives.some(box=>!replacement.includes(box)
  &&firstId!==undefined&&lastId!==undefined&&firstId<=box.toMessageId&&box.fromMessageId<=lastId);
 const includesPending=!!chosenFloors.length&&last===floors?.length&&floors.at(-1)?.role==='user';
 const changeRange=(next:typeof range)=>{
  completedBatches.current.clear();incompleteBatches.current.clear();
  setRangeFailure('');setRangeProgress(null);setStatus('');
  setRange(next);
 };
 const openRange=(id?:string)=>{
  const box=boxes.find(item=>item.id===id);
  const firstIndex=floors?.findIndex(row=>row.id===box?.fromMessageId)??-1;
  const lastIndex=floors?.findIndex(row=>row.id===box?.toMessageId)??-1;
  setError('');setStatus('');setRevokeTarget(null);
  if(hasTabs) switchTab('archives');
  if((!hasTabs||tab==='archives')&&scrollRef.current)scrollRef.current.scrollTop=0;
  changeRange({first:firstIndex<0?'':String(firstIndex+1),last:lastIndex<0?'':String(lastIndex+1),replaceId:id});
 };
 useEffect(()=>{if(range)rangeSection.current?.scrollIntoView?.({block:'nearest'});},[!!range,range?.replaceId,tab]);
 const saveRange=async()=>{
  if(running.current||locked||!range||!chosenFloors.length||overlaps||includesPending)return;
  running.current=true;setBusy(true);setRangeBusy(true);setError('');setStatus('');setRangeFailure('');setRangeProgress(null);
  try{
   const updated=await archiveStoryFloorRange(entry.id,chosenFloors,apiConfig,range.replaceId,isVector?{
    embedding:memoryPalaceConfig.embedding,remote:remoteVectorConfig,
    fallbackApi:memoryPalaceConfig.lightLLM?.baseUrl?{...memoryPalaceConfig.lightLLM,apiKey:memoryPalaceConfig.lightLLM.apiKey??''}:undefined,
   }:undefined,{completed:completedBatches.current,incomplete:incompleteBatches.current,onProgress:setRangeProgress});
   onUpdated(updated);changeRange(null);setStatus('第 '+first+'–'+last+' 楼已归档。');
   addToast('归档已保存','success');
  }catch(e:any){setRangeFailure(e?.message||'请求失败');}
  finally{running.current=false;setBusy(false);setRangeBusy(false);}
 };
 const progressText=rangeProgress?.phase==='index'?'正在建立向量'
  :rangeProgress?.phase==='saving'?'正在保存归档'
  :rangeProgress?'第 '+rangeProgress.index+' / '+rangeProgress.total+' 批 · '+(rangeProgress.phase==='recovering'?'正在用更短的内容重试':'正在总结')
  :'正在准备归档';
 const failureTitle=rangeProgress?.phase==='index'?'向量建立失败'
  :rangeProgress?.phase==='saving'?'归档保存失败'
  :rangeProgress?'第 '+rangeProgress.index+' / '+rangeProgress.total+' 批整理失败'
  :'归档失败';
 const failedBatch=rangeProgress&&(rangeProgress.phase==='summary'||rangeProgress.phase==='recovering')?rangeProgress:null;
 const floorNumbers=useMemo(()=>new Map((floors??[]).map((row,index)=>[row.id,index+1])),[floors]);
 const sourceTimes=useMemo(()=>storyArchiveSourceTimes(floors??[]),[floors]);
 const readableLines=(box:StoryTheaterArchive)=>storyArchiveReadableLines(box,floorNumbers,sourceTimes);
 const readableSummary=(box:StoryTheaterArchive)=>readableLines(box).join('\n');
 const archivePreview=(box:StoryTheaterArchive)=>{
  const lines=readableLines(box);
  const renderLine=(line:string,index:number)=><div key={index} className='py-2 border-b border-slate-100 last:border-0'>
   {line.length>105?<details><summary aria-label='展开或收起完整记忆' className='story-memory-inline-expand cursor-pointer leading-6 break-words'><span>{line.slice(0,105)}…</span><CaretDown size={14} className='story-memory-expand-caret'/></summary><p className='mt-2 leading-6 break-words whitespace-pre-wrap'>{line}</p></details>
    :<p className='leading-6 break-words whitespace-pre-wrap'>{line}</p>}
  </div>;
  return <div className='py-2 text-xs'>
   {!!box.historyFacts?.length&&<p className='mb-2 text-[11px] text-slate-500'>按剧情楼层排列；过去的状态不是现在的状态。同楼多件事以原文为准。</p>}
   {lines.slice(0,3).map(renderLine)}
   {lines.length>3&&<details className='mt-2'><summary className='story-memory-inline-expand cursor-pointer py-2 text-slate-500'><span>其余 {lines.length-3} 条</span><CaretDown size={14} className='story-memory-expand-caret'/></summary><div>{lines.slice(3).map((line,index)=>renderLine(line,index+3))}</div></details>}
   {!lines.length&&<p className='text-slate-500'>暂无新剧情记忆</p>}
  </div>;
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
   const content=[`剧情事件盒 · ${entry.title}`,...rows.map(box=>`\n===== 事件盒 ${boxes.indexOf(box)+1} · ${box.messageCount} 条原文 =====\n${readableSummary(box)}`)].join('\n');
   await shareOrDownloadFile({content,fileName:`${entry.title.replace(/[\\/:*?"<>|]/g,'_').slice(0,80)||'剧情'}-事件盒.txt`,mimeType:'text/plain;charset=utf-8',shareTitle:'剧情事件盒'});
  }catch(e:any){setError(e?.message||'导出失败，请重试');}
 };
 const archiveSearch=archiveQuery.normalize('NFKC').trim().toLowerCase();
 const searchWords=archiveSearch.split(/\s+/u).filter(Boolean);
 const floorMatch=archiveSearch.match(/^(?:第\s*)?(\d+)\s*楼?$/u);
 const visibleBoxes=searchWords.length?boxes.filter(box=>{
  const first=floorNumbers.get(box.fromMessageId),last=floorNumbers.get(box.toMessageId);
  if(floorMatch&&first&&last&&Number(floorMatch[1])>=first&&Number(floorMatch[1])<=last)return true;
  if(floorMatch&&archiveSearch.includes('楼'))return false;
  const text=readableSummary(box).normalize('NFKC').toLowerCase();
  return searchWords.every(word=>text.includes(word));
 }):boxes;
 const archiveRows = showingArchives && <div className='story-memory-archive-list'>
     {visibleBoxes.map(box=>{
      const index=boxes.indexOf(box);
      const checked=selected.includes(box.id),receipt=box.memoryConversions?.[charId];
      const firstFloor=(floorNumbers.get(box.fromMessageId)??0)-1;
      const lastFloor=(floorNumbers.get(box.toMessageId)??0)-1;
      const legacyBox=isVector&&!box.vectorMemoryIds;
      const timeline=children&&isVector?{...box,facts:[]}:box;
      return <section key={box.id} className='story-memory-archive-item py-2'>
       <div className='story-memory-archive-heading flex items-center gap-2'>
        {!isVector&&<input type='checkbox' aria-label={'选择事件盒 '+(index+1)} checked={checked} disabled={blocked} onChange={()=>toggle(box.id)} className='accent-violet-600'/>}
        <div className='min-w-0 flex-1'>
         <h2 className='truncate text-xs font-semibold'>{legacyBox?'旧向量归档':(isVector?'向量归档 ':'事件盒 ')+(index+1)}</h2>
         <p className='truncate text-[10px] text-slate-500'>{legacyBox&&legacy.length>1?legacy.length+' 段 · 按组处理':firstFloor>=0&&lastFloor>=0?'第 '+(firstFloor+1)+'–'+(lastFloor+1)+' 楼':box.messageCount+' 条原文'}{receipt?' · 已转化':''}</p>
        </div>
        <div className='story-memory-archive-actions'>
         {!isVector&&<ArchiveIcon label={'重新总结事件盒 '+(index+1)} disabled={blocked} onClick={()=>void regenerate(box.id)}>{regeneratingId===box.id?<SpinnerGap size={17} className='animate-spin'/>:<ArrowClockwise size={19}/>}</ArchiveIcon>}
         <ArchiveIcon label={'重选楼层 · '+(index+1)} disabled={blocked||!floors?.length} onClick={()=>openRange(box.id)}><ListNumbers size={19}/></ArchiveIcon>
         <ArchiveIcon label={'撤销归档 · '+(index+1)} disabled={blocked} onClick={()=>{setRevokeTarget(box);setRange(null);setError('');setStatus('');}}><ArrowUUpLeft size={19}/></ArchiveIcon>
        </div>
       </div>
       {!isVector&&<details className='pl-5 text-xs'><summary className='story-memory-expand-summary cursor-pointer py-1 text-slate-500'><span>剧情记忆 · 按楼层整理</span><CaretDown size={14} className='story-memory-expand-caret'/></summary>{archivePreview(box)}</details>}
       {isVector&&!!((!children&&box.facts?.length)||box.historyFacts?.length)&&<details className='pl-5 text-xs'><summary className='story-memory-expand-summary cursor-pointer py-1 text-slate-500'><span>{children?'过去的变化':'剧情时间线'} · {readableLines(timeline).length} 条</span><CaretDown size={14} className='story-memory-expand-caret'/></summary>{archivePreview(timeline)}</details>}
       {revokeTarget?.id===box.id&&<div className='mt-1 flex items-center gap-1 rounded-lg border border-rose-200 px-2' role='group' aria-label='确认撤销归档'>
        <p className='min-w-0 flex-1 text-[11px] text-slate-600'>{legacyBox&&legacy.length>1?'撤销整组旧向量，恢复原文？':'撤销这段归档，恢复原文？'}</p>
        <ArchiveIcon label='确认撤销' disabled={blocked} onClick={()=>void revoke()}><Check size={18}/></ArchiveIcon>
        <ArchiveIcon label='取消撤销' disabled={blocked} onClick={()=>setRevokeTarget(null)}><X size={17}/></ArchiveIcon>
       </div>}
       {!isVector&&checked&&!receipt&&<label className='mt-2 block pl-5 text-[11px]'>记忆日期<input type='date' aria-label={'事件盒 '+(index+1)+' 记忆日期'} disabled={blocked} value={dates[box.id]??''} onChange={e=>setDates(current=>({...current,[box.id]:e.target.value}))} className='ml-2 rounded-lg border border-slate-200 bg-white p-1.5'/></label>}
      </section>;
     })}
    </div>;
 return <div className='story-memory-workspace h-full w-full flex flex-col bg-stone-100 text-slate-800'>
  <header className='story-safe-header story-memory-header shrink-0 border-b border-slate-200'>
   <div className='story-memory-header-row h-14 px-3 flex items-center gap-1'>
    <ArchiveIcon label='返回剧情' disabled={blocked} onClick={onBack}><ArrowLeft size={21}/></ArchiveIcon>
    <div className='min-w-0 flex-1'><p className='text-[10px] text-slate-500'>{isVector?'独立向量':'剧情事件盒'}</p><h1 className='truncate text-sm font-semibold'>{entry.title}</h1></div>
    <button type='button' aria-label='手动归档楼层' disabled={blocked||!floors?.length} onClick={()=>openRange()} title='归档楼层' className='story-memory-header-create inline-grid h-11 w-11 shrink-0 place-items-center rounded-full text-violet-700 disabled:opacity-40'><Plus size={21}/></button>
    <StoryAppearanceButton/>
   </div>
   {hasTabs&&<nav aria-label='剧情记忆页面' className='story-memory-tabs mx-4 flex max-w-2xl gap-2 text-sm'>
    <button type='button' disabled={blocked} aria-pressed={tab==='vector'} onClick={()=>switchTab('vector')} className={'min-h-10 flex-1 rounded-lg '+(tab==='vector'?'bg-violet-100 font-semibold text-violet-700':'')}>向量记忆</button>
    <button type='button' disabled={blocked} aria-pressed={tab==='archives'} onClick={()=>switchTab('archives')} className={'min-h-10 flex-1 rounded-lg '+(tab==='archives'?'bg-violet-100 font-semibold text-violet-700':'')}>归档记录</button>
   </nav>}
   {((!showingArchives && !!vectorSearch) || (showingArchives && boxes.length > 0)) && <div className='story-memory-search-bar px-4 pb-3'>
    <div className='mx-auto max-w-2xl'>
     {showingArchives ? <div className='relative story-memory-search-field'>
      <MagnifyingGlass size={18} aria-hidden className='pointer-events-none absolute left-3 top-3.5 text-slate-500' />
      <input type='search' aria-label='搜索归档' placeholder='搜索归档或楼层' value={archiveQuery} onChange={event=>setArchiveQuery(event.target.value)}
       className='story-memory-search-input min-h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-base'/>
     </div> : vectorSearch}
    </div>
   </div>}
  </header>
  <main ref={scrollRef} className='story-page-scroll story-memory-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3'>
   <div className='max-w-2xl mx-auto space-y-3'>
    {showingArchives&&range&&<section ref={rangeSection} className='story-memory-range space-y-2 rounded-xl border border-violet-200 bg-white p-3' aria-label='选择归档楼层'>
     <div className='flex items-center justify-between gap-2'>
      <h2 className='text-xs font-semibold'>{range.replaceId?'重选楼层':'归档楼层'} <span className='font-normal text-slate-500'>· 共 {floors?.length||0} 楼</span></h2>
      <button type='button' aria-label='取消选楼' disabled={blocked} onClick={()=>changeRange(null)} title='取消选楼' className='story-memory-range-cancel inline-grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-600'><X size={18}/></button>
     </div>
     {!range.replaceId&&recentRange&&<button type='button' disabled={blocked} onClick={()=>changeRange(recentRange)}
      className='story-memory-recent-range inline-flex min-h-11 items-center gap-2 px-2 text-sm font-medium text-violet-700'><ClockCounterClockwise size={17}/>第 {recentRange.first}–{recentRange.last} 楼 · 最近未归档</button>}
     <div className='grid grid-cols-3 gap-2 text-xs'>
      <label>起始楼<input type='number' inputMode='numeric' min={1} max={floors?.length} value={range.first} disabled={blocked} onChange={e=>changeRange({...range,first:e.target.value})} className='mt-1 min-w-0 w-full rounded-lg border border-slate-200 px-2 py-2 text-base'/></label>
      <label>结束楼<input type='number' inputMode='numeric' min={1} max={floors?.length} value={range.last} disabled={blocked} onChange={e=>changeRange({...range,last:e.target.value})} className='mt-1 min-w-0 w-full rounded-lg border border-slate-200 px-2 py-2 text-base'/></label>
      <label>归档条数<input type='number' inputMode='numeric' min={1} value={range.first&&range.last&&Number.isSafeInteger(first)&&Number.isSafeInteger(last)&&last>=first?last-first+1:''} disabled={blocked||!Number.isSafeInteger(first)||first<1} onChange={e=>changeRange({...range,last:e.target.value?String(first+Number(e.target.value)-1):''})} className='mt-1 min-w-0 w-full rounded-lg border border-slate-200 px-2 py-2 text-base'/></label>
     </div>
     {range.first&&range.last&&!chosenFloors.length&&<p className='text-[11px] text-rose-600'>请输入有效的楼层范围。</p>}
     {chosenFloors.length>0&&<div className='space-y-1 text-[11px] leading-5 text-slate-500'>
      <p>预计整理 {splitStoryArchiveBatches(chosenFloors).length} 批</p>
      <p className='truncate'>起 · {chosenFloors[0].content.replace(/<[^>]*>/g,'').trim()}</p>
      {chosenFloors.length>1&&<p className='truncate'>止 · {chosenFloors.at(-1)?.content.replace(/<[^>]*>/g,'').trim()}</p>}
     </div>}
     {overlaps&&<p className='text-[11px] text-rose-600'>与其他归档重叠，请调整范围。</p>}
     {includesPending&&<p className='text-[11px] text-rose-600'>最后一条推进尚未得到回复。</p>}
     {replacement.length>1&&<p className='text-[11px] text-amber-700'>旧向量按组存储。确认后重建所选楼层，其余旧归档楼层恢复原文。</p>}
     <div ref={rangeActions} className='space-y-2'>
     {rangeBusy&&<p role='status' aria-live='polite' className='py-1 text-sm text-slate-700'>{progressText}</p>}
     {rangeFailure&&<div role='alert' className='rounded-lg border border-rose-200 bg-rose-50/70 p-3 text-sm'>
      <p className='font-semibold text-rose-700'>{failureTitle}{failedBatch&&' · 第 '+failedBatch.first+(failedBatch.last===failedBatch.first?'':'–'+failedBatch.last)+' 楼'}</p>
      <p className='mt-1 text-xs text-slate-700'>原文和旧归档已保留。{completedBatches.current.size>0?'本次已完成的总结可继续使用。':''}</p>
      {rangeProgress?<details className='mt-1 text-xs leading-5 text-slate-600'>
       <summary className='flex min-h-8 cursor-pointer items-center'>查看原因</summary>
       <p className='break-words'>{rangeFailure}</p>
      </details>:<p className='mt-1 break-words text-xs text-slate-700'>{rangeFailure}</p>}
     </div>}
     <button type='button' onClick={()=>void saveRange()} disabled={blocked||!chosenFloors.length||overlaps||includesPending}
      className='flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white disabled:opacity-40'>
      {rangeBusy&&<SpinnerGap size={16} className='animate-spin'/>}{rangeBusy?'整理中…':rangeFailure?(rangeProgress?.phase==='index'?'重试建向量':completedBatches.current.size?'继续整理':'重试整理'):'开始整理'}
     </button>
     </div>
    </section>}
    {error&&<p role='alert' className='text-xs leading-5 text-rose-600'>{error}</p>}
    {status&&<p role='status' className='text-xs leading-5 text-violet-700'>{status}</p>}
    <div hidden={hasTabs&&showingArchives}>{children}</div>
    <div hidden={!showingArchives} className='space-y-3'>
    {!boxes.length&&<p className='py-3 text-center text-xs text-slate-500'>{floors===null?'正在读取楼层…':'暂无归档，点击右上角添加楼层'}</p>}
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
    {showingArchives&&(visibleBoxes.length?archiveRows:boxes.length>0&&<p className='py-4 text-sm text-slate-600'>没有匹配的归档</p>)}
    </div>
   </div>
  </main>
 </div>;
}
