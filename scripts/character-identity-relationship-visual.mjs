import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const origin=process.env.IDENTITY_RELATIONSHIP_VISUAL_ORIGIN||'http://127.0.0.1:5197';
const browser=process.env.CHROME_BIN||'google-chrome';
const out=process.env.IDENTITY_RELATIONSHIP_VISUAL_OUT||'/tmp/identity-relationship-shots';
mkdirSync(out,{recursive:true});

async function run(width){
  const profile=mkdtempSync(join(tmpdir(),'identity-relationship-chrome-'));
  const child=spawn(browser,[
    '--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu',
    '--disable-extensions','--no-first-run','--remote-allow-origins=*',
    '--remote-debugging-port=0','--user-data-dir='+profile,'--window-size='+width+',844','about:blank',
  ],{stdio:['ignore','ignore','pipe']});
  let stderr='';child.stderr?.on('data',chunk=>{stderr+=String(chunk).slice(0,2000)});
  try{
    let port;
    for(let i=0;i<250;i++){
      if(child.exitCode!==null)throw Error('Chrome terminated: '+stderr.slice(-2000));
      try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);if(port)break}catch{}
      await sleep(120);
    }
    assert(port,'Chrome debug port missing '+stderr);
    const targets=await fetch('http://127.0.0.1:'+port+'/json/list').then(response=>response.json());
    const target=targets.find(item=>item.type==='page');assert(target,'Missing Chrome page');
    const ws=new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})});
    let next=0;const pending=new Map();
    ws.addEventListener('message',event=>{
      const message=JSON.parse(event.data);
      if(message.id&&pending.has(message.id)){
        const item=pending.get(message.id);pending.delete(message.id);
        message.error?item.reject(Error(JSON.stringify(message.error))):item.resolve(message.result);
      }
    });
    const send=(method,params={})=>new Promise((resolve,reject)=>{
      const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));
    });
    const evaluate=async expression=>{
      const response=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
      if(response.exceptionDetails)throw Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || JSON.stringify(response.exceptionDetails));
      return response.result?.value;
    };
    const screenshot=async name=>{
      const result=await send('Page.captureScreenshot',{format:'png',fromSurface:true});
      writeFileSync(join(out,name+'-'+width+'.png'),Buffer.from(result.data,'base64'));
    };
    await send('Page.enable');await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
    await send('Page.navigate',{url:origin+'/tests/character-identity-relationship-visual.html'});
    let state;
    for(let i=0;i<180;i++){
      state=await evaluate(`({ready:document.body?.dataset.identityRelationshipReady==="true",error:document.body?.dataset.visualError||"",overflow:(document.documentElement?.scrollWidth||0)>innerWidth+1,field:!!document.querySelector('#relationship-root textarea[aria-label="身份关系"]'),label:(document.body?.innerText||"").includes("身份关系"),placeholder:document.querySelector('#relationship-root textarea[aria-label="身份关系"]')?.placeholder||""})`);
      if(state.error)throw Error('Visual fixture: '+state.error);
      if(state.ready)break;
      await sleep(150);
    }
    assert(state?.ready&&state.field&&state.label,'Identity relationship field did not render '+JSON.stringify(state));
    assert(state.placeholder==='关系…','Placeholder should be short and match other fields '+JSON.stringify(state));
    assert(!state.overflow,'Horizontal overflow at '+width+'px');
    const rect=await evaluate(`document.querySelector('#relationship-root textarea[aria-label="身份关系"]').getBoundingClientRect().toJSON()`);
    assert(rect.width>width-45,'Field is unexpectedly narrow '+JSON.stringify(rect));
    assert(rect.height>=80,'Field is too short '+JSON.stringify(rect));
    await screenshot('identity-relationship-before-edit');
    await evaluate(`document.querySelector('#relationship-root textarea[aria-label="身份关系"]').focus()`);
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
    await send('Input.insertText',{text:'新的关系设定测试'});
    const edited=await evaluate(`({value:document.querySelector('#relationship-root textarea[aria-label="身份关系"]').value,overflow:document.documentElement.scrollWidth>innerWidth+1})`);
    assert(edited.value.includes('新的关系设定测试'),'Textarea did not accept user input '+JSON.stringify(edited));
    assert(!edited.overflow,'Input caused horizontal overflow');
    await sleep(200);
    await screenshot('identity-relationship-after-edit');
    console.log('PASS Neural Link identity relationship mobile UI',width,rect);
    ws.close();
  }finally{
    child.kill('SIGTERM');await sleep(200);rmSync(profile,{recursive:true,force:true,maxRetries:3});
  }
}
for(const width of [390,320])await run(width);
