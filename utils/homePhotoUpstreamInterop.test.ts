// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import HomePhotoMode from '../apps/room3d/HomePhotoMode';

vi.mock('../apps/room3d/PhotoActions',()=>({PhotoActions:()=>null}));
vi.mock('../apps/room3d/PhotoFilterPresets',()=>({default:()=>null}));
vi.mock('../utils/shareExport',()=>({shareOrDownloadBlob:vi.fn()}));
vi.mock('@phosphor-icons/react',()=>({Camera:()=>null,X:()=>null,DownloadSimple:()=>null,ArrowCounterClockwise:()=>null}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;

let root:Root|undefined,host:HTMLDivElement;
beforeEach(()=>{
 host=document.createElement('div');document.body.append(host);
 vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockReturnValue(390);
 vi.spyOn(HTMLElement.prototype,'clientHeight','get').mockReturnValue(844);
 vi.spyOn(HTMLElement.prototype,'offsetHeight','get').mockReturnValue(260);
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
 vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>setTimeout(()=>fn(0),0));
 vi.stubGlobal('cancelAnimationFrame',clearTimeout);
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({
  drawImage:vi.fn(),fillRect:vi.fn(),save:vi.fn(),restore:vi.fn(),translate:vi.fn(),scale:vi.fn(),
  beginPath:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),bezierCurveTo:vi.fn(),closePath:vi.fn(),
  fill:vi.fn(),fillText:vi.fn(),measureText:vi.fn(()=>({width:100})),
 } as any);
 root=createRoot(host);
});
afterEach(async()=>{
 if(root)await act(async()=>root!.unmount());
 host.remove();root=undefined;vi.restoreAllMocks();vi.unstubAllGlobals();
});
async function setup(){
 const editor={
  beginPhotoMode:vi.fn(()=>[{id:'a',label:'A'},{id:'b',label:'B'}]),
  endPhotoMode:vi.fn(),setPhotoCamera:vi.fn(),setPhotoTogether:vi.fn(),
  renderPhoto:vi.fn(),subscribePhoto:vi.fn(()=>()=>{}),
 };
 await act(async()=>{root!.render(React.createElement(HomePhotoMode,{editor:editor as any,onClose:vi.fn()}));});
 return editor;
}
async function click(label:string){
 const button=[...host.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')||b.textContent)===label)!;
 expect(button).toBeTruthy();
 await act(async()=>button.click());
}
it('original Halloween close-up photo framing works in customized UI, and leaving it restores portrait framing',async()=>{
 const editor=await setup();
 await click('镜头');
 await click('爱心大头贴');
 expect(editor.setPhotoTogether).toHaveBeenCalledWith(.85);
 expect(editor.setPhotoCamera).toHaveBeenLastCalledWith(expect.objectContaining({pan:0,zoom:1.65,height:1.75,pitch:2}));
 await click('全身 9:16');
 expect(editor.setPhotoCamera).toHaveBeenLastCalledWith(expect.objectContaining({pan:0,zoom:1,height:1.2,pitch:4}));
});
it('customized photo modes and HD export control remain visible after upstream docking import',async()=>{
 await setup();
 expect(host.querySelector('.photo-dock')).toBeTruthy();
 expect(host.querySelector('[aria-label="照片导出分辨率"]')?.textContent).toContain('2560');
 await click('镜头');
 expect(host.querySelector('[aria-label="照片比例"]')).toBeTruthy();
 expect(host.querySelectorAll('.photo-formats button')).toHaveLength(8);
});
