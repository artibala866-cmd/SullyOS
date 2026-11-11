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
  if(name==='study-mobile-390')console.log('STUDY_ROOM_SCREENSHOT_BASE64='+shot.data);
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
  const clicked=await evaluate(`(()=>{
    const items=[...document.querySelectorAll('button,[role=button],a')];
    const match=items.find(x=>(x.getAttribute('aria-label')||x.textContent||'').trim()==='学习室');
    if(!match)return false;match.click();return true;
  })()`);
  console.log('STUDY_BROWSER_CLICKED_ROOM='+clicked);
  if(!clicked){
    console.error('VISUAL_BLOCKER: unlocked launcher has no directly selectable study-room entry');
    process.exitCode=1;
  }
  if(clicked){
    await sleep(5500);
    const inside=await inspect('STUDY');
    await capture('study-mobile-390',390,844);
    if(!inside.text.includes('学习室')&&!inside.text.includes('专注')){
      console.error('VISUAL_BLOCKER: navigation did not expose the study room');
      process.exitCode=1;
    }
  }
  await capture('desktop-1366',1366,768);

  if (process.env.STUDY_PRESSURE_MODE==='1') {
    await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    const seed=await evaluate(`(async()=>{
      const date=new Date().toLocaleDateString('sv-SE');
      const tasks=Array.from({length:550},(_,i)=>({id:'stress-task-'+i,title:'练习与画稿 '+i,done:false,sessions:0,
        ...(i<240?{source:{kind:i%2?'homework':'commission',id:'stress-'+i}}:{})}));
      const records=Array.from({length:7000},(_,i)=>({taskId:'stress-task-'+(i%550),
        sessionId:'study-old-'+i,date,minutes:25}));
      for(const [key,value] of Object.entries({tasks,records,selectedTask:tasks[0].id,
        focusMinutes:25,session:{id:'stress-expired-once',mode:'focus',duration:25,
          deadline:Date.now()-1000,taskId:tasks[0].id,usedChatWindows:[]},coachByChar:{}}))
        localStorage.setItem('sully_pomodoro_v1_'+key,JSON.stringify(value));
      const ws={commissions:Array.from({length:500},(_,i)=>({id:'stress-'+(2*i),title:'虚构画稿 '+i,
        client:'',type:'',brief:'',acceptedAt:'',dueDate:'2026-12-15',stage:'草稿',priority:2,
        status:'active',remainingMinutes:60,bufferMinutes:5,plannedDate:'',price:'',paid:false,note:'',order:i})),
        homework:Array.from({length:500},(_,i)=>({id:'stress-'+(2*i+1),classId:'c'+i,
          title:'虚构作业 '+i,dueAt:'2026-12-15T19:00',minutes:40,done:false,note:''})),
        classes:Array.from({length:80},(_,i)=>({id:'c'+i,name:'课程 '+i,
          weekday:i%7,start:'09:00',end:'10:00',until:'',teacher:'',location:'',note:''})),
        notes:[],reminders:[],focusSettlements:[],privateChatPermissions:{},
        dailyAvailableMinutes:240,planSlots:[],availability:[],coachActions:[]};
      const dbName=(await indexedDB.databases()).find(x=>x.name?.includes('AetherOS_Data'))?.name;
      if(!dbName)throw Error('study IndexedDB unavailable');
      const db=await new Promise((res,rej)=>{const q=indexedDB.open(dbName);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error);});
      const courses=Array.from({length:240},(_,i)=>({
        id:'stress-pdf-'+i,title:'虚构教材 '+i,
        rawText:'章节正文段落 '.repeat(150),
        chapters:Array.from({length:12},(_,j)=>({
          id:'chapter-'+j,title:'测试章节 '+j,summary:'用于压力测试的短摘要',
          difficulty:'normal',isCompleted:j<3,content:'缓存讲解文本 '.repeat(40)
        })),
        currentChapterIndex:3,createdAt:Date.now()-i*1000,
        coverStyle:'#525252',totalProgress:25
      }));
      const quizzes=Array.from({length:420},(_,i)=>({
        id:'stress-quiz-'+i,courseId:'stress-pdf-'+(i%240),
        chapterId:'chapter-3',chapterTitle:'测试章节 3',
        courseTitle:'虚构试卷 '+i,
        questions:Array.from({length:8},(_,j)=>({
          id:'question-'+j,type:'choice',stem:'测试问题 '+j,
          options:['甲','乙','丙','丁'],answer:'A',explanation:'解释 '+j
        })),
        score:6,totalQuestions:8,aiReview:'仅测试本地成绩',
        status:i%3?'graded':'in_progress',createdAt:Date.now()-i*50000
      }));
      await new Promise((res,rej)=>{const tx=db.transaction(['assets','courses','quizzes'],'readwrite');
        tx.objectStore('assets').put({id:'sully_workspace_v1',data:ws});
        for(const course of courses)tx.objectStore('courses').put(course);
        for(const quiz of quizzes)tx.objectStore('quizzes').put(quiz);
        tx.oncomplete=res;tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error);});
      db.close();
      window.__studyStressErrors=[];
      window.addEventListener('error',e=>window.__studyStressErrors.push(String(e.message)));
      window.addEventListener('unhandledrejection',e=>window.__studyStressErrors.push(String(e.reason)));
      window.__studyStressModelCalls=0;
      const original=window.fetch.bind(window);
      window.fetch=(...args)=>{if(String(args[0]).includes('/chat/completions')){
        window.__studyStressModelCalls++;return Promise.reject(Error('No model calls in stress run'));}
        return original(...args);};
      return {tasks:tasks.length,records:records.length,commissions:ws.commissions.length,homework:ws.homework.length,courses:courses.length,quizzes:quizzes.length};
    })()`);
    console.log('STUDY_PRESSURE_SEEDED='+JSON.stringify(seed));
    if(seed.tasks!==550||seed.records!==7000)throw Error('Incomplete stress seed');
    const left=await evaluate(`(()=>{
      const b=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='返回'
        &&x.closest('header')?.querySelector('h1')?.textContent==='学习室');
      b?.click();return !!b;
    })()`);
    if(!left)throw Error('Study app did not exit');
    await sleep(2300);
    const entered=await evaluate(`(()=>{
      const b=[...document.querySelectorAll('button,[role=button],a')].find(x=>
        (x.getAttribute('aria-label')||x.textContent||'').trim()==='学习室');
      b?.click();return !!b;
    })()`);
    if(!entered)throw Error('Study app did not reopen');
    await sleep(4800);
    const once=await evaluate(`(()=>{
      const r=JSON.parse(localStorage.getItem('sully_pomodoro_v1_records')||'[]');
      const t=JSON.parse(localStorage.getItem('sully_pomodoro_v1_tasks')||'[]');
      return {count:r.length,once:r.filter(x=>x.sessionId==='stress-expired-once').length,
        sessions:t[0]?.sessions,session:JSON.parse(localStorage.getItem('sully_pomodoro_v1_session')||'null')};
    })()`);
    console.log('STUDY_PRESSURE_RECOVERY='+JSON.stringify(once));
    if(once.count!==7001||once.once!==1||once.sessions!==1||once.session)throw Error('Timer recovery/dedup failure');
    const result=await evaluate(`(async()=>{
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      const clickNav=name=>{
        const nav=[...document.querySelectorAll('nav')].find(n=>[...n.querySelectorAll('button')]
          .some(b=>b.textContent?.trim()==='专注'));
        const button=[...(nav?.querySelectorAll('button')||[])].find(b=>b.textContent?.trim()===name);
        button?.click();return !!button;
      };
      for(let i=0;i<36;i++){if(!clickNav(['排单','课程表','专注'][i%3]))
        throw Error('missing tab '+i);await sleep(150);}
      clickNav('专注');await sleep(350);
      const start=document.querySelector('button[aria-label="开始专注"]');
      if(!start)throw Error('missing start button');
      start.click();await sleep(550);
      const pause=document.querySelector('button[aria-label="暂停专注"]');
      if(!pause)throw Error('could not start session');
      pause.click();await sleep(500);
      const paused=JSON.parse(localStorage.getItem('sully_pomodoro_v1_session')||'null');
      if(paused?.pauseRemainingMs==null)throw Error('pause did not persist');
      clickNav('课程表');await sleep(250);clickNav('专注');await sleep(250);
      const stillPaused=!!document.querySelector('button[aria-label="继续专注"]');
      const records=JSON.parse(localStorage.getItem('sully_pomodoro_v1_records')||'[]');
      return {switches:36,stillPaused,records:records.length,
        errors:window.__studyStressErrors,modelCalls:window.__studyStressModelCalls,
        overflow:document.documentElement.scrollWidth>innerWidth+2,width:innerWidth};
    })()`);
    console.log('STUDY_PRESSURE_BROWSER='+JSON.stringify(result));
    if(result.switches!==36||!result.stillPaused||result.records!==7001||
      result.errors.length||result.modelCalls||result.overflow||result.width!==390)
      throw Error('Study browser stress failure '+JSON.stringify(result).slice(0,1100));
    await capture('study-pressure-390',390,844);

    // Open the actual nested PDF self-study UI while a focus session is paused.
    // The bookshelf and practice book both read the seeded IndexedDB stores.
    const enteredPdf=await evaluate(`(()=>{
      const nav=[...document.querySelectorAll('nav')].find(n=>[...n.querySelectorAll('button')]
        .some(b=>b.textContent?.trim()==='专注'));
      const button=[...(nav?.querySelectorAll('button')||[])].find(b=>b.textContent?.trim()==='自习室');
      button?.click();return !!button;
    })()`);
    if(!enteredPdf)throw Error('Could not navigate to self-study PDF bookshelf');
    await sleep(3500);
    const bookshelf=await evaluate(`(()=>{
      const text=document.body.textContent||'';
      return {lastCourse:text.includes('虚构教材 239'),
        firstCourse:text.includes('虚构教材 0'),
        count:[...document.querySelectorAll('.aspect-\\[4\\/5\\]')].length,
        hasStudy:text.includes('自习室'),
        errors:window.__studyStressErrors,
        modelCalls:window.__studyStressModelCalls
      };
    })()`);
    console.log('STUDY_PRESSURE_PDF_SHELF='+JSON.stringify(bookshelf));
    if(!bookshelf.lastCourse||!bookshelf.firstCourse||!bookshelf.hasStudy||
      bookshelf.errors.length||bookshelf.modelCalls)throw Error('Large PDF bookshelf incomplete');
    await capture('study-pressure-pdf-shelf-390',390,844);
    const openQuizzes=await evaluate(`(()=>{
      const button=document.querySelector('button[title="练习册"]');
      button?.click();return !!button;
    })()`);
    if(!openQuizzes)throw Error('Could not open the real practice book');
    await sleep(2800);
    const practice=await evaluate(`(()=>{
      const text=document.body.textContent||'';
      return {hasTitle:text.includes('练习册'),
        firstQuiz:text.includes('虚构试卷 0'),
        lastQuiz:text.includes('虚构试卷 419'),
        errors:window.__studyStressErrors,
        modelCalls:window.__studyStressModelCalls,
        overflow:document.documentElement.scrollWidth>innerWidth+2
      };
    })()`);
    console.log('STUDY_PRESSURE_PRACTICE_BOOK='+JSON.stringify(practice));
    if(!practice.hasTitle||!practice.firstQuiz||!practice.lastQuiz||practice.errors.length||
      practice.modelCalls||practice.overflow)throw Error('Large practice book incomplete');
    await capture('study-pressure-practice-390',390,844);
    // 320 px catches clipped mobile content under a fully populated bookshelf.
    await cdp('Emulation.setDeviceMetricsOverride',{width:320,height:710,deviceScaleFactor:1,mobile:true});
    await sleep(900);
    const narrow=await evaluate(`({
      width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+2,
      errors:window.__studyStressErrors,modelCalls:window.__studyStressModelCalls
    })`);
    console.log('STUDY_PRESSURE_PRACTICE_320='+JSON.stringify(narrow));
    if(narrow.width!==320||narrow.overflow||narrow.errors.length||narrow.modelCalls)
      throw Error('Study narrow practice book failed');
    await capture('study-pressure-practice-320',320,710);

  }

}finally{
  socket.close();
}
