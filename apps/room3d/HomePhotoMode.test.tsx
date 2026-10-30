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

it('offers four independent aspect frames and toggles horizontal framing without changing filters or actions',async()=>{
 Object.defineProperty(HTMLElement.prototype,'clientWidth',{configurable:true,get(){return 390;}});
 Object.defineProperty(HTMLElement.prototype,'clientHeight',{configurable:true,get(){return 844;}});
 await render();
 expect(host.querySelector('.photo-frame')).toBeTruthy();
 const tabs=[...host.querySelectorAll<HTMLButtonElement>('.photo-controls nav button')];
 act(()=>tabs.find(b=>b.textContent==='镜头')!.click());
 const formats=host.querySelector('[aria-label="照片比例"]')!;
 expect(formats.querySelectorAll('button')).toHaveLength(4);
 for(const label of ['横幅 16:9','电影 2.39:1','竖幅 3:4','方形 1:1']){
  const button=[...formats.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===label)!;
  act(()=>button.click());
  expect(button.getAttribute('aria-pressed')).toBe('true');
  expect(host.querySelector('.photo-format-label')?.textContent).toBe(label);
 }
 expect(host.querySelector('.photo-dock .photo-controls nav button:last-child')?.textContent).toBe('氛围');
 click('button[aria-label="拍下合影"]');
 expect(editor.renderPhoto).toHaveBeenCalledWith(expect.any(HTMLCanvasElement),expect.objectContaining({preset:'daylight'}),{aspect:1,quality:'export'});
 expect(host.querySelector('.home-photo-mode')).toBeTruthy();
});
it('captures export from a separate PNG canvas, preserving the current preview and original storage lifecycle',async()=>{
 await render();
 const preview=host.querySelector<HTMLCanvasElement>('canvas.photo-view')!;
 click('button[aria-label="拍下合影"]');
 const [output,,options]=editor.renderPhoto.mock.lastCall!;
 expect(output).not.toBe(preview);
 expect(options).toMatchObject({aspect:16/9,quality:'export'});
 expect(pending).toHaveLength(1);
 act(()=>pending[0](new Blob(['hi-res PNG'],{type:'image/png'})));
 expect(host.querySelector('.photo-result img')).toBeTruthy();
 click('.photo-result button');
 expect(revokeObjectUrl).toHaveBeenCalledWith('blob:home-photo-1');
});
