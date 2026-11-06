/* Mobile browser screenshot of ACTUAL ChatModals file importer with synthetic file. */
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';

const chromePath=process.env.CHROME_PATH || process.argv[2];
if(!chromePath) throw Error('Missing chrome path');
const profile=mkdtempSync(join(tmpdir(),'emoji-docs-chrome-'));
const dir=resolve('emoji-document-visual-artifacts');mkdirSync(dir,{recursive:true});
const port=9229;
const chrome=spawn(chromePath,[
 '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
 '--remote-debugging-port='+port,'--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
try {
 let page;
 for(let n=0;n<80;n++){
    try { const list=await (await fetch('http://127.0.0.1:'+port+'/json')).json();
        page=list.find(x=>x.type==='page'&&x.webSocketDebuggerUrl);
        if(page)break;
    }catch{} await sleep(130);
 }
 if(!page)throw Error('Chrome CDP not ready');
 const ws=new WebSocket(page.webSocketDebuggerUrl);
 const pending=new Map();let seq=0;
 ws.addEventListener('message',e=>{
  const packet=JSON.parse(e.data);if(!packet.id)return;
  const p=pending.get(packet.id);if(!p)return;
  pending.delete(packet.id);packet.error?p.reject(Error(JSON.stringify(packet.error))):p.resolve(packet.result);
 });
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})});
 const cmd=(method,params={})=>new Promise((resolve,reject)=>{
  const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));
 });
 const run=async expression=>(await cmd('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result?.value;
 await cmd('Page.enable');await cmd('Runtime.enable');
 const cases=[{name:'phone-320',width:320,height:690},{name:'phone-390',width:390,height:844},
              {name:'landscape-844',width:844,height:390}];
 const errors=[];
 for(const c of cases){
   await cmd('Emulation.setDeviceMetricsOverride',{width:c.width,height:c.height,deviceScaleFactor:1,mobile:true});
   await cmd('Page.navigate',{url:'http://127.0.0.1:5173/tests/emoji-document-import-visual.html?mode='+c.name+'&x='+Math.random()});
   let ready=null;
   for(let n=0;n<130;n++){
     ready=await run('document.body.dataset.emojiDocumentVisualReady || null');
     if(ready==='true'||ready==='false')break;
     await sleep(130);
   }
   const report=await run('document.querySelector("#qa-report")?.textContent||""');
   const screenshot=await cmd('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
   writeFileSync(join(dir,c.name+'.png'),Buffer.from(screenshot.data,'base64'));
   console.log('EMOJI_DOCUMENT_VISUAL '+c.name+' '+JSON.stringify({ready,report:report?.slice(0,1800)}));
   if(ready!=='true')errors.push(c.name+': '+report);
   if(ready==='true') {
     const after=await run(`(async()=>{
       const clean=[...document.querySelectorAll('button')].find(x=>x.textContent?.includes('只保留已识别内容'));
       clean?.click();
       await new Promise(r=>setTimeout(r,160));
       const save=[...document.querySelectorAll('button')].find(x=>x.textContent?.includes('添加至当前分类'));
       const area=document.querySelector('textarea');
       return {cleaned:!area?.value.includes('无效格式'),saveEnabled:save?.disabled===false,rows:(area?.value||'').split('\\n').length};
     })()`);
     console.log('EMOJI_DOCUMENT_CLEANUP '+c.name+' '+JSON.stringify(after));
     if(!after?.cleaned || !after?.saveEnabled || after?.rows!==5) errors.push(c.name+': cleanup did not unlock saving: '+JSON.stringify(after));
     const cleanedSnap=await cmd('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
     writeFileSync(join(dir,c.name+'-cleaned.png'),Buffer.from(cleanedSnap.data,'base64'));
     // Save via the actual modal button and write to real browser IndexedDB.
     const saved=await run(`(async()=>{
       [...document.querySelectorAll('button')].find(x=>x.textContent?.includes('添加至当前分类'))?.click();
       for(let i=0;i<100;i++){
         if(document.body.dataset.emojiStored)break;
         await new Promise(r=>setTimeout(r,60));
       }
       return document.body.dataset.emojiStored ? JSON.parse(document.body.dataset.emojiStored) : null;
     })()`);
     console.log('EMOJI_DOCUMENT_SAVED '+c.name+' '+JSON.stringify(saved));
     if(!saved || saved.count!==5 || !saved.categories.includes('qa-emoji-cat') ||
        !saved.names.includes('Wordhappy') || !saved.names.includes('PDFhappy'))
       errors.push(c.name+': IndexedDB save missing rows '+JSON.stringify(saved));
     // Re-open the browser document (equivalent to leaving and re-entering chat).
     await cmd('Page.reload',{ignoreCache:false});
     let reopened=null;
     for(let tries=0;tries<60;tries++){
       try{
         reopened=await run(`(async()=>{
           const mod=await import('/utils/db.ts');
           const all=await mod.DB.getEmojis();
           return all.filter(e=>e.categoryId==='qa-emoji-cat').map(e=>({name:e.name,url:e.url}));
         })()`);
         if(Array.isArray(reopened)&&reopened.length===5)break;
       }catch{}
       await sleep(90);
     }
     console.log('EMOJI_DOCUMENT_REOPEN '+c.name+' '+JSON.stringify(reopened));
     if(!Array.isArray(reopened)||reopened.length!==5||
         !reopened.some(e=>e.name==='Wordhappy'&&e.url==='https://example.com/word.gif')||
         !reopened.some(e=>e.name==='PDFhappy'&&e.url==='https://example.com/pdf.png'))
       errors.push(c.name+': saved entries lost after navigation '+JSON.stringify(reopened));

   }
 }
 ws.close();
 if(errors.length)throw Error(errors.join('\n'));
 console.log('EMOJI_DOCUMENT_ALL_MOBILE_SCREENSHOTS_PASSED');
}finally{chrome.kill('SIGTERM')}
