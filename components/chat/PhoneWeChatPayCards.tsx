import React from 'react';
import {CaretRight, Check, Receipt} from '@phosphor-icons/react';
import type {PhoneMessage} from '../../utils/characterPhoneIdentity';

export type WeChatPayNotice = {
  merchant:string;
  amount:string;
  direction:'支出'|'收入';
  detail:string;
};

/** Read the existing stored notice. Never invent a transaction, merchant, or card number. */
export function parseWeChatPayNotice(text:string):WeChatPayNotice|null {
  const match=text.trim().match(/^微信支付通知\s*[:：]\s*(.+?)\s*[·•]\s*(支出|收入)\s*[¥￥]\s*([\d,]+(?:\.\d{1,2})?)\s*[;；]?\s*([\s\S]*)$/);
  if(!match)return null;
  const merchant=match[1].trim();
  const raw=Number(match[3].replace(/,/g,''));
  if(!merchant||!Number.isFinite(raw)||raw<=0)return null;
  return {merchant,amount:raw.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}),
    direction:match[2] as '支出'|'收入',detail:match[4].trim()};
}

function timeOf(timestamp:number|undefined):string {
  if(!timestamp||!Number.isFinite(timestamp))return '';
  const date=new Date(timestamp);
  if(!Number.isFinite(date.getTime()))return '';
  return date.toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
}

/** Read-only WeChat Pay service conversation; card dimensions and spacing follow WeChat's transaction notices. */
export default function PhoneWeChatPayCards({messages}:{messages:PhoneMessage[]}) {
  return <div className="min-h-full bg-[#ededed] px-4 pb-8 pt-5 text-[#1d1d1d]" data-testid="wechat-pay-cards">
    {messages.map((message,index)=>{
      const record=parseWeChatPayNotice(message.text||'');
      const clock=timeOf(message.createdAt);
      const preceding=timeOf(messages[index-1]?.createdAt);
      const showTime=!!clock&&(index===0||clock!==preceding);
      const received=record?.direction==='收入';
      return <React.Fragment key={index}>
        {showTime&&<p className="pb-4 pt-3 text-center text-[12px] font-normal text-[#a5a5a5]">{clock}</p>}
        <article data-testid="wechat-pay-card" className="mb-5 w-full overflow-hidden rounded-[12px] bg-white">
          <div className="flex min-h-[57px] items-center gap-3 border-b border-[#ededed] px-4 py-3">
            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#20b46a] text-[19px] font-semibold text-white">¥</span>
            <span className="min-w-0 flex-1 break-words text-[15px] font-semibold leading-5 text-[#202020]">{record?.merchant||'微信支付'}</span>
          </div>
          {record ? <>
            <div className="flex flex-col items-center px-4 pb-5 pt-7 text-center">
              <span className="text-[17px] text-[#252525]">{received?'收款成功':'微信支付成功'}</span>
              <strong className="mt-5 break-all text-[36px] font-semibold leading-none tracking-[-.03em] tabular-nums text-black">¥{record.amount}</strong>
              <span className="mt-5 rounded-[5px] bg-[#e7f8ef] px-2.5 py-1 text-[12px] text-[#34ae75]">
                <Check size={13} weight="bold" className="mr-1 inline-block align-[-2px]"/>{received?'已收款':'支付成功'}
              </span>
              <span className="mt-5 flex items-center gap-1 text-[13px] text-[#999]">交易详情 <CaretRight size={13}/></span>
            </div>
            <div className="space-y-3 px-4 pb-5 text-[13px] leading-[20px]">
              {clock&&<div className="flex gap-4"><span className="w-[70px] shrink-0 text-[#999]">交易时间</span><span className="min-w-0 flex-1 text-[#333]">{clock}</span></div>}
              {record.detail&&<div className="flex gap-4"><span className="w-[70px] shrink-0 text-[#999]">商品说明</span><span className="min-w-0 flex-1 break-words text-[#333]">{record.detail}</span></div>}
            </div>
            <div className="flex min-h-[52px] items-center justify-between border-t border-[#ededed] px-4 text-[14px]">
              <span>查看商家订单</span><CaretRight size={17} color="#b7b7b7"/>
            </div>
          </> : <div className="px-4 py-6">
            <div className="mb-3 flex items-center gap-2 text-[#777]"><Receipt size={18}/><span className="text-[13px]">服务通知</span></div>
            <p className="whitespace-pre-wrap break-words text-[15px] leading-7">{message.text}</p>
          </div>}
        </article>
      </React.Fragment>;
    })}
    {!messages.length&&<p className="pt-20 text-center text-sm text-[#999]">暂无支付通知</p>}
  </div>;
}
