import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import ChatInputArea from '../components/chat/ChatInputArea';
import UserVoiceBubble from '../components/chat/UserVoiceBubble';
import {PRESET_THEMES} from '../components/chat/ChatConstants';
import {attachUserVoiceAudio, makeUserVoiceMetadata} from '../utils/userVoiceMessage';
import {putImageBlob} from '../utils/blobRef';
import {encodeWavFromFloat32} from '../utils/speechToText';

const root=document.getElementById('voice-visual');
if(!root)throw Error('Missing visual test root');
const voices={
 idle:{status:'idle',mode:'transcribe',transcript:'',hasAudioDraft:false,seconds:0,error:''},
 review:{status:'review',mode:'transcribe',transcript:'你好，今天画稿进度怎么样？',hasAudioDraft:true,seconds:6,error:''},
};
const scene=(label:string,id:string)=>{
 const section=document.createElement('section');
 section.className='scene';
 section.dataset.scene=id;
 section.innerHTML='<h2>'+label+'</h2><div class="composer-area"><div class="sully-chat-inputbar"></div></div>';
 root.appendChild(section);
 return section.querySelector('.sully-chat-inputbar') as HTMLElement;
};
const props=(mode:'idle'|'review',typed=false)=>({
 input: typed?'用输入法识别出的文字':'',setInput:()=>{},isTyping:false,selectionMode:false,
 showPanel:'none' as const,setShowPanel:()=>{},onSend:()=>{},onDeleteSelected:()=>{},
 selectedCount:0,emojis:[],onPanelAction:()=>{},onImageSelect:()=>{},
 isSummarizing:false,onReroll:()=>{},canReroll:false,typedVoiceEnabled:typed,
 onSelectTypedVoice:()=>{},onExitTypedVoice:()=>{},onSendTypedVoice:()=>{},
 speechInput:{...voices[mode],start:async()=>{},startTranscription:async()=>{},stop:()=>{},cancel:()=>{},editTranscript:()=>{},confirm:()=>{}},
});
void (async()=>{try{
 const normal=scene('正常输入栏：麦克风在输入框内','normal');
 const typed=scene('输入法文字语音：保留输入框宽度','typed');
 const review=scene('识别与原声同时确认','review');
 const menu=scene('紧凑语音选择菜单','menu');
 const n=createRoot(normal),t=createRoot(typed),r=createRoot(review),m=createRoot(menu);
 flushSync(()=>n.render(React.createElement(ChatInputArea,props('idle') as any)));
 flushSync(()=>t.render(React.createElement(ChatInputArea,props('idle',true) as any)));
 flushSync(()=>r.render(React.createElement(ChatInputArea,props('review') as any)));
 flushSync(()=>m.render(React.createElement(ChatInputArea,props('idle') as any)));
 const bubble=document.createElement('section');bubble.className='scene';bubble.dataset.scene='bubble';
 bubble.innerHTML='<h2>发送后的原版浅色语音条</h2><div class="voice-example"></div>';root.appendChild(bubble);
 const voiceRoot=createRoot(bubble.querySelector('.voice-example')!);
 flushSync(()=>voiceRoot.render(React.createElement(UserVoiceBubble,{message:{
  id:12,charId:'preview',role:'user',type:'voice',timestamp:Date.now(),
  content:'你好，今天画稿进度怎么样？',
  metadata:makeUserVoiceMetadata('你好，今天画稿进度怎么样？','recorded')
 },styleConfig:PRESET_THEMES.forest.ai,initiallyExpanded:true})));
 // Persist one genuine WAV in the same IndexedDB Blob store used by Chat.
 const actual=document.createElement('section');actual.className='scene';actual.dataset.scene='real-audio';
 actual.innerHTML='<h2>真实录音：可播放的原声音频和转写</h2><div class="voice-example"></div>';root.appendChild(actual);
 const ref=await putImageBlob(encodeWavFromFloat32(new Float32Array(16000), 16000));
 const audioRoot=createRoot(actual.querySelector('.voice-example')!);
 flushSync(()=>audioRoot.render(React.createElement(UserVoiceBubble, {message: {
  id:13,charId:'preview',role:'user',type:'voice',timestamp:Date.now(),content:'这是实际保存的录音',
  metadata:attachUserVoiceAudio(makeUserVoiceMetadata('这是实际保存的录音','recorded'),ref,1)
 },styleConfig:PRESET_THEMES.forest.ai,initiallyExpanded:true})));
 await new Promise(resolve=>setTimeout(resolve,500));
 const field=normal.querySelector<HTMLElement>('.sully-chat-input-wrap');
 const mic=normal.querySelector<HTMLElement>('.sully-chat-voice-trigger');
 const send=normal.querySelector<HTMLElement>('.sully-chat-send-button');
 const input=normal.querySelector<HTMLElement>('textarea');
 const menuTrigger=menu.querySelector<HTMLButtonElement>('.sully-chat-voice-trigger');
 flushSync(()=>menuTrigger?.click());
 const chooser=menu.querySelector<HTMLElement>('[aria-label="语音输入方式"]');
 const fb=field?.getBoundingClientRect(),mb=mic?.getBoundingClientRect(),sb=send?.getBoundingClientRect();
 const checks={
  fieldWide:!!fb&&fb.width>=150,
  micInsideField:!!fb&&!!mb&&mb.left>=fb.left&&mb.right<=fb.right+1,
  senderVisible:!!sb&&sb.width>=25,
  inlineDraft:!!input&&input.clientWidth>=85,
  popoverStacked:!!chooser&&chooser.querySelectorAll('button').length>=2,
  realStt:!!chooser?.querySelector('[aria-label="自动语音转文字"]'),
  keyboardDictation:!!chooser?.querySelector('[aria-label="输入法语音"]'),
  voiceBarMatchesOriginal:!!bubble.querySelector('.sully-voice-bar-shell .sully-voice-bar'),
  transcriptVisible:!!bubble.querySelector('.sully-voice-bar-transcript'),
  noFakePlayback:!bubble.querySelector('[aria-label="播放录音"]'),
  actualSavedAudioPlayButton:!!actual.querySelector('[aria-label="播放录音"]'),
  actualAudioTranscriptVisible:!!actual.querySelector('.sully-voice-bar-transcript')
 };
 const out=document.createElement('output');out.id='voice-visual-checks';out.textContent=JSON.stringify(checks);root.prepend(out);
 root.dataset.voiceVisualReady=Object.values(checks).every(Boolean)?'true':'false';
}catch(error){root.dataset.voiceVisualReady='false';root.dataset.voiceVisualError=String(error);root.textContent=String(error);}})();
