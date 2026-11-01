import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import ChatInputArea from '../components/chat/ChatInputArea';
import ChatBlockModal from '../components/chat/ChatBlockModal';
import {changeChatBlock,configureCharacterBlocking} from '../utils/chatBlock';
import type {ChatBlockState} from '../types';
const host=document.getElementById('block-test')!;
const result:Record<string,boolean>={};
const App=()=>{
 const [panel,setPanel]=useState<'none'|'actions'|'emojis'|'chars'>('actions');
 const [open,setOpen]=useState(false);
 const [state,setState]=useState<ChatBlockState>();
 return <>
  <ChatInputArea input="" setInput={()=>{}} isTyping={false} selectionMode={false}
    previewActionsPage={2} showPanel={panel} setShowPanel={setPanel}
    onSend={()=>{}} onDeleteSelected={()=>{}} selectedCount={0}
    emojis={[]} onImageSelect={()=>{}} isSummarizing={false} onReroll={()=>{}} canReroll={false}
    onPanelAction={type=>{if(type==='chat-block'){result.routed=true;setOpen(true);setPanel('none');}}}/>
  {open&&<ChatBlockModal characterName="陈苍琛" state={state} onClose={()=>setOpen(false)}
    onSetUserBlock={block=>setState(prev=>changeChatBlock(prev,'user',block,{at:1000,source:'manual'}))}
    onSetCharacterAllowed={allowed=>setState(prev=>configureCharacterBlocking(prev,allowed,2000))}/>}
 </>;
};
try {
 const app=createRoot(host);flushSync(()=>app.render(<App/>));
 const tile=Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.getAttribute('type')==='button'&&b.textContent?.trim()==='拉黑');
 result.tile=!!tile;
 flushSync(()=>tile?.click());
 result.dialog=!!document.querySelector('[role="dialog"][aria-label="私聊拉黑"]');
 const trigger=document.querySelector<HTMLButtonElement>('button[aria-label="拉黑角色"]');
 flushSync(()=>trigger?.click());
 const confirm=[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()==='确认拉黑');
 result.confirm=!!confirm;
 flushSync(()=>confirm?.click());
 const text=document.querySelector('[role="dialog"]')?.textContent??'';
 result.blocked=text.includes('已拉黑');
 const check=document.querySelector<HTMLInputElement>('input[aria-label="允许角色自主拉黑我"]');
 flushSync(()=>check?.click());
 result.permitOff=check?.checked===false;
 result.width=!!document.querySelector('[role="dialog"]')&&document.querySelector('[role="dialog"]')!.getBoundingClientRect().width<=innerWidth;
 const output=document.createElement('output');output.className='checks';output.textContent=JSON.stringify(result);document.body.append(output);
 host.dataset.ready=Object.values(result).every(Boolean)?'true':'false';
} catch(e) {host.dataset.ready='false';host.dataset.error=String(e);}
