/** Real Chrome DevTools smoke for the existing built SullyOS UI.
 * No app logic, user data, network credentials or test-only runtime switches.
 */
import {writeFileSync,mkdirSync} from 'node:fs';

const port=Number(process.env.STUDY_CHROME_DEBUG_PORT||9222);
const output=process.env.STUDY_SCREENSHOT_DIR||'/tmp/study-room-screenshots';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function targets(){
  const r=await fetch('http://127.0.0.1:'+port+'/json');
  if(!r.ok)throw new Error('Chrome debugger '+r.status);
  return r.json();
}
let pages=[];
for(let i=0;i<40;i++){
  try{pages=await targets();if(pages.some(t=>t.type==='page'))break;}catch{}
  await sleep(250);
}
const target=pages.find(t=>t.type==='page');
if(!target)throw new Error('Chrome never exposed a page target');
const socket=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{
  socket.addEventListener('open',resolve,{once:true});
  socket.addEventListener('error',reject,{once:true});
});
let id=0;const pending=new Map();
socket.addEventListener('message',event=>{
  const msg=JSON.parse(String(event.data));
  if(!msg.id)return;
  const req=pending.get(msg.id);if(!req)return;
  pending.delete(msg.id);
  msg.error?req.reject(new Error(msg.error.message)):req.resolve(msg.result);
});
function cdp(method,params={}){
  return new Promise((resolve,reject)=>{
    const key=++id;pending.set(key,{resolve,reject});
    socket.send(JSON.stringify({id:key,method,params}));
  });
}
async function evaluate(expression){
  const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(r.exceptionDetails)throw new Error('Page JavaScript error: '+JSON.stringify(r.exceptionDetails).slice(0,600));
  return r.result.value;
}
async function inspect(stage){
  const d=await evaluate(`({ready:document.readyState,title:document.title,
    text:(document.body?.innerText||'').slice(0,1600),
    links:[...document.querySelectorAll('button,[role=button],a')].slice(0,65)
      .map(n=>(n.getAttribute('aria-label')||n.textContent||'').trim()).filter(Boolean),
    width:innerWidth,height:innerHeight})`);
  console.log('STUDY_BROWSER_DIAGNOSTIC_'+stage+'='+JSON.stringify(d));
  return d;
}
async function capture(name,width,height){
  await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
  await sleep(2800);
  const shot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  const bytes=Buffer.from(shot.data,'base64');
  const target=output+'/'+name+'.png';
  writeFileSync(target,bytes);
  console.log('STUDY_BROWSER_SCREENSHOT='+name+':'+bytes.length+':'+target);
  if(name==='mobile-390')console.log('STUDY_MOBILE_SCREENSHOT_BASE64='+shot.data);
  return bytes.length;
}
try{
  mkdirSync(output,{recursive:true});
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await cdp('Page.navigate',{url:'http://127.0.0.1:4173/'});
  await sleep(15000);
  const initial=await inspect('LOCK');
  if(initial.text.includes('TAP TO UNLOCK')){
    const pressed=await evaluate(`(()=>{
      const element=document.elementFromPoint(195,765);
      if(!element)return false;element.click();return true;
    })()`);
    console.log('STUDY_BROWSER_UNLOCK_CLICKED='+pressed);
    await sleep(6500);
  }
  const home=await inspect('HOME');
  const size=await capture('mobile-390',390,844);
  if(!home.text.trim()||home.text.includes('TAP TO UNLOCK')||size<4500){
    console.error('VISUAL_BLOCKER: built app did not reach an unlocked home screen');
    process.exitCode=1;
  }
  const clicked=await evaluate(`(()=>{
    const items=[...document.querySelectorAll('button,[role=button],a')];
    const match=items.find(x=>(x.getAttribute('aria-label')||x.textContent||'').trim()==='学习室');
    if(!match)return false;match.click();return true;
  })()`);
  console.log('STUDY_BROWSER_CLICKED_ROOM='+clicked);
  if(!clicked)console.error('VISUAL_BLOCKER: unlocked launcher has no directly selectable study-room entry');
  if(clicked){
    await sleep(5500);
    const inside=await inspect('STUDY');
    await capture('study-mobile-390',390,844);
    if(!inside.text.includes('学习室')&&!inside.text.includes('专注'))
      console.error('VISUAL_BLOCKER: navigation did not expose the study room');
  }
  await capture('desktop-1366',1366,768);
}finally{
  socket.close();
}
