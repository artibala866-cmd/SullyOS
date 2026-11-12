/* Actual Chromium mobile-viewport regression of Character.tsx import modal.
 * Captures screenshots and DOM assertions, never downloads users' private cards.
 * Uses Chrome DevTools Protocol without importing Playwright/npm browser packages. */
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';

const chromePath=process.env.CHROME_PATH || process.argv[2];
if(!chromePath)throw Error('Missing Chrome binary');
const port=9223;
const profile=mkdtempSync(join(tmpdir(),'card-import-chrome-'));
const out=resolve('card-import-visual-artifacts');mkdirSync(out,{recursive:true});
const chrome=spawn(chromePath,[
 '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
 '--remote-debugging-port='+port,'--no-first-run','--no-default-browser-check',
 '--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
try{
 let pages;
 for(let attempt=0;attempt<70;attempt++){
  try{
   pages=await (await fetch('http://127.0.0.1:'+port+'/json')).json();
   if(pages?.some(p=>p.webSocketDebuggerUrl))break;
  }catch{}
  await sleep(130);
 }
 const page=pages?.find(p=>p.type==='page'&&p.webSocketDebuggerUrl);
 if(!page)throw Error('Chromium debugging page unavailable');
 const ws=new WebSocket(page.webSocketDebuggerUrl);
 const pending=new Map();let serial=1;
 ws.addEventListener('message',event=>{
  const response=JSON.parse(event.data);
  if(!response.id)return;
  const p=pending.get(response.id);
  if(!p)return;
  pending.delete(response.id);
  if(response.error)p.reject(Error(JSON.stringify(response.error)));
  else p.resolve(response.result);
 });
 await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
 const cmd=(method,params={})=>new Promise((resolve,reject)=>{
  const id=serial++;pending.set(id,{resolve,reject});
  ws.send(JSON.stringify({id,method,params}));
 });
 const evaluate=async expression=>(await cmd('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result?.value;
 await cmd('Page.enable');await cmd('Runtime.enable');
 const cases=[
  {name:'tavern-390',source:'tavern',w:390,h:844},
  {name:'batch-390',source:'batch',w:390,h:844},
  {name:'batch-320',source:'batch',w:320,h:690},
  {name:'batch-landscape',source:'batch',w:844,h:390},
  {name:'link-390',source:'link',w:390,h:844},
  {name:'document-390',source:'document',w:390,h:844},
  {name:'remark-tavern-390',source:'remark-tavern',w:390,h:844},
  {name:'remark-link-390',source:'remark-link',w:390,h:844},
  {name:'remark-tavern-320',source:'remark-tavern',w:320,h:690},
  {name:'remark-link-320',source:'remark-link',w:320,h:690},
  {name:'link-openings-390',source:'link-openings',w:390,h:844},
  {name:'link-openings-320',source:'link-openings',w:320,h:690},
  {name:'tavern-320',source:'tavern',w:320,h:690},
  {name:'document-320',source:'document',w:320,h:690},
  {name:'worldbook-390',source:'worldbook',w:390,h:844},
  {name:'worldbook-320',source:'worldbook',w:320,h:690},
  {name:'worldbook-landscape',source:'worldbook',w:844,h:390},
  {name:'user-profile-390',source:'user-profile',w:390,h:844},
  {name:'user-profile-320',source:'user-profile',w:320,h:690},
  {name:'user-profile-pdf-390',source:'user-profile-pdf',w:390,h:844},
  {name:'user-profile-word-390',source:'user-profile-word',w:390,h:844},
  {name:'user-profile-saved-390',source:'user-profile-saved',w:390,h:844},
  {name:'user-profile-whitespace-390',source:'user-profile-whitespace',w:390,h:844},
  {name:'user-profile-duplicate-390',source:'user-profile-duplicate',w:390,h:844},
  {name:'user-profile-cancel-320',source:'user-profile-cancel',w:320,h:690},
  {name:'user-profile-failure-320',source:'user-profile-failure',w:320,h:690},
  {name:'user-profile-persist-390',source:'user-profile-persist',w:390,h:844},
  {name:'user-profile-replace-320',source:'user-profile-replace',w:320,h:690},
  {name:'user-profile-landscape',source:'user-profile',w:844,h:390},
  {name:'tavern-landscape',source:'tavern',w:844,h:390},
  {name:'link-landscape',source:'link',w:844,h:390},
  {name:'link-openings-landscape',source:'link-openings',w:844,h:390},
 ];
 const failures=[];
 for(const c of cases){
  await cmd('Emulation.setDeviceMetricsOverride',{width:c.w,height:c.h,deviceScaleFactor:1,mobile:true});
  const page=c.source==='worldbook'?'link-worldbook-visual.html':c.source.startsWith('user-profile')?'user-document-visual.html':'card-import-visual.html';
  const uri='http://127.0.0.1:5173/tests/'+page+'?source='+c.source+'&nonce='+Math.random();
  await cmd('Page.navigate',{url:uri});
  let ready=null;
  for(let n=0;n<185;n++){
   ready=await evaluate('document.body?.dataset?.cardImportVisualReady || null');
   if(ready==='true'||ready==='false')break;
   await sleep(110);
  }
  const reportText=await evaluate('document.querySelector("#qa-report")?.textContent||""');
  let report;try{report=JSON.parse(reportText)}catch{report={raw:reportText.slice(0,1500)}}
  // Responsive snapshot for visual inspection.
  const snap=await cmd('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
  writeFileSync(join(out,c.name+'.png'),Buffer.from(snap.data,'base64'));
  const mini=await cmd('Page.captureScreenshot',{format:'jpeg',quality:55,captureBeyondViewport:false,fromSurface:true});
  // Safe synthetic screenshot in logs, not uploaded user content.
  console.log('SCREENSHOT_BEGIN '+c.name);
  for(let i=0;i<mini.data.length;i+=2500)console.log('SCREENSHOT_DATA '+mini.data.slice(i,i+2500));
  console.log('SCREENSHOT_END '+c.name);
  console.log('CARD_VISUAL_REPORT '+c.name+' '+JSON.stringify({ready,report}));
  if(ready!=='true')failures.push(c.name+': '+JSON.stringify(report).slice(0,1700));
  if(c.name==='batch-390'&&ready==='true'){
   const selection=await evaluate(`(async()=>{
      const button=()=>[...document.querySelectorAll('button')]
         .find(x=>x.textContent?.trim()==='取消全选'||x.textContent?.trim()==='全选');
      const confirm=()=>[...document.querySelectorAll('button')]
         .find(x=>x.textContent?.includes('确认导入'));
      const selected=()=>[...document.querySelectorAll('input[type=checkbox]')]
         .filter(x=>!x.getAttribute('aria-label')?.startsWith('导入')).filter(x=>x.checked).length;
      const initial=selected();
      button()?.click();await new Promise(r=>setTimeout(r,120));
      const none=selected()===0&&confirm()?.disabled===true;
      button()?.click();await new Promise(r=>setTimeout(r,120));
      const restored=selected()===3&&confirm()?.disabled===false;
      return {initial,none,restored};
   })()`);
   console.log('BATCH_CARD_SELECTION '+JSON.stringify(selection));
   if(selection?.initial!==3||!selection?.none||!selection?.restored)
      failures.push('batch select-all regression: '+JSON.stringify(selection));
  }
  if(c.name==='link-openings-390'&&ready==='true'){
   const choice=await evaluate(`(async()=>{
      const persona=document.querySelector('input[aria-label="导入人设"]');
      const greeting=document.querySelector('input[aria-label="导入开场白"]');
      const confirm=[...document.querySelectorAll('button')].find(x=>x.textContent?.includes('确认导入'));
      persona.click();await new Promise(r=>setTimeout(r,100));
      const onlyGreeting=greeting.checked&&!greeting.disabled&&confirm?.disabled===false;
      greeting.click();await new Promise(r=>setTimeout(r,100));
      const allOff=confirm?.disabled===true;
      greeting.click();await new Promise(r=>setTimeout(r,100));
      return {onlyGreeting,allOff,restored:confirm?.disabled===false};
   })()`);
   console.log('LINK_OPENING_SELECTION '+JSON.stringify(choice));
   if(!choice?.onlyGreeting||!choice?.allOff||!choice?.restored)
      failures.push('link opening-only import toggle: '+JSON.stringify(choice));
  }
  if(c.name==='tavern-390'&&ready==='true'){
   const clickResult=await evaluate(`(async()=>{const labels=['人设','世界书','开场白'];for(const label of labels){document.querySelector('input[aria-label="导入'+label+'"]')?.click()}await new Promise(r=>setTimeout(r,180));const button=[...document.querySelectorAll('button')].find(x=>x.textContent?.includes('确认导入'));const noneDisabled=button?.disabled===true;document.querySelector('input[aria-label="导入世界书"]')?.click();await new Promise(r=>setTimeout(r,180));const picked=labels.map(label=>document.querySelector('input[aria-label="导入'+label+'"]')?.checked);return {noneDisabled,picked,buttonEnabled:button?.disabled===false};})()`);
   console.log('CARD_SELECTION_INTERACTION '+JSON.stringify(clickResult));
   if(!clickResult?.noneDisabled||!clickResult?.buttonEnabled||
    JSON.stringify(clickResult.picked)!=='[false,true,false]')failures.push('section toggle bug: '+JSON.stringify(clickResult));
  }
 }
 ws.close();
 if(failures.length)throw Error(failures.join('\n'));
 console.log('CARD_VISUAL_ALL_CHECKS_PASSED '+cases.length);
}finally{
 // The GitHub Actions VM is disposable. Chromium may still be flushing its
 // profile after SIGTERM; deleting it immediately causes a false ENOTEMPTY
 // regression failure even when every screenshot and interaction passed.
 chrome.kill('SIGTERM');
}
