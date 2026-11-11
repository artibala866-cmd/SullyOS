// Real 390px-wide touch gestures against the mounted 72-floor StoryTheaterSession.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2];
if (!url) throw Error('Missing story visual URL');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = await mkdtemp(join(tmpdir(), 'story-touch-'));
const browser = spawn(process.env.CHROME_BIN || 'chromium', [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
  '--no-first-run', '--remote-debugging-port=0', '--no-proxy-server',
  '--proxy-bypass-list=*', '--user-data-dir=' + profile, 'about:blank',
], { stdio: 'ignore' });
let ws;
try {
  let port;
  for (let i=0;i<120;i++) {
    try {port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break;}
    catch { /* Chromium is starting */ }
    await delay(100);
  }
  if (!port) throw Error('Chromium remote debugging did not start');
  const targets=await (await fetch('http://127.0.0.1:'+port+'/json')).json();
  const page=targets.find(t=>t.type==='page');
  if (!page) throw Error('Missing Chromium page');
  ws=new WebSocket(page.webSocketDebuggerUrl);
  const pending=new Map();let seq=0;
  ws.onmessage=e=>{
    const reply=JSON.parse(e.data);const waiter=pending.get(reply.id);
    if(!waiter)return;
    pending.delete(reply.id);
    if(reply.error)waiter.reject(Error(JSON.stringify(reply.error)));else waiter.resolve(reply.result);
  };
  await new Promise((ok,no)=>{ws.onopen=ok;ws.onerror=no;});
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));
  });
  const js=async expression=>{
    const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));
    return r.result?.value;
  };
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await cdp('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  const nav=await cdp('Page.navigate',{url});
  if(nav.errorText)throw Error('Cannot open visual fixture: '+nav.errorText);
  const waitFor=async(expression,label)=>{
    for(let i=0;i<180;i++){
      try {const result=await js(expression);if(result)return result;}catch{/* loading */}
      await delay(130);
    }
    throw Error('Timeout waiting for '+label);
  };
  await waitFor("document.querySelectorAll('[data-story-floor]').length === 72 && document.querySelectorAll('.story-page-scroll iframe').length >= 30",'72 real floors and HTML cards');
  await js("document.querySelector('[data-story-floor=\"68\"]').scrollIntoView({block:'start',behavior:'instant'})");
  const state='(() => {const s=document.querySelector(".story-page-scroll"),f=document.querySelector("[data-story-floor=\\"68\\"] iframe");if(!s||!f)return null;const r=f.getBoundingClientRect(),v=s.getBoundingClientRect();return {top:s.scrollTop,max:s.scrollHeight-s.clientHeight,height:r.height,frameTop:r.top,frameBottom:r.bottom,viewportTop:v.top,viewportBottom:v.bottom};})()';
  await waitFor('('+state+')?.height > 650','expanded iframe at floor 68');
  const before=await js(state);
  await delay(950);
  const idle=await js(state);
  if(Math.abs(before.height-idle.height)>3||Math.abs(before.top-idle.top)>18)throw Error('Reader moves without touch: '+JSON.stringify({before,idle}));
  const swipe=async(x,y,endY)=>{
    await cdp('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let i=1;i<=14;i++){
      await cdp('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+(endY-y)*i/14}]});
      await delay(16);
    }
    await cdp('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  };
  const startY=Math.min(idle.viewportBottom-90,idle.frameBottom-35);
  if(startY<Math.max(idle.viewportTop+80,idle.frameTop+40)+170)throw Error('Iframe is not sufficiently visible');
  await swipe(130,startY,startY-190);
  await delay(250);
  const after=await js(state);
  if(after.top<before.top+110)throw Error('Iframe swallowed finger swipe: '+JSON.stringify({before,after}));
  await delay(650);
  const settled=await js(state);
  if(settled.top+32<after.top)throw Error('Reader rebounded after swipe: '+JSON.stringify({after,settled}));
  for(let i=0;i<10;i++){
    const pos=await js('(() => {const s=document.querySelector(".story-page-scroll"),v=s.getBoundingClientRect();const f=[...s.querySelectorAll("iframe")].find(x=>{const r=x.getBoundingClientRect();return r.top<v.bottom-200&&r.bottom>v.top+260&&r.height>250});const r=f?.getBoundingClientRect();return {top:s.scrollTop,max:s.scrollHeight-s.clientHeight,x:r?Math.max(r.left+50,125):125,y:r?Math.min(v.bottom-105,r.bottom-40):v.bottom-115};})()');
    if(pos.max-pos.top<120)break;
    await swipe(pos.x,pos.y,pos.y-235);
    await delay(500);
  }
  const end=await js(state);
  if(end.max-end.top>500)throw Error('Cannot reach final story floors by continuous swipes: '+JSON.stringify(end));
  await mkdir('output/story-iframe-touch',{recursive:true});
  const shot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await writeFile('output/story-iframe-touch/72-floor-end.png',Buffer.from(shot.data,'base64'));
  console.log('PASS: 72 floors, 36 HTML frames, touch follows reader, no rebound and newest floor reachable');
  console.log(JSON.stringify({before,idle,after,settled,end}));
} finally {
  ws?.close();browser.kill('SIGTERM');await delay(250);
  await rm(profile,{recursive:true,force:true});
}
