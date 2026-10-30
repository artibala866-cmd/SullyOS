// Actual Chromium/SwiftShader review of both carrying directions, 3 height
// combinations, 2 real skinned wardrobes and the enter/lift/hold/landing timeline.
// Screenshots are evidence for manual silhouette/cloth/hair review, not a
// claim that a geometric unit test proves absence of visible interpenetration.
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const out=join(process.cwd(),'home3d-carry-visual');mkdirSync(out,{recursive:true});
let binary=process.env.CHROME_BIN||'';
for(const cmd of ['google-chrome','chromium','chromium-browser'])if(!binary)try{binary=execFileSync('which',[cmd],{encoding:'utf8'}).trim();}catch{}
if(!binary)throw Error('Chromium is required');
const profile=mkdtempSync(join(tmpdir(),'sully-carry-'));
const chrome=spawn(binary,['--headless=new','--no-sandbox','--disable-dev-shm-usage',
 '--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader',
 '--remote-allow-origins=*','--remote-debugging-port=0','--window-size=1280,800',
 '--user-data-dir='+profile,'http://127.0.0.1:4173/test/home3d-carry-visual.html'],
 {stdio:['ignore','ignore','pipe']});
let stderr='',ws,report={status:'starting',errors:[]};chrome.stderr.on('data',v=>stderr=(stderr+v.toString()).slice(-20000));
try{
 let port=0;
 for(let until=Date.now()+70000;Date.now()<until;){if(chrome.exitCode!==null)throw Error('Chromium closed '+stderr.slice(-800));try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);if(port)break;}catch{}await delay(250);}
 if(!port)throw Error('No Chrome DevTools port '+stderr.slice(-700));
 let tab;for(let i=0;i<50&&!tab;i++){try{tab=(await fetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json())).find(x=>x.type==='page');}catch{}if(!tab)await delay(250);}
 if(!tab?.webSocketDebuggerUrl)throw Error('No page to inspect');
 ws=new WebSocket(tab.webSocketDebuggerUrl);
 await new Promise((ok,no)=>{const t=setTimeout(()=>no(Error('CDP websocket connection timeout')),12000);ws.addEventListener('open',()=>{clearTimeout(t);ok();},{once:true});ws.addEventListener('error',no,{once:true});});
 const pending=new Map();let next=0;
 ws.addEventListener('message',e=>{const r=JSON.parse(e.data),p=pending.get(r.id);if(!p)return;pending.delete(r.id);clearTimeout(p.t);r.error?p.no(Error(JSON.stringify(r.error))):p.ok(r.result);});
 const send=(method,params={})=>new Promise((ok,no)=>{const id=++next,t=setTimeout(()=>{pending.delete(id);no(Error('CDP '+method+' timeout'));},45000);pending.set(id,{ok,no,t});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async(expression)=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails).slice(0,700));return r.result?.value;};
 await send('Runtime.enable');await send('Page.enable');
 for(let until=Date.now()+900000;Date.now()<until;){
  const value=await evaluate('JSON.stringify(window.__carryVisualAcceptance??{status:"starting",stage:"waiting for scene"})');
  try{report=JSON.parse(value);}catch{}
  if(['pass','fail'].includes(report.status))break;
  await delay(1200);
 }
 writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2));
 console.log('Carry WebGL review:',JSON.stringify({status:report.status,stage:report.stage,images:report.images?.length,scenarios:report.sequences?.length,errors:report.errors}));
 // Persist available real WebGL frames even when acceptance rejects a pose.
 // A failed iteration must remain visually inspectable instead of uploading
 // only a JSON error, especially during motion choreography development.
 const complete=report.status==='pass'&&report.images.length===980&&report.sequences.length===12&&report.timelines.length===2;
 for(let i=0;i<report.images.length;i++){
  const src=await evaluate('document.querySelectorAll(".gallery figure img")['+i+']?.src');
  if(!src?.startsWith('data:image/png;base64,'))throw Error('Missing actual WebGL render '+i);
  const name=report.images[i].name;if(!/^[a-z0-9-]+$/.test(name))throw Error('Unsafe capture name');
  writeFileSync(join(out,name+'.png'),Buffer.from(src.slice(src.indexOf(',')+1),'base64'));
 }
 for(let i=0;i<(report.materialImages||[]).length;i++){
  const src=await evaluate('document.querySelectorAll(".materials figure img")['+i+']?.src');
  if(!src?.startsWith('data:image/png;base64,'))throw Error('Missing material WebGL frame '+i);
  const name=report.materialImages[i].name;
  if(!/^material-[a-z0-9-]+$/.test(name))throw Error('Unsafe material frame name '+name);
  writeFileSync(join(out,name+'.png'),Buffer.from(src.slice(src.indexOf(',')+1),'base64'));
 }
 if((report.materialImages||[]).length!==36)throw Error('Material coverage incomplete');
 if(!complete)throw Error('Carry WebGL fixture failed/incomplete: '+(report.errors||[]).join(' | ').slice(0,1000));
 const h=await evaluate('document.documentElement.scrollHeight');
 if(h<300)throw Error('Empty visual gallery '+h);
 // Save every frame individually; an extremely tall full-page screenshot OOMs.
 const img=await send('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:1280,height:800,scale:1}});
 if(img?.data)writeFileSync(join(out,'all-poses-desktop.png'),Buffer.from(img.data,'base64'));
 console.log('Saved 980 motion PNGs + 36 material WebGL PNGs, two 10Hz timelines and 30/60Hz joint traces.');

}finally{try{ws?.close();}catch{}try{chrome.kill('SIGTERM');}catch{}if(report.status!=='pass')console.error('Carry WebGL Chrome stderr',stderr.slice(-1200));}
