import {describe,it,expect} from 'vitest';
import {BUILTIN_WHITEBOX_PRESETS} from './builtinWhitebox';
import {decorationPatches} from './chatDecoration';
import {resolveLegacyFriendRequestRainCss} from '../components/chat/BlobRefStyle';
const read=()=>BUILTIN_WHITEBOX_PRESETS.find(x=>x.id==='builtin-friend-request-rain')!.read();
describe('请求添加好友 native whitebox',()=>{
 it('contains one whole outfit with actual chat and group hooks',()=>{
  const p=read(),css=p.parts.css!;
  expect(Object.keys(p.parts).sort()).toEqual(['background','bubbles','css','layout']);
  for(const s of ['.sully-chat-header','.sully-chat-back','.sully-chat-trigger','.sully-chat-composer',
  '.sully-chat-input-wrap','.sully-chat-voice-trigger','.sully-chat-voice-menu','.sully-chat-send-button',
  '.sully-bubble-user','.sully-bubble-ai','.sully-chat-reply','.sully-chat-interaction',
  '.sully-voice-bar','.sully-psyche-card','.sully-chat-transfer-card',
  '.sully-chat-transfer-receipt','.sully-chat-group-packet','.sully-chat-group-packet-receipt'])
   expect(css).toContain(s);
  expect(css).not.toMatch(/\.chat-header-custom|\.msg-transfer-card|\.chat-detail-screen|\.input-btns-right/);
  expect(css).toContain('池谕原稿视觉补全 v4');
  expect(css).toContain('池谕视觉回归修正 v5');
  expect(css).toContain('池谕顶栏文字防遮挡 v6');
  expect(p.parts.bubbles!.user.tailMode).toBe('every');
  expect(css).toContain('content:"♥ ♥ ♥ ♥ ♥"');
  expect(css).toContain('.sully-chat-transfer-card .sully-chat-transfer-watermark{display:none!important}');
  expect(css).toContain('.sully-chat-transfer-card .sully-chat-transfer-icon>svg{display:none!important}');
  expect(css).toContain('@media(max-width:390px)');
  expect(css).toContain('@media(prefers-color-scheme:dark)');
 });
 it('uses single icon replacement without masking functional lightning, send, or voice mode',()=>{
  const css=read().parts.css!;
  expect(css).toContain('.sully-chat-back>svg{opacity:0!important}');
  expect(css).toContain('.sully-chat-back::after');
  expect(css).toContain('.sully-chat-actions-button>svg{opacity:0!important}');
  expect(css).toContain('.sully-chat-actions-button::after');
  expect(css).toContain('.sully-chat-trigger>svg{visibility:visible!important;opacity:1!important');
  expect(css).toContain('.sully-chat-voice-trigger>svg{opacity:1!important');
  expect(css).toContain('.sully-chat-send-button[aria-label="发送文字"]>svg{opacity:0!important}');
  expect(css).toContain('.sully-chat-translate-action');
  expect(css).toContain('Dreamed of a rain');
  expect(css).toContain('sully-chat-inputbar:has(.sully-chat-textarea:placeholder-shown)');
  expect(css).toContain('min-height:calc(148px');
  expect(css).not.toMatch(/voice-transcription-toggle|msg-translation-btn|content:"•••"/);
 });
 it('applies to global and character without losing existing sounds',async()=>{
  const p=read();const local=await decorationPatches(p,['layout','bubbles','css'],'character',{id:'test',chatSound:{src:'ding'}} as any,{} as any);
  expect(local.character.chromeCustomCss).toContain('.sully-chat-group-packet');
  expect(local.character.chatDecorationCssIsolated).toBe(true);
  expect(local.character.chatSound).toEqual({src:'ding'});
  const global=await decorationPatches(p,['layout','bubbles','css'],'global',{id:'test'} as any,{} as any);
  expect(global.theme.chatChromeCustomCss).toContain('.sully-chat-group-packet');
  const edited=read();edited.parts.css='oops';expect(read().parts.css).not.toBe('oops');
  expect(p.parts.background?.image.startsWith('data:image/svg+xml,')).toBe(true);
 });
 it('updates old installed CSS idempotently and keeps user edits',()=>{
  const full=read().parts.css!;const mark='/* 请求添加好友 · 池谕原稿视觉补全 v4';
  const older=full.slice(0,full.indexOf(mark))+'\n.user-custom{color:red}';
  const patched=resolveLegacyFriendRequestRainCss(older);
  expect(patched).toContain('.user-custom{color:red}');
  expect(patched).toContain(mark);
  expect(resolveLegacyFriendRequestRainCss(patched)).toBe(patched);
  const v4Only=full.slice(0,full.indexOf('/* 请求添加好友 · 池谕视觉回归修正 v5'));
  const patchedV4=resolveLegacyFriendRequestRainCss(v4Only);
  expect(patchedV4).toContain('池谕视觉回归修正 v5');
  expect(resolveLegacyFriendRequestRainCss(patchedV4)).toBe(patchedV4);
  const v5Only=full.slice(0,full.indexOf('/* 请求添加好友 · 池谕顶栏文字防遮挡 v6'));
  expect(resolveLegacyFriendRequestRainCss(v5Only)).toContain('池谕顶栏文字防遮挡 v6');
  expect(resolveLegacyFriendRequestRainCss('.other-theme{color:red}')).toBe('.other-theme{color:red}');
 });
});