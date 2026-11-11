import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import AlchemyRuleFolders from '../components/alchemy/AlchemyRuleFolders';
import type { StoryRegexRule } from '../utils/storyRegex';
import { alchemyRulesFor, type AlchemyDomain } from '../utils/alchemyRegex';
const domain: AlchemyDomain = new URLSearchParams(location.search).get('domain') === 'offline' ? 'offline' : 'online';
const templateNames = ['小法庭','豆包','弹幕','刮彩票','微信红包','番茄小剧场'];
const filterNames = ['WS8.3-核心指令','WS8.3-词汇级禁令','WS8.3-句式级禁令','WS8.3-环境描写禁令','WS8.3-人物细节禁令','WS8.3-言情八股禁令','WS8.3-结尾禁令'];
const initial: StoryRegexRule[] = [
 ...templateNames.map((name, i): StoryRegexRule => ({
  id:'beauty-'+i,name,enabled:true,presetId:'',kind:'template',domain:'online',pattern:'<tag>(.*?)</tag>',flags:'g',
  replacement:'<div>{{$1}}</div>',display:true,history:false,instruction:'',
  importGroup:'糯叽叽 HTML 模板 6 则',subcategory:i>3?'红包与剧情':'互动卡片',
 })),
 ...filterNames.map((name, i): StoryRegexRule => ({
  id:'rules-'+i,name,enabled:i!==5,presetId:'',kind:'filter',domain:'offline',pattern:'坏词',flags:'g',
  replacement:'',display:true,history:false,instruction:i===0?'角色指令':'',
  importGroup:'7.5 八股正则补丁',subcategory:i===0?'核心指令':i<4?'词句清理':'叙事表达',
 })),
];
function Visual(){
 const [rules,setRules] = useState(initial);
 const [opened,setOpened] = useState('');
 const filtered=useMemo(()=>alchemyRulesFor(rules,domain),[rules]);
 const expect=domain==='online'?6:7;
 const active=filtered.filter(r=>r.enabled).length;
 const toggle=(rule:StoryRegexRule)=>setRules(old=>old.map(r=>r.id===rule.id?{...r,enabled:!r.enabled}:r));
 const cross=alchemyRulesFor(rules,domain==='online'?'offline':'online');
 React.useEffect(()=>{
  const found=document.querySelectorAll('[data-alchemy-rule]').length;
  const folders=document.querySelectorAll('[data-alchemy-folder]').length;
  const cats=document.querySelectorAll('[data-alchemy-category]').length;
  document.body.dataset.alchemyScreenshotReady=String(found===expect&&folders===1&&cats>=2&&cross.length===(domain==='online'?6:6));
  const out=document.getElementById('alchemy-report');
  if(out)out.textContent=JSON.stringify({domain,count:found,folders,categories:cats,active,crossCount:cross.length,opened});
 },[rules,opened,active,cross.length]);
 return <main className="max-w-md mx-auto min-h-screen bg-stone-100">
  <header className="bg-white border-b border-slate-200 px-5 py-5">
   <div className="text-[11px] tracking-wide text-slate-400">糯米机 · 正则管理</div>
   <h1 className="font-bold text-[19px] mt-1">{domain==='online'?'美化类 · 私聊 / 群聊':'规则类 · 剧情 / 见面'}</h1>
   <div className="text-xs text-slate-500 mt-2">导入文件 → 小分类 → 单条规则</div>
  </header>
  <section className="p-4 space-y-3">
   <p className="px-1 text-[12px] text-slate-500">{filtered.length} 条规则 · {active} 条开启</p>
   <AlchemyRuleFolders rules={filtered} scopeName={()=>domain==='online'?'全部私聊 / 群聊':'全部剧情 / 见面'}
    onOpen={rule=>setOpened(rule.name)} onToggle={toggle}/>
   {opened&&<p className="rounded-xl bg-white px-4 py-3 text-xs text-slate-600">已打开：{opened}</p>}
   <p className="p-2 text-[11px] text-slate-400">两套分类独立显示；原始规则数据保持不变</p>
  </section>
  <output id="alchemy-report" hidden/>
 </main>;
}
createRoot(document.getElementById('visual')!).render(<Visual/>);