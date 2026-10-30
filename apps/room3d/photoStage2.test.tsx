// @vitest-environment jsdom
import React,{act} from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createRoot,type Root} from 'react-dom/client';
import {PhotoActions} from './PhotoActions';
import {photoLibrary} from './photoLibrary';
import {isRomanticMotion} from './homeRomance';
import {photoFrames,photoSize} from './photoFrame';
import {composePhoto,photoWindows,photoCaptureAspect,isPhotoPaper} from './photoComposition';
import {defaultPhotoLettering,PHOTO_LETTERING_KEY,readPhotoLettering,writePhotoLettering} from './photoLettering';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement,root:Root|undefined;
beforeEach(()=>{localStorage.clear();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{if(root){act(()=>root!.unmount());root=undefined;}host.remove();vi.restoreAllMocks();});

describe('photo paper and 3D double-person permission regression',()=>{
 it('composes the same four photo windows and typography for preview and exported PNG',()=>{
  const draws:any[]=[],texts:any[]=[];
  const ctx:any={
   fillRect:vi.fn(),drawImage:vi.fn((...args)=>draws.push(args)),save:vi.fn(),restore:vi.fn(),
   translate:vi.fn(),scale:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),bezierCurveTo:vi.fn(),
   lineTo:vi.fn(),closePath:vi.fn(),fill:vi.fn(),fillText:vi.fn((...args)=>texts.push(args)),
   measureText:vi.fn((value:string)=>({width:value.length*20})),
   fillStyle:'',font:'',textAlign:'',textBaseline:''
  };
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(ctx);
  const source=document.createElement('canvas'),output=document.createElement('canvas');
  const paper=defaultPhotoLettering('collage');
  paper.title='四个瞬间';paper.footer='我们的家';
  expect(photoWindows('collage')).toHaveLength(4);
  expect(photoCaptureAspect('collage')).toBeCloseTo(1);
  expect(isPhotoPaper('landscape')).toBe(false);
  composePhoto(source,output,'collage','preview',paper);
  expect(draws).toHaveLength(4);
  expect(texts.map(v=>v[0])).toEqual(['四个瞬间','我们的家']);
  expect([output.width,output.height]).toEqual([1024,1280]);
  draws.length=0;texts.length=0;
  composePhoto(source,output,'collage','export',paper);
  expect(draws).toHaveLength(4);
  expect(texts.map(v=>v[0])).toEqual(['四个瞬间','我们的家']);
  expect([output.width,output.height]).toEqual([2048,2560]);
  expect(draws[0][1]/output.width).toBeCloseTo(.055,2);
  expect(draws[0][2]/output.height).toBeCloseTo(.075,2);
 });
 it('stores only user-edited paper lettering, does not touch home saves, tolerates corrupt local storage',()=>{
  const value={polaroid:{title:'给你',footer:'秋夜',font:'rounded' as const}};
  writePhotoLettering(value);
  expect(readPhotoLettering()).toEqual(value);
  expect(localStorage.getItem(PHOTO_LETTERING_KEY)).toContain('给你');
  localStorage.setItem(PHOTO_LETTERING_KEY,'{not-json');
  expect(readPhotoLettering()).toEqual({});
  localStorage.setItem(PHOTO_LETTERING_KEY,JSON.stringify({collage:{title:'x'.repeat(100),footer:'f'.repeat(99),font:'classic'},polaroid:{title:'x',footer:'z',font:'invalid'}}));
  const parsed=readPhotoLettering();
  expect(parsed.collage?.title).toHaveLength(40);
  expect(parsed.collage?.footer).toHaveLength(64);
  expect(parsed.polaroid).toBeUndefined();
 });
 it('always keeps existing four capture formats and original 2560 output',()=>{
  expect(Object.keys(photoFrames).slice(0,4)).toEqual(['landscape','cinema','portrait','square']);
  expect(photoSize(photoFrames.landscape.aspect,'export')).toEqual({width:2560,height:1440});
  expect(photoSize(photoFrames.square.aspect,'export')).toEqual({width:2560,height:2560});
  expect(Object.keys(photoFrames)).toHaveLength(8);
 });
 it('hides romantic actions without authorization, reveals them only for the selected approved pair',async()=>{
  const intimate=photoLibrary.find(e=>isRomanticMotion(e.id));
  const ordinary=photoLibrary.find(e=>e.kind==='pair'&&!isRomanticMotion(e.id));
  expect(intimate).toBeTruthy();
  expect(ordinary).toBeTruthy();
  const allowed=new Set<string>();
  const editor={
   canPlaySocial:vi.fn((id:string,a:string,b:string)=>allowed.has([id,a,b].join(':'))),
   setPhotoInteraction:vi.fn(async()=>{}),
   setPhotoPose:vi.fn(async()=>{})
  } as any;
  const actors=[{id:'a',label:'甲'},{id:'b',label:'乙'}];
  await act(async()=>root!.render(<PhotoActions editor={editor} actors={actors} refresh={()=>{}}/>));
  function click(text:string){
   const target=[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.includes(text));
   expect(target,text).toBeTruthy();act(()=>target!.click());
  }
  click('双人互动');
  const labels=()=>[...host.querySelectorAll('.photo-action-grid button')].map(e=>e.textContent);
  expect(labels()).not.toContain(intimate!.label);
  expect(labels()).toContain(ordinary!.label);
  allowed.add([intimate!.id,'a','b'].join(':'));
  await act(async()=>root!.render(<PhotoActions editor={editor} actors={[...actors]} refresh={()=>{}}/>));
  expect(labels()).toContain(intimate!.label);
  const chosen=[...host.querySelectorAll<HTMLButtonElement>('.photo-action-grid button')].find(b=>b.textContent===intimate!.label)!;
  await act(async()=>chosen.click());
  expect(editor.setPhotoInteraction).toHaveBeenCalledWith(intimate!.id,'a','b',expect.any(Number));
  allowed.clear();
  await act(async()=>root!.render(<PhotoActions editor={editor} actors={[...actors]} refresh={()=>{}}/>));
  expect(labels()).not.toContain(intimate!.label);
  expect(host.querySelector('.photo-action-preview')).toBeNull();
  const slider=host.querySelector<HTMLInputElement>('input[aria-label="动作时刻"]');
  expect(slider).toBeNull();
 });
});
