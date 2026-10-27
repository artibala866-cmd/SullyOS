// @vitest-environment jsdom
import React,{act} from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createRoot,type Root} from 'react-dom/client';
import HomePhotoMode from './HomePhotoMode';

vi.mock('./PhotoFilterPresets',()=>({default:()=>null}));
vi.mock('./PhotoActions',()=>({PhotoActions:()=>null}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;

let host:HTMLDivElement,root:Root|undefined;
let pending:Array<(blob:Blob|null)=>void>;
const editor={
 beginPhotoMode:vi.fn(()=>[]),
 endPhotoMode:vi.fn(),
 setPhotoCamera:vi.fn(),
 renderPhoto:vi.fn(),
} as any;
const makeObjectUrl=vi.fn(()=>'blob:home-photo-1');
const revokeObjectUrl=vi.fn();
beforeEach(()=>{
 pending=[];
 vi.clearAllMocks();
 vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));
 vi.stubGlobal('cancelAnimationFrame',vi.fn());
 Object.defineProperty(URL,'createObjectURL',{configurable:true,writable:true,value:makeObjectUrl});
 Object.defineProperty(URL,'revokeObjectURL',{configurable:true,writable:true,value:revokeObjectUrl});
 vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(callback=>{
  pending.push(callback as (blob:Blob|null)=>void);
 });
 host=document.createElement('div');document.body.append(host);
 root=createRoot(host);
});
afterEach(()=>{
 if(root){act(()=>root!.unmount());root=undefined;}
 host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();
});
async function render(){
 await act(async()=>root!.render(React.createElement(HomePhotoMode,{editor,onClose:vi.fn()})));
}
function click(selector:string){
 const button=host.querySelector<HTMLButtonElement>(selector);
 expect(button,selector).toBeTruthy();
 act(()=>button!.dispatchEvent(new MouseEvent('click',{bubbles:true})));
 return button!;
}
it('does not allow overlapping captures, releases the old photo on retake, and ignores callbacks after unmount',async()=>{
 await render();
 const shutter=click('button[aria-label="拍下合影"]');
 expect(shutter.disabled).toBe(true);
 expect(pending).toHaveLength(1);
 act(()=>pending[0](new Blob(['photo'],{type:'image/png'})));
 expect(host.querySelector('.photo-result img')).toBeTruthy();
 expect(makeObjectUrl).toHaveBeenCalledTimes(1);
 click('.photo-result button');
 expect(revokeObjectUrl).toHaveBeenCalledWith('blob:home-photo-1');
 expect(host.querySelector('button[aria-label="拍下合影"]')).toBeTruthy();
 click('button[aria-label="拍下合影"]');
 expect(pending).toHaveLength(2);
 act(()=>root!.unmount());root=undefined;
 act(()=>pending[1](new Blob(['late'],{type:'image/png'})));
 expect(makeObjectUrl).toHaveBeenCalledTimes(1);
});
it('shows a retryable error when canvas photo capture fails',async()=>{
 vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementationOnce(()=>{throw Error('canvas lost');});
 await render();
 click('button[aria-label="拍下合影"]');
 expect(host.querySelector('[role="alert"]')?.textContent).toContain('照片生成失败');
 expect(host.querySelector<HTMLButtonElement>('button[aria-label="拍下合影"]')?.disabled).toBe(false);
});
