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

  if (process.env.STUDY_HUMAN_MODE==='1') {
    // One ordinary learner journey, not a random-click or volume benchmark.
    // Everything runs in the disposable empty browser profile from this CI job.
    await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    const studyDay=await evaluate(`(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      const until=async(f,label,ms=6500)=>{
        for(let t=0;t<ms;t+=100){if(await f())return true;await wait(100);}
        throw Error('Learning journey blocked: '+label);
      };
      const visible=e=>e&&e.getClientRects().length>0;
      const controls=()=>[...document.querySelectorAll('button')].filter(visible);
      const press=text=>{
        const b=controls().find(x=>x.textContent?.trim()===text&&!x.disabled);
        if(!b)throw Error('Missing action: '+text);
        b.click();return b;
      };
      const nav=text=>{
        const bar=[...document.querySelectorAll('nav')].find(x=>[...x.querySelectorAll('button')]
          .some(b=>b.textContent?.trim()==='专注'));
        const b=[...(bar?.querySelectorAll('button')||[])].find(x=>x.textContent?.trim()===text);
        if(!b)throw Error('Missing section: '+text);
        b.click();
      };
      const value=(selector,v)=>{
        const el=[...document.querySelectorAll(selector)].find(visible);
        if(!el)throw Error('Missing form field '+selector);
        const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype
          :el instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto,'value').set.call(el,String(v));
        el.dispatchEvent(new Event('input',{bubbles:true}));
        el.dispatchEvent(new Event('change',{bubbles:true}));
        return el;
      };
      const due=new Date();due.setDate(due.getDate()+5);
      const two=n=>String(n).padStart(2,'0');
      const deadline=[due.getFullYear(),two(due.getMonth()+1),two(due.getDate())].join('-')+'T19:00';
      const dbName=(await indexedDB.databases()).find(d=>d.name?.includes('AetherOS_Data'))?.name;
      if(!dbName)throw Error('No actual app IndexedDB');
      const db=await new Promise((res,rej)=>{
        const req=indexedDB.open(dbName);
        req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error);
      });
      const workspace=()=>new Promise((res,rej)=>{
        const tx=db.transaction('assets','readonly');
        const req=tx.objectStore('assets').get('sully_workspace_v1');
        req.onsuccess=()=>res(req.result?.data||{classes:[],homework:[],notes:[]});
        req.onerror=()=>rej(req.error);
      });
      window.__humanJourneyErrors=[];
      window.__humanJourneyModelCalls=0;
      window.addEventListener('error',e=>window.__humanJourneyErrors.push(String(e.message)));
      window.addEventListener('unhandledrejection',e=>window.__humanJourneyErrors.push(String(e.reason)));
      const oldFetch=window.fetch.bind(window);
      window.fetch=(...args)=>{
        if(String(args[0]).includes('/chat/completions')){
          window.__humanJourneyModelCalls++;
          return Promise.reject(Error('QA blocks paid AI; this scenario never requested it'));
        }
        return oldFetch(...args);
      };

      // Monday: enter timetable and manually record a single real class.
      nav('课程表');
      await until(()=>!![...document.querySelectorAll('summary')].find(x=>visible(x)&&x.textContent?.includes('新建')),'new-class section');
      const create=[...document.querySelectorAll('summary')].find(x=>visible(x)&&x.textContent?.includes('新建'));
      if(!create)throw Error('Missing expand-new-class action');create.click();
      await until(()=>!![...document.querySelectorAll('input[aria-label="课程名称"]')].find(visible),'class editor');
      value('input[aria-label="课程名称"]','周三透视基础课');
      const classForm=[...document.querySelectorAll('form')].find(f=>visible(f)&&f.querySelector('input[aria-label="课程名称"]'));
      if(!classForm)throw Error('Class form absent');
      const times=[...classForm.querySelectorAll('input[type="time"]')];
      value('input[aria-label="老师或班级"]','线稿练习');
      const timeValue=(el,v)=>{
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v);
        el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
      };
      if(times.length!==2)throw Error('Course start and end fields missing');
      timeValue(times[0],'09:00');timeValue(times[1],'10:30');
      await wait(180);press('保存课程');
      await until(async()=>(await workspace()).classes?.some(c=>c.name==='周三透视基础课'),'save class');

      // The same course gets one homework and a note, as a learner normally does.
      await until(()=>!![...document.querySelectorAll('input[aria-label="新增作业"]')].find(visible),'homework field');
      value('input[aria-label="新增作业"]','透视课练习：两张速写');
      value('input[aria-label="作业截止时间"]',deadline);
      await wait(140);press('添加作业');
      await until(async()=>(await workspace()).homework?.some(h=>h.title==='透视课练习：两张速写'),'save homework');
      value('textarea[placeholder="记下刚学到的知识"]','先找消失点，再检查物体投影。');
      await wait(140);press('保存笔记');
      await until(async()=>(await workspace()).notes?.some(n=>n.body==='先找消失点，再检查物体投影。'),'save note');
      const initial=await workspace();
      const exercise=initial.homework.find(x=>x.title==='透视课练习：两张速写');
      if(!exercise||exercise.done||initial.classes.length!==1||initial.homework.length!==1||initial.notes.length!==1)
        throw Error('Ordinary course, homework or note state inconsistent');

      // After class: start studying this precise homework, pause for an errand,
      // switch back to the timetable and return without losing the same round.
      press('为作业开始专注');
      await until(()=>!!document.querySelector('button[aria-label="暂停专注"]'),'start linked focus');
      const round=JSON.parse(localStorage.getItem('sully_pomodoro_v1_session')||'null');
      if(round?.mode!=='focus'||!round.taskId)throw Error('Linked focus not started');
      const tasks=JSON.parse(localStorage.getItem('sully_pomodoro_v1_tasks')||'[]');
      if(!tasks.some(t=>t.id===round.taskId&&t.source?.id===exercise.id))
        throw Error('Focus is not connected to the selected homework');
      document.querySelector('button[aria-label="暂停专注"]').click();
      await until(()=>JSON.parse(localStorage.getItem('sully_pomodoro_v1_session')||'null')?.pauseRemainingMs!=null,'pause');
      nav('课程表');await wait(400);
      nav('专注');await until(()=>!!document.querySelector('button[aria-label="继续专注"]'),'return to paused session');
      const pauseRound=JSON.parse(localStorage.getItem('sully_pomodoro_v1_session')||'null');
      if(pauseRound.id!==round.id)throw Error('Tab switch changed focus round');
      document.querySelector('button[aria-label="继续专注"]').click();
      await until(()=>!!document.querySelector('button[aria-label="暂停专注"]'),'resume focus');

      // Student checks the accompanying Char phone, then closes it.
      document.querySelector('button[aria-label="打开 Char 悬浮手机"]')?.click();
      await until(()=>!!document.querySelector('[aria-label="Char 手机私聊"]'),'open Char phone');
      if(!document.body.textContent.includes('限额陪聊'))throw Error('Focus chat limit was bypassed');
      document.querySelector('button[aria-label="关闭 Char 手机"]')?.click();
      await wait(140);

      // Interruption should *not* be treated as learning completion.
      document.querySelector('button[aria-label="结束或退出本轮选项"]')?.click();
      await until(()=>!!controls().find(b=>b.textContent?.trim()==='继续专注'),'confirm-before-stop dialog');
      press('继续专注');await wait(130);
      if(!JSON.parse(localStorage.getItem('sully_pomodoro_v1_session')||'null'))
        throw Error('Continue-from-exit unexpectedly erased timer');
      document.querySelector('button[aria-label="结束或退出本轮选项"]')?.click();
      await wait(130);press('中断本轮，留在学习室');
      await until(()=>localStorage.getItem('sully_pomodoro_v1_session')==='null','interrupt round');
      const storedRecords=JSON.parse(localStorage.getItem('sully_pomodoro_v1_records')||'[]');
      if(storedRecords.length!==0)throw Error('Interrupted homework was falsely credited');
      const pending=await workspace();
      if(pending.homework.find(h=>h.id===exercise.id)?.done)throw Error('Timer falsely completed homework');

      // It is the learner, not the timer or companion, who marks the work done.
      nav('课程表');
      await until(()=>!![...document.querySelectorAll('input[aria-label="完成透视课练习：两张速写"]')].find(visible),'homework completion checkbox');
      document.querySelector('input[aria-label="完成透视课练习：两张速写"]').click();
      await until(async()=>(await workspace()).homework.some(h=>h.id===exercise.id&&h.done),'save manual completion');
      const end=await workspace();
      db.close();
      if(window.__humanJourneyModelCalls!==0||window.__humanJourneyErrors.length)
        throw Error('Unexpected AI usage or script errors '+JSON.stringify({calls:window.__humanJourneyModelCalls,errors:window.__humanJourneyErrors}));
      return {className:end.classes[0].name,homework:end.homework[0].title,
        noteCount:end.notes.length,manualCompleted:end.homework[0].done,
        savedFocusCount:storedRecords.length,sessionStillOpen:false,
        modelCalls:window.__humanJourneyModelCalls,errors:window.__humanJourneyErrors,
        beforeDeadline:deadline};
    })()`);
    console.log('STUDY_HUMAN_CLASS_HOMEWORK_FOCUS='+JSON.stringify(studyDay));
    await capture('human-homework-finished',390,844);

    // A returning learner already has one saved PDF and one graded practice
    // sheet. Seed only that past history; the interactions below use real UI.
    const past=await evaluate(`(async()=>{
      const name=(await indexedDB.databases()).find(d=>d.name?.includes('AetherOS_Data'))?.name;
      const db=await new Promise((res,rej)=>{
        const q=indexedDB.open(name);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error);
      });
      const course={id:'human-reading-1',title:'光影基础：继续上次的课',
        rawText:'光源决定受光面和背光面。',currentChapterIndex:0,
        chapters:[
          {id:'ch-1',title:'明暗五调子',summary:'理解明暗的层次',
            difficulty:'easy',isCompleted:false,content:'课程笔记：先确认光源，再绘制明暗交界线。'},
          {id:'ch-2',title:'投影练习',summary:'分析光源方向',
            difficulty:'normal',isCompleted:false,content:'下一节课：观察投影的形状。'}],
        createdAt:Date.now()-86400000,coverStyle:'#777777',totalProgress:0};
      const quiz={id:'human-past-quiz-1',courseId:course.id,chapterId:'ch-1',
        chapterTitle:'明暗五调子',courseTitle:course.title,createdAt:Date.now()-3600000,
        status:'graded',score:1,totalQuestions:2,aiReview:'下次多观察阴影边界。',
        questions:[
          {id:'q1',type:'choice',stem:'明暗交界线与什么有关？',options:['光源','画框','画纸'],answer:'A',
            userAnswer:'A',isCorrect:true,explanation:'取决于光线'},
          {id:'q2',type:'true_false',stem:'所有投影都向同一方向。',answer:'false',
            userAnswer:'true',isCorrect:false,explanation:'需要观察光源'}]};
      await new Promise((res,rej)=>{const t=db.transaction(['courses','quizzes'],'readwrite');
        t.objectStore('courses').put(course);t.objectStore('quizzes').put(quiz);
        t.oncomplete=res;t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error);
      });
      db.close();return {course:course.title,quiz:quiz.courseTitle};
    })()`);
    console.log('STUDY_HUMAN_PAST_SESSION='+JSON.stringify(past));

    const reading=await evaluate(`(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      const visible=e=>e&&e.getClientRects().length>0;
      const until=async(fn,label)=>{
        for(let i=0;i<65;i++){if(fn())return;await wait(100);}
        throw Error('Human PDF journey: '+label);
      };
      const nav=[...document.querySelectorAll('nav')].find(n=>[...n.querySelectorAll('button')]
        .some(b=>b.textContent?.trim()==='专注'));
      const btn=[...(nav?.querySelectorAll('button')||[])].find(b=>b.textContent?.trim()==='自习室');
      if(!btn)throw Error('Self-study launcher missing');btn.click();
      await until(()=>[...document.querySelectorAll('div')].some(e=>visible(e)&&String(e.className).includes('aspect-[4/5]')&&e.textContent.includes('光影基础：继续上次的课')),'load saved PDF course');
      const cover=[...document.querySelectorAll('div')].find(e=>visible(e)
        &&String(e.className).includes('aspect-[4/5]')&&e.textContent.includes('光影基础：继续上次的课'));
      cover.click();
      await until(()=>document.body.textContent.includes('明暗五调子'),'enter cached classroom');
      await wait(1100);
      const cachedShown=document.body.textContent.includes('课程笔记：先确认光源');
      const reviewAction=!![...document.querySelectorAll('button')].find(b=>visible(b)&&b.getAttribute('title')==='刷题');
      if(!reviewAction)throw Error('Old course lacks practice action');

      // Back to bookshelf using the classroom's real navigation.
      const courseBack=[...document.querySelectorAll('button')].find(b=>visible(b)
        &&b.closest('div')?.parentElement?.textContent?.includes('明暗五调子')
        &&!!b.querySelector('svg'));
      // Use chapter/back header only if present; otherwise report exact state
      // instead of silently assuming that the learner returned.
      const practiceButton=[...document.querySelectorAll('button')].find(b=>visible(b)&&b.title==='刷题');
      return {cachedShown,reviewAction,courseBackFound:!!courseBack,
        modelCalls:window.__humanJourneyModelCalls,
        errors:window.__humanJourneyErrors};
    })()`);
    console.log('STUDY_HUMAN_RESUME_PDF='+JSON.stringify(reading));
    if(!reading.cachedShown||!reading.reviewAction||reading.modelCalls||reading.errors.length)
      throw Error('Returning reader cannot see saved teaching without generating AI: '+JSON.stringify(reading));
    await capture('human-resume-pdf',390,844);

    // A returning learner reopens an old graded worksheet, reads corrections,
    // and presses Back. It must return to the practice book, not a blank class.
    const oldQuiz=await evaluate(`(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      const until=async(fn,label)=>{
        for(let t=0;t<65;t++){if(fn())return;await wait(100);}
        throw Error('Cannot resume past worksheet: '+label);
      };
      const visible=e=>e&&e.getClientRects().length>0;
      const tutorButton=document.querySelector('button[aria-label="选择本课助教"]');
      const classHeader=tutorButton?.parentElement?.parentElement;
      const back=classHeader?.querySelector('button');
      if(!back)throw Error('Saved lesson has no return to bookshelf');
      back.click();
      await until(()=>!![...document.querySelectorAll('button[title="练习册"]')].find(visible),'bookshelf');
      document.querySelector('button[title="练习册"]').click();
      await until(()=>document.body.textContent.includes('练习册')
        &&[...document.querySelectorAll('div')].some(e=>String(e.className).includes('border-slate-100')
        &&e.textContent.includes('光影基础：继续上次的课')),'practice history');
      const oldCard=[...document.querySelectorAll('div')].find(e=>visible(e)
        &&String(e.className).includes('border-slate-100')
        &&e.textContent.includes('光影基础：继续上次的课'));
      if(!oldCard)throw Error('Saved graded worksheet disappeared');
      oldCard.click();
      await until(()=>document.body.textContent.includes('批改结果'),'graded review');
      const scoreShown=document.body.textContent.includes('1/2');
      const reviewShown=document.body.textContent.includes('下次多观察阴影边界。');
      const returnButton=[...document.querySelectorAll('button')].find(b=>
        visible(b)&&b.textContent.trim()==='返回课堂');
      if(!returnButton)throw Error('Review return button absent');
      returnButton.click();
      await wait(350);
      const backInPractice=document.body.textContent.includes('练习册')
        &&document.body.textContent.includes('光影基础：继续上次的课')
        &&!document.body.textContent.includes('批改结果');
      return {scoreShown,reviewShown,backInPractice,
        modelCalls:window.__humanJourneyModelCalls,
        errors:window.__humanJourneyErrors};
    })()`);
    console.log('STUDY_HUMAN_RESUME_GRADED_QUIZ='+JSON.stringify(oldQuiz));
    if(!oldQuiz.scoreShown||!oldQuiz.reviewShown||!oldQuiz.backInPractice||
      oldQuiz.errors.length||oldQuiz.modelCalls)
      throw Error('Past practice review failed real return journey: '+JSON.stringify(oldQuiz));
    await capture('human-graded-quiz',390,844);

  }


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
      count:[...document.querySelectorAll('div')].filter(node=>String(node.className||'').includes('aspect-[4/5]')).length,
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
