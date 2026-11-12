// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach,describe,expect,it,vi} from 'vitest';
import StoryTheaterEditor from '../components/date/story/StoryTheaterEditor';
import StoryPresetMaker from '../components/date/story/StoryPresetMaker';
import {BUILTIN_NIGHT_SCREENING_PRESET,createStoryTheaterDraft,parseStoryTheaterPreset} from './storyTheater';
import {DB} from './db';
vi.mock('../components/os/TokenImg',()=>({default:()=>null}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root|null=null,host:HTMLElement|null=null;
afterEach(async()=>{if(root)await act(async()=>root!.unmount());host?.remove();root=null;host=null;});
const valid=(rule:string)=>JSON.stringify({
 prompts:[{identifier:'rule',name:'规则',role:'system',content:rule}],
 prompt_order:[{character_id:100001,order:[{identifier:'rule',enabled:true}]}],
});
describe('真实剧情编辑器：多文件导入和错误恢复',()=>{
 it('3个文件中间一个损坏：批量选择、保存的ID和最后成功选中的预设一致',async()=>{
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  const char={id:'import-ui-char',name:'演员',avatar:'',mountedWorldbooks:[],memories:[],systemPrompt:'原指令'} as any;
  const savedIds:string[]=[];
  const onImport=vi.fn(async(file:File)=>{
   try{const doc=parseStoryTheaterPreset(await file.text(),file.name);
     await DB.saveStoryTheaterPreset(doc);savedIds.push(doc.id);return doc;}
   catch{return null;}
  });
  const onSave=vi.fn(async()=>{});
  // Mirror the parent state update from StoryTheater: the editor must receive
  // each newly imported preset as a new props value before final selection.
  const Wrapper=()=>{
   const [presets,setPresets]=React.useState([BUILTIN_NIGHT_SCREENING_PRESET]);
   return React.createElement(StoryTheaterEditor,{
    initial:{...createStoryTheaterDraft(),title:'批量导入后写剧情',characterIds:[char.id]},
    characters:[char],user:{name:'用户'} as any,masks:[],maskLocked:false,
    presets,onCancel:()=>{},onSave,
    onImportPreset:async file=>{
     const imported=await onImport(file);
     if(imported)setPresets(current=>[imported,...current]);
     return imported;
    },onEditPreset:()=>{},onOpenMaskBox:()=>{},
   });
  };
  await act(async()=>root!.render(React.createElement(Wrapper)));
  const picker=host!.querySelector<HTMLInputElement>('input[type=file][accept*=".json"]');
  expect(picker?.multiple).toBe(true);
  expect(picker?.accept).toContain('.json');
  const files=[new File([valid('第一份')],'第一份.json',{type:'application/json'}),
   new File(['{broken'],'损坏.json',{type:'application/json'}),
   new File([valid('第二份')],'第二份.json',{type:'application/json'})];
  // jsdom's File shim lacks Blob.text() on some runner versions; browsers have it.
  [valid('第一份'), '{broken', valid('第二份')].forEach((raw,i)=>{
   Object.defineProperty(files[i],'text',{configurable:true,value:async()=>raw});
  });
  Object.defineProperty(picker!,'files',{configurable:true,value:files});
  await act(async()=>{picker!.dispatchEvent(new Event('change',{bubbles:true}));});
  // IndexedDB commits on a later task; wait for the real third import rather
  // than assuming React act() awaits an async file input event handler.
  for(let attempt=0;attempt<30&&onImport.mock.calls.length<3;attempt++){
   await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
  }
  expect(onImport).toHaveBeenCalledTimes(3);
  expect(savedIds).toHaveLength(2);
  const button=[...host!.querySelectorAll('button')].find(b=>b.textContent?.trim()==='保存并进入');
  expect(button).toBeDefined();
  await act(async()=>button!.click());
  expect(onSave).toHaveBeenCalledTimes(1);
  expect((onSave.mock.calls[0] as any)[0].presetId).toBe(savedIds[1]);
  const persisted=await DB.getStoryTheaterPresets();
  expect(persisted.find(p=>p.id===savedIds[0])?.document.prompts[0].content).toBe('第一份');
  expect(persisted.find(p=>p.id===savedIds[1])?.document.prompts[0].content).toBe('第二份');
  expect(persisted.some(p=>p.sourceFileName==='损坏.json')).toBe(false);
  for(const id of savedIds)await DB.deleteStoryTheaterPreset(id);
 });

 it('真实 React 默认版：显示作者自己的选项，切换源提示词后保存数据库并重新打开',async()=>{
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  const items=[
   {identifier:'agency-head',name:'<==抢话▣▣权限==>',role:'system',content:''},
   {identifier:'agency-full',name:'▢完全',role:'system',content:'<rule name="演绎权限·5档">作者自己的完全接管。</rule>'},
   {identifier:'agency-none',name:'▢不抢',role:'system',content:'<rule name="演绎权限·1档">作者自己的不抢话。</rule>'},
   {identifier:'pov-head',name:'<==人称▣▣选1个==>',role:'system',content:''},
   {identifier:'pov-you',name:'▢上帝：user你',role:'system',content:'<rule name="上帝视角·User你">User用你。</rule>'},
   {identifier:'pov-i',name:'▢上帝：user我',role:'system',content:'<rule name="上帝视角·User我">User用我。</rule>'},
   {identifier:'style-head',name:'┏╔拖拖📚文风╗┓',role:'system',content:'<writing_style>'},
   {identifier:'style-auto',name:'📩随机适配📩',role:'system',content:'<writing_style:随机适配>作者随机文风。</writing_style>'},
   {identifier:'style-lemon',name:'🎵拖：柠檬糖',role:'system',content:'<writing_style:柠檬糖>作者柠檬糖文风。</writing_style>'},
   {identifier:'style-end',name:'┗╚拖拖📚文风╝┛',role:'system',content:'</writing_style>'},
  ];
  const on=new Set(['agency-head','agency-full','pov-head','pov-you','style-head','style-auto','style-end']);
  const preset=parseStoryTheaterPreset(JSON.stringify({
   temperature:1.05,top_p:.95,frequency_penalty:.4,presence_penalty:.3,
   prompts:items,prompt_order:[{character_id:100001,
    order:items.map(item=>({identifier:item.identifier,enabled:on.has(item.identifier)}))}],
  }),'宝宝我是char-原作者UI.json');
  const originalTexts=preset.document.prompts.map(p=>p.content);
  const saved=vi.fn(async(item:typeof preset)=>{await DB.saveStoryTheaterPreset(item);});
  await act(async()=>root!.render(React.createElement(StoryPresetMaker,{
   preset,onBack:()=>{},onSave:saved,onOpenCopy:async()=>{},onDelete:async()=>{},
  })));
  expect(host!.textContent).toContain('原作者的选项');
  expect(host!.textContent).toContain('抢话权限');
  expect(host!.textContent).toContain('人称选1个');
  expect(host!.textContent).toContain('拖拖文风');
  expect(host!.textContent).toContain('不抢');
  expect(host!.textContent).not.toContain('汽水日常');
  expect(host!.textContent).not.toContain('低烧 I');
  for(const field of ['温度','候选范围','重复惩罚','话题惩罚','最大输出'])
   expect(host!.textContent).toContain(field);
  // Inspect all source options in place, without switching to professional
  // mode or losing the original author-choice scroll position.
  const simpleScroll=host!.querySelector<HTMLElement>('main.story-page-scroll')!;
  simpleScroll.scrollTop=480;
  const preview=[...host!.querySelectorAll('button')].find(b=>b.textContent?.trim()==='查看原文');
  expect(preview).toBeDefined();
  await act(async()=>preview!.click());
  const inspector=host!.querySelector<HTMLElement>('[role="dialog"][aria-label="查看原作者原文"]');
  expect(inspector).not.toBeNull();
  expect(inspector!.textContent).toContain('作者自己的完全接管');
  const other=[...inspector!.querySelectorAll('button')].find(b=>b.textContent?.includes('不抢'));
  expect(other).toBeDefined();
  const inspectedScroll=inspector!.querySelector<HTMLElement>('.overscroll-contain')!;
  inspectedScroll.scrollTop=420;
  await act(async()=>other!.click());
  expect(inspectedScroll.scrollTop).toBe(0);
  expect(host!.querySelector('[role="dialog"] pre')?.textContent).toContain('作者自己的不抢话');
  expect(host!.textContent).toContain('原作选择');
  await act(async()=>host!.querySelector<HTMLButtonElement>('button[aria-label="返回原作选择"]')!.click());
  expect(host!.querySelector('[role="dialog"]')).toBeNull();
  expect(simpleScroll.scrollTop).toBe(480);
  const choice=host!.querySelector<HTMLButtonElement>('button[aria-label="抢话权限：不抢（未启用）"]');
  expect(choice).toBeDefined();
  await act(async()=>choice!.click());
  expect(host!.querySelector<HTMLButtonElement>('button[aria-label="抢话权限：不抢（已启用）"]')?.getAttribute('aria-pressed')).toBe('true');
  const saveButton=[...host!.querySelectorAll('button')].find(b=>b.textContent?.trim()==='保存');
  await act(async()=>saveButton!.click());
  expect(saved).toHaveBeenCalledTimes(1);
  const data=(saved.mock.calls[0] as any)[0] as typeof preset;
  expect(data.document.prompts.map(p=>p.content)).toEqual(originalTexts);
  expect(data.document.prompts.find(p=>p.id==='st-agency-full')?.enabled).toBe(false);
  expect(data.document.prompts.find(p=>p.id==='st-agency-none')?.enabled).toBe(true);
  expect(data.document.prompts.find(p=>p.id==='st-pov-you')?.enabled).toBe(true);
  expect(data.document.generation).toMatchObject({temperature:1.05,topP:.95,frequencyPenalty:.4,presencePenalty:.3});
  expect(data.document.tavernControls?.overrides).toEqual({});
  const persisted=(await DB.getStoryTheaterPresets()).find(p=>p.id===data.id)!;
  expect(persisted.document.prompts.find(p=>p.id==='st-agency-none')?.enabled).toBe(true);
  expect(persisted.document.prompts.find(p=>p.id==='st-agency-full')?.enabled).toBe(false);
  await DB.deleteStoryTheaterPreset(data.id);
  const pro=[...host!.querySelectorAll('button')].find(b=>b.textContent?.trim()==='专业版');
  await act(async()=>pro!.click());
  expect(host!.textContent).toContain('先选大区，再看细节');
  const professionalScroll=host!.querySelector<HTMLElement>('main.story-page-scroll')!;
  professionalScroll.scrollTop=360;
  const category=[...host!.querySelectorAll('button')].find(b=>
    b.textContent?.includes('抢话') && b.textContent?.includes('条有效'));
  expect(category).toBeDefined();
  await act(async()=>category!.click());
  expect(host!.textContent).toContain('返回大分类');
  expect(professionalScroll.scrollTop).toBe(0);
  const back=[...host!.querySelectorAll('button')].find(b=>b.textContent?.includes('返回大分类'));
  await act(async()=>back!.click());
  expect(professionalScroll.scrollTop).toBe(360);
  const simple=[...host!.querySelectorAll('button')].find(b=>b.textContent?.trim()==='默认版');
  await act(async()=>simple!.click());
  expect(host!.textContent).toContain('原作选择');
  expect(simpleScroll.scrollTop).toBe(480);
  await act(async()=>pro!.click());
  expect(host!.textContent).toContain('先选大区，再看细节');
  expect(professionalScroll.scrollTop).toBe(360);
 });


 it('隐藏空白与结构时不允许跨不可见条目排序；新增的空条目返回后仍可找到',async()=>{
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  const items=[
   {identifier:'head',name:'<==剧情▣▣排版==>',role:'system',content:''},
   {identifier:'open',name:'XML开',role:'system',content:'<chapter>'},
   {identifier:'first',name:'首个正文',role:'system',content:'前半部分'},
   {identifier:'gap',name:'空白插槽',role:'system',content:''},
   {identifier:'second',name:'第二正文',role:'system',content:'后半部分'},
   {identifier:'close',name:'XML闭合',role:'system',content:'</chapter>'},
   {identifier:'lite',name:'无效Lite占位',role:'system',content:'[Lite未包含此扩展.]'},
  ];
  const preset=parseStoryTheaterPreset(JSON.stringify({
   prompts:items,
   prompt_order:[{character_id:100001,order:items.map(item=>({identifier:item.identifier,enabled:true}))}],
  }),'原生结构保护.json');
  const originalIds=preset.document.prompts.map(x=>x.id);
  const saved=vi.fn(async()=>{});
  await act(async()=>root!.render(React.createElement(StoryPresetMaker,{
   preset,onBack:()=>{},onSave:saved,onOpenCopy:async()=>{},
  })));
  const pro=[...host!.querySelectorAll('button')].find(b=>b.textContent?.trim()==='专业版')!;
  await act(async()=>pro.click());
  const category=[...host!.querySelectorAll('button')].find(b=>
   b.textContent?.includes('剧情') && b.textContent?.includes('条有效'))!;
  expect(category).toBeDefined();
  await act(async()=>category.click());
  expect(host!.querySelector<HTMLButtonElement>('button[aria-label="首个正文：下移"]')).not.toBeNull();
  expect(host!.querySelector<HTMLButtonElement>('button[aria-label="首个正文：下移"]')!.disabled).toBe(true);
  expect(host!.querySelector<HTMLButtonElement>('button[aria-label="空白插槽：下移"]')).toBeNull();
  expect(host!.querySelector<HTMLButtonElement>('button[aria-label="无效Lite占位：下移"]')).toBeNull();
  await act(async()=>host!.querySelector<HTMLButtonElement>('button[aria-label="首个正文：下移"]')!.click());
  const show=[...host!.querySelectorAll('button')].find(b=>b.textContent?.trim()==='显示空条目')!;
  await act(async()=>show.click());
  expect(host!.querySelector<HTMLButtonElement>('button[aria-label="首个正文：下移"]')!.disabled).toBe(false);
  expect(host!.querySelector<HTMLButtonElement>('button[aria-label="空白插槽：下移"]')).not.toBeNull();
  const main=host!.querySelector<HTMLElement>('main.story-page-scroll')!;
  main.scrollTop=250;
  const add=[...host!.querySelectorAll('button')].find(b=>b.textContent?.includes('在本区新增提示词'))!;
  await act(async()=>add.click());
  expect(host!.textContent).toContain('返回提示词列表');
  const back=[...host!.querySelectorAll('button')].find(b=>b.textContent?.includes('返回提示词列表'))!;
  await act(async()=>back.click());
  expect(main.scrollTop).toBe(250);
  expect(host!.querySelector<HTMLButtonElement>('button[aria-label="新提示词：下移"]')).not.toBeNull();
  const save=[...host!.querySelectorAll('button')].find(b=>b.textContent?.trim()==='保存')!;
  await act(async()=>save.click());
  expect(saved).toHaveBeenCalledTimes(1);
  const after=(saved.mock.calls[0] as any)[0].document.prompts as Array<{id:string;content:string;enabled:boolean}>;
  expect(after.filter(item=>originalIds.includes(item.id)).map(item=>item.id)).toEqual(originalIds);
  expect(after.find(item=>item.id==='st-lite')?.content).toBe('[Lite未包含此扩展.]');
  expect(after.find(item=>item.id==='st-gap')?.enabled).toBe(true);
 });


 it('从作者元数据分组新增空提示词：仍在本组显示、可编辑和保存',async()=>{
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  const items=[
   {identifier:'opening',name:'包裹开头',role:'system',content:'<scene>'},
   {identifier:'body',name:'作者规则',role:'system',content:'重要正文'},
   {identifier:'ending',name:'包裹结尾',role:'system',content:'</scene>'},
  ];
  const preset=parseStoryTheaterPreset(JSON.stringify({
   prompts:items,
   prompt_order:[{character_id:100001,order:items.map(item=>({identifier:item.identifier,enabled:true}))}],
   extensions:{entryGrouping:[{id:'author-scene',name:'作者场景模块',memberIdentifiers:items.map(item=>item.identifier)}]},
  }),'有元数据的作者预设.json');
  const saved=vi.fn(async()=>{});
  await act(async()=>root!.render(React.createElement(StoryPresetMaker,{
   preset,onBack:()=>{},onSave:saved,onOpenCopy:async()=>{},
  })));
  const pro=[...host!.querySelectorAll('button')].find(b=>b.textContent?.trim()==='专业版')!;
  await act(async()=>pro.click());
  const group=[...host!.querySelectorAll('button')].find(b=>
   b.textContent?.includes('作者场景模块') && b.textContent?.includes('条有效'))!;
  expect(group).toBeDefined();
  await act(async()=>group.click());
  const main=host!.querySelector<HTMLElement>('main.story-page-scroll')!;
  main.scrollTop=220;
  const add=[...host!.querySelectorAll('button')].find(b=>b.textContent?.includes('在本区新增提示词'))!;
  await act(async()=>add.click());
  expect(host!.textContent).toContain('返回提示词列表');
  expect(host!.querySelector<HTMLTextAreaElement>('textarea')).not.toBeNull();
  const close=[...host!.querySelectorAll('button')].find(b=>b.textContent?.includes('返回提示词列表'))!;
  await act(async()=>close.click());
  expect(host!.textContent).toContain('作者场景模块');
  expect(host!.querySelector<HTMLButtonElement>('button[aria-label="新提示词：下移"]')).not.toBeNull();
  const save=[...host!.querySelectorAll('button')].find(b=>b.textContent?.trim()==='保存')!;
  await act(async()=>save.click());
  const doc=(saved.mock.calls[0] as any)[0].document;
  const added=doc.prompts.find((item:any)=>item.name==='新提示词');
  expect(added).toBeDefined();
  expect(doc.tavernEntryGroups[0].memberIdentifiers).toContain(added.id.slice(3));
  expect(doc.prompts.filter((item:any)=>item.id!=='st-opening'&&item.id!=='st-body'&&item.id!=='st-ending')).toHaveLength(1);
  expect(doc.prompts.filter((item:any)=>item.id.startsWith('st-')&&item.id!==added.id).map((item:any)=>item.id))
   .toEqual(['st-opening','st-body','st-ending']);
 });


 it('手机专业版：长装饰标题显示真实名称，进入后默认隐藏空条目，切区不会再次冒出',async()=>{
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  const items=[
   {identifier:'first-head',name:'━━━━━━✨【世界书设置】✨━━━━━━',role:'system',content:''},
   {identifier:'empty',name:'空白预留栏目',role:'system',content:''},
   {identifier:'real',name:'重要世界规则',role:'system',content:'真实的作者规则'},
   {identifier:'separator',name:'分隔占位',role:'system',content:'━━━━━━'},
   {identifier:'second-head',name:'✧━━━━━━━━【剧情节奏】━━━━━━━━✧',role:'system',content:''},
   {identifier:'actual',name:'节奏规则',role:'system',content:'有效的剧情节奏'},
   {identifier:'only-head',name:'╔━━━━【纯标题区】━━━━╗',role:'system',content:''},
  ];
  const preset=parseStoryTheaterPreset(JSON.stringify({prompts:items,prompt_order:[
   {character_id:100001,order:items.map(item=>({identifier:item.identifier,enabled:true}))},
  ]}),'真实长装饰标题.json');
  const before=JSON.stringify(preset.document);
  const saved=vi.fn(async()=>{});
  await act(async()=>root!.render(React.createElement(StoryPresetMaker,{
   preset,onBack:()=>{},onSave:saved,onOpenCopy:async()=>{},
  })));
  const button=(label:string)=>[...host!.querySelectorAll('button')].find(b=>b.textContent?.trim()===label);
  await act(async()=>button('专业版')!.click());
  const categories=()=>[...host!.querySelectorAll('button')].filter(b=>b.textContent?.includes('条有效'));
  expect(categories().map(b=>b.textContent)).toEqual(expect.arrayContaining([
   expect.stringContaining('世界书设置'),expect.stringContaining('剧情节奏'),
  ]));
  expect(categories().some(b=>b.textContent?.includes('纯标题区'))).toBe(false);
  const first=categories().find(b=>b.textContent?.includes('世界书设置'))!;
  await act(async()=>first.click());
  expect(host!.textContent).toContain('重要世界规则');
  expect(host!.textContent).not.toContain('空白预留栏目');
  expect(host!.textContent).not.toContain('分隔占位');
  const show=button('显示空条目');
  expect(show).toBeDefined();
  await act(async()=>show!.click());
  expect(host!.textContent).toContain('空白预留栏目');
  expect(host!.textContent).toContain('分隔占位');
  await act(async()=>[...host!.querySelectorAll('button')].find(b=>b.textContent?.includes('返回大分类'))!.click());
  const second=categories().find(b=>b.textContent?.includes('剧情节奏'))!;
  await act(async()=>second.click());
  expect(host!.textContent).toContain('节奏规则');
  expect(button('显示空条目')).toBeDefined();
  expect(host!.textContent).not.toContain('空白预留栏目');
  await act(async()=>[...host!.querySelectorAll('button')].find(b=>b.textContent?.includes('返回大分类'))!.click());
  await act(async()=>[...host!.querySelectorAll('button')].find(b=>b.textContent?.trim()==='保存')!.click());
  expect(saved).toHaveBeenCalledTimes(1);
  expect(JSON.stringify((saved.mock.calls[0] as any)[0].document)).toBe(before);
 });

});
