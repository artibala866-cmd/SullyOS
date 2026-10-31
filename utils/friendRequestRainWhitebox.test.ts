import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {BUILTIN_WHITEBOX_PRESETS} from './builtinWhitebox';
import {decorationPatches} from './chatDecoration';
import {resolveLegacyFriendRequestRainCss} from '../components/chat/BlobRefStyle';
const read=()=>BUILTIN_WHITEBOX_PRESETS.find(x=>x.id==='builtin-friend-request-rain')!.read();
const source=readFileSync(resolve(process.cwd(),'presets/chat/friend-request-rain.source.css'),'utf8');
describe('Friend Rain whitebox must be based ONLY on uploaded CSS',()=>{
 it('does not invent wallpapers, fake banners, labels, or unrelated packet artwork',()=>{
  const p=read(),css=p.parts.css!;
  expect(Object.keys(p.parts).sort()).toEqual(['bubbles','css','layout']);
  expect(p.parts.background).toBeUndefined();
  expect(css).toContain('原生逐项适配 v7');
  expect(css).toContain('尺寸与申请按钮适配 v8');
  expect(css).toContain('头像与整体尺寸回归 v11');
  expect(p.parts.layout?.chatAvatarSize).toBe('small');
  expect(css).toContain('height:calc(108px + var(--safe-top,0px))');
  expect(css).toContain('min-height:68px!important');
  expect(css).toContain('sully-chat-message-avatar-slot img{display:block!important');

  expect(css).toContain('content:"拒绝"');
  expect(css).toContain('content:"同意"');
  expect(css).toContain('background-image:none!important');
  expect(css).not.toContain('池谕原稿视觉补全 v4');
  expect(css).not.toContain('池谕视觉回归修正 v5');
  expect(css).not.toContain('池谕顶栏文字防遮挡 v6');
  expect(css).not.toContain('viewBox%3D%220%200%20360%20780%22');
  expect(css).not.toContain('.sully-chat-group-packet{');
 });
 it('references only uploaded source images and its text',()=>{
  const css=read().parts.css!;
  const urls=[...css.matchAll(/https?:\/\/[^\s'")]+/g)].map(m=>m[0]);
  expect(urls.length).toBeGreaterThan(5);
  for(const url of urls)expect(source).toContain(url);
  for(const content of ['请求添加你为好友','夢 見 一 場 不 會 結 束 的 雨','Dreamed of a rain that wouldn','我們的世界不应該只剩下彼此了嗎','終 · わ · ら · な · い · 雨']){expect(css).toContain(content);expect(source).toContain(content);}
  for(const hook of ['.sully-chat-header','.sully-chat-avatar','.sully-chat-trigger','.sully-bubble-user',
    '.sully-bubble-ai','.sully-chat-reply','.sully-chat-translate-action','.sully-chat-composer',
    '.sully-chat-voice-trigger','.sully-chat-send-button','.sully-chat-transfer-card'])
    expect(css).toContain(hook);
 });
 it('replaces icons once but never disguises actual native actions',()=>{
  const css=read().parts.css!;
  expect(css).toContain('.sully-chat-actions-button svg{display:none!important}');
  expect(css).toContain('.sully-chat-actions-button::after');
  expect(css).toContain('.sully-chat-voice-trigger::after');
  expect(css).toContain('[aria-label="生成回复"]::after');
  expect(css).toContain('.sully-chat-header button[aria-label="电话"]::after');
  expect(css).toContain('.sully-chat-trigger::after');
  expect(css).toContain('content:"拒绝"');
  expect(css).toContain('content:"同意"');
  expect(css).toContain('.sully-chat-message-content::before');
  expect(css).toContain('.sully-chat-message-timestamp::after');
  expect(css).toContain('content:"已读"');
  expect(css).toContain('[aria-label="发送文字"]::after');
  expect(css).toContain('content:">> "');
 });
 it('replaces old applied wrong CSS, leaves other themes and subsequent corrections untouched',()=>{
  const bad='/* 请求添加好友 · 雨梦 by 池谕 | SullyOS 原生整套白框适配\\n.old-drops{color:red}';
  const corrected=resolveLegacyFriendRequestRainCss(bad);
  expect(corrected).toBe(read().parts.css);
  expect(resolveLegacyFriendRequestRainCss(corrected)).toBe(corrected);
  const full=read().parts.css!;
  const v8='/* 请求添加好友 · 尺寸与申请按钮适配 v8';
  const v9='/* 请求添加好友 · 顶区操作与标签去重叠 v9';
  const v10='/* 请求添加好友 · 原生动作按钮 + 原 SVG 五心 + 用户消息状态 v10';
  const v11='/* 请求添加好友 · 头像与整体尺寸回归 v11';
  for(const marker of [v8,v9,v10,v11]){
    const older=full.slice(0,full.indexOf(marker))+'\n.my-css{color:hotpink}';
    const migrated=resolveLegacyFriendRequestRainCss(older);
    expect(migrated).toContain(v11);
    expect(migrated).toContain('.my-css{color:hotpink}');
    expect(resolveLegacyFriendRequestRainCss(migrated)).toBe(migrated);
  }
  expect(resolveLegacyFriendRequestRainCss('.unrelated-theme{color:red}')).toBe('.unrelated-theme{color:red}');
 });
 it('applies character/global parts without modifying sounds or removing native group packet',async()=>{
  const p=read();
  const local=await decorationPatches(p,['layout','bubbles','css'],'character',{id:'c',chatSound:{src:'ding'}} as any,{} as any);
  expect(local.character.chromeCustomCss).toContain('IMG-3703.png');
  expect(local.character.chatSound).toEqual({src:'ding'});
  expect(local.character.chatDecorationCssIsolated).toBe(true);
  const global=await decorationPatches(p,['layout','bubbles','css'],'global',{id:'c'} as any,{} as any);
  expect(global.theme.chatChromeCustomCss).toContain('IMG-3703.png');
 });
});