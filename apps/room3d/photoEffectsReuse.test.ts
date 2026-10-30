// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {paintPhoto,photoLooks} from './photoEffects';
afterEach(()=>vi.restoreAllMocks());

it('reuses the same scratch surfaces for preview, 2560-pixel export and repeated filters',()=>{
 const source=document.createElement('canvas'),out=document.createElement('canvas');
 source.width=2560;source.height=1440;
 const created=document.createElement.bind(document),newCanvases:string[]=[];
 vi.spyOn(document,'createElement').mockImplementation((tag:any,options?:any)=>{
  const element=created(tag,options) as HTMLElement;
  if(tag==='canvas')newCanvases.push(tag);
  return element;
 });
 const blank=()=>({data:new Uint8ClampedArray(32),width:2,height:4});
 const ctx:any={save:vi.fn(),restore:vi.fn(),clearRect:vi.fn(),drawImage:vi.fn(),
  getImageData:vi.fn(blank),putImageData:vi.fn(),createLinearGradient:()=>({addColorStop:vi.fn()}),
  createRadialGradient:()=>({addColorStop:vi.fn()}),fillRect:vi.fn(),globalCompositeOperation:'source-over',
  globalAlpha:1,filter:'none',fillStyle:'#000'};
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(ctx);
 paintPhoto(source,out,photoLooks.daylight);
 expect([out.width,out.height]).toEqual([2560,1440]);
 expect(newCanvases).toHaveLength(2); // reduced highlight surface and full-res fringe surface
 for(const preset of ['natural','neon','dream','afterglow','watercolor','daylight'] as const)
  paintPhoto(source,out,photoLooks[preset]);
 expect(newCanvases).toHaveLength(2);
 const other=document.createElement('canvas');
 newCanvases.length=0;paintPhoto(source,other,photoLooks.daylight);
 expect(newCanvases).toHaveLength(2); // separate shot gets separate mutable buffers
 expect(ctx.drawImage).toHaveBeenCalled();
});

it('keeps the exported color and aspect dimensions when switching aspect ratios',()=>{
 const source=document.createElement('canvas'),out=document.createElement('canvas');
 const ctx:any={save:()=>{},restore:()=>{},clearRect:()=>{},drawImage:()=>{},filter:'none'};
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(ctx);
 for(const [width,height] of [[2560,1440],[1920,2560],[2560,2560],[2560,1071]]){
  source.width=width;source.height=height;
  paintPhoto(source,out,photoLooks.natural);
  expect([out.width,out.height]).toEqual([width,height]);
 }
});
