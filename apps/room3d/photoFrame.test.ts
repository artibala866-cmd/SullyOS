// @vitest-environment jsdom
import {describe,it,expect,vi,afterEach} from 'vitest';
import * as T from 'three';
import {photoFrames,photoSize,photoDrag} from './photoFrame';
import {createPhotoRenderer} from './photoRenderer';
import {photoLooks} from './photoEffects';

afterEach(()=>vi.restoreAllMocks());

describe('home 3D photo frame and high-quality export',()=>{
 it('keeps four optical crops and pixel-perfect export dimensions independent from physical phone rotation',()=>{
  expect(photoFrames.landscape.aspect).toBe(16/9);
  expect(photoFrames.cinema.aspect).toBe(2.39);
  expect(photoFrames.portrait.aspect).toBe(3/4);
  expect(photoFrames.square.aspect).toBe(1);
  for(const [id,f] of Object.entries(photoFrames)){
   const a=photoSize(f.aspect,'moving'),b=photoSize(f.aspect,'preview'),c=photoSize(f.aspect,'export');
   expect(Math.max(a.width,a.height),id).toBe(768);
   expect(Math.max(b.width,b.height),id).toBe(1280);
   expect(Math.max(c.width,c.height),id).toBe(2560);
   expect(c.width/c.height,id).toBeCloseTo(f.aspect,2);
  }
  expect(photoSize(photoFrames.landscape.aspect,'export')).toEqual({width:2560,height:1440});
  expect(photoSize(photoFrames.portrait.aspect,'export')).toEqual({width:1920,height:2560});
  expect(photoSize(photoFrames.square.aspect,'export')).toEqual({width:2560,height:2560});
  expect(photoDrag(8,3,false)).toEqual({dx:8,dy:3});
  expect(photoDrag(8,3,true)).toEqual({dx:3,dy:-8});
  expect(photoSize(-Infinity,'export')).toEqual({width:2560,height:1440});
 });
 it('exports a separate scene crop without altering original filter API, and restores camera and renderer on close',()=>{
  let currentPixelRatio=2,width=600,height=340;
  const canvas=document.createElement('canvas');
  const renderer={
   domElement:canvas,
   getSize:(out:T.Vector2)=>out.set(width,height),
   getPixelRatio:()=>currentPixelRatio,
   setPixelRatio:vi.fn((n:number)=>{currentPixelRatio=n;}),
   setSize:vi.fn((w:number,h:number)=>{width=w;height=h;canvas.width=Math.round(w*currentPixelRatio);canvas.height=Math.round(h*currentPixelRatio);})
  } as unknown as T.WebGLRenderer;
  const camera=new T.OrthographicCamera(-5,5,3,-3,.1,200);
  const original={left:camera.left,right:camera.right,top:camera.top,bottom:camera.bottom,ratio:currentPixelRatio,size:[width,height]};
  const draw=vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(()=>({
   drawImage:draw,save:vi.fn(),restore:vi.fn(),clearRect:vi.fn(),filter:'none'
  }) as unknown as CanvasRenderingContext2D);
  const capture=vi.fn(),photo=createPhotoRenderer(renderer,camera,capture);
  const preview=document.createElement('canvas'),exported=document.createElement('canvas');
  photo.render(preview,photoLooks.natural,{aspect:3/4,quality:'preview'});
  expect(preview.width).toBe(960);expect(preview.height).toBe(1280);
  expect(camera.right-camera.left).toBeCloseTo((camera.top-camera.bottom)*3/4,4);
  expect(capture).toHaveBeenCalledTimes(1);
  photo.render(preview,{...photoLooks.natural,exposure:1.08},{aspect:3/4,quality:'preview'});
  expect(capture).toHaveBeenCalledTimes(1); // Filters reuse frozen RGB pixels.
  photo.render(exported,photoLooks.natural,{aspect:16/9,quality:'export'});
  expect(exported.width).toBe(2560);expect(exported.height).toBe(1440);
  expect(camera.right-camera.left).toBeCloseTo((camera.top-camera.bottom)*16/9,4);
  expect(capture).toHaveBeenCalledTimes(2);
  photo.invalidate();
  photo.render(exported,photoLooks.natural,{aspect:16/9,quality:'export'});
  expect(capture).toHaveBeenCalledTimes(3);
  expect(photo.inspect()).toMatchObject({width:2560,height:1440,captures:3});
  photo.dispose();
  expect({left:camera.left,right:camera.right,top:camera.top,bottom:camera.bottom}).toEqual({left:original.left,right:original.right,top:original.top,bottom:original.bottom});
  expect(currentPixelRatio).toBe(original.ratio);
  expect([width,height]).toEqual(original.size);
  expect(draw).toHaveBeenCalled();
 });
});
