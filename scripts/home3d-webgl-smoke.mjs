// CI-only Chromium DevTools driver for the real Home3D editor and classic rig.
// It runs the isolated test/home3d-smoke.html fixture, not the production app.
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const output=join(process.cwd(),'home3d-webgl-smoke');
mkdirSync(output,{recursive:true});
let binary=process.env.CHROME_BIN||'';
if(!binary)for(const name of ['google-chrome','chromium','chromium-browser']){
 try{binary=execFileSync('which',[name],{encoding:'utf8'}).trim();break;}catch{}
}
if(!binary)throw new Error('Chromium is required for WebGL smoke test');
const profile=mkdtempSync(join(tmpdir(),'sully-home3d-'));
const chrome=spawn(binary,[
 '--headless=new','--no-sandbox','--disable-dev-shm-usage',
 '--enable-webgl','--use-gl=angle','--use-angle=swiftshader',
 '--enable-unsafe-swiftshader','--remote-allow-origins=*',
 '--remote-debugging-port=0','--window-size=1280,800',
 '--user-data-dir='+profile,'http://127.0.0.1:4173/test/home3d-smoke.html'
],{stdio:['ignore','ignore','pipe']});
let stderr='';chrome.stderr.on('data',x=>{stderr=(stderr+x.toString()).slice(-20000);});
let port=0,ws,report={status:'fail',stage:'init',errors:[]};
// Shared CI runners can take longer to launch SwiftShader under parallel
// regression load. This only extends browser startup, never motion tolerances.
const deadline=Date.now()+60000;
try{
 while(Date.now()<deadline){
  if(chrome.exitCode!==null)throw Error('Chromium exited prematurely: '+stderr.slice(-1000));
  try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);if(port)break;}catch{}
  await delay(250);
 }
 if(!port)throw Error('DevTools websocket did not start: '+stderr.slice(-1000));
 let tab=null;
 for(let i=0;i<40&&!tab;i++){
  try{const result=await fetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json());tab=result.find(x=>x.type==='page');}catch{}
  if(!tab)await delay(250);
 }
 if(!tab?.webSocketDebuggerUrl)throw Error('Cannot locate Chromium WebGL test page');
 ws=new WebSocket(tab.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(Error('Chrome DevTools websocket timeout')),10000);
  ws.addEventListener('open',()=>{clearTimeout(timeout);resolve();},{once:true});
  ws.addEventListener('error',e=>{clearTimeout(timeout);reject(Error('WebSocket error '+String(e)));},{once:true});
 });
 const pending=new Map();let seq=0;
 ws.addEventListener('message',e=>{
  const msg=JSON.parse(e.data);
  if(msg.id&&pending.has(msg.id)){
   const {resolve,reject,timeout}=pending.get(msg.id);clearTimeout(timeout);pending.delete(msg.id);
   msg.error?reject(Error(JSON.stringify(msg.error))):resolve(msg.result);
  }
 });
 const send=(method,params={})=>new Promise((resolve,reject)=>{
  const id=++seq,timeout=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},method==='Page.captureScreenshot'?30000:15000);
  pending.set(id,{resolve,reject,timeout});ws.send(JSON.stringify({id,method,params}));
 });
 await send('Page.enable');
 await send('Runtime.enable');
 const until=Date.now()+420000; // full seat/bed/prop actions plus bath contact-stage screenshots in software WebGL
 const captured=new Set();
 async function captureRealFrame(stage){
  // The software WebGL compositor can time out during expensive frame copies.
  // Retry via Chromium's viewport screenshot path, never reusing old pixels.
  try{
   return await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  }catch(first){
   console.warn('Surface capture timed out for '+stage+': '+String(first));
   const response=await send('Page.captureScreenshot',{
    format:'png',fromSurface:false,captureBeyondViewport:false,
    clip:{x:0,y:0,width:960,height:600,scale:1}
   });
   if(!response?.data)throw Error('Real WebGL fallback capture empty: '+stage);
   return response;
  }
 }
 while(Date.now()<until){
  const result=await send('Runtime.evaluate',{expression:'JSON.stringify(window.__home3dSmoke ?? {status:"starting",stage:"waiting for module"})',returnByValue:true});
  const value=result?.result?.value;
  try{report=JSON.parse(value||'{}');}catch{}
  // Capture the actual WebGL canvas at authored contact phases, not merely
  // a status screenshot after the model has already exited the furniture.
  // These are reviewable evidence, NOT a computer-vision pass/fail verdict.
  const stage=report.captureStage;
  if(stage&&/^[a-z0-9-]{3,40}$/.test(stage)&&!captured.has(stage)){
   console.info('WebGL screenshot stage: '+stage);
   const shot=await captureRealFrame(stage);
   if(!shot?.data)throw Error('Cannot capture the real WebGL frame: '+stage);
   const bytes=Buffer.from(shot.data,'base64');
   if(stage.endsWith('-side')){
    const primary=readFileSync(join(output,'bath-'+stage.slice(0,-5)+'.png'));
    if(bytes.equals(primary))throw Error('Bathtub camera did not redraw before side-view capture: '+stage);
   }
   writeFileSync(join(output,'bath-'+stage+'.png'),bytes);
   captured.add(stage);
   await send('Runtime.evaluate',{expression:'window.__home3dSmoke.capturedStages = [...(window.__home3dSmoke.capturedStages ?? []), '+JSON.stringify(stage)+']'});
  }
  if(['pass','fail'].includes(report.status))break;
  await delay(1100);
 }
 const screenshot=await captureRealFrame('final-scene');
 if(screenshot?.data)writeFileSync(join(output,'scene.png'),Buffer.from(screenshot.data,'base64'));
 writeFileSync(join(output,'result.json'),JSON.stringify(report,null,2));
 console.info('Home3D browser smoke:',JSON.stringify(report));
 if(report.status!=='pass')throw Error('3D browser smoke did not pass: '+(report.errors||[]).join('; '));
}finally{
 try{ws?.close();}catch{}
 try{chrome.kill('SIGTERM');}catch{}
 if(report.status!=='pass')console.error('Chromium tail:',stderr.slice(-1800));
}
