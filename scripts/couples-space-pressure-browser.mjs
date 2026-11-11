// Real headless Chromium with an exact 390px/320px mobile CSS viewport.
// Drives actual BondRecords panels over thousands of synthetic saved entries.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const [url,widthArg] = process.argv.slice(2);
const width = Number(widthArg);
if (!url || ![320,390].includes(width)) throw new Error('Usage: node scripts/couples-space-pressure-browser.mjs URL 320|390');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = await mkdtemp(join(tmpdir(), 'couples-pressure-'));
const browser = spawn(process.env.CHROME_BIN || 'chromium', [
  '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run',
  '--remote-debugging-port=0','--no-proxy-server','--user-data-dir='+profile,'about:blank',
], { stdio:'ignore' });
let ws;
try {
  let port;
  for(let i=0;i<120;i++){
    try { port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]); if(port)break; }
    catch {}
    await pause(100);
  }
  if(!port)throw new Error('Chromium CDP did not start');
  const targets=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  const page=targets.find(row=>row.type==='page');
  if(!page)throw new Error('No Chromium page target');
  ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  let seq=0;const pending=new Map();
  ws.onmessage=event=>{
    const data=JSON.parse(event.data),promise=pending.get(data.id);
    if(!promise)return;
    pending.delete(data.id);
    if(data.error)promise.reject(Error(JSON.stringify(data.error)));
    else promise.resolve(data.result);
  };
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));
  });
  const js=async expression=>{
    const res=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(res.exceptionDetails)throw Error(JSON.stringify(res.exceptionDetails));
    return res.result?.value;
  };
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
  await cdp('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  const navigation=await cdp('Page.navigate',{url});
  if(navigation.errorText)throw new Error('Page did not load: '+navigation.errorText);
  let metrics;
  for(let i=0;i<220;i++){
    try {
      metrics=await js('(() => {const e=document.querySelector("#couple-pressure-report");return e && e.dataset.ready==="true" ? {entries:Number(e.dataset.entries),visits:Number(e.dataset.visits),width:innerWidth,overflow:e.dataset.overflow,errors:Number(e.dataset.errors),final:e.dataset.final,details:e.textContent}:null;})()');
      if(metrics)break;
    } catch {}
    await pause(250);
  }
  if(!metrics)throw Error('Pressure fixture never finished its real navigation cycle');
  console.log('Couples browser pressure metrics:',JSON.stringify(metrics));
  if(metrics.entries!==3200 || metrics.visits!==35 || metrics.width!==width ||
      metrics.overflow!=='false' || metrics.errors!==0)throw Error('FAIL: '+JSON.stringify(metrics));
  await mkdir('output/couples-pressure',{recursive:true});
  const shot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await writeFile('output/couples-pressure/mobile-'+width+'.png',Buffer.from(shot.data,'base64'));
  console.log('PASS: '+width+'px, 3,200 records, 35 real page switches, no JS errors or horizontal overflow.');
}finally{
  ws?.close();browser.kill('SIGTERM');await pause(250);
  await rm(profile,{recursive:true,force:true});
}
