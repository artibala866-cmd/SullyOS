// Real headless Chromium / SwiftShader check of photo aspect, 2560px PNG pixels,
// same-shot filter changes and complete scene restoration after capture.
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const output=join(process.cwd(),'home3d-photo-acceptance');mkdirSync(output,{recursive:true});
let binary=process.env.CHROME_BIN||'';
for(const cmd of ['google-chrome','chromium','chromium-browser'])if(!binary)try{binary=execFileSync('which',[cmd],{encoding:'utf8'}).trim();}catch{}
if(!binary)throw Error('Chromium is required');
const profile=mkdtempSync(join(tmpdir(),'sully-photo-'));
const chrome=spawn(binary,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-allow-origins=*','--remote-debugging-port=0','--window-size=1280,800','--user-data-dir='+profile,'http://127.0.0.1:4173/test/home3d-photo-export.html'],{stdio:['ignore','ignore','pipe']});
let stderr='',socket,report={status:'starting',errors:[]};chrome.stderr.on('data',x=>stderr=(stderr+x.toString()).slice(-10000));
try{
 let port=0;for(const until=Date.now()+60000;Date.now()<until;){try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);if(port)break;}catch{}await delay(250);}
 if(!port)throw Error('Chromium debugger unavailable: '+stderr.slice(-400));
 let tab;for(let i=0;i<40&&!tab;i++){try{tab=(await fetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json())).find(x=>x.type==='page');}catch{}if(!tab)await delay(250);}
 if(!tab?.webSocketDebuggerUrl)throw Error('Chrome page not found');
 socket=new WebSocket(tab.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('CDP timeout')),12000);socket.addEventListener('open',()=>{clearTimeout(t);resolve();},{once:true});socket.addEventListener('error',reject,{once:true});});
 const pending=new Map();let id=0;socket.addEventListener('message',e=>{const msg=JSON.parse(e.data),p=pending.get(msg.id);if(!p)return;clearTimeout(p.t);pending.delete(msg.id);msg.error?p.reject(Error(JSON.stringify(msg.error))):p.resolve(msg.result);});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const num=++id,t=setTimeout(()=>{pending.delete(num);reject(Error('Timed out '+method));},30000);pending.set(num,{resolve,reject,t});socket.send(JSON.stringify({id:num,method,params}));});
 await send('Page.enable');await send('Runtime.enable');
 for(const until=Date.now()+210000;Date.now()<until;){
  const result=await send('Runtime.evaluate',{expression:'JSON.stringify(window.__photoExportSmoke??{status:"starting"})',returnByValue:true});
  report=JSON.parse(result?.result?.value||'{}');if(['pass','fail'].includes(report.status))break;
  await delay(800);
 }
 writeFileSync(join(output,'result.json'),JSON.stringify(report,null,2));
 console.info('Home3D photo WebGL export:',JSON.stringify(report));
 if(report.status!=='pass'||report.formats?.length!==8)throw Error('Photo WebGL acceptance failed: '+(report.errors||[]).join(' | ').slice(0,800));
 const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
 if(!shot?.data)throw Error('No real WebGL photo screenshot');
 writeFileSync(join(output,'eight-original-and-paper-photos.png'),Buffer.from(shot.data,'base64'));
}finally{try{socket?.close();}catch{}try{chrome.kill('SIGTERM');}catch{}if(report.status!=='pass')console.error(stderr.slice(-500));}
