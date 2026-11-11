/** Real Chrome DevTools smoke for the existing built SullyOS UI.
 * No app logic, user data, network credentials or test-only runtime switches.
 */
import {writeFileSync,mkdirSync} from 'node:fs';

const port=Number(process.env.COUPLE_CHROME_DEBUG_PORT||9222);
const output=process.env.COUPLE_SCREENSHOT_DIR||'/tmp/study-room-screenshots';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function targets(){
  const r=await fetch('http://127.0.0.1:'+port+'/json');
  if(!r.ok)throw new Error('Chrome debugger '+r.status);
  return r.json();
}
let pages=[];
for(let i=0;i<150;i++){
  try{pages=await targets();if(pages.some(t=>t.type==='page'))break;}catch{}
  await sleep(400);
}
const target=pages.find(t=>t.type==='page');
if(!target)throw new Error('Chrome never exposed a page target after 60s; CDP 9222 unreachable or no page target');
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
  console.log('COUPLES_DIAGNOSTIC_'+stage+'='+JSON.stringify(d));
  return d;
}
async function capture(name,width,height){
  await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
  await sleep(2800);
  const shot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  const bytes=Buffer.from(shot.data,'base64');
  const target=output+'/'+name+'.png';
  writeFileSync(target,bytes);
  console.log('COUPLES_SCREENSHOT='+name+':'+bytes.length+':'+target);
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
  // Clean-profile onboarding overlays legitimately cover the home screen.
  // Accept the app's notice and skip optional setup only in this throwaway
  // GitHub CI browser; do not pre-populate user data or bypass production gates.
  for(const name of ['我已知悉，继续使用','直接跳过引导']){
    const didClick=await evaluate(`(()=>{
      const name=${JSON.stringify(name)};
      const items=[...document.querySelectorAll('button')];
      const item=items.find(x=>(x.textContent||'').trim()===name&&!x.disabled);
      if(!item)return false;item.click();return true;
    })()`);
    console.log('STUDY_BROWSER_ONBOARDING_'+name+'='+didClick);
    if(didClick)await sleep(2200);
  }
  const closeNavIntro=await evaluate(`(()=>{
    const buttons=[...document.querySelectorAll('button')];
    const intro=buttons.find(x=>(x.textContent||'').trim()==='知道了'&&!x.disabled);
    if(!intro)return false;intro.click();return true;
  })()`);
  console.log('STUDY_BROWSER_NAV_INTRO_CLOSED='+closeNavIntro);
  if(closeNavIntro)await sleep(1200);
  const returnedHome=await evaluate(`(()=>{
    const header=[...document.querySelectorAll('h1')].find(h=>(h.textContent||'').trim()==='系统设置');
    const back=header?.parentElement?.querySelector('button');
    if(!back)return false;back.click();return true;
  })()`);
  console.log('STUDY_BROWSER_RETURNED_HOME='+returnedHome);
  if(returnedHome)await sleep(2200);
  const home=await inspect('HOME');
  if(home.links.some(x=>x==='自习室')){
    console.error('VISUAL_BLOCKER: duplicate home self-study launcher icon still visible');
    process.exitCode=1;
  }
  const size=await capture('mobile-390',390,844);
  if(!home.text.trim()||home.text.includes('TAP TO UNLOCK')||size<4500){
    console.error('VISUAL_BLOCKER: built app did not reach an unlocked home screen');
    process.exitCode=1;
  }

  const entered=await evaluate(`(()=>{
    const b=[...document.querySelectorAll('button,[role=button],a')].find(x=>
      (x.getAttribute('aria-label')||x.textContent||'').trim()==='情侣空间');
    b?.click();return !!b;
  })()`);
  if(!entered)throw Error('Home screen had no couples-space app icon');
  await sleep(1900);
  const result=await evaluate(`(async()=>{
    const pause=ms=>new Promise(r=>setTimeout(r,ms));
    const visible=e=>e&&e.getClientRects().length>0;
    const wait=async(fn,label,timeout=8000)=>{
      for(let t=0;t<timeout;t+=100){if(await fn())return;await pause(100);}
      throw Error('Real couples journey: '+label);
    };
    window.__couplesHumanErrors=[];
    window.__couplesHumanModelCalls=0;
    window.addEventListener('error',e=>window.__couplesHumanErrors.push(String(e.message)));
    window.addEventListener('unhandledrejection',e=>window.__couplesHumanErrors.push(String(e.reason)));
    window.confirm=()=>true;
    const oldFetch=window.fetch.bind(window);
    window.fetch=(...args)=>{
      if(String(args[0]).includes('/chat/completions')){
        window.__couplesHumanModelCalls++;
        return Promise.reject(Error('No model request expected in local-only journey'));
      }
      return oldFetch(...args);
    };
    const buttons=()=>[...document.querySelectorAll('button')].filter(visible);
    const hit=(query,label,root=document)=>{
      const node=[...root.querySelectorAll(query)].find(visible);
      if(!node)throw Error('Missing UI: '+label);
      node.click();return node;
    };
    const click=(label)=>{
      const b=buttons().find(x=>(x.getAttribute('aria-label')||'')===label||
        x.textContent?.trim()===label||x.querySelector('strong')?.textContent?.trim()===label);
      if(!b)throw Error('Missing action '+label+'; visible: '+buttons().map(x=>x.textContent?.trim()).slice(0,18).join(' / '));
      b.click();return b;
    };
    const input=(selector,v)=>{
      const e=[...document.querySelectorAll(selector)].find(visible);
      if(!e)throw Error('Missing input: '+selector);
      const proto=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype
        :e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(e,v);
      e.dispatchEvent(new Event('input',{bubbles:true}));
      e.dispatchEvent(new Event('change',{bubbles:true}));
      return e;
    };
    const dbName=(await indexedDB.databases()).find(d=>d.name?.includes('AetherOS_Data'))?.name;
    if(!dbName)throw Error('Actual user-space IndexedDB was not available in disposable profile');
    const db=await new Promise((resolve,reject)=>{
      const q=indexedDB.open(dbName);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);
    });
    const spaces=()=>new Promise((resolve,reject)=>{
      const req=db.transaction('assets','readonly').objectStore('assets').get('couples_space_v1');
      req.onsuccess=()=>resolve(req.result?.data||{});req.onerror=()=>reject(req.error);
    });
    const current=async()=>Object.values(await spaces()).find(x=>x.members?.length===1);
    const getRecord=async(kind)=>((await current())?.entries||[]).find(x=>x.kind===kind);
    const goShelf=async(label)=>{
      const b=[...document.querySelectorAll('.couple-ios-tabs button')].find(x=>x.textContent.trim()===label);
      if(!b)throw Error('Shelf unavailable: '+label);
      b.click();await pause(160);
    };
    const goPanel=async(label,kind)=>{
      const b=[...document.querySelectorAll('.couple-ios-link,.couple-ios-spotlight')].find(x=>x.textContent.includes(label));
      if(!b)throw Error('Feature absent from shelf: '+label);
      b.click();await wait(()=>document.querySelector('.couple-records-'+kind),'open '+label);
    };
    const returnHero=async()=>{
      // Details, compose and feature screens each occupy their own back level.
      // Match a human pressing the visible Back arrow until they see the space.
      for(let i=0;i<4;i++){
        if(document.querySelector('.couple-ios-hero'))return;
        const h=document.querySelector('.couple-header button[aria-label="返回"]');
        if(!h)throw Error('Couple header back not found');
        h.click();await pause(220);
      }
      await wait(()=>!!document.querySelector('.couple-ios-hero'),'back to space');
    };
    const edit=async(kind,title,body)=>{
      await wait(()=>!!document.querySelector('.couple-compose-'+kind),'compose '+kind);
      input('.couple-compose-'+kind+' .couple-edit-title input',title);
      await pause(110);
      input('.couple-compose-'+kind+' .couple-edit-note textarea',body);
      await pause(110);
      hit('.couple-compose-'+kind+' button.couple-primary','save '+kind);
      await wait(async()=>!!(await getRecord(kind)),'persist '+kind);
    };
    // Two people first choose their relationship and open their shared space.
    await wait(()=>!!document.querySelector('.couple-picker-confirm'),'character orbit');
    click('选择此角色');
    await wait(()=>!!buttons().find(x=>x.textContent.trim()==='直接建立羁绊'),'binding choice');
    click('直接建立羁绊');
    await wait(()=>!!document.querySelector('.couple-ios-hero'),'establish partnership');
    const first=await current();
    if(!first||first.status!=='open'||first.entries.length)throw Error('Invalid initial bond');

    // After a shared conversation: write an ordinary letter, read it, and go back.
    await goPanel('时光信箱','mail');
    hit('button.couple-mail-slot','write a letter');
    await edit('mail','周末想一起做什么？','如果不下雨，我们去看展览，再一起喝奶茶。');
    const mail=await getRecord('mail');
    if(mail.title!=='周末想一起做什么？'||!mail.body.includes('看展览'))throw Error('Letter lost its user-written contents');
    hit('.couple-mail-trays button','open posted letter');
    await wait(()=>!!document.querySelector('.couple-entry-mail'),'read letter');
    if(!document.querySelector('.couple-entry-mail').textContent.includes('奶茶'))throw Error('Letter detail cannot display saved text');
    hit('button.couple-record-detail-back','back to mailbox');
    await returnHero();

    // Promise to read a letter together in the future; today it stays sealed.
    await goPanel('时间胶囊','capsule');
    hit('button.couple-capsule-new','write a future letter');
    await edit('capsule','留给下个月的我们','希望我们还记得今天选的展览。');
    const capsule=await getRecord('capsule');
    if(!capsule.unlockDate||capsule.opened)throw Error('Time capsule saved as already opened');
    hit('.couple-capsule-shelves button','open saved capsule preview');
    await wait(()=>!!document.querySelector('.couple-entry-capsule'),'capsule detail');
    if(document.querySelector('.couple-entry-capsule').textContent.includes('希望我们还记得'))
      throw Error('BUG: sealed future letter is visible before its unlock date');
    click('提前拆封');
    await wait(()=>buttons().some(x=>x.textContent.trim()==='继续封存'),'early-opening confirmation');
    click('继续封存');
    if((await getRecord('capsule')).opened)throw Error('Cancel early open still marked it opened');
    await returnHero();

    // Make a modest wish, add a real plan step, then later mark it complete.
    await goShelf('心意');
    await goPanel('愿望清单','wish');
    hit('button.wish-universe-first-star','write first wish');
    await wait(()=>!!document.querySelector('.couple-compose-wish'),'wish editor');
    input('.couple-compose-wish .couple-edit-title input','一起去海边看日落');
    await pause(80);
    input('.couple-compose-wish .couple-edit-note textarea','等周末有空就去。');
    await pause(80);
    click('＋ 再写一个小步骤');
    await wait(()=>!!document.querySelector('input[aria-label="第1个步骤"]'),'first wish step');
    input('input[aria-label="第1个步骤"]','先看天气预报');
    await pause(100);
    hit('.couple-compose-wish button.couple-primary','save wish');
    await wait(async()=>!!(await getRecord('wish')),'wish persisted');
    const wish=await getRecord('wish');
    if(wish.steps?.[0]?.text!=='先看天气预报')throw Error('Wish lost its plan step');
    // Human returns to this wish later and marks the step as done.
    await wait(()=>!!document.querySelector('.wish-universe-star'),'wish star');
    hit('.wish-universe-star','focus wish');
    click('查看愿望 ↗');
    await wait(()=>!!document.querySelector('.couple-entry-wish'),'wish detail');
    const checkbox=document.querySelector('.couple-entry-wish label input[type="checkbox"]');
    if(!checkbox)throw Error('Wish step was not editable on return');
    checkbox.click();
    await wait(async()=>(await getRecord('wish')).steps[0].done,'save completed step');
    click('标记完成');
    await wait(async()=>(await getRecord('wish')).done,'wish completion');
    await returnHero();

    // Earn points only after an actual completed wish, then check claim was once.
    await goShelf('收藏');
    const shop=[...document.querySelectorAll('.couple-ios-spotlight,.couple-ios-link')].find(x=>x.textContent.includes('羁绊商店'));
    if(!shop)throw Error('Points shop unreachable');
    shop.click();
    await wait(()=>!!document.querySelector('.bond-ticket-room'),'shop');
    const tasks=[...document.querySelectorAll('.bond-ticket-tabs button')].find(x=>x.textContent.trim()==='任务');
    tasks?.click();
    await wait(()=>!!document.querySelector('.bond-ticket-tasks'),'daily rewards');
    hit('button[aria-label="领取完成第一个共同愿望奖励"]','claim completed wish reward');
    await wait(async()=>(await current()).claims.includes('first-wish'),'reward once');
    const afterPoints=await current();
    if(afterPoints.points.me!==100||afterPoints.points.shared!==100)throw Error('Claiming real wish gave inconsistent points');
    await returnHero();

    // A separation and reunion must preserve both sentimental and earned records.
    hit('.couple-header button[aria-label="空间设置"]','open relationship settings');
    await wait(()=>buttons().some(x=>x.textContent.trim()==='解除绑定'),'settings open');
    click('解除绑定');
    await wait(()=>!!document.querySelector('[aria-label="确认解除绑定"]'),'unbinding confirmation');
    click('保留空间');
    await wait(()=>!document.querySelector('[aria-label="确认解除绑定"]'),'decline unbind');
    if((await current()).status!=='open')throw Error('Declining unbind still closed the space');
    click('解除绑定');
    await wait(()=>!!document.querySelector('[aria-label="确认解除绑定"]'),'reopen unbinding confirmation');
    click('确认解除');
    await wait(async()=>(await current()).status==='closed','unbind');
    if((await current()).entries.length!==3)throw Error('Breakup deleted the letters and wishes');
    click('重新开启');
    await wait(()=>!!document.querySelector('.couple-ios-hero'),'reunite');
    const reopened=await current();
    if(reopened.entries.length!==3||reopened.points.me!==100||reopened.id===first.id)
      throw Error('Reopening lost history/points or failed generation rollover');
    // Later that day: spend a genuinely earned reward on one voucher,
    // use it once in chat, then verify that it was sent and consumed.
    await goShelf('收藏');
    const ticketShop=[...document.querySelectorAll('.couple-ios-spotlight,.couple-ios-link')]
      .find(x=>x.textContent.includes('羁绊商店'));
    if(!ticketShop)throw Error('The voucher shop disappeared on reunion');
    ticketShop.click();
    await wait(()=>!!document.querySelector('.bond-ticket-room'),'reenter shop');
    hit('button[aria-label="兑换昵称卡"]','buy a nickname voucher');
    await wait(async()=>(await current()).bags.me.nickname===1,'voucher credited to wallet');
    await wait(()=>!!document.querySelector('.bond-ticket-wallet'),'open new voucher');
    window.prompt=()=> '想给你起一个只有我们知道的昵称';
    click('使用卡券 ↗');
    await wait(async()=>(await current()).played.length===1,'play one owned voucher');
    const consumed=await current();
    if(consumed.bags.me.nickname!==0||consumed.points.me!==65)
      throw Error('Voucher was not properly deducted from inventory and points');
    const chatMessages=()=>new Promise((resolve,reject)=>{
      const req=db.transaction('messages','readonly').objectStore('messages').getAll();
      req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error);
    });
    await wait(async()=>(await chatMessages()).some(m=>m.content?.includes('昵称卡')),'voucher delivered to native chat');
    const dispatched=(await chatMessages()).filter(m=>m.content?.includes('昵称卡'));
    if(dispatched.length!==1)throw Error('Voucher delivery duplicated in ordinary chat');

    if(window.__couplesHumanModelCalls||window.__couplesHumanErrors.length)
      throw Error('Unexpected model use or browser error '+JSON.stringify({
        calls:window.__couplesHumanModelCalls,errors:window.__couplesHumanErrors}));
    const metrics={partner:reopened.members[0],status:reopened.status,
      records:reopened.entries.map(x=>x.kind),wishComplete:reopened.entries.find(x=>x.kind==='wish').done,
      capsuleStillSealed:!reopened.entries.find(x=>x.kind==='capsule').opened,
      points:consumed.points,claims:consumed.claims, voucherDelivered:dispatched.length, played:consumed.played.length,
      modelCalls:window.__couplesHumanModelCalls,errors:window.__couplesHumanErrors};
    db.close();
    return metrics;
  })()`);
  console.log('COUPLES_HUMAN_COMPLETE='+JSON.stringify(result));
  await capture('couples-human-reopened-390',390,844);

}finally{socket.close();}
