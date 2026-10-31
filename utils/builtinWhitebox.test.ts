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

describe('iOS 6 glass theme uses SullyOS actual whitebox hooks',()=>{
 it('ships a complete bundle with transfer + group styling, no global selectors',()=>{
  const item=BUILTIN_WHITEBOX_PRESETS.find(x=>x.id==='builtin-ios6-crystal')!;
  expect(item).toBeDefined();
  const p=item.read(),c=p.parts.css!;
  expect(Object.keys(p.parts).sort()).toEqual(['background','bubbles','css','layout']);
  expect(p.parts.bubbles?.user.backgroundColor).toBe('#2f81df');
  expect(p.parts.bubbles?.ai.backgroundColor).toBe('#e8eaf0');
  for(const cls of ['.sully-chat-header','.sully-chat-inputbar','.sully-chat-send-button','.sully-bubble-user','.sully-bubble-ai','.sully-voice-bar','.sully-chat-transfer-card','.sully-chat-transfer-receipt','.sully-chat-transfer-accept','.sully-chat-transfer-return','.sully-chat-group-packet','.sully-chat-group-packet-receipt'])expect(c).toContain(cls);
  expect(c).not.toContain('.bubble-me-custom');expect(c).not.toContain('[class*="header"]');expect(c).not.toMatch(/(^|\n)\s*(body|header|nav|footer|button|textarea)\s*[,{}]/);
  const altered=item.read();altered.parts.css='other';expect(item.read().parts.css).not.toBe('other');
 });
 it('does not overwrite sound and can be applied globally for group chat',async()=>{
  const item=BUILTIN_WHITEBOX_PRESETS.find(x=>x.id==='builtin-ios6-crystal')!;
  const local=await decorationPatches(item.read(),['layout','bubbles','background','css'],'character',{id:'c',chatSound:{src:'ding'}} as any,{} as any);
  expect(local.character.chromeCustomCss).toContain('sully-chat-transfer-card');
  expect(local.character.chatSound).toEqual({src:'ding'});
  const group=await decorationPatches(item.read(),['layout','bubbles','background','css'],'global',{id:'c'} as any,{} as any);
  expect(group.theme.chatChromeCustomCss).toContain('sully-chat-group-packet');
 });
});


describe('Faint Silk 浅丝 full whitebox conversion by 落吟',()=>{
 it('is one valid SullyOS outfit without legacy selectors or invisible controls',()=>{
  const item=BUILTIN_WHITEBOX_PRESETS.find(x=>x.id==='builtin-faint-silk');
  expect(item).toBeDefined();
  const preset=item!.read(),css=preset.parts.css!;
  expect(preset.name).toContain('by落吟');
  expect(Object.keys(preset.parts).sort()).toEqual(['bubbles','css','layout']);
  expect(preset.parts.layout?.chatHeaderAlign).toBe('center');
  expect(preset.parts.bubbles?.user.textColor).toBe('#262626');
  expect(preset.parts.bubbles?.ai.tailMode).toBe('none');
  for(const selector of ['.sully-chat-header','.sully-chat-inputbar','.sully-chat-input-wrap','.sully-chat-textarea','.sully-chat-send-button','.sully-bubble-user','.sully-bubble-ai','.sully-voice-bar','.sully-chat-transfer-card','.sully-chat-transfer-receipt','.sully-chat-group-packet','.sully-chat-group-packet-receipt'])
   expect(css).toContain(selector);
  for(const legacy of ['.chat-header-custom','.header-profile-section','.input-area-custom','--bubble-me-bg','--transfer-card-bg','[class*="messages"]'])
   expect(css).not.toContain(legacy);
  expect(css).not.toMatch(/opacity\s*:\s*0\s*!important|pointer-events\s*:\s*none\s*!important/);
  expect(css).not.toMatch(/(^|\n)\s*(body|html|:root)\s*[{,]/);
  expect(css).toContain('pointer-events:none');
  const another=item!.read();another.parts.css='tampered';expect(item!.read().parts.css).not.toBe('tampered');
 });
 it('replaces a character whitebox or applies globally for group, preserving sound',async()=>{
  const preset=BUILTIN_WHITEBOX_PRESETS.find(x=>x.id==='builtin-faint-silk')!.read();
  const char=await decorationPatches(preset,['layout','bubbles','css'],'character',{id:'char',chromeCustomCss:'.sully-chat-back{color:red}',chatSound:{src:'ding'}} as any,{} as any);
  expect(char.character.chromeCustomCss).toBe(preset.parts.css);
  expect(char.character.chromeCustomCss).not.toContain('color:red');
  expect(char.character.chatDecorationCssIsolated).toBe(true);
  expect(char.character.chatSound).toEqual({src:'ding'});
  const group=await decorationPatches(preset,['layout','bubbles','css'],'global',{id:'char'} as any,{} as any);
  expect(group.theme.chatChromeCustomCss).toContain('.sully-chat-group-packet');
  expect(group.theme.chatHeaderAlign).toBe('center');
  expect(group.theme.chatDefaultBubbleStyle).toBeDefined();
 });
});
