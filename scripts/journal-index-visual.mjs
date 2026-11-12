
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const origin=process.env.JOURNAL_VISUAL_ORIGIN||'http://127.0.0.1:5182';
const browser=process.env.CHROME_BIN||'google-chrome';
const out=process.env.JOURNAL_VISUAL_OUT||'/tmp/journal-index-shots';
mkdirSync(out,{recursive:true});
async function run(scene,width){
 const dir=mkdtempSync(join(tmpdir(),'journal-real-chrome-'));
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
  ws.addEventListener('message',event=>{const value=JSON.parse(event.data);if(value.id&&pending.has(value.id)){const {resolve,reject}=pending.get(value.id);pending.delete(value.id);value.error?reject(Error(JSON.stringify(value.error))):resolve(value.result)}});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
  await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
  await send('Page.navigate',{url:origin+'/tests/journal-index-visual.html?scene='+scene});
  let html='';
  for(let n=0;n<180;n++){
   const result=await send('Runtime.evaluate',{expression:'document.querySelector("output[data-journal-visual-ready]")?.outerHTML||document.querySelector("output[data-journal-visual-error]")?.outerHTML||""',returnByValue:true});
   html=result.result?.value||'';
   if(html.includes('data-journal-visual-ready="true"')||html.includes('data-journal-visual-error='))break;
   await sleep(150);
  }
  const shot=await send('Page.captureScreenshot',{format:'png',fromSurface:true});
  writeFileSync(join(out,'journal-real-'+scene+'-'+width+'.png'),Buffer.from(shot.data,'base64'));
  assert(html.includes('data-journal-visual-ready="true"'),'Actual JournalApp render failed '+html);
  assert(html.includes('data-no-horizontal-overflow="true"'),'Horizontal overflow '+html);
  assert(html.includes('data-white-background="true"'),'Not pure white '+html);
  assert(html.includes('data-has-card-shadow="false"'),'Floating card unexpectedly returned '+html);
  assert(html.includes('data-has-pen-button="true"'),'Ink pen CTA missing '+html);
  if(scene==='empty')assert(html.includes('data-count="0"'),'Empty state wrong '+html);
  else assert(html.includes('data-month-count="'), 'Month headers absent '+html);
  if(scene==='many')assert(html.includes('data-count="24"'),'Long list hidden entries '+html);
  if(scene==='two')assert(html.includes('data-count="2"'),'Two real diaries not rendered '+html);
  console.log('PASS actual JournalApp',scene,width,html);
  ws.close();
 }finally{child.kill('SIGTERM');await sleep(200);rmSync(dir,{recursive:true,force:true,maxRetries:3})}
}
for(const [scene,width] of [['two',390],['two',320],['empty',390],['many',320],['long',320]])await run(scene,width);
