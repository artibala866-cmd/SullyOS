import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import StoryRegexPanel from '../components/date/story/StoryRegexPanel';
import { OSPreviewProvider } from '../context/OSContext';
import type { StoryRegexRule } from '../utils/storyRegex';

const scenario = new URLSearchParams(location.search).get('view') || 'beauty-list';
const names = ['小法庭','豆包','弹幕','刮彩票','微信红包','番茄小剧场'];
const bans = ['核心指令','词汇级禁令','句式级禁令','环境描写禁令','人物细节禁令','言情八股禁令','结尾禁令'];
const initial: StoryRegexRule[] = [
  ...names.map((name, i): StoryRegexRule => ({
    id:'beauty-'+i, name, enabled:true, kind:'template', domain:'online', presetId:'',
    pattern:'<card>([\\s\\S]*?)</card>', flags:'g',
    replacement:'<div class="chat-card">卡片代码 '+name+' {{$1}}</div>',
    display:true, history:false, instruction:'', parseMode:'text',
    importGroup:'糯叽叽 HTML 模板 6 则',
  })),
  ...bans.map((name, i): StoryRegexRule => ({
    id:'rules-'+i, name:'WS8.3-'+name, enabled:i!==5, kind:'filter', domain:'offline', presetId:'',
    pattern:'<think>[\\s\\S]*?</think>', flags:'g', replacement:'', display:true,
    history:i===0, instruction:i===0?'减少套路化描写':'',
    importGroup:'7.5 八股正则补丁', source:{category:'八股净化'},
  })),
];
function App(){
  const [rules,setRules]=useState(initial);
  const section = scenario === 'rules-list' || scenario === 'rules-edit' ? 'rules' : 'beauty';
  return <OSPreviewProvider value={{registerBackHandler:()=>()=>{}} as any}>
    <StoryRegexPanel domain='offline' section={section} rules={rules} presets={[]}
      onSave={async change=>setRules(old=>change(old))} onBack={()=>{}}/>
  </OSPreviewProvider>;
}
createRoot(document.getElementById('visual')!).render(<App/>);

