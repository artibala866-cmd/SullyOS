import {describe,it,expect} from 'vitest';
import {BUILTIN_WHITEBOX_PRESETS} from './builtinWhitebox';
import {resolveLegacySilentLetterCss} from '../components/chat/BlobRefStyle';
import {decorationPatches} from './chatDecoration';
import {portableCssImages} from './cssImageAssets';

// Export may use base64 instead of percent-encoded SVG; compare decoded assets and CSS.
const normalizeImages=(css:string)=>css.replace(/data:image\/svg\+xml(;base64)?,([^"\n]*)/g,(_,base64,body)=>
 'svg:'+JSON.stringify(base64?Buffer.from(body,'base64').toString('utf8'):decodeURIComponent(body)));

describe('bundled star orbit outfits',()=>{
 it.each(BUILTIN_WHITEBOX_PRESETS.filter(item=>item.id.startsWith('builtin-acid-orbit')))('$name is portable and applies a complete outfit without changing sounds',async item=>{
  const preset=item.read();
  expect(preset.parts.layout?.chatAvatarSize).toBe('medium');
  expect(preset.parts.css).toContain('data:image/svg+xml');
  expect(preset.parts.css).not.toMatch(/url\(["']?https?:/);
  const patch=await decorationPatches(preset,['layout','bubbles','background','psyche','css'],'character',{id:'sample',chatSound:{src:'ding'}} as any,{} as any);
  expect(patch.character.chromeCustomCss).toContain('blobref:');expect(normalizeImages(await portableCssImages(patch.character.chromeCustomCss!))).toBe(normalizeImages(preset.parts.css!));
  expect(patch.character.chatAppearance?.chatAvatarSize).toBe('medium');
  expect(patch.character.chatSound).toEqual({src:'ding'});
 });

 it('ports Silent Letter dark as one usable SullyOS whitebox for chat and group shared components',async()=>{
  const item=BUILTIN_WHITEBOX_PRESETS.find(item=>item.id==='builtin-silent-letter-dark');
  expect(item).toBeDefined();
  const preset=item!.read();
  expect(Object.keys(preset.parts).sort()).toEqual(['bubbles','css','layout','psyche']);
  expect(preset.parts.bubbles?.user.backgroundColor).toBe('#1a1a1a');
  expect(preset.parts.bubbles?.ai.backgroundColor).toBe('#eeeeee');
  expect(preset.parts.css).toContain('.sully-chat-header');
  expect(preset.parts.css).toContain('.sully-chat-transfer-card');
  expect(preset.parts.css).toContain('.sully-chat-transfer-receipt');
  expect(preset.parts.css).toContain('.sully-psyche-card');
  expect(preset.parts.css).toContain('.sully-voice-bar');
  expect(preset.parts.css).toContain('.sully-chat-inputbar');
  expect(preset.parts.css).not.toMatch(/\.msg-transfer-card|\.bubble-me-custom|\.chat-detail-screen/);
  expect(preset.parts.css).not.toMatch(/(?:display:\s*none|visibility:\s*hidden)[^}]*\.sully-chat-send-button/);
  const char=await decorationPatches(preset,['layout','bubbles','psyche','css'],'character',{id:'test',chatSound:{src:'ding'}} as any,{} as any);
  expect(char.character.chromeCustomCss).toContain('sully-chat-transfer-card');
  expect(char.character.chatSound).toEqual({src:'ding'});
  const group=await decorationPatches(preset,['layout','bubbles','psyche','css'],'global',{id:'test'} as any,{} as any);
  expect(group.theme.chatChromeCustomCss).toContain('sully-chat-transfer-card');
  expect(group.theme.chatDefaultBubbleStyle).toBeDefined();
  const fresh=item!.read();fresh.parts.css='tampered';
  expect(item!.read().parts.css).not.toBe('tampered');
 });
 it('upgrades an already-applied legacy Silent Letter outfit without touching other character CSS',()=>{
  const legacy='/* 【糯叽机】无声回信（黑）by黛 — SullyOS 白框适配 */ .sully-chat-message-avatar:not(.sully-chat-avatar-wrap)::after{content:"+"}';
  const fixed=resolveLegacySilentLetterCss(legacy);
  expect(fixed).toContain('.sully-chat-profile');
  expect(fixed).toContain('imonly temporary 2 u');
  expect(fixed).not.toContain('.sully-chat-message-avatar:not(.sully-chat-avatar-wrap)::after');
  const other='.sully-chat-header {background: pink!important;}';
  expect(resolveLegacySilentLetterCss(other)).toBe(other);
 });
 it('keeps builtins unchanged when a returned copy is edited',()=>{
  const item=BUILTIN_WHITEBOX_PRESETS[0];const p=item.read();p.parts.css='changed';
  expect(item.read().parts.css).not.toBe('changed');
 });
});
