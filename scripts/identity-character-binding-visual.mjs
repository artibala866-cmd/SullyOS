import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const origin=process.env.IDENTITY_VISUAL_ORIGIN||'http://127.0.0.1:5196';
const browser=process.env.CHROME_BIN||'google-chrome';
const out=process.env.IDENTITY_VISUAL_OUT||'/tmp/identity-binding-shots';
mkdirSync(out,{recursive:true});
async function run(width,bound){
 const dir=mkdtempSync(join(tmpdir(),'identity-real-chrome-'));
 const child=spawn(browser,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-extensions','--no-first-run','--remote-allow-origins=*','--remote-debugging-port=0','--user-data-dir='+dir,'--window-size='+width+',844','about:blank'],{stdio:['ignore','ignore','pipe']});
 let stderr='';child.stderr?.on('data',x=>{stderr+=String(x).slice(0,2000)});
 try{
  let port;
  for(let n=0;n<250;n++){if(child.exitCode!==null)throw Error('Chrome terminated: '+stderr.slice(-2000));try{port=Number(readFileSync(join(dir,'DevToolsActivePort'),'utf8').split('\n')[0]);if(port)break}catch{}await sleep(120)}
  assert(port,'Chrome debug port missing '+stderr);
  const targets=await fetch('http://127.0.0.1:'+port+'/json/list').then(x=>x.json());
  const target=targets.find(t=>t.type==='page');assert(target,'Missing Chrome page');
  const ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})});
  let next=0;const pending=new Map();
  ws.addEventListener('message',event=>{const v=JSON.parse(event.data);if(v.id&&pending.has(v.id)){const p=pending.get(v.id);pending.delete(v.id);v.error?p.reject(Error(JSON.stringify(v.error))):p.resolve(v.result)}});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
  const evaluate=async expression=>{const v=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(v.exceptionDetails)throw Error(v.exceptionDetails.text);return v.result?.value};
  const shot=async name=>{const result=await send('Page.captureScreenshot',{format:'png',fromSurface:true});writeFileSync(join(out,name+'-'+width+'.png'),Buffer.from(result.data,'base64'))};
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
  await send('Page.navigate',{url:origin+'/tests/identity-character-binding-visual.html'+(bound?'?bound=1':'')});
  let status;
  for(let n=0;n<180;n++){
   status=await evaluate('({ready:!!document.querySelector("output[data-identity-visual-ready]"),error:document.querySelector("output[data-identity-visual-error]")?.dataset.identityVisualError||"",buttons:document.querySelectorAll("button[aria-pressed][aria-label*=长按]").length})');
   if(status.error)throw Error('Archive render '+status.error);
   if(status.ready&&status.buttons===8)break;
   await sleep(150);
  }
  assert(status?.ready && status.buttons===8,'Archive avatar grid did not render '+JSON.stringify(status));
  await sleep(650);
  const initial=await evaluate('({visible:document.querySelector("output[data-identity-visual-ready]").dataset.visibleIds,bound:document.querySelector("output[data-identity-visual-ready]").dataset.boundIds,overflow:document.documentElement.scrollWidth>innerWidth+1,card:document.querySelector("button[aria-label*=长按]")?.getBoundingClientRect().toJSON(),viewport:innerWidth})');
  assert(!initial.overflow,'Identity avatar grid horizontal overflow at '+width);
  assert(initial.card?.width > 30,'No visible character card');
  if(bound) {
   assert.equal(initial.bound,'role-0,role-2','Pre-bound roles not marked');
   assert.equal(initial.visible,'role-0,role-2','Bound picker list not isolated');
   await shot('identity-prebound');
  } else {
   assert.equal(initial.bound,'','Legacy default unexpectedly bound');
   assert.equal(initial.visible,'role-0,role-1,role-2,role-3,role-4,role-5,role-6,role-7','Unbound picker not full roster');
   await shot('identity-unbound');
   const rect=initial.card;
   const x=Math.round(rect.x+rect.width/2),y=Math.round(rect.y+rect.height/2);
   assert(y>20 && y<844,'Role avatar outside viewport '+JSON.stringify(rect));
   if(width===320){
     // Exercise the actual touch path, including Android's context-menu behavior.
     await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
     await sleep(680);
     await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   } else {
     await send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
     await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
     await sleep(680);
     await send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
   }
   await sleep(350);
   const after=await evaluate('({bound:document.querySelector("output[data-identity-visual-ready]").dataset.boundIds,visible:document.querySelector("output[data-identity-visual-ready]").dataset.visibleIds,pressed:document.querySelector("button[aria-label*=长按]")?.getAttribute("aria-pressed"),modal:document.body.innerText.includes("图床链接（推荐）"),overflow:document.documentElement.scrollWidth>innerWidth+1})');
   assert.equal(after.bound,'role-0','Long press did not save first role '+JSON.stringify(after));
   assert.equal(after.visible,'role-0','Post-bind chooser shows unbound roles '+JSON.stringify(after));
   assert.equal(after.pressed,'true','Selected avatar not visibly marked');
   assert.equal(after.modal,false,'Long press accidentally opened old avatar editor');
   assert(!after.overflow,'Horizontal overflow after selection');
   await shot('identity-after-longpress');
  }
  console.log('PASS actual UserApp identity binding',width,bound?'prebound':'longpress',initial);
  ws.close();
 }finally{child.kill('SIGTERM');await sleep(200);rmSync(dir,{recursive:true,force:true,maxRetries:3})}
}
for(const [width,bound] of [[390,false],[320,false],[390,true],[320,true]])await run(width,bound);
