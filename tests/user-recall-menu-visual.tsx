/**
 * Real ChatModals menu, not a hand-drawn mock. The click assertion runs
 * against a mounted React button and the assistant-role comparison is SSR.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import ChatModals from '../components/chat/ChatModals';
import type { Message } from '../types';

const host = document.getElementById('manual-recall-menu-root');
if (!host) throw new Error('Missing message menu mount');
const chatId='visual-manual-recall';
const m:Message={id:101,charId:chatId,role:'user',type:'text',timestamp:Date.now(),
    content:'我刚刚发的这句话打错了，想撤回'};
let clicks=0;
const props={
    compactHome:false,
    modalType:'message-options',
    setModalType:()=>{},
    selectedMessage:m,
    activeCharacter:{id:chatId,name:'林屿'},
    messages:[m],
    onRecallMessage:()=>{clicks++;},
    onEnterSelectionMode:()=>{},
    onReplyMessage:()=>{},
    onEditMessageStart:()=>{},
    onCopyMessage:()=>{},
    onDeleteMessage:()=>{},
    onToggleMessageFavorite:()=>{},
    messageFavorited:false,
    contextSuiteAnyEnabled:false,
    contextSuiteAllEnabled:false,
    settingsInputPreferences:{},
    settingsContextLimit:500,
    settingsContextRangeMode:'manual',
    settingsHideSysLogs:false,
    allCharacters:[],
    apiPresets:[],
} as unknown as React.ComponentProps<typeof ChatModals>;

const root=createRoot(host);
try {
    const assistantMenu = renderToStaticMarkup(React.createElement(ChatModals,{
        ...props,selectedMessage:{...m,role:'assistant'}
    }));
    root.render(React.createElement(ChatModals,props));
    window.setTimeout(()=>{
        const all=[...host.querySelectorAll('button')];
        const action=all.find(b=>b.textContent?.trim()==='撤回消息');
        const heading=[...host.querySelectorAll('h3')].find(h=>h.textContent?.trim()==='消息操作');
        const hasDelete=all.some(b=>b.textContent?.trim()==='删除消息');
        const noRecallForAssistant=!assistantMenu.includes('撤回消息');
        const hasRecallForUser=!!action && action.getBoundingClientRect().height>=32;
        // Simulate real user tapping the actual mounted React menu control.
        action?.click();
        const correctlyWired=clicks===1;
        const width=action?.getBoundingClientRect().width||0;
        const noOverflow=!!action && width<=window.innerWidth-25;
        const checks={heading:!!heading,hasRecallForUser,hasDelete,noRecallForAssistant,correctlyWired,noOverflow};
        const output=document.createElement('output');
        output.hidden=true;output.id='manual-recall-checks';output.textContent=JSON.stringify(checks);
        document.body.append(output);
        document.body.dataset.manualRecallReady=Object.values(checks).every(Boolean)?'true':'false';
    },200);
}catch(e){
    document.body.dataset.manualRecallReady='false';
    document.body.dataset.manualRecallError=String(e instanceof Error?e.stack||e.message:e);
}
