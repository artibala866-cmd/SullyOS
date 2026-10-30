// @vitest-environment jsdom
import React,{act} from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createRoot,type Root} from 'react-dom/client';
import HomePhotoMode from './HomePhotoMode';
import {photoSize} from './photoFrame';

vi.mock('./PhotoFilterPresets',()=>({default:()=>null}));
vi.mock('./PhotoActions',()=>({PhotoActions:()=>null}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;

let host:HTMLDivElement,root:Root|undefined;
let pending:Array<(blob:Blob|null)=>void>;
const editor={
 beginPhotoMode:vi.fn(()=>[]),
 endPhotoMode:vi.fn(),
 setPhotoCamera:vi.fn(),
 renderPhoto:vi.fn((canvas:HTMLCanvasElement,_look:unknown,options:{aspect?:number;quality?:'moving'|'preview'|'export'}={})=>{
  const size=photoSize(options.aspect??16/9,options.quality);canvas.width=size.width;canvas.height=size.height;
 }),
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

it('preserves four original frames while adding independent paper and tall frames and toggles horizontal framing without changing filters or actions',async()=>{
 Object.defineProperty(HTMLElement.prototype,'clientWidth',{configurable:true,get(){return 390;}});
 Object.defineProperty(HTMLElement.prototype,'clientHeight',{configurable:true,get(){return 844;}});
 await render();
 expect(host.querySelector('.photo-frame')).toBeTruthy();
 expect(host.querySelector('.photo-format-label')?.textContent).toBe('横幅 16:9');
 const turn=[...host.querySelectorAll<HTMLButtonElement>('footer button')].find(b=>b.textContent==='横屏取景');
 expect(turn).toBeTruthy();
 act(()=>turn!.click());
 const rotated=host.querySelector<HTMLElement>('.home-photo-mode')!;
 expect(rotated.getAttribute('data-sideways')).toBe('true');
 expect(rotated.style.transform).toContain('rotate(90deg)');
 expect(rotated.style.width).toBe('844px');
 expect(rotated.style.height).toBe('390px');
 act(()=>[...host.querySelectorAll<HTMLButtonElement>('footer button')].find(b=>b.textContent==='回到竖屏')!.click());
 expect(rotated.getAttribute('data-sideways')).toBe('false');
 const tabs=[...host.querySelectorAll<HTMLButtonElement>('.photo-controls nav button')];
 act(()=>tabs.find(b=>b.textContent==='镜头')!.click());
 const formats=host.querySelector('[aria-label="照片比例"]')!;
 expect(formats.querySelectorAll('button')).toHaveLength(8);
 for(const label of ['横幅 16:9','电影 2.39:1','竖幅 3:4','方形 1:1','全身 9:16','奶油拍立得','爱心大头贴','四格贴纸']){
  const button=[...formats.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===label)!;
  act(()=>button.click());
  expect(button.getAttribute('aria-pressed')).toBe('true');
  expect(host.querySelector('.photo-format-label')?.textContent).toBe(label);
 }
 expect(host.querySelector('.photo-dock .photo-controls nav button:last-child')?.textContent).toBe('氛围');
 act(()=>[...formats.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='方形 1:1')!.click());
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
 expect(output.width).toBe(2560);expect(output.height).toBe(1440);
 expect(pending).toHaveLength(1);
 act(()=>pending[0](new Blob(['hi-res PNG'],{type:'image/png'})));
 expect(host.querySelector('.photo-result img')).toBeTruthy();
 click('.photo-result button');
 expect(revokeObjectUrl).toHaveBeenCalledWith('blob:home-photo-1');
});

it('refuses silently downgraded or empty exports without altering stored photo URLs',async()=>{
 await render();
 editor.renderPhoto.mockImplementationOnce((canvas:HTMLCanvasElement)=>{canvas.width=1280;canvas.height=720;});
 click('button[aria-label="拍下合影"]');
 expect(host.querySelector('[role="alert"]')?.textContent).toContain('照片生成失败');
 expect(host.querySelector<HTMLButtonElement>('button[aria-label="拍下合影"]')?.disabled).toBe(false);
 expect(pending).toHaveLength(0);
 expect(makeObjectUrl).not.toHaveBeenCalled();
});
it('exports the chosen 3:4 portrait as full-resolution PNG and visibly reports its dimensions',async()=>{
 await render();
 act(()=>[...host.querySelectorAll<HTMLButtonElement>('.photo-controls nav button')].find(b=>b.textContent==='镜头')!.click());
 act(()=>[...host.querySelectorAll<HTMLButtonElement>('[aria-label="照片比例"] button')].find(b=>b.textContent==='竖幅 3:4')!.click());
 expect(host.querySelector('[aria-label="照片导出分辨率"]')?.textContent).toContain('1920×2560');
 click('button[aria-label="拍下合影"]');
 const [output,,options]=editor.renderPhoto.mock.lastCall!;
 expect(options).toMatchObject({aspect:3/4,quality:'export'});
 expect([output.width,output.height]).toEqual([1920,2560]);
 expect(pending).toHaveLength(1);
 act(()=>pending[0](new Blob(['hi-res'],{type:'image/png'})));
 expect(host.querySelector('.photo-result img')).toBeTruthy();
});

it('composes editable paper lettering at export resolution without changing camera or original capture mode',async()=>{
 const ctx:any={fillRect:vi.fn(),drawImage:vi.fn(),save:vi.fn(),restore:vi.fn(),translate:vi.fn(),scale:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),bezierCurveTo:vi.fn(),lineTo:vi.fn(),closePath:vi.fn(),fill:vi.fn(),fillText:vi.fn(),measureText:vi.fn(()=>({width:100}))};
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(ctx);
 await render();
 const initialCamera=editor.setPhotoCamera.mock.lastCall?.[0];
 act(()=>[...host.querySelectorAll<HTMLButtonElement>('.photo-controls nav button')].find(b=>b.textContent==='镜头')!.click());
 act(()=>[...host.querySelectorAll<HTMLButtonElement>('[aria-label="照片比例"] button')].find(b=>b.textContent==='四格贴纸')!.click());
 expect(editor.setPhotoCamera.mock.lastCall?.[0]).toEqual(initialCamera);
 expect(host.querySelector('.photo-lettering')).toBeTruthy();
 const field=host.querySelector<HTMLInputElement>('input[aria-label="相纸主文案"]')!;
 await act(async()=>{
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
  setter.call(field,'我们的四格合照');
  field.dispatchEvent(new Event('input',{bubbles:true}));
 });
 expect(localStorage.getItem('sully.home.photo-lettering.v1')).toContain('我们的四格合照');
 click('button[aria-label="拍下合影"]');
 await act(async()=>{await Promise.resolve();await Promise.resolve();});
 const calls=editor.renderPhoto.mock.calls;
 const last=calls.at(-1)!,source=last[0] as HTMLCanvasElement;
 expect(last[2]).toMatchObject({aspect:1,quality:'export'});
 expect([source.width,source.height]).toEqual([1,1]); // source is intentionally released after composition
 expect(ctx.drawImage).toHaveBeenCalledTimes(4);
 expect(ctx.fillText).toHaveBeenCalledWith('我们的四格合照',expect.any(Number),expect.any(Number),expect.any(Number));
 expect(pending).toHaveLength(1);
 act(()=>pending[0](new Blob(['paper'],{type:'image/png'})));
 expect(host.querySelector('.photo-result img')).toBeTruthy();
 click('.photo-result button');
 expect(host.querySelector('button[aria-label="拍下合影"]')).toBeTruthy();
});
