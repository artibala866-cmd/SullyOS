/** Real Chrome DevTools smoke for the existing built SullyOS UI.
 * No app logic, user data, network credentials or test-only runtime switches.
 */
import {writeFileSync,mkdirSync} from 'node:fs';

const port=Number(process.env.INTEGRATED_CHROME_DEBUG_PORT||9222);
const output=process.env.INTEGRATED_SCREENSHOT_DIR||'/tmp/study-room-screenshots';
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
  console.log('INTEGRATED_DIAGNOSTIC_'+stage+'='+JSON.stringify(d));
  return d;
}
async function capture(name,width,height){
  await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
  await sleep(2800);
  const shot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  const bytes=Buffer.from(shot.data,'base64');
  const target=output+'/'+name+'.png';
  writeFileSync(target,bytes);
  console.log('INTEGRATED_SCREENSHOT='+name+':'+bytes.length+':'+target);
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
    const names=['打开角色聊天','聊天','私聊'];
    const b=[...document.querySelectorAll('button,[role=button],a')]
      .find(el=>names.includes((el.getAttribute('aria-label')||el.textContent||'').trim()));
    b?.click();return !!b;
  })()`);
  console.log('INTEGRATED_ENTERED_PRIVATE_CHAT='+entered);
  if(!entered)throw Error('No private chat launcher in actual home screen');
  await sleep(3200);

  const journey=await evaluate(`(async()=>{
    const pause=ms=>new Promise(r=>setTimeout(r,ms));
    const visible=node=>node&&node.getClientRects().length>0&&!node.closest('[hidden]');
    const wait=async(f,name,timeout=7500)=>{
      for(let t=0;t<timeout;t+=100){if(await f())return true;await pause(100);}
      throw Error('Human chat-phone-schedule journey: '+name+
        '; visible buttons: '+[...document.querySelectorAll('button')].filter(e=>e.getClientRects().length)
          .map(e=>(e.getAttribute('aria-label')||e.textContent||'').trim()).filter(Boolean).slice(-24).join(' / '));
    };
    const buttons=(root=document)=>[...root.querySelectorAll('button')].filter(visible);
    const press=(text,root=document)=>{
      const btn=buttons(root).find(b=>(b.getAttribute('aria-label')||'').trim()===text
        ||b.textContent?.trim()===text
        ||b.querySelector('strong')?.textContent?.trim()===text);
      if(!btn)throw Error('Cannot find '+text+'; available: '+buttons(root)
        .map(b=>(b.getAttribute('aria-label')||b.textContent||'').trim()).filter(Boolean).slice(0,23).join(' / '));
      if(btn.disabled)throw Error('Action is disabled: '+text);
      btn.click();return btn;
    };
    const textInput=(selector,text)=>{
      const element=[...document.querySelectorAll(selector)].find(visible);
      if(!element)throw Error('Input missing: '+selector);
      const type=element instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(type,'value').set.call(element,text);
      element.dispatchEvent(new Event('input',{bubbles:true}));
      element.dispatchEvent(new Event('change',{bubbles:true}));
      return element;
    };
    const dbName=(await indexedDB.databases()).find(row=>row.name?.includes('AetherOS_Data'))?.name;
    if(!dbName)throw Error('Real IndexedDB database unavailable');
    const db=await new Promise((resolve,reject)=>{
      const request=indexedDB.open(dbName);
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
    const readStore=(name)=>new Promise((resolve,reject)=>{
      const q=db.transaction(name,'readonly').objectStore(name).getAll();
      q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);
    });
    const writeRow=(name,record)=>new Promise((resolve,reject)=>{
      const t=db.transaction(name,'readwrite');t.objectStore(name).put(record);
      t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);
    });
    let errors=[],apiRequests=[],progress=[];
    window.__integratedErrors=errors;
    window.addEventListener('error',event=>errors.push(String(event.message)));
    window.addEventListener('unhandledrejection',event=>errors.push(String(event.reason)));
    const previousFetch=window.fetch.bind(window);
    window.fetch=(...args)=>{
      const url=typeof args[0]==='string'?args[0]:args[0]?.url||'';
      if(url.includes('/chat/completions')){
        apiRequests.push(url);
        return Promise.reject(Error('CI browser: paid API blocked; all manual services are local-only'));
      }
      return previousFetch(...args);
    };
    const storeKeys=()=>Array.from({length:localStorage.length},(_,i)=>localStorage.key(i));
    const currentChar=()=>localStorage.getItem('os_last_active_char_id')||'preset-sully-v2';
    const messages=async()=> (await readStore('messages')).filter(x=>x.charId===currentChar());
    const seenText=async(text)=>(await messages()).some(x=>x.role==='user'&&x.content===text);
    const menu=async()=>{
      const trigger=[...document.querySelectorAll('button[aria-label="聊天功能"]')].find(visible);
      if(!trigger)throw Error('Chat action menu missing');
      if(trigger.getAttribute('aria-expanded')!=='true')trigger.click();
      await wait(()=>trigger.getAttribute('aria-expanded')==='true','open chat action menu');
    };
    const action=async(label)=>{
      await menu();
      const buttonsOnPage=()=>buttons().find(x=>{
        const value=x.textContent?.trim()||'';
        return value===label||(label==='真人感'&&value.startsWith('真人感 · '));
      });
      const pageButtons=[...document.querySelectorAll('button[aria-label^="第 "]')]
        .filter(x=>/^第 \d+ 页$/.test(x.getAttribute('aria-label')||''));
      if(!buttonsOnPage()){
        // Real users swipe through the feature pages; start from the first
        // available page instead of assuming the menu always opens on page 1.
        for(const page of pageButtons){
          page.click();
          await pause(160);
          if(buttonsOnPage())break;
        }
      }
      const selected=buttonsOnPage();
      if(!selected)throw Error('Chat feature not available: '+label);
      selected.click();await pause(190);
    };
    const closeMenu=()=>{
      const btn=document.querySelector('button[aria-label="聊天功能"]');
      if(btn?.getAttribute('aria-expanded')==='true')btn.click();
    };
    const send=async(content)=>{
      closeMenu();
      textInput('textarea.sully-chat-textarea',content);
      await pause(170);
      press('发送文字');
      await wait(()=>seenText(content),'send user text '+content);
    };
    await wait(()=>!!document.querySelector('.sully-chat-composer'),'open real private chat');
    // No automatic contact by default. If the preset has consent, revoke it
    // through the same UI a player uses.
    await menu();
    const mode=buttons().find(b=>b.textContent?.trim().startsWith('真人感 · '));
    if(mode?.textContent?.includes('运行')||mode?.textContent?.includes('待启动')){
      await action('真人感');await pause(200);
    }
    closeMenu();
    await wait(()=>localStorage.getItem('sully_life_pacing')!=='on','real-person off');
    const first='我今天画了两张人物速写，晚上准备去图书馆。';
    const second='如果有空，也想顺便整理一下明天的计划。';
    await send(first);await send(second);
    await pause(3100);
    if(apiRequests.length)throw Error('Real person OFF unexpectedly called API');
    const privateMessages=await messages();
    if(privateMessages.filter(x=>x.role==='user'&&[first,second].includes(x.content)).length!==2)
      throw Error('Real chat did not save the two-person conversation');
    progress.push('private two-message conversation saved; no automatic reply');

    // A user now checks the character's actual phone and reads her own
    // corresponding message mirror; it may not claim those were NPC messages.
    await action('查手机');
    await wait(()=>!!document.querySelector('[role="dialog"][aria-label$="的手机"]'),'open character phone');
    const phone=()=>[...document.querySelectorAll('[role="dialog"][aria-label$="的手机"]')].find(visible);
    const unlock=phone().querySelector('[aria-label="向右滑动解锁"]');
    if(!unlock)throw Error('Character phone lockscreen missing');
    unlock.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    await wait(()=>!!phone().querySelector('button.cp-home-shortcut'),'unlock character phone');
    const wechat=buttons(phone()).find(x=>x.textContent?.trim()==='微信');
    if(!wechat)throw Error('Phone desktop did not have WeChat');
    wechat.click();
    await wait(()=>buttons(phone()).some(b=>b.textContent?.includes('真实私聊')),'phone mirrored real user conversation');
    const realThread=buttons(phone()).find(b=>b.textContent?.includes('真实私聊'));
    realThread.click();
    await wait(()=>phone().textContent?.includes(first)&&phone().textContent?.includes(second),
      'read both user messages from phone mirror');
    progress.push('real chat->phone private message mirror is correct');

    // The character can add an NPC on their own phone without accidentally
    // creating a new User-facing private chat message.
    press('返回',phone());
    await wait(()=>buttons(phone()).some(b=>b.textContent?.trim()==='通讯录'),'return to phone WeChat');
    press('通讯录',phone());
    await wait(()=>buttons(phone()).some(b=>b.textContent?.trim()==='添加朋友'),'phone contacts');
    press('添加朋友',phone());
    await wait(()=>buttons(phone()).some(b=>b.textContent?.trim()==='保存联系人'),'contact editor');
    const nick=[...phone().querySelectorAll('label')].find(x=>x.textContent.includes('微信昵称'))?.querySelector('textarea');
    const who=[...phone().querySelectorAll('label')].find(x=>x.textContent.includes('与Char关系'))?.querySelector('textarea');
    if(!nick||!who)throw Error('Phone contact has no nickname/relationship field');
    const setPhoneField=(input,value)=>{
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,value);
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
    };
    setPhoneField(nick,'林同学');
    await pause(110);setPhoneField(who,'同学');
    await pause(130);press('保存联系人',phone());
    await wait(()=>phone().textContent.includes('林同学'),'manual contact persisted in phone');
    if((await messages()).filter(x=>x.role==='user').length!==privateMessages.filter(x=>x.role==='user').length)
      throw Error('Phone added contact accidentally generated User chat turn');
    progress.push('phone contact saved independently of private chat');

    // Turn off autonomous phone life in the existing settings (separate from
    // all real-person/chat/schedule switches).
    const phoneBack=()=>press('返回',phone());
    phoneBack();await wait(()=>!!phone().querySelector('button.cp-home-shortcut'),'back to phone desktop');
    press('微信',phone());
    await wait(()=>buttons(phone()).some(x=>x.textContent?.trim()==='我'),'phone WeChat menu');
    press('我',phone());
    await wait(()=>buttons(phone()).some(x=>x.textContent?.trim().startsWith('设置')),'phone settings entry');
    const phoneSettingsButton=buttons(phone()).find(x=>x.textContent?.trim().startsWith('设置'));
    if(!phoneSettingsButton)throw Error('Phone settings action was absent');
    phoneSettingsButton.click();
    await wait(()=>phone().textContent.includes('Char 手机自主生活'),'phone autonomy settings');
    const phoneAutonomy=[...phone().querySelectorAll('label')].find(l=>l.textContent.includes('Char 手机自主生活'))?.querySelector('input[type="checkbox"]');
    if(!phoneAutonomy)throw Error('Phone autonomous-life toggle not found');
    if(phoneAutonomy.checked)phoneAutonomy.click();
    await pause(170);
    if(localStorage.getItem('sully_phone_autonomy_disabled_v1:'+currentChar())!=='1')
      throw Error('Phone autonomous-life switch did not persist OFF');
    progress.push('phone autonomy was disabled independently');

    // Back to private chat. A historical schedule is one realistic retained
    // plan from earlier use, not thousands of fabricated records.
    phoneBack();phoneBack();
    await wait(()=>!!phone().querySelector('button.cp-home-shortcut'),'leave phone settings');
    press('退出查手机',phone());
    await wait(()=>!phone(),'close phone');
    const day=new Date();
    const pad=n=>String(n).padStart(2,'0');
    const date=[day.getFullYear(),pad(day.getMonth()+1),pad(day.getDate())].join('-');
    const charId=currentChar();
    await writeRow('daily_schedule',{id:charId+'_'+date,charId,date,generatedAt:Date.now(),
      slots:[{startTime:'00:00',activity:'在家准备学习计划',availability:'busy',
        description:'一份虚构角色的事先保存的计划',location:'书房'}]});
    window.dispatchEvent(new CustomEvent('sully:daily-schedule-saved',{detail:{charId}}));
    await action('日程');
    await wait(()=>!!document.querySelector('button[aria-label="切换角色日程开关"]'),
      'open chat schedule modal');
    const scheduleToggle=()=>document.querySelector('button[aria-label="切换角色日程开关"]');
    const scheduleSection=scheduleToggle().closest('div.mb-4')||scheduleToggle().parentElement?.parentElement;
    // Disable schedule if it was enabled; old stored slots must stay saved but
    // stop affecting live chat and phone.
    if(scheduleSection?.textContent.includes('已开启'))scheduleToggle().click();
    await wait(()=>scheduleSection?.textContent.includes('已关闭'),'turn schedule off');
    const schedules=await readStore('daily_schedule');
    if(!schedules.some(row=>row.charId===charId&&row.slots?.[0]?.activity==='在家准备学习计划'))
      throw Error('Toggling schedule OFF erased historical plan');
    progress.push('old schedule retained but disabled as live context');
    const scheduleDialog=[...document.querySelectorAll('[role="dialog"]')].find(x=>x.textContent.includes('角色日程'));
    const closeSchedule=[...(scheduleDialog?.querySelectorAll('button')||[])].find(x=>
      ['关闭','返回'].includes(x.getAttribute('aria-label')||'')||x.textContent?.trim()==='×');
    if(closeSchedule)closeSchedule.click();
    else document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    await wait(()=>!document.querySelector('button[aria-label="切换角色日程开关"]'),'schedule modal close');

    // The player explicitly turns real-person on for the next chat turn, then
    // begins composing a second message. While the draft is unfinished, the
    // automatic reply must wait. Turning the switch back off cancels the pending
    // intent and must never initiate a new generation.
    await action('真人感');
    await wait(()=>localStorage.getItem('sully_life_pacing')==='on','real person ON');
    await send('等我把这段话补完，再回复我哦。');
    textInput('textarea.sully-chat-textarea','我还想补充几点，先别急着回复');
    await pause(3150);
    if(apiRequests.length)throw Error('Private chat replied while a user draft was active');
    await action('真人感');
    await wait(()=>localStorage.getItem('sully_life_pacing')==='off','real person OFF after unfinished draft');
    await wait(()=>!storeKeys().some(key=>key.startsWith('sully_chat_auto_reply_intent_v1:')),
      'revoke queued automatic replies');
    await pause(2600);
    if(apiRequests.length||errors.length)throw Error('Unexpected model call/error with all permissions off: '+
      JSON.stringify({apiRequests,errors}));
    const chatsAfter=await messages();
    if(chatsAfter.filter(x=>x.role==='user').length!==privateMessages.filter(x=>x.role==='user').length+1)
      throw Error('Phone/schedule/real-person toggles changed chat send history');
    if(chatsAfter.some(x=>x.role==='assistant'&&x.content?.includes('CI browser')))
      throw Error('Technical model failure leaked into player history');
    progress.push('typing gate and turning real-person OFF revoked stale auto-reply');

    // Exit and reopen chat in the same normal session. Reopened phone should
    // preserve the NPC contact but not inherit a stale planned availability.
    const out={charId,progress,phoneDisabled:true,scheduleStored:schedules.length,
      replies:chatsAfter.filter(x=>x.role==='assistant').length,apiRequests:apiRequests.length,
      errors,unansweredIntentKeys:storeKeys().filter(k=>k.startsWith('sully_chat_auto_reply_intent_v1:'))};
    db.close();return out;
  })()`);
  console.log('INTEGRATED_REAL_USER_JOURNEY='+JSON.stringify(journey));
  await capture('integrated-chat-phone-schedule-390',390,844);

}finally{socket.close();}
