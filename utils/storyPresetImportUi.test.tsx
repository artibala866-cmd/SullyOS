// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach,describe,expect,it,vi} from 'vitest';
import StoryTheaterEditor from '../components/date/story/StoryTheaterEditor';
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
  await act(async()=>root!.render(React.createElement(StoryTheaterEditor,{
   initial:{...createStoryTheaterDraft(),title:'批量导入后写剧情',characterIds:[char.id]},
   characters:[char],user:{name:'用户'} as any,masks:[],maskLocked:false,
   presets:[BUILTIN_NIGHT_SCREENING_PRESET],onCancel:()=>{},onSave,
   onImportPreset:onImport,onEditPreset:()=>{},onOpenMaskBox:()=>{},
  })));
  const picker=host!.querySelector<HTMLInputElement>('input[type=file]');
  expect(picker?.multiple).toBe(true);
  expect(picker?.accept).toContain('.json');
  const files=[new File([valid('第一份')],'第一份.json',{type:'application/json'}),
   new File(['{broken'],'损坏.json',{type:'application/json'}),
   new File([valid('第二份')],'第二份.json',{type:'application/json'})];
  Object.defineProperty(picker!,'files',{configurable:true,value:files});
  await act(async()=>{picker!.dispatchEvent(new Event('change',{bubbles:true}));});
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
});
