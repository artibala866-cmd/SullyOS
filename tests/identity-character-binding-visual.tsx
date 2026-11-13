import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import UserApp from '../apps/UserApp';
import { OSPreviewProvider } from '../context/OSContext';
import type { UserProfile } from '../types';
import { filterCharactersForIdentity } from '../utils/identityCharacterBinding';

const names = ['周树生', '陈谦文', '谢嬴', '赵尧', '余天鹗', '苗理生', '程嘉延', '幸芳白'];
const colors = ['#393939','#b3b3b3','#565656','#939393','#5c5c5c','#c2c2c2','#777777','#888888'];
const makeAvatar = (name: string, bg: string) => 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="50" fill="'+bg+'"/><circle cx="50" cy="40" r="18" fill="white" opacity=".85"/><path d="M10 100 Q16 67 50 67 Q84 67 90 100" fill="white" opacity=".85"/></svg>');
const characters = names.map((name,i)=>({id:'role-'+i,name,avatar:makeAvatar(name,colors[i]),description:'虚构测试角色'}));
const qs = new URLSearchParams(location.search);
const initialBound = qs.has('bound') ? ['role-0','role-2'] : [];
function ArchiveFixture(){
    const [userProfile,setProfile] = useState<UserProfile>({
        name:'幸福', avatar:makeAvatar('幸福','#d0d8df'),bio:'',
        boundCharacterIds:initialBound,perCharAvatars:{},
    });
    const updateUserProfile = async (updates: Partial<UserProfile> | ((prev: UserProfile)=>Partial<UserProfile>)) => {
        setProfile(prev=>({...prev,...(typeof updates==='function'?updates(prev):updates)}));
    };
    const context = useMemo(()=>({
        closeApp:()=>{},characters, userProfile,updateUserProfile,
        addToast:()=>{}, activeCharacterId:'role-0',
    }),[userProfile]);
    useEffect(()=>{
        const node = document.querySelector<HTMLOutputElement>('output[data-identity-visual-ready]') || document.createElement('output');
        node.dataset.identityVisualReady='true';
        node.dataset.boundIds=(userProfile.boundCharacterIds||[]).join(',');
        node.dataset.visibleIds=filterCharactersForIdentity(characters,userProfile.boundCharacterIds).map(c=>c.id).join(',');
        document.body.appendChild(node);
        const scroller = document.querySelector<HTMLElement>('[data-testid="archive-scroll"]');
        if(scroller && scroller.scrollTop<170) scroller.scrollTop=330;
    },[userProfile]);
    return <OSPreviewProvider value={context as any}><UserApp/></OSPreviewProvider>;
}
createRoot(document.getElementById('root')!).render(<ArchiveFixture/>);
