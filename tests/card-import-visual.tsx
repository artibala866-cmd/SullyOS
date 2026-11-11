/* Screenshots of the ACTUAL Character.tsx import modal.
 * No personal cards are copied to the repository: synthetic CCv3 and Link PNG fixtures
 * reproduce the real sample shapes (13 lore entries / 26 greetings / Link 0 books). */
import React from 'react';
import {createRoot} from 'react-dom/client';
import Character from '../apps/Character';
import {OSPreviewProvider} from '../context/OSContext';
import {normalizeCharacterCard} from '../utils/sillyTavernCard';
import {normalizeBabyLinkShare} from '../utils/babyLinkCard';

const query=new URLSearchParams(location.search);
const source=query.get('source')||'tavern';
const observed: string[]=[];
addEventListener('error',e=>observed.push(e.message));
addEventListener('unhandledrejection',e=>observed.push(String(e.reason)));
const sampleTavern=source==='remark-tavern'
  ?normalizeCharacterCard({spec:'chara_card_v3',spec_version:'3.0',data:{
      name:'季淮北',description:'关于季淮北的完整人设，必须只留在 AI 上下文',
      personality:'沉稳',first_mes:'雪夜见面'}}).character:null;
const sampleLink=source==='remark-link'
  ?normalizeBabyLinkShare({magic:'LINK_CHARACTER_SHARE_PNG_V1',version:1,
      characters:[{name:'季淮北',nickname:'阿北',
        description:'Link 人设详细设定，不允许进入备注',
        signature:'签名内容不允许进入备注',avatar:'',localWorldBookIds:[]}],worldBooks:[]}).cards[0].character:null;
const importedRemarkRole=sampleTavern||sampleLink;
const role={id:'fixture-original',name:source.startsWith('link')?'车恩熙':'谢嬴',
 avatar:'',description:'原有简介',systemPrompt:'原有稳定人设',memories:[],
 mountedWorldbooks:[],tavernGreetings:[],...(importedRemarkRole||{})} as any;
const os={
  closeApp:()=>{},openApp:()=>{},characters:[role],activeCharacterId:role.id,
  setActiveCharacterId:()=>{},addCharacter:async()=>role,updateCharacter:()=>{},
  deleteCharacter:async()=>({status:'deleted'}),characterGroups:[],createCharacterGroup:()=>{},
  renameCharacterGroup:()=>{},deleteCharacterGroup:()=>{},apiConfig:{},addToast:(message:string)=>observed.push('toast:'+message),
  userProfile:{name:'玩家'},worldbooks:[],addWorldbook:()=>{},theme:{},
  memoryPalaceConfig:{},remoteVectorConfig:{},
} as any;
createRoot(document.getElementById('root')!).render(<OSPreviewProvider value={os}><Character/></OSPreviewProvider>);

const v3={
 spec:'chara_card_v3',spec_version:'3.0',
 data:{
  name:'谢嬴',description:'用于画面检查的示例人物背景',personality:'冷静沉稳',
  first_mes:'欢迎来到故事',alternate_greetings:Array.from({length:25},(_,i)=>'备选开场 '+(i+1)),
  character_book:{entries:Array.from({length:13},(_,i)=>({
    id:i,comment:'设定条目 '+(i+1),content:'设定内容 '+(i+1),
    keys:[],constant:true,position:'after_char',extensions:{position:1},
  }))},
 }
};

