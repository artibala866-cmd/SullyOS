/** Real archive + OS provider and real storage; synthetic data only. */
import '../../utils/userSaveBootstrap';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { OSProvider, useOS } from '../../context/OSContext';
import Settings from '../../apps/Settings';
import UserApp from '../../apps/UserApp';
import { DB } from '../../utils/db';
import { USER_SAVE_ID } from '../../utils/userSaveScope';
if (USER_SAVE_ID === 'original' && !localStorage.getItem('qa-user-saves-seeded')) {
    await DB.saveCharacter({id:'qa-save-char',name:'谢嬴',avatar:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#64748b"/><text x="32" y="43" text-anchor="middle" font-size="36" fill="white">C</text></svg>'),description:'保留的角色人设',systemPrompt:'保留的人设',memories:[{id:'old',date:'2026-11-06',summary:'原身份的记忆'}],refinedMemories:{'2026-11':'原身份的月度总结'}});
    await DB.saveWorldbook({id:'qa-save-world',name:'已有世界书',entries:[]} as any);
    await DB.saveMessage({charId:'qa-save-char',role:'user',type:'text',content:'原身份的聊天'});
    await DB.saveUserProfile({name:'原身份名字',avatar:'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#4682b4"/><text x="64" y="89" text-anchor="middle" font-size="76" fill="white">A</text></svg>'),bio:'原身份设定',perCharAvatars:{'qa-save-char':'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#ef4444"/></svg>')},imageAppearance:'原身份独有外貌',imageReference:'blobref:qa-private-face',imageLockEnabled:true,wardrobeOutfits:[],chibiStudio:{home3D:{state:{selected:{eyes:'eyes_02',skin:'skin_01'}},img:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#4682b4"/></svg>'),hair:{layers:{},extras:[]}}},vrState:{enabled:true,activity:'原身份活动'}});
    const now=Date.now(), date=new Date().toLocaleDateString('en-CA');
    await DB.saveLifeRecordSettings({id:'main',cycleLength:32,periodLength:6,exerciseWeeklyGoal:6,exercisePlanNote:'A档每周慢跑'});
    await DB.saveMedPlan({id:'qa-med-a',name:'A档测试药盒',time:'08:30',enabled:true,createdAt:now,planKind:'longterm',intervalDays:1});
    for(const record of [{id:'qa-period-a',module:'period',kind:'start',payload:{}},{id:'qa-med-taken-a',module:'med',kind:'taken',payload:{name:'A档测试药盒',planId:'qa-med-a'}},{id:'qa-exercise-a',module:'exercise',kind:'session',payload:{activity:'A档慢跑',duration:'30分钟'}}] as const) await DB.saveLifeRecord({...record,date,timestamp:now,recordedBy:'user',reviewStatus:'confirmed'});
    await DB.saveBankState({config:{dailyBudget:150,currencySymbol:'¥'},shop:{},goals:[{id:'qa-goal-a',name:'A档储蓄目标',targetAmount:1000,currentAmount:400,icon:'',isCompleted:false}],todaySpent:123.4,lastLoginDate:date} as any);
    await DB.saveTransaction({id:'qa-expense-a',amount:123.4,category:'food',note:'A档独立账单',timestamp:now,dateStr:date});
    localStorage.setItem('palace_hwm_qa-save-char','321');
    localStorage.setItem('vr_sar_simulations_v1',JSON.stringify({runs:[{id:'old-story',title:'原剧情'}]}));
    localStorage.setItem('qa-user-saves-seeded','1');
}
function ReadyArchive() { const {isDataLoaded} = useOS(); return isDataLoaded ? new URLSearchParams(location.search).has('settings') ? <Settings/> : <UserApp/> : <p>正在读取档案…</p>; }
createRoot(document.getElementById('root')!).render(<React.StrictMode><OSProvider><ReadyArchive/></OSProvider></React.StrictMode>);
