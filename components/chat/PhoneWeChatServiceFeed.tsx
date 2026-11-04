import React from 'react';
import {CaretRight, Newspaper} from '@phosphor-icons/react';
import type {PhoneMessage} from '../../utils/characterPhoneIdentity';

/** Only layout classification. Legacy threads without a subtype remain compatible. */
export type PhoneServiceFeedKind='official'|'service';
export function resolvePhoneServiceFeedKind(thread:{
  name:string;contactId?:string;kind?:string;serviceType?:PhoneServiceFeedKind;
}):PhoneServiceFeedKind{
  if(thread.serviceType==='official'||thread.serviceType==='service')return thread.serviceType;
  const label=[thread.name,thread.contactId||''].join(' ');
  return /公众号|订阅号|官方号|新闻|资讯|日报|周刊|杂志|报刊|文摘|看一看|财闻|热点|书评|文化观察|时事|快讯/i.test(label)
    ?'official':'service';
}
type FeedEntry={id:number;title:string;source:string;time:string;raw:string};
const shortTitle=(s:string)=>{
  const original=s.trim().replace(/\s+/g,' ');
  return original.replace(/^(?:通知|【消息】|【推送】|快讯)[:：\s]*/,'').trim()||original;
};
function formatTime(ms?:number){
  if(!ms||!Number.isFinite(ms))return '';
  const d=new Date(ms);
  if(!Number.isFinite(d.getTime()))return '';
  return d.toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
}
function entriesOf(messages:PhoneMessage[],name:string):FeedEntry[]{
  return messages.filter(m=>m.text&&m.text.trim()).map((m,i)=>({
    id:i,title:shortTitle(m.text),source:name,
    time:formatTime(m.createdAt),raw:m.text.trim(),
  })).reverse();
}
/** Explicit neutral placeholders, not generated pictures or remote photos. */
function GrayImage({className='',testId}:{className?:string;testId?:string}){
  return <div data-testid={testId||'service-gray-placeholder'} aria-label="图片占位"
    className={'shrink-0 bg-[#e7e7e7] '+className}/>;
}
function ServiceFeed({items,name}:{items:FeedEntry[];name:string}){
  const first=items[0];const remainder=items.slice(1);
  if(!first)return <div data-testid="phone-service-feed" className="min-h-full bg-[#f8f8f8]"/>;
  return <div data-testid="phone-service-feed" className="min-h-full bg-[#f8f8f8] px-[8px] pb-9 pt-4 text-[#191919]">
    <section aria-label="通知" className="px-3">
      <h3 className="mb-5 text-[17px] font-semibold">通知</h3>
      <div className="border-t border-[#ededed] pt-4"/>
    </section>
    {first&&<div className="overflow-hidden rounded-[12px] bg-white px-4 py-5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 break-words text-[17px] font-medium leading-[26px]">{first.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-[#a7a7a7]">
            <span className="max-w-[140px] truncate">{name}</span>
            <span>{first.time}</span>
          </div>
        </div>
        <GrayImage testId="service-notice-cover" className="h-[74px] w-[74px] rounded-[5px]"/>
      </div>
    </div>}
    {remainder.length>0&&<>
    <div className="mt-7 flex items-center justify-between px-3 pb-3">
      <h3 className="text-[17px] font-semibold">贴图</h3>
      <div className="flex items-center gap-4 text-[14px]">
        <span className="border-b-2 border-[#222] pb-1 text-[#222]">推荐</span><span className="pb-1 text-[#969696]">关注</span>
      </div>
    </div>
    <div className="grid grid-cols-2 items-start gap-2">
      {remainder.map((item,i)=><article key={item.id} data-testid="service-feed-tile"
        className="overflow-hidden rounded-[9px] bg-white">
        <GrayImage className={'w-full '+(i%3===1?'aspect-[4/3]':'aspect-[3/4]')}/>
        <div className="px-2.5 pb-3 pt-2">
          <p className="line-clamp-3 break-words text-[13px] font-medium leading-5">{item.title}</p>
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-[#999]">
            <span className="h-[13px] w-[13px] rounded-full bg-[#e1e1e1]"/><span className="min-w-0 truncate">{item.source}</span>
          </div>
        </div>
      </article>)}
    </div></>}
  </div>;
}
function OfficialFeed({items,name}:{items:FeedEntry[];name:string}){
  const news=items[0];const older=items.slice(1);
  if(!news)return <div data-testid="phone-official-feed" className="min-h-full bg-[#ededed]"/>;
  return <div data-testid="phone-official-feed" className="min-h-full bg-[#ededed] px-[8px] pb-9 pt-3 text-[#161616]">
    {news&&<div className="overflow-hidden rounded-[12px] bg-white px-4 py-4">
      <div className="flex items-center gap-2 text-[14px] text-[#65738b]">
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#ef6c68] text-white">
          <Newspaper size={11} weight="fill"/>
        </span><span className="font-medium">快讯</span>
        <span aria-hidden="true" className="ml-auto flex h-4 w-4 items-center justify-center rounded-full border border-[#ddd] text-[11px] text-[#ccc]">×</span>
      </div>
      <div className="mt-5 flex items-center gap-3 pb-4">
        <div className="min-w-0 flex-1">
          <p className="line-clamp-3 break-words text-[17px] leading-[26px]">{news.title}</p>
          <p className="mt-1 truncate text-[12px] text-[#a6a6a6]">{name}　{news.time}</p>
        </div>
        <GrayImage testId="official-news-cover" className="h-[64px] w-[64px] rounded-[4px]"/>
      </div>
      {older.length>0&&<div className="flex items-center justify-between border-t border-[#ededed] pt-3 text-[13px] text-[#68768b]">
        <span>查看其余{older.length}条</span><CaretRight size={16} className="text-[#bbb]"/>
      </div>}
    </div>}
    {older.length>0&&<>
      <p className="my-7 flex items-center justify-center gap-1 text-[12px] text-[#b1b1b1]">更多消息 <CaretRight size={15}/></p>
      <h3 className="mb-5 pl-2 text-[17px] font-semibold">看一看</h3>
      <div className="mb-2.5 overflow-hidden rounded-[11px] bg-white px-4 py-4">
        <p className="line-clamp-3 break-words text-[17px] leading-[25px]">{older[0].title}</p>
        <div className="mt-3 grid grid-cols-3 gap-[5px]">
          <GrayImage className="aspect-[1.12] w-full rounded-[2px]"/>
          <GrayImage className="aspect-[1.12] w-full rounded-[2px]"/>
          <GrayImage className="aspect-[1.12] w-full rounded-[2px]"/>
        </div>
        <p className="mt-2.5 text-[12px] text-[#b1b1b1]">{name}</p>
      </div>
      <div className="grid grid-cols-2 items-start gap-2">
        {older.slice(1).map((item,i)=><article key={item.id} data-testid="official-article-tile"
          className="overflow-hidden rounded-[9px] bg-white">
          <GrayImage className={'w-full '+(i%2?'aspect-[4/5]':'aspect-[3/4]')}/>
          <div className="px-2.5 pb-3 pt-2">
            <p className="line-clamp-3 break-words text-[13px] leading-5">{item.title}</p>
            <p className="mt-2 truncate text-[11px] text-[#a3a3a3]">{name}</p>
          </div>
        </article>)}
      </div>
    </>}

  </div>;
}
export default function PhoneWeChatServiceFeed({messages,name,kind}:{
  messages:PhoneMessage[];name:string;kind:PhoneServiceFeedKind;
}){
  const items=entriesOf(messages,name);
  return kind==='official'
    ?<OfficialFeed items={items} name={name}/>
    :<ServiceFeed items={items} name={name}/>;
}
