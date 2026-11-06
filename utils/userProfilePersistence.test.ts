// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import UserImageIdentitySection from '../components/user/UserImageIdentitySection';
import PerCharAvatarPicker from '../components/user/PerCharAvatarPicker';
import {beginUserSaveOperation} from './userSaves';
const mocks=vi.hoisted(()=>({save:vi.fn(),toast:vi.fn(),blob:vi.fn().mockResolvedValue('blobref:face'),image:vi.fn().mockResolvedValue('data:image/png;base64,AAA')}));
vi.mock('../context/OSContext',()=>({useOS:()=>({characters:[{id:'c',name:'角色',avatar:''}],userProfile:{name:'本档',avatar:'',bio:''},updateUserProfile:mocks.save,addToast:mocks.toast})}));
vi.mock('../components/os/TokenImg',()=>({default:()=>null}));
vi.mock('./blobRef',()=>({putImageBlob:mocks.blob,migrateDataUrlToRef:mocks.blob}));
vi.mock('./file',()=>({processImage:mocks.image}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let root:ReturnType<typeof createRoot>|undefined;const host=document.createElement('div');document.body.append(host);
afterEach(()=>{if(root)act(()=>root!.unmount());root=undefined;host.innerHTML='';vi.clearAllMocks();});
async function render(component:React.FunctionComponent){root=createRoot(host);await act(async()=>root!.render(React.createElement(component)));}
async function upload(){const input=host.querySelector('input[type=file]')!;Object.defineProperty(input,'files',{value:[new File(['pixels'],'face.png',{type:'image/png'})],configurable:true});await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));}
it('lock-face upload holds the save operation until profile persistence succeeds, and reports failures',async()=>{
 let resolve!:()=>void;mocks.save.mockReturnValueOnce(new Promise<void>(r=>{resolve=r}));
 await render(UserImageIdentitySection);await upload();
 expect(mocks.save).toHaveBeenCalledWith({imageReference:'blobref:face',imageLockEnabled:true});
 expect(mocks.toast).not.toHaveBeenCalled();expect(()=>beginUserSaveOperation('切换')).toThrow('保存锁脸');
 await act(async()=>resolve());expect(mocks.toast).toHaveBeenCalledWith('user 锁脸参考图已更新','success');
 const release=beginUserSaveOperation('检查锁释放');release();mocks.toast.mockClear();mocks.save.mockRejectedValueOnce(new Error('quota-test'));
 await upload();expect(host.textContent).toContain('图片保存失败：quota-test');expect(mocks.toast).not.toHaveBeenCalledWith(expect.anything(),'success');
});
it('per-character uploads merge against the latest profile and cannot announce success before commit',async()=>{
 let resolve!:()=>void;mocks.save.mockReturnValueOnce(new Promise<void>(r=>{resolve=r}));
 await render(PerCharAvatarPicker);const button=[...host.querySelectorAll('button')].find(b=>b.textContent==='角色')!;
 await act(async()=>button.click());await upload();expect(mocks.save).toHaveBeenCalledOnce();
 const update=mocks.save.mock.lastCall![0];expect(update({perCharAvatars:{other:'other-face'}})).toEqual({perCharAvatars:{other:'other-face',c:'blobref:face'}});
 expect(mocks.toast).not.toHaveBeenCalled();expect(()=>beginUserSaveOperation('切换')).toThrow('保存分角色');
 await act(async()=>resolve());expect(mocks.toast).toHaveBeenCalledWith('已设置该角色的聊天头像','success');
 mocks.toast.mockClear();mocks.save.mockRejectedValueOnce(new Error('write-test'));await upload();expect(mocks.toast).toHaveBeenCalledWith('write-test','error');expect(mocks.toast).not.toHaveBeenCalledWith(expect.anything(),'success');
 const release=beginUserSaveOperation('检查锁释放');release();
});
