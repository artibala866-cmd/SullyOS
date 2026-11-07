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
  const picker=host!.querySelector<HTMLInputElement>('input[type=file]');
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
 it('四类酒馆写法自动显示内置八组快捷控制，选择后实际保存并不覆盖原作者文本',async()=>{
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  const preset=parseStoryTheaterPreset(JSON.stringify({
   temperature:1.05,top_p:0.95,frequency_penalty:0.4,presence_penalty:0.3,
   prompts:[
    {identifier:'pov',name:'✍️视角体系',role:'system',content:'<pov_user>第二人称</pov_user><pov_npc>第三人称</pov_npc>'},
    {identifier:'style',name:'文风设置',role:'system',content:'请写出电影化写实的情绪与动作，不要堆砌比喻。'.repeat(7)},
    {identifier:'length',name:'正文篇幅',role:'system',content:'正文必须在1421到2023字之间。'},
    {identifier:'language',name:'修改语言',role:'system',content:'{{setvar::主要语言::简体中文}}'},
    {identifier:'theater',name:'随机小剧场',role:'system',content:'每轮结尾生成一个随机小剧场。'},
    {identifier:'user',name:'你',role:'user',content:'用户叙事偏好原文不能丢失'},
   ],
   prompt_order:[{character_id:100001,order:['pov','style','length','language','theater','user']
    .map(identifier=>({identifier,enabled:true}))}],
  }),'导入自动识别.json');
  const originalTexts=preset.document.prompts.map(p=>p.content);
  const saved=vi.fn(async()=>{});
  await act(async()=>root!.render(React.createElement(StoryPresetMaker,{
   preset,onBack:()=>{},onSave:saved,onOpenCopy:async()=>{},onDelete:async()=>{},
  })));
  expect(host!.textContent).toContain('只调看得懂的部分');
  for(const label of ['文风','人称','输入转述','你的执笔权','场景张力','小剧场','语言','篇幅']){
   expect([...host!.querySelectorAll('h2')].some(h=>h.textContent===label)).toBe(true);
  }
  expect(host!.textContent).toContain('1421–2023字');
  expect(host!.textContent).toContain('简体中文');
  expect(host!.textContent).toContain('第二人称');
  for(const field of ['温度','候选范围','重复惩罚','话题惩罚','最大输出']){
   expect(host!.textContent).toContain(field);
  }
  const theater=[...host!.querySelectorAll('h2')].find(h=>h.textContent==='小剧场')!.closest('section')!;
  const shut=[...theater.querySelectorAll('button')].find(b=>b.textContent?.trim()==='关闭');
  await act(async()=>shut!.click());
  const perspective=[...host!.querySelectorAll('h2')].find(h=>h.textContent==='人称')!.closest('section')!;
  const third=[...perspective.querySelectorAll('button')].find(b=>b.textContent?.trim()==='第三人称');
  await act(async()=>third!.click());
  const saveButton=[...host!.querySelectorAll('button')].find(b=>b.textContent?.trim()==='保存');
  await act(async()=>saveButton!.click());
  expect(saved).toHaveBeenCalledTimes(1);
  const doc=(saved.mock.calls[0] as any)[0].document;
  expect(doc.tavernControls.overrides).toMatchObject({pov:'nmj-v3-pov-third',theater:''});
  expect(doc.prompts.map((p:any)=>p.content)).toEqual(originalTexts);
  const pro=[...host!.querySelectorAll('button')].find(b=>b.textContent?.trim()==='专业版');
  await act(async()=>pro!.click());
  expect(host!.textContent).toContain('先选大区，再看细节');
 });

});