const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(check:()=>boolean,label:string){
  for(let i=0;i<110;i++){if(check())return;await sleep(40);}
  throw new Error('管理器检查失败：'+label);
}
async function run(){
  await waitFor(()=>!!document.querySelector('nav[aria-label="正则分类"]'),'分类导航');
  const tabs=[...document.querySelectorAll<HTMLButtonElement>('nav[aria-label="正则分类"] button')];
  if(tabs.length!==2 || !tabs[0].textContent?.includes('HTML 美化') ||
      !tabs[1].textContent?.includes('规则')) throw Error('美化及规则入口缺失');
  // Actual tabs must be reachable EVEN from offline story/meeting.
  const uploadInput=document.querySelector<HTMLInputElement>('input[type=file][accept*=".html"]');
  if(!uploadInput) throw Error('没有 HTML 导入入口');
  if(scenario==='beauty-list'||scenario==='rules-list'){
    const expected=scenario==='beauty-list'?6:7;
    const nodes=document.querySelectorAll('[data-alchemy-rule]');
    if(nodes.length!==expected)throw Error('分组规则数量不对：'+nodes.length);
  } else if(scenario==='beauty-edit'||scenario==='rules-edit') {
    const folders=document.querySelectorAll<HTMLDetailsElement>('[data-alchemy-folders] > div > details');
    folders.forEach(detail=>{detail.open=true;});
    await sleep(80);
    document.querySelectorAll<HTMLDetailsElement>('[data-alchemy-category]').forEach(item=>{
      const detail=item.closest('details');if(detail)detail.open=true;
    });
    await sleep(80);
    const first=document.querySelector<HTMLButtonElement>('[data-alchemy-rule] button');
    first?.click();
  } else if(scenario==='import-raw-html'||scenario==='import-json-html'){
    const raw=scenario==='import-raw-html';
    const file=raw?new File([
      '<style>.gift{padding:8px}</style><div class="gift">导入的 HTML {{$1}}</div>',
      ],'漂亮的聊天卡片.html',{type:'text/html'}):
      new File([JSON.stringify([{
        name:'新导入的 HTML 卡片', pattern:'<gift>([\\s\\S]*?)</gift>',
        isHtmlTemplate:true, htmlTemplate:'<div class="gift">JSON 导入的 HTML {{$1}}</div>',
        flags:'g', applyOnDisplay:true,
      }])],'HTML模板批量导入.json',{type:'application/json'});
    const dt=new DataTransfer();dt.items.add(file);uploadInput.files=dt.files;
    uploadInput.dispatchEvent(new Event('change',{bubbles:true}));
    if(!raw){
      await waitFor(()=>!![...document.querySelectorAll<HTMLButtonElement>('button')]
        .find(button=>button.textContent?.trim()==='导入'), '导入确认');
      [...document.querySelectorAll<HTMLButtonElement>('button')].find(button=>
        button.textContent?.trim()==='导入')!.click();
      await waitFor(()=>!!document.querySelector('[data-alchemy-folder]'), '导入完成');
      const tab=tabs[0];
      if(tab.getAttribute('aria-pressed')!=='true')throw Error('HTML 导入后没有转到美化分类');
      const groups=document.querySelectorAll<HTMLDetailsElement>('[data-alchemy-folders] > div > details');
      groups.forEach(detail=>{detail.open=true;});
      await sleep(60);
      document.querySelectorAll<HTMLDetailsElement>('[data-alchemy-category]').forEach(item=>{
        const detail=item.closest('details');if(detail)detail.open=true;
      });
      await sleep(60);
      const row=[...document.querySelectorAll<HTMLElement>('[data-alchemy-rule]')]
        .find(node=>node.dataset.alchemyRule==='新导入的 HTML 卡片');
      row?.querySelector<HTMLButtonElement>('button')?.click();
    }
  }
  if(['beauty-edit','rules-edit','import-raw-html','import-json-html'].includes(scenario)){
    await waitFor(()=>!!document.querySelector<HTMLTextAreaElement>('#alchemy-source'),'源码编辑区');
    const code=document.querySelector<HTMLTextAreaElement>('#alchemy-source')!;
    if(scenario!=='rules-edit' && !code.value.includes('HTML') && !code.value.includes('卡片代码'))
      throw Error('HTML 实际代码不在编辑器');
    if(scenario!=='rules-edit' && code.getBoundingClientRect().top>650)
      throw Error('HTML 代码被挤到屏幕下面');
    if(scenario!=='rules-edit'){
      await waitFor(()=>!!document.querySelector<HTMLIFrameElement>(
        '[data-alchemy-live-preview] iframe[sandbox="allow-scripts"]'),'HTML 自动可视化效果');
      const frame=document.querySelector<HTMLIFrameElement>('[data-alchemy-live-preview] iframe')!;
      if(!frame.srcdoc.includes('HTML') && !frame.srcdoc.includes('卡片代码'))
        throw Error('预览没有真实 HTML 卡片内容');
      if(document.querySelector('button')?.textContent?.includes('试跑'))
        throw Error('HTML 预览不应要求手动点击试跑');
      const nativeSetter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')?.set;
      if(!nativeSetter)throw Error('无法编辑 HTML 源码');
      const updated=code.value+'<b>实时修改已生效</b>';
      nativeSetter.call(code,updated);
      code.dispatchEvent(new Event('input',{bubbles:true}));
      await waitFor(()=>document.querySelector<HTMLIFrameElement>(
        '[data-alchemy-live-preview] iframe')?.srcdoc.includes('实时修改已生效')||false,
        '修改源码后自动更新可视化');
    }
    if(!document.querySelector('button')?.getAttribute('aria-label') && !document.querySelector('h1'))
      throw Error('原始编辑头部缺失');
  }
  document.body.dataset.alchemyManagerReady='true';
  document.body.dataset.alchemyManagerScenario=scenario;
}
void run().catch(error=>{
  document.body.dataset.alchemyManagerReady='false';
  document.body.dataset.alchemyManagerError=String(error);
});
