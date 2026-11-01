// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import HomeFigureStudio from '../components/character/HomeFigureStudio';
const mocks=vi.hoisted(()=>({editor:vi.fn(),save:vi.fn(),userSave:vi.fn()}));
vi.mock('../context/OSContext',()=>({useOS:()=>({
 characters:[{id:'c',name:'Sully',chibiStudio:{home3D:{state:{selected:{eyes:'home'}},hair:{layers:{},extras:[]}},room:{state:{selected:{eyes:'old-room'}}},like520:{state:{selected:{eyes:'old-event'}}}}}],
 userProfile:{name:'用户',chibiStudio:{home3D:{state:{selected:{eyes:'user-home'}},hair:{layers:{},extras:[]}},userChibi:{state:{selected:{eyes:'old-user'}}}}},
 updateCharacter:mocks.save,updateUserProfile:mocks.userSave
})}));
vi.mock('../components/os/TokenImg',()=>({default:()=>null}));
vi.mock('../components/character/HomeFigureEditor',()=>({default:(props:any)=>{mocks.editor(props);return React.createElement('button',{onClick:props.onClose},'取消编辑');}}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const host=document.createElement('div');document.body.appendChild(host);let root:ReturnType<typeof createRoot>|undefined;
afterEach(()=>{if(root)act(()=>root!.unmount());root=undefined;vi.clearAllMocks();vi.unstubAllGlobals();host.innerHTML='';});
async function render(charId?:string){root=createRoot(host);await act(async()=>root!.render(React.createElement(HomeFigureStudio,{charId,startEditing:true,onClose:vi.fn()})));}
async function click(label:string){await act(async()=>{const button=[...host.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label||b.textContent===label);if(!button)throw Error('Missing button '+label);button.click();});}
it('legacy room and event figures cannot be chosen as a 3D source',async()=>{
 await render('c');for(const label of ['小小窝','特别时光','彼方'])expect(host.textContent).not.toContain(label);
 await click('继续编辑当前家园形象');const a=mocks.editor.mock.lastCall![0];expect(a.value.state.selected.eyes).toBe('home');expect(a.seedState).toBeUndefined();
 await click('取消编辑');await click('从头捏一个');const b=mocks.editor.mock.lastCall![0];expect(b.value).toBeUndefined();expect(b.seedState).toBeUndefined();expect(b.draftKey).not.toBe(a.draftKey);
});
it('user editing uses only the real home3D Q figure',async()=>{
 await render();expect(host.textContent).not.toContain('我的 Chibi');
 await click('继续编辑当前家园形象');expect(mocks.editor.mock.lastCall![0].value.state.selected.eyes).toBe('user-home');
});
it('new and existing 3D figures work without crypto.randomUUID',async()=>{
 const native=globalThis.crypto;vi.stubGlobal('crypto',{getRandomValues:native.getRandomValues.bind(native)});
 await render('c');const keys=new Set<string>();
 for(const label of ['从头捏一个','继续编辑当前家园形象']){await click(label);keys.add(mocks.editor.mock.lastCall![0].draftKey);await click('取消编辑');}
 expect(keys.size).toBe(2);expect(mocks.save).not.toHaveBeenCalled();
});
