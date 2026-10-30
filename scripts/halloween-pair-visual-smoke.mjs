// Chromium/SwiftShader evidence: all four original-motion-based Halloween
// pairs, both role orders, 3 height sets, 4 cameras, 5 phases, reconstructed
// old shared-root-yaw comparisons, explicit cancel/replay, real GLB props.
// Never mark the fix accepted based on screenshots alone: inspect the frames.
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const out=join(process.cwd(),'halloween-pair-visual');mkdirSync(out,{recursive:true});
let binary=process.env.CHROME_BIN||'';
for(const command of ['google-chrome','chromium','chromium-browser'])if(!binary)try{binary=execFileSync('which',[command],{encoding:'utf8'}).trim();}catch{}
if(!binary)throw Error('Chromium required for real WebGL');
const profile=mkdtempSync(join(tmpdir(),'sully-halloween-pair-'));
const chrome=spawn(binary,['--headless=new','--no-sandbox','--disable-dev-shm-usage',
 '--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader',
 '--remote-allow-origins=*','--remote-debugging-port=0','--window-size=1280,800',
 '--user-data-dir='+profile,'http://127.0.0.1:4173/test/halloween-pair-visual.html'],{stdio:['ignore','ignore','pipe']});
let stderr='',ws,report={status:'starting',errors:[],images:[],runs:[]};
chrome.stderr.on('data',v=>stderr=(stderr+v.toString()).slice(-20000));
try{
 let port=0;
 for(let until=Date.now()+65000;Date.now()<until;){if(chrome.exitCode!==null)throw Error('Chrome exited '+stderr.slice(-700));try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);if(port)break;}catch{}await delay(250);}
 if(!port)throw Error('DevTools port unavailable '+stderr.slice(-700));
 let tab;
 for(let i=0;i<50&&!tab;i++){try{tab=(await fetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json())).find(x=>x.type==='page');}catch{}if(!tab)await delay(250);}
 if(!tab?.webSocketDebuggerUrl)throw Error('CDP page missing');
 ws=new WebSocket(tab.webSocketDebuggerUrl);
 await new Promise((ok,no)=>{const t=setTimeout(()=>no(Error('CDP connection timeout')),12000);ws.addEventListener('open',()=>{clearTimeout(t);ok();},{once:true});ws.addEventListener('error',no,{once:true});});
 const pending=new Map();let next=0;
 ws.addEventListener('message',e=>{const p=JSON.parse(e.data),item=pending.get(p.id);if(!item)return;pending.delete(p.id);clearTimeout(item.t);p.error?item.reject(Error(JSON.stringify(p.error))):item.resolve(p.result);});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next,t=setTimeout(()=>{pending.delete(id);reject(Error('CDP '+method+' timeout'));},45000);pending.set(id,{resolve,reject,t});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails).slice(0,850));return r.result?.value;};
 await send('Runtime.enable');await send('Page.enable');
 for(let until=Date.now()+1100000;Date.now()<until;){
  const value=await evaluate('JSON.stringify(window.__halloweenPairVisualAcceptance??{status:"starting",stage:"loading"})');
  try{report=JSON.parse(value);}catch{}
  if(['pass','fail'].includes(report.status))break;
  await delay(1000);
 }
 writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2));
 console.info('Halloween pair WebGL:',JSON.stringify({status:report.status,stage:report.stage,images:report.images?.length,runs:report.runs?.length,errors:report.errors?.slice(0,3)}));
 // Save all available renders even on failure for postmortem comparison.
 for(let i=0;i<(report.images?.length??0);i++){
  const name=report.images[i].name;if(!/^[a-z0-9-]+$/.test(name))throw Error('Unsafe screenshot name '+name);
  const src=await evaluate('document.querySelectorAll(".gallery figure img")['+i+']?.src');
  if(!src?.startsWith('data:image/png;base64,'))throw Error('Missing real WebGL screenshot '+i);
  writeFileSync(join(out,name+'.png'),Buffer.from(src.slice(src.indexOf(',')+1),'base64'));
 }
 const expected=4*3*2*(5+2)*4;
 if(report.status!=='pass'||report.images?.length!==expected||report.runs?.length!==24)throw Error('Missing or failed WebGL acceptance: '+(report.errors||[]).join(' | ').slice(0,1000));
 const shot=await send('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:1280,height:800,scale:1}});
 if(shot?.data)writeFileSync(join(out,'gallery-preview.png'),Buffer.from(shot.data,'base64'));
 console.log('Saved '+expected+' actual WebGL captures and per-frame position, orientation, hand, prop, foot reports.');
}finally{try{ws?.close();}catch{}try{chrome.kill('SIGTERM');}catch{}if(report.status!=='pass')console.error('Chrome tail:',stderr.slice(-1200));}
