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
      // Find the exact action on the actual paged tray. It may be on a hidden
      // page; jump to that page with the user's existing pager dot.
      const target=[...document.querySelectorAll('[role="group"][aria-label^="聊天功能第 "] button')]
        .find(b=>{
          const value=b.textContent?.trim()||'';
          return value===label||(label==='真人感'&&value.startsWith('真人感 · '));
        });
      if(!target)throw Error('Missing feature tile '+label);
      const group=target.closest('[role="group"][aria-label^="聊天功能第 "]');
      const page=group?.getAttribute('aria-label')?.match(/[0-9]+/)?.[0];
      if(!page)throw Error('Cannot find feature page for '+label);
      const pager=document.querySelector('button[aria-label="第 '+page+' 页"]');
      if(!pager)throw Error('Missing pager for '+label);
      pager.click();
      await wait(()=>visible(target),'feature tile '+label);
      target.click();
      await pause(190);
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

    // A plausible human sees an old NPC thread beside the real private chat,
    // searches with contradictory terms, then reads a saved Moments post.
    // Fixtures are isolated to this throwaway browser and never hit a paid API.
    const phoneId=currentChar(),now=Date.now();
    const inboxKey='sully_character_phone_wechat_v1:'+phoneId;
    const existingInbox=JSON.parse(localStorage.getItem(inboxKey)||'[]');
    localStorage.setItem(inboxKey,JSON.stringify([{
      id:'ci-phone-inbox',contactId:'ci-phone-friend',kind:'npc',
      name:'林同学',preview:'明天还要画速写吗？',time:now,
      messages:[{speaker:{role:'contact',contactId:'ci-phone-friend'},
        text:'明天还要画速写吗？',createdAt:now}],
    },...existingInbox]));
    window.dispatchEvent(new CustomEvent('sully:character-phone-chats-changed',
      {detail:{characterId:phoneId}}));
    press('返回',phone());
    await wait(()=>buttons(phone()).some(b=>b.textContent?.trim()==='微信'),'phone bottom WeChat after contact edit');
    press('微信',phone());
    await wait(()=>!!phone().querySelector('[aria-label="搜索聊天"]'),'wechat search icon');
    press('搜索聊天',phone());
    textInput('input[aria-label="搜索微信聊天"]','完全不相关的暗号');
    await wait(()=>phone().textContent.includes('没有匹配的微信消息'),'empty search state');
    if(buttons(phone()).some(b=>b.textContent?.includes('真实私聊')||b.textContent?.includes('林同学')))
      throw Error('WeChat search leaked unrelated conversations');
    textInput('input[aria-label="搜索微信聊天"]','如果有空');
    await wait(()=>buttons(phone()).some(b=>b.textContent?.includes('真实私聊')),
      'real private chat matches its message preview');
    if(buttons(phone()).some(b=>b.textContent?.includes('林同学')))
      throw Error('WeChat real-chat query matched the unrelated NPC');
    textInput('input[aria-label="搜索微信聊天"]','林同学');
    await wait(()=>buttons(phone()).some(b=>b.textContent?.includes('林同学')),
      'NPC row matches search');
    if(buttons(phone()).some(b=>b.textContent?.includes('真实私聊')))
      throw Error('WeChat NPC query still shows the private chat');
    press('搜索聊天',phone());
    progress.push('search private/NPC/no-results in one session without cross-row leakage');

    const momentKey='sully_character_moments_v1:'+phoneId;
    localStorage.setItem(momentKey,JSON.stringify([{
      id:'ci-phone-moment',characterId:phoneId,authorId:phoneId,origin:'char',
      text:'画完速写去买杯热饮。',imageUrls:[],createdAt:now,
      visibility:'all',likes:[],comments:[],
    }]));
    window.dispatchEvent(new CustomEvent('sully:character-moments-changed',
      {detail:{characterId:phoneId,changeKind:'published',actorId:phoneId}}));
    press('发现',phone());
    press('朋友圈',phone());
    await wait(()=>!!phone().querySelector('[data-testid="moment-post-ci-phone-moment"]'),
      'saved Moment visible');
    const more=()=>phone().querySelector('[data-testid="moment-more-ci-phone-moment"]');
    more().click();
    await wait(()=>!!phone().querySelector('[data-testid="moment-like-action-ci-phone-moment"]'),
      'Moment like popover');
    phone().querySelector('[data-testid="moment-like-action-ci-phone-moment"]').click();
    await wait(()=>JSON.parse(localStorage.getItem(momentKey)||'[]')[0]?.likes?.length===1,
      'Moment like saved');
    more().click();
    phone().querySelector('[data-testid="moment-like-action-ci-phone-moment"]').click();
    await wait(()=>JSON.parse(localStorage.getItem(momentKey)||'[]')[0]?.likes?.length===0,
      'Moment unlike saved');
    more().click();
    phone().querySelector('[data-testid="moment-comment-action-ci-phone-moment"]').click();
    textInput('input[aria-label="评论"]','我刚发现你也在画速写！');
    press('发送',phone());
    await wait(()=>JSON.parse(localStorage.getItem(momentKey)||'[]')[0]?.comments?.length===1,
      'Moment comment saved once');
    const confirmBefore=window.confirm;window.confirm=()=>true;
    try{press('删除这条朋友圈',phone());}finally{window.confirm=confirmBefore;}
    await wait(()=>!phone().querySelector('[data-testid="moment-post-ci-phone-moment"]'),
      'deleted Moment is no longer shown');
    if(!JSON.parse(localStorage.getItem(momentKey)||'[]')[0]?.deletedAt)
      throw Error('Moment did not retain its soft deletion');
    press('返回',phone());
    progress.push('real Moments like/unlike/comment/delete cycle keeps persistence');

    // A user opens the fictional wallet straight after talking about buying
    // a drink: previously saved receipt is applied only once on repeated refresh.
    const walletKey='sully_character_phone_wallet_v1:'+phoneId;
    const receiptKey='sully_character_phone_pay_receipts_v1:'+phoneId;
    localStorage.setItem(walletKey,JSON.stringify({
      version:1,characterId:phoneId,currency:'CNY',createdAt:now,updatedAt:now,
      accounts:[{id:'cash',kind:'cash',title:'零钱',bankLabel:'微信支付',
        maskedNumber:'4321',balanceCents:50000,note:'虚构角色余额'}],
      transactions:[],appliedMemoIds:[],appliedPaymentIds:[],
    }));
    localStorage.setItem(receiptKey,JSON.stringify([{
      id:'ci-payment-1',characterId:phoneId,title:'热饮',detail:'买热饮',
      category:'日常',amountCents:-500,occurredAt:now,origin:'wechat-simulated',
    }]));
    press('我',phone());
    press('钱包',phone());
    await wait(()=>phone().textContent.includes('资产 · ASSETS'),'wallet assets displayed');
    await wait(()=>phone().textContent.includes('495.00'),'receipt applied to wallet balance');
    for(let i=0;i<5;i++){
      press('刷新资产',phone());
      await pause(150);
    }
    const afterWallet=JSON.parse(localStorage.getItem(walletKey)||'null');
    if(afterWallet?.transactions?.length!==1||afterWallet.accounts?.[0]?.balanceCents!==49500)
      throw Error('Repeated wallet refresh double-charged the single receipt');
    press('清空资产档案',phone());
    await wait(()=>!!phone().querySelector('[role="dialog"][aria-label="清空虚构资产"]'),
      'wallet delete confirmation');
    press('取消',phone());
    if(!localStorage.getItem(walletKey))throw Error('Cancel deleted wallet assets');
    press('返回',phone());
    progress.push('real wallet repeated refresh and cancelled deletion are consistent');

    // Character avatar library is shared with private chat. Select an existing
    // recognized avatar through the actual modal rather than editing its storage.
    const avatarImage='data:image/svg+xml;base64,'+
      btoa('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="lightblue"/></svg>');
    const avatarKey='sully_character_avatar_library_v1_'+phoneId;
    localStorage.setItem(avatarKey,JSON.stringify({
      entries:[{id:'ci-avatar',image:avatarImage,createdAt:now,
        source:'upload',visionDescription:'浅蓝色方形头像'}],autonomousEnabled:false,
    }));
    const profileButton=buttons(phone()).find(b=>!!b.querySelector('strong.text-xl'));
    if(!profileButton)throw Error('Phone self profile entry missing');
    profileButton.click();
    await wait(()=>!!phone().querySelector('[data-testid="character-phone-profile-panel"]'),
      'phone owner profile');
    press('打开角色头像库',phone());
    await wait(()=>!!document.querySelector('[role="dialog"][aria-label="角色头像库"]'),
      'character avatar library modal');
    const avatarModal=document.querySelector('[role="dialog"][aria-label="角色头像库"]');
    press('使用',avatarModal);
    await wait(()=>JSON.parse(localStorage.getItem(avatarKey)||'null')?.activeId==='ci-avatar',
      'character avatar selection is persisted');
    press('关闭头像库',document);
    press('返回',phone());
    progress.push('avatar choice persisted from the actual shared library UI');


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
    phoneBack();
    await wait(()=>buttons(phone()).some(b=>b.textContent?.trim()==='微信'),'return to WeChat from settings');
    await pause(180);
    phoneBack();
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
    // Use the actual visible close control, not an assumed dialog wrapper.
    // The Chat modal can render through a portal without a matching role.
    const closeSchedule=buttons().find(b=>(b.getAttribute('aria-label')||b.textContent||'').trim()==='关闭');
    if(!closeSchedule)throw Error('Schedule modal has no visible Close control');
    closeSchedule.click();
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

  // All data below lives in a disposable Chromium profile, never in the user's device.
  // A second saved character and a loopback-only mock LLM let us exercise
  // actual React, chat persistence, phone mirror, schedule and permission races.
  const extremeSeed=await evaluate(`(async()=>{
    const store=(name,mode='readonly')=>new Promise((resolve,reject)=>{
      const open=indexedDB.open('AetherOS_Data');
      open.onsuccess=()=>{const db=open.result;
        if(!db.objectStoreNames.contains(name)){db.close();reject(Error('no store '+name));return;}
        const tx=db.transaction(name,mode);
        resolve({db,tx,collection:tx.objectStore(name)});
      };open.onerror=()=>reject(open.error);
    });
    const ch=await store('characters');
    const all=await new Promise((resolve,reject)=>{const r=ch.collection.getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    ch.db.close();
    const base=all.find(c=>c.id==='preset-sully-v2')||all[0];
    if(!base)throw Error('No real source role for disposable role B');
    const charB='qa-mad-usage-second';
    if(!all.some(c=>c.id===charB)){
      const clone=JSON.parse(JSON.stringify(base));
      Object.assign(clone,{id:charB,name:'压力角色乙',description:'安静且有自己的生活节奏，喜欢摄影',
        systemPrompt:'你是压力角色乙，喜欢摄影，不是另一位角色。',
        scheduleFeatureEnabled:false,scheduleStyle:null,chatBlock:undefined,
        activeMsg2Config:{enabled:false}, emotionConfig:{enabled:false}});
      const put=await store('characters','readwrite');
      put.collection.put(clone);
      await new Promise((res,rej)=>{put.tx.oncomplete=res;put.tx.onerror=()=>rej(put.tx.error);});
      put.db.close();
    }
    const day=new Date();
    const date=[day.getFullYear(),String(day.getMonth()+1).padStart(2,'0'),String(day.getDate()).padStart(2,'0')].join('-');
    const schedules=await store('daily_schedule','readwrite');
    schedules.collection.put({id:charB+'_'+date,charId:charB,date,generatedAt:Date.now(),
      slots:[{startTime:'00:00',activity:'乙在外摄影',availability:'busy',description:'纯压测日程',location:'公园'}]});
    await new Promise((res,rej)=>{schedules.tx.oncomplete=res;schedules.tx.onerror=()=>rej(schedules.tx.error);});
    schedules.db.close();
    const original=JSON.parse(localStorage.getItem('os_api_config')||'{}');
    localStorage.setItem('os_api_config',JSON.stringify({...original,
      baseUrl:'http://127.0.0.1:4173/_qa/v1',apiKey:'DISPOSABLE_CI_NO_BILL',model:'ci-mock-real-person',stream:false}));
    return {chars:all.length+(!all.some(c=>c.id===charB)?1:0),second:charB,api:'loopback-only',
      first:localStorage.getItem('os_last_active_char_id')};
  })()`);
  console.log('EXTREME_SEEDED='+JSON.stringify(extremeSeed));
  await cdp('Page.addScriptToEvaluateOnNewDocument',{source: `(()=>{
    const realFetch=window.fetch.bind(window);
    const qa={calls:[],unsafe:[],delayMs:900};
    window.__extremeQA=qa;
    window.fetch=(input,opts={})=>{
      const url=typeof input==='string'?input:input?.url||'';
      if(url.includes('/chat/completions')){
        if(!url.includes('127.0.0.1:4173/_qa/v1'))qa.unsafe.push(url);
        let payload={};
        try{payload=JSON.parse(opts.body||'{}');}catch{}
        const count=qa.calls.push({at:Date.now(),url,
          model:payload.model,msgCount:payload.messages?.length||0,
          last:payload.messages?.slice(-1)?.[0]?.content?.slice?.(0,120)||''});
        return new Promise((resolve,reject)=>{
          if(opts.signal?.aborted){reject(new DOMException('cancelled','AbortError'));return;}
          const delay=qa.delayMs;
          const timer=setTimeout(()=>{
            if(opts.signal?.aborted){reject(new DOMException('cancelled','AbortError'));return;}
            resolve(new Response(JSON.stringify({
              id:'qa-stub-'+count,object:'chat.completion',created:Math.floor(Date.now()/1000),
              model:'ci-mock-real-person',
              choices:[{index:0,message:{role:'assistant',
                content:'我听见你说的了。这是一次真实界面压测的本地模拟回复。'},finish_reason:'stop'}],
              usage:{prompt_tokens:15,completion_tokens:20,total_tokens:35},
            }),{status:200,headers:{'content-type':'application/json'}}));
          },delay);
          opts.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('cancelled','AbortError'));},{once:true});
        });
      }
      return realFetch(input,opts);
    };
  })()`});
  await cdp('Page.reload',{ignoreCache:true});
  await sleep(14500);
  let reloaded=await inspect('EXTREME_RELOADED');
  if(reloaded.text.includes('TAP TO UNLOCK')){
    await evaluate(`(()=>{document.elementFromPoint(195,765)?.click();return true})()`);
    await sleep(5300);
  }
  // Reload intentionally tests re-entry through the real home launcher.
  const enterAfterReload=await evaluate(`(()=>{
    if(document.querySelector('.sully-chat-composer'))return true;
    const b=[...document.querySelectorAll('button,[role=button],a')]
      .find(x=>(x.getAttribute('aria-label')||'').trim()==='打开角色聊天');
    if(!b)return false;b.click();return true;
  })()`);
  console.log('EXTREME_REOPEN_CHAT='+enterAfterReload);
  if(!enterAfterReload)throw Error('Reload lost access to private chat');
  await sleep(4500);

  const extreme=await evaluate(`(async()=>{try{
    const pause=ms=>new Promise(r=>setTimeout(r,ms));
    const visible=e=>e?.getClientRects().length>0&&!e.closest('[hidden]');
    const wait=async(f,name,ms=15000)=>{
      for(let i=0;i<ms;i+=90){if(await f())return;await pause(90);}
      throw Error('Extreme real-user '+name+'; visible: '+[...document.querySelectorAll('button')]
        .filter(visible).map(x=>(x.getAttribute('aria-label')||x.textContent||'').trim()).filter(Boolean).slice(-18).join('/'));
    };
    const currentId=()=>localStorage.getItem('os_last_active_char_id');
    const dbName=(await indexedDB.databases()).find(x=>x.name?.includes('AetherOS_Data'))?.name;
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(dbName);
      r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const rows=()=>new Promise((resolve,reject)=>{
      const q=db.transaction('messages','readonly').objectStore('messages').getAll();
      q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);
    });
    const count=async(id,prefix)=>(await rows()).filter(x=>x.charId===id&&x.role==='user'&&x.content?.startsWith(prefix)).length;
    const textarea=()=>[...document.querySelectorAll('textarea.sully-chat-textarea')].find(visible);
    const setDraft=text=>{const el=textarea();if(!el)throw Error('Composer lost');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,text);
      el.dispatchEvent(new Event('input',{bubbles:true}));
    };
    const button=label=>[...document.querySelectorAll('button')].find(x=>visible(x)&&
      ((x.getAttribute('aria-label')||'').trim()===label||x.textContent?.trim()===label));
    const press=label=>{const b=button(label);if(!b)throw Error('Button missing: '+label);b.click();};
    const menu=async()=>{
      const btn=button('聊天功能');if(!btn)throw Error('Chat feature tray unavailable');
      if(btn.getAttribute('aria-expanded')!=='true')btn.click();
      await wait(()=>btn.getAttribute('aria-expanded')==='true','open feature tray');
    };
    const closeMenu=()=>{const b=button('聊天功能');if(b?.getAttribute('aria-expanded')==='true')b.click();};
    const action=async(label)=>{
      await menu();
      const target=[...document.querySelectorAll('[role="group"][aria-label^="聊天功能第 "] button')]
        .find(x=>{const s=x.textContent?.trim()||'';return s===label||
          (label==='真人感'&&s.startsWith('真人感 · '));});
      if(!target)throw Error('No feature '+label);
      const page=target.closest('[role="group"]')?.getAttribute('aria-label')?.match(/[0-9]+/)?.[0];
      const pager=document.querySelector('button[aria-label="第 '+page+' 页"]');
      pager?.click();await wait(()=>visible(target),'show '+label);
      target.click();await pause(115);
    };
    const send=async(content)=>{
      closeMenu();setDraft(content);
      await pause(85);
      const before=await count(currentId(),content);
      press('发送文字');
      await wait(async()=>(await count(currentId(),content))===before+1,'send '+content.slice(0,20));
    };
    const switchRole=async(name,id)=>{
      closeMenu();const header=[...document.querySelectorAll('.sully-chat-profile')].find(visible);
      if(!header)throw Error('Role switch header not available');header.click();
      await wait(()=>!![...document.querySelectorAll('.sully-chat-switch-item')].find(x=>visible(x)&&x.textContent.includes(name)),
        'show switch role '+name);
      const chosen=[...document.querySelectorAll('.sully-chat-switch-item')].find(x=>visible(x)&&x.textContent.includes(name));
      chosen.click();await wait(()=>currentId()===id,'switch role '+name);
      await pause(230);
    };
    const qa=window.__extremeQA;
    if(!qa)throw Error('Mock LLM protection missing, refusing to test paid API');
    const faults=[];const samples=[];let phoneTrips=0;
    const first=currentId();const second='qa-mad-usage-second';
    if(first===second)throw Error('Stress started with wrong primary role');
    if(localStorage.getItem('sully_life_pacing')==='on')await action('真人感');
    await wait(()=>localStorage.getItem('sully_life_pacing')==='off','ensure real person OFF');
    setDraft('');await pause(150);
    // 1. Rapid repeated sends, long Unicode and an accidental double tap.
    const variants=['奇怪的第一句','[html]不是指令[/html]','柠檬/蜂蜜|草莓\\n换行', '📷🧩🦊🪷🌙',
      '一个很长的句子'+('角色生活记忆不许串线。'.repeat(185)),'AA-回忆-001','明天见。','同一句发两次是用户选择'];
    for(let i=0;i<24;i++){
      const line='极端连续发送#'+String(i).padStart(3,'0')+':'+variants[i%variants.length];
      await send(line);
    }
    const beforeDup=await count(first,'故意双击的唯一消息');
    setDraft('故意双击的唯一消息');await pause(150);
    const sendBtn=button('发送文字');
    sendBtn.click();sendBtn.click();
    await wait(async()=>(await count(first,'故意双击的唯一消息'))>=beforeDup+1,'double tap persistence');
    await pause(450);
    const extraDup=(await count(first,'故意双击的唯一消息'))-beforeDup;
    samples.push({step:'double-tap',stored:extraDup});
    if(extraDup!==1)throw Error('Double-tapping Send produced '+extraDup+' duplicate messages');
    if(qa.calls.length!==0)throw Error('OFF mode attempted '+qa.calls.length+' API requests');
    samples.push({step:'24 message burst',messages:await count(first,'极端连续发送#'),apiCalls:qa.calls.length});

    // 2. Switch to another existing role and return multiple times, with
    // overlapping chat saves and nontrivial scroll/render history.
    for(let round=0;round<5;round++){
      await switchRole('压力角色乙',second);
      await send('乙独有一条'+round+'：我在拍晚霞。');
      if((await rows()).some(x=>x.charId===first&&x.content?.includes('乙独有一条')))
        throw Error('Second role private message leaked into first role');
      await switchRole('Sully',first);
      await send('甲独有一条'+round+'：我在画人物。');
    }
    if(await count(second,'乙独有一条')!==5||await count(first,'甲独有一条')!==5)
      throw Error('Cross role message counts inconsistent');
    samples.push({step:'10 cross-role switches',first:await count(first,'甲独有一条'),
      second:await count(second,'乙独有一条')});

    // 3. User sends, immediately picks up the character's phone, and holds
    // it through the reply window. A legitimate answer may arrive even while
    // the phone is open, but it must never be duplicated or cross-posted.
    await action('真人感');
    await wait(()=>localStorage.getItem('sully_life_pacing')==='on','real person ON');
    await send('悬空回复测验：我先看看你的手机，你稍后再接我话。');
    await action('查手机');
    await wait(()=>!!document.querySelector('[role="dialog"][aria-label$="的手机"]'),'open phone during pending reply');
    const phone=()=>document.querySelector('[role="dialog"][aria-label$="的手机"]');
    await pause(5800);
    const duringPhone=qa.calls.length;
    samples.push({step:'pending reply while reading phone',modelCalls:duringPhone});
    if(duringPhone>1)throw Error('One saved user turn caused duplicate automatic replies while reading the phone: '+duringPhone);
    phone().querySelector('[aria-label="向右滑动解锁"]')
      ?.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    await wait(()=>!!phone().querySelector('button.cp-home-shortcut'),'phone unlock under pending reply');
    phone().querySelector('button.cp-home-shortcut')?.click();
    await wait(()=>phone().textContent.includes('真实私聊'),'phone private mirror at heavy message load');
    const thread=[...phone().querySelectorAll('button')].find(x=>x.textContent?.includes('真实私聊'));
    if(!thread)throw Error('Phone did not mirror A after 30+ rapid sends');
    thread.click();
    await wait(()=>phone().textContent.includes('悬空回复测验'),'freshest chat message in phone');
    press('返回');
    await pause(140);press('返回');
    await wait(()=>!!phone().querySelector('button.cp-home-shortcut'),'return from phone WeChat');
    press('退出查手机');
    await wait(()=>!phone(),'phone closes and chat is foreground');
    await wait(()=>qa.calls.length>=1,'pending auto response resumes after phone closes',18000);
    await wait(async()=>(await rows()).some(x=>x.charId===first&&x.role==='assistant'&&
      x.content?.includes('本地模拟回复')),'receive actual mock AI reply',15000);
    const apiAfterClose=qa.calls.length;
    await pause(2800);
    // Additional optional phone-install analysis may use a second request,
    // but a single private reply must not repeat for the same user turn.
    if(qa.calls.length!==apiAfterClose)throw Error('Unexpected additional AI request after reply settled: '+
      JSON.stringify(qa.calls.slice(-4)));
    samples.push({step:'phone close resumes exactly one reply',apiCalls:qa.calls.length});

    // 4. Switch a role while the last reply is pending: no old character
    // message may land inside the new UI conversation.
    await send('甲需要稍后回的唯一一句，切换角色时不要发给乙。');
    await switchRole('压力角色乙',second);
    await pause(4250);
    const visibleChat=document.querySelector('.sully-chat-composer')?.parentElement?.parentElement?.textContent||'';
    if(visibleChat.includes('甲需要稍后回的唯一一句'))
      throw Error('Wrong character message visible in B after rapid switch');
    await send('乙也在这里说一句。');
    await wait(()=>qa.calls.length>=2,'B automatic reply requests model',18000);
    samples.push({step:'role switch while pending',calls:qa.calls.length,visibleOld:false});
    // 5. Switch OFF during a slow existing automatic model request. A
    // late response must not intrude into this conversation after revocation.
    await wait(async()=>(await rows()).some(x=>x.charId===second&&x.role==='assistant'),
      'B first mock answer committed',15000);
    qa.delayMs=5100;
    await send('乙的慢速回复：关开关后不许再出现。');
    const beforeSlow=qa.calls.length;
    await wait(()=>qa.calls.length>=beforeSlow+1,'slow automatic request launched',18000);
    const msgsBeforeOff=(await rows()).filter(x=>x.charId===second&&x.role==='assistant').length;
    await action('真人感');
    await wait(()=>localStorage.getItem('sully_life_pacing')==='off','disable while in-flight');
    await pause(6400);
    const msgsAfterOff=(await rows()).filter(x=>x.charId===second&&x.role==='assistant').length;
    samples.push({step:'disable during slow reply',before:msgsBeforeOff,after:msgsAfterOff});
    if(msgsAfterOff>msgsBeforeOff)
      throw Error('Turning real-person OFF allowed an in-flight automatic reply to be delivered');
    if(qa.unsafe.length)throw Error('Attempted network to non-test model provider: '+JSON.stringify(qa.unsafe));

    // 6. The user frantically flicks a saved schedule on and off 20 times
    // while real-person is OFF. The previous day's authored plan must remain
    // stored; no automatic request may be launched by any of the toggles.
    const requestsBeforeSchedule=qa.calls.length;
    await action('日程');
    await wait(()=>!!document.querySelector('button[aria-label="切换角色日程开关"]'),'schedule entry for B');
    const scheduleButton=()=>document.querySelector('button[aria-label="切换角色日程开关"]');
    const scheduleState=()=>scheduleButton()?.closest('div.mb-4')?.textContent||'';
    if(!scheduleState().includes('已关闭'))throw Error('B schedule unexpectedly ON before toggle marathon');
    for(let i=0;i<20;i++){
      const expected=i%2===0?'已开启':'已关闭';
      scheduleButton().click();
      await wait(()=>scheduleState().includes(expected),'schedule switch cycle '+i);
      if(currentId()!==second)throw Error('Schedule toggle switched active character');
      await pause(45);
    }
    if(!scheduleState().includes('已关闭'))throw Error('20 schedule toggles did not end OFF');
    if(qa.calls.length!==requestsBeforeSchedule)
      throw Error('Schedule toggles launched model calls with real-person disabled');
    const storedSchedule=await new Promise((resolve,reject)=>{
      const q=db.transaction('daily_schedule','readonly').objectStore('daily_schedule').getAll();
      q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);
    });
    if(!storedSchedule.some(x=>x.charId===second&&x.slots?.[0]?.activity==='乙在外摄影'))
      throw Error('Stress toggle deleted the existing role-B schedule');
    samples.push({step:'20 rapid schedule toggles',final:'off',saved:true,
      modelCalls:qa.calls.length-requestsBeforeSchedule});
    press('关闭');
    await wait(()=>!scheduleButton(),'leave schedule after rapid toggles');
    await action('查手机');
    await wait(()=>!!document.querySelector('[role="dialog"][aria-label$="的手机"]'),
      'phone after schedule hammer');
    const phoneB=()=>document.querySelector('[role="dialog"][aria-label$="的手机"]');
    phoneB().querySelector('[aria-label="向右滑动解锁"]')
      ?.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    await wait(()=>!!phoneB().querySelector('button.cp-home-shortcut'),'unlock B phone');
    const wx=[...phoneB().querySelectorAll('button')].find(x=>x.textContent?.trim()==='微信');
    if(!wx)throw Error('B phone WeChat shortcut absent');wx.click();
    await wait(()=>[...phoneB().querySelectorAll('button')].some(x=>x.textContent?.trim()==='通讯录'),
      'phone WeChat after schedule toggles');
    press('通讯录');
    await pause(260);
    if(phoneB().textContent.includes('当前生活状态 · 乙在外摄影'))
      throw Error('B phone displayed disabled stale schedule as currently active');
    press('返回');await wait(()=>!!phoneB().querySelector('button.cp-home-shortcut'),'B phone home');
    press('退出查手机');
    await wait(()=>!phoneB(),'close B phone');
    samples.push({step:'phone after schedule stress',showsDisabledActivity:false});
    const apiAfterAll=qa.calls.length;
    await send('把日程开关反复按完了，现在只聊我主动发送的这条。');
    await pause(3600);
    if(qa.calls.length!==apiAfterAll)
      throw Error('Real-person OFF after schedule/phone marathon still triggered a model reply');
    samples.push({step:'all systems OFF, user sends after chaos',modelCalls:qa.calls.length-apiAfterAll});

    db.close();
    return {samples,calls:qa.calls.length,unsafe:qa.unsafe,errors:faults,
      finalRole:currentId(),revokeKeys:Object.keys(localStorage).filter(k=>k.startsWith('sully_chat_auto_reply_intent_v1:'))};
  }catch(error){
    return {failure:String(error),calls:window.__extremeQA?.calls||[],
      unsafe:window.__extremeQA?.unsafe||[],mode:localStorage.getItem('sully_life_pacing'),
      apiUrl:JSON.parse(localStorage.getItem('os_api_config')||'{}').baseUrl||'',
      pendingKeys:Object.keys(localStorage).filter(k=>k.startsWith('sully_chat_auto_reply_intent_v1:')),
      role:localStorage.getItem('os_last_active_char_id'),
      visibleText:document.body.innerText.slice(-450)};
  }})()`);
  console.log('EXTREME_REAL_USER_PRESSURE='+JSON.stringify(extreme));
  if(extreme.failure)throw Error(extreme.failure);
  await capture('integrated-chaos-private-chat-390',390,844);
  await capture('integrated-chaos-private-chat-320',320,700);
  const narrow=await evaluate(`({width:innerWidth,html:document.documentElement.scrollWidth,
    body:document.body.scrollWidth,chat:!!document.querySelector('.sully-chat-composer')})`);
  console.log('EXTREME_NARROW_MOBILE='+JSON.stringify(narrow));
  if(narrow.width!==320||!narrow.chat||Math.max(narrow.html,narrow.body)>322)
    throw Error('320px device chat layout exceeds viewport after pressure test');


}finally{socket.close();}
