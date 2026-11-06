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
    await DB.saveCharacter({id:'qa-save-char',name:'谢嬴',avatar:'',description:'保留的角色人设',systemPrompt:'保留的人设',memories:[{id:'old',date:'2026-11-06',summary:'原身份的记忆'}],refinedMemories:{'2026-11':'原身份的月度总结'}});
    await DB.saveWorldbook({id:'qa-save-world',name:'已有世界书',entries:[]} as any);
    await DB.saveMessage({charId:'qa-save-char',role:'user',type:'text',content:'原身份的聊天'});
    await DB.saveUserProfile({name:'原身份名字',avatar:'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#e2e8f0"/><circle cx="64" cy="48" r="22" fill="#94a3b8"/><ellipse cx="64" cy="114" rx="42" ry="38" fill="#94a3b8"/></svg>'),bio:'原身份设定'});
    localStorage.setItem('palace_hwm_qa-save-char','321');
    localStorage.setItem('vr_sar_simulations_v1',JSON.stringify({runs:[{id:'old-story',title:'原剧情'}]}));
    localStorage.setItem('qa-user-saves-seeded','1');
}
function ReadyArchive() { const {isDataLoaded} = useOS(); return isDataLoaded ? new URLSearchParams(location.search).has('settings') ? <Settings/> : <UserApp/> : <p>正在读取档案…</p>; }
createRoot(document.getElementById('root')!).render(<OSProvider><ReadyArchive/></OSProvider>);