async function makeLinkPng():Promise<File>{
  const payload=JSON.stringify({magic:'LINK_CHARACTER_SHARE_PNG_V1',version:1,
    characters:[{name:'车恩熙',description:'这里是用于截图回归的角色背景，不包含真实角色卡内容。',signature:'',
      nickname:'车恩熙',avatar:'',localWorldBookIds:[],
      ...(source==='link-openings'?{openings:[
        {id:'native-one',title:'车站相遇',description:'Link 原生场景',opening:'{{char}}在车站等{{user}}。'},
        {id:'native-two',title:'午夜回信',content:'<!-- Link 正文注释 -->\\n她拆开信封。'},
      ]}:{})}],worldBooks:[]});
  const stream=new Blob([payload]).stream().pipeThrough(new CompressionStream('gzip'));
  const compressed=new Uint8Array(await new Response(stream).arrayBuffer());
  const packed=new Uint8Array(4+compressed.length);
  new DataView(packed.buffer).setUint32(0,compressed.length,false);
  packed.set(compressed,4);
  const canvas=document.createElement('canvas'); canvas.width=360;canvas.height=480;
  const ctx=canvas.getContext('2d',{willReadFrequently:true})!;
  ctx.fillStyle='#e9e9e9';ctx.fillRect(0,0,canvas.width,canvas.height);
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
  for(let bit=0;bit<packed.length*8;bit++){
    const pos=Math.floor(bit/3),channel=bit%3;
    pixels.data[pos*4+channel]=(pixels.data[pos*4+channel]&254)|
      ((packed[bit>>3]>>(7-(bit%8)))&1);
  }
  ctx.putImageData(pixels,0,0);
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('PNG encoding failed')),'image/png'));
  return new File([blob],'link-qa.png',{type:'image/png'});
}
function box(element:Element|null){
  if(!element)return null;const r=element.getBoundingClientRect();
  return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height),bottom:Math.round(r.bottom),right:Math.round(r.right)};
}
async function run(){
 try{
  // Open the actual 神经链接 role detail, not a recreated remark field.
  // Persona must remain in systemPrompt while the remark input is blank
  // for Tavern and exactly nickname for Link.
  if(source.startsWith('remark-')){
    const want=source==='remark-tavern'?'':'阿北';
    let card:HTMLElement|null=null;
    for(let n=0;n<100&&!card;n++){
      const title=[...document.querySelectorAll('h3')].find(x=>x.textContent?.trim()==='季淮北');
      card=title?.closest<HTMLElement>('.cursor-pointer')||null;
      if(!card)await new Promise(r=>setTimeout(r,80));
    }
    if(!card)throw Error('Character card row not found');
    card.click();
    let input:HTMLInputElement|null=null;
    for(let n=0;n<100&&!input;n++){
      input=document.querySelector<HTMLInputElement>('input[aria-label="输入备注"]');
      if(!input)await new Promise(r=>setTimeout(r,80));
    }
    if(!input)throw Error('Real Neural Link remark input not mounted');
    const result={source,viewport:[innerWidth,innerHeight],
      remark:input.value,expected:want,
      placeholder:input.placeholder,
      personaSaved:role.systemPrompt.includes(source==='remark-tavern'
        ?'关于季淮北的完整人设':'Link 人设详细设定'),
      noOverflowX:document.documentElement.scrollWidth<=innerWidth+2,
      inputVisible:input.getBoundingClientRect().width>40,
      errors:observed.filter(v=>!v.startsWith('toast:'))};
    document.body.dataset.cardImportVisualReady=String(
      result.remark===want&&result.personaSaved&&result.inputVisible&&
      result.noOverflowX&&!result.errors.length);
    document.getElementById('qa-report')!.textContent=JSON.stringify(result);
    return;
  }
  const input=await new Promise<HTMLInputElement>((resolve,reject)=>{
   let n=0;const poll=()=>{
     const node=document.querySelector<HTMLInputElement>('input[type=file][accept*=".json"]');
     if(node)return resolve(node);
     if(++n>100)return reject(Error('Import input not mounted'));
     setTimeout(poll,80);
   };poll();
  });
  const file=source.startsWith('link')?await makeLinkPng():
    source==='document'?new File(['完整人物人设。\n独立角色背景保持不拆分。'],'自定义角色人设.txt',{type:'text/plain'}):
    new File([JSON.stringify(v3)],'tavern-qa.json',{type:'application/json'});
  const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;
  input.dispatchEvent(new Event('change',{bubbles:true}));
  let steps=0;
  const poll=()=>{
    const heading=[...document.querySelectorAll('h3')].find(x=>x.textContent?.includes('导入'));
    if(!heading && steps++<100)return setTimeout(poll,100);
    const labels=['人设','世界书','开场白'];
    const inputs=labels.map(t=>document.querySelector<HTMLInputElement>('input[aria-label="导入'+t+'"]'));
    const states=inputs.map(x=>({present:!!x,disabled:x?.disabled,checked:x?.checked,rect:box(x||null)}));
    const modal=heading?.closest('.fixed');
    const modalDialog=modal?.querySelector('.relative');
    const footer=[...modal?.querySelectorAll('button')||[]].find(x=>x.textContent?.includes('确认导入'));
    const content=modal?.querySelector('.overflow-y-auto');
    const windowHeight=innerHeight;
    const footerBox=box(footer||null);
    const layout={
      source, viewport:[innerWidth,innerHeight],
      sectionStates:states,modal:box(modalDialog||null),footer:footerBox,
      content:box(content||null),
      overflowX:document.documentElement.scrollWidth-innerWidth,
      modalScroll:content?content.scrollHeight-content.clientHeight:0,
      footerVisible:!!footerBox&&footerBox.bottom<=windowHeight+2&&footerBox.y>=0,
      modalVisible:!!modalDialog&&!!modal&&!!footerBox,
      // A Link V1 PNG without an openings payload must not be described as a
      // character with no opening; the app may store it outside the export.
      omissionExplained:source!=='link'||Boolean(modal?.textContent?.includes('分享包缺少部分开场白')
          &&modal?.textContent?.includes('本地内容会保留')),
      documentPersonaVisible:source!=='document'||Boolean(
        modal?.textContent?.includes('自定义角色人设') &&
        states[0]?.checked&&!states[1]?.checked&&!states[2]?.checked),
      linkOpeningsRecognized:source!=='link-openings'||Boolean(
        modal?.textContent?.includes('独立开场白：2 条') &&
        states[2]?.checked &&
        modal?.textContent?.includes('开场白')),
      allCheckedDefault:source==='link'||source==='document'?states[0]?.checked&&!states[1]?.checked&&!states[2]?.checked:
          source==='link-openings'?states[0]?.checked&&!states[1]?.checked&&states[2]?.checked:
          states.every(x=>x.checked),
      amountString:(modal?.textContent||'').match(/世界书\s*13\s*条|世界书\s*0\s*条/)?.[0]||'',
      errors:observed.filter(v=>!v.startsWith('toast:')),
    };
    (document.body.dataset as any).cardImportVisualReady=String(
      layout.modalVisible&&layout.allCheckedDefault&&layout.omissionExplained&&layout.linkOpeningsRecognized&&layout.documentPersonaVisible&&layout.footerVisible&&
      layout.overflowX<=2&&states.every(x=>x.present)&&
      (source==='link'||source==='document'?states[1].disabled&&states[2].disabled:
        source==='link-openings'?states[1].disabled&&!states[2].disabled:states.every(x=>!x.disabled))&&
      !layout.errors.length
    );
    const report=document.getElementById('qa-report')!;report.textContent=JSON.stringify(layout);
  };poll();
 } catch(error){
  document.body.dataset.cardImportVisualReady='false';
  document.getElementById('qa-report')!.textContent=String(error instanceof Error?error.stack:error);
 }
}
setTimeout(()=>{void run()},250);
