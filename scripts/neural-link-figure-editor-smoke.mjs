// Actual Chromium DevTools smoke for the existing 3D Q-figure editor.
// Poll real elapsed time, not Chromium virtual time, so image loading cannot be outrun by timers.
import {spawn} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const output='figure-visual';
const chrome=process.env.CHROME_BIN;
if(!chrome)throw Error('Chrome path required');
const profile=mkdtempSync(join(tmpdir(),'sully-figure-'));
const pageUrl='http://127.0.0.1:5173/tests/neural-link-cabinet-visual.html?scene=editor&existing=1';
const cp=spawn(chrome,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--remote-allow-origins=*','--remote-debugging-port=0','--window-size=430,930','--user-data-dir='+profile,pageUrl],{stdio:['ignore','ignore','pipe']});
let stderr='',ws,port;
cp.stderr.on('data',x=>{stderr=(stderr+x.toString()).slice(-12000);});
const exceptions=[],messages=[];
try{
 const limit=Date.now()+45000;
 while(Date.now()<limit){try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);if(port)break;}catch{}await delay(250);}
 if(!port)throw Error('Browser startup failed '+stderr.slice(-1500));
 let target;
 for(let i=0;i<80&&!target;i++){try{target=(await fetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json())).find(x=>x.type==='page');}catch{}if(!target)await delay(250);}
 if(!target?.webSocketDebuggerUrl)throw Error('No Chromium CDP page');
 ws=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 const pending=new Map();let id=0;
 ws.addEventListener('message',ev=>{let x=JSON.parse(ev.data);if(x.method==='Runtime.exceptionThrown')exceptions.push(JSON.stringify(x.params).slice(0,800));if(x.method==='Runtime.consoleAPICalled'&&x.params.type==='error')messages.push(JSON.stringify(x.params.args).slice(0,800));if(x.id&&pending.has(x.id)){let p=pending.get(x.id);pending.delete(x.id);clearTimeout(p.timer);x.error?p.reject(Error(JSON.stringify(x.error))):p.resolve(x.result);}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error('CDP timeout '+method));},30000);pending.set(key,{resolve,reject,timer});ws.send(JSON.stringify({id:key,method,params}));});
 await send('Runtime.enable');await send('Page.enable');
 let state={},passed=false;
 const check=async()=>{
  const r=await send('Runtime.evaluate',{expression:`JSON.stringify((()=>{const button=document.querySelector('.home-figure-save');const iframe=document.querySelector('iframe');const frame=iframe?.contentWindow;let api={};try{api={state:frame?.eval('typeof state'),parts:frame?.eval('typeof PARTS'),merge:frame?.eval('typeof mergeExtraItems'),imageCount:iframe?.contentDocument?.querySelectorAll('.character img').length,iframeReady:iframe?.contentDocument?.readyState}}catch(e){api={error:String(e)}}return {bodyReady:document.body.dataset.figureVisualReady,buttonPresent:!!button,buttonDisabled:button?.disabled,loading:document.body.textContent?.includes('正在还原 3D 形象'),alerts:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent?.slice(0,200)),iframe:api};})())`,returnByValue:true});
  return JSON.parse(r?.result?.value??'{}');
 };
 // Do not treat the first lazy-mounted frame as a failure: allow real network and renderer time.
 for(let i=0;i<75;i++){
  state=await check();
  if(state.buttonPresent&&state.buttonDisabled===false&&state.loading===false){passed=true;break;}
  if(i%10===0)console.info('Figure reconstruction stage',i,state);
  await delay(1000);
 }
 const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
 if(shot?.data)writeFileSync(join(output,'saved-editor.png'),Buffer.from(shot.data,'base64'));
 const report={passed,state,exceptions:exceptions.slice(-8),consoleErrors:messages.slice(-8),url:pageUrl};
 writeFileSync(join(output,'saved-editor-report.json'),JSON.stringify(report,null,2));
 console.info('Real 3D figure editor result:',JSON.stringify(report));
 if(!passed)throw Error('3D Q figure did not reconstruct and unlock saving in Chromium');
}finally{try{ws?.close();}catch{}cp.kill('SIGTERM');}
