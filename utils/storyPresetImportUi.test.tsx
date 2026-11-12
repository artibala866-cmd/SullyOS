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
  expect(host!.textContent).toContain('拖拖📚文风');
  expect(host!.textContent).toContain('不抢');
  expect(host!.textContent).not.toContain('汽水日常');
  expect(host!.textContent).not.toContain('低烧 I');
  for(const field of ['温度','候选范围','重复惩罚','话题惩罚','最大输出'])
   expect(host!.textContent).toContain(field);
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
 });


});
