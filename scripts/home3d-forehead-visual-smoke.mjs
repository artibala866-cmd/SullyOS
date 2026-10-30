// Real Chromium/SwiftShader review gallery for 20 complete costumes and 9×2 pet hats.
// CI saves every authored WebGL frame and full desktop/mobile galleries as artifacts.
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const dir=join(process.cwd(),'home3d-forehead-acceptance');mkdirSync(dir,{recursive:true});
let binary=process.env.CHROME_BIN||'';
for(const cmd of ['google-chrome','chromium','chromium-browser'])if(!binary)try{binary=execFileSync('which',[cmd],{encoding:'utf8'}).trim();}catch{}
if(!binary)throw Error('Chromium is required');
const profile=mkdtempSync(join(tmpdir(),'sully-forehead-'));
const chrome=spawn(binary,['--headless=new','--no-sandbox','--disable-dev-shm-usage',
 '--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader',
 '--remote-allow-origins=*','--remote-debugging-port=0','--window-size=1280,800',
 '--user-data-dir='+profile,'http://127.0.0.1:4173/test/home3d-forehead.html'],{stdio:['ignore','ignore','pipe']});
let stderr='',ws,report={status:'starting',errors:[]};chrome.stderr.on('data',x=>stderr=(stderr+x.toString()).slice(-16000));
try{
 let port=0;
 for(let until=Date.now()+60000;Date.now()<until;){try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);if(port)break;}catch{}await delay(250);}
 if(!port)throw Error('No Chrome DevTools port: '+stderr.slice(-500));
 let tab;
 for(let i=0;i<40&&!tab;i++){try{const pages=await fetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json());tab=pages.find(x=>x.type==='page');}catch{}if(!tab)await delay(250);}
 if(!tab?.webSocketDebuggerUrl)throw Error('No Chromium page');
 ws=new WebSocket(tab.webSocketDebuggerUrl);
 await new Promise((ok,no)=>{const timeout=setTimeout(()=>no(Error('CDP websocket timeout')),12000);ws.addEventListener('open',()=>{clearTimeout(timeout);ok();},{once:true});ws.addEventListener('error',no,{once:true});});
 const pending=new Map();let seq=0;
 ws.addEventListener('message',e=>{const o=JSON.parse(e.data);if(o.id&&pending.has(o.id)){const a=pending.get(o.id);clearTimeout(a.t);pending.delete(o.id);o.error?a.no(Error(JSON.stringify(o.error))):a.ok(o.result);}});
 const send=(method,params={})=>new Promise((ok,no)=>{const id=++seq,t=setTimeout(()=>{pending.delete(id);no(Error('CDP '+method+' timed out'));},30000);pending.set(id,{ok,no,t});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async(expression)=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails).slice(0,800));return r.result?.value;};
 await send('Page.enable');await send('Runtime.enable');
 for(let until=Date.now()+480000;Date.now()<until;){
  const value=await evaluate('JSON.stringify(window.__foreheadVisualAcceptance??{status:"starting",stage:"waiting"})');
  try{report=JSON.parse(value);}catch{}
  if(['pass','fail'].includes(report.status))break;
  await delay(1250);
 }
 writeFileSync(join(dir,'result.json'),JSON.stringify(report,null,2));
 console.info('Forehead contact WebGL acceptance:',JSON.stringify({status:report.status,stage:report.stage,frames:report.frames?.length,contacts:report.contacts,styles:report.styles,errors:report.errors}));
 if(report.status!=='pass')throw Error('Forehead contact scene failed: '+(report.errors||[]).join(' | ').slice(0,1000));
 if(report.frames?.length!==8||report.contacts?.length!==4)throw Error('Missing paired contact style/height frames');
 // Every file below is an actual WebGL framebuffer, not a GLB thumbnail.
 for(let i=0;i<8;i++){
  const src=await evaluate('document.querySelectorAll(".gallery figure img")['+i+']?.src');
  if(!src?.startsWith('data:image/png;base64,'))throw Error('Missing render image '+i);
  const name=report.images[i].name;
  if(!/^[a-z0-9-]+$/.test(name))throw Error('Invalid screenshot name');
  writeFileSync(join(dir,name+'.png'),Buffer.from(src.slice(src.indexOf(',')+1),'base64'));
 }
 const capture=async(filename,width)=>{
  if(width===390)await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await delay(300);
  const height=Math.ceil(await evaluate('document.documentElement.scrollHeight'));
  if(height<350||height>15000)throw Error('Unexpected '+width+' gallery height '+height);
  const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height,scale:1}});
  if(!shot?.data)throw Error('Screenshot missing '+width);
  writeFileSync(join(dir,filename),Buffer.from(shot.data,'base64'));
 };
 await capture('desktop-gallery.png',1280);await capture('mobile-gallery.png',390);
 console.info('Captured 8 individual real WebGL forehead-contact poses plus desktop/mobile galleries');
}finally{try{ws?.close();}catch{}try{chrome.kill('SIGTERM');}catch{}if(report.status!=='pass')console.error('Chrome tail:',stderr.slice(-1000));}
