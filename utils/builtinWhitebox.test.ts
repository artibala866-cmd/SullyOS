import {describe,it,expect} from 'vitest';
import {BUILTIN_WHITEBOX_PRESETS} from './builtinWhitebox';
import {resolveLegacySilentLetterCss,isWeixinBaiyuCss,resolveLegacyWeixinBaiyuCss} from '../components/chat/BlobRefStyle';
import {decorationPatches} from './chatDecoration';
import {portableCssImages} from './cssImageAssets';
import {isFaintSilkPairCss} from './faintSilkPair';

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
  expect(preset.parts.css).toContain('/* 12. 无声回信原生交互与原作细节补齐 v3');
  expect(preset.parts.css).toContain('.sully-psyche-author-avatar');
  expect(preset.parts.css).toContain('.sully-chat-card[data-card-kind="sim_card"]');
  expect(preset.parts.css).toContain('.sully-facebook-translation');
  expect(preset.parts.css).toContain('.sully-chat-voice-menu');
  expect(preset.parts.css).toContain('/* 13. 无声回信独立引用条适配 v4');
  expect(preset.parts.css).toContain('bottom:calc(100% + 7px)');
  expect(preset.parts.css).toContain('/* 14. 无声回信输入区原作图标与实际热区对齐 v5');
  expect(preset.parts.css).toContain('DHYhIUp.png');
  expect(preset.parts.css).toContain('DcdDRsw.png');
  expect(preset.parts.css).toContain('n9OXMPV.png');
  expect(preset.parts.css).toContain('H9Q5nB122');
  expect(preset.parts.css).toContain('.sully-chat-composer > .sully-chat-send-button');
  expect(preset.parts.css).toContain('.sully-chat-trigger:not([title="停止生成"]) > svg');
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
 it('upgrades the exact persisted v2 icon overlay while preserving cached image refs and user extras',()=>{
  const current=BUILTIN_WHITEBOX_PRESETS.find(p=>p.id==='builtin-silent-letter-dark')!.read().parts.css!;
  const iconPatch='/* 11. 贴图是真正的替换图标';
  const v2=current.slice(0,current.indexOf(iconPatch))+'\n/* user extra */ .custom-user-class{color:purple;}';
  const withCachedImage=v2.replace('https://i.imgant.com/v2/L06lLMZ.png','blobref:old-user-icon');
  const migrated=resolveLegacySilentLetterCss(withCachedImage);
  expect(migrated).toContain('blobref:old-user-icon');
  expect(migrated).toContain('.custom-user-class{color:purple;}');
  expect(migrated).toContain('.sully-chat-actions-button > svg');
  expect(migrated).toContain('.sully-chat-trigger:not([title="停止生成"]) > svg');
  expect(migrated).toContain('.sully-chat-send-button:is(');
  expect(migrated).toContain('/* 12. 无声回信原生交互与原作细节补齐 v3');
  expect(migrated).toContain('sully-psyche-author-avatar');
  expect(migrated).toContain('/* 13. 无声回信独立引用条适配 v4');
  expect(migrated).toContain('/* 14. 无声回信输入区原作图标与实际热区对齐 v5');
  expect(migrated).not.toContain('content:"+"} .sully-chat-avatar-wrap');
  expect(resolveLegacySilentLetterCss(migrated)).toBe(migrated);
  expect(resolveLegacySilentLetterCss(current)).toBe(current);
  const unrelated='/* source stylesheet */ .sully-chat-actions-button > svg{display:block}';
  expect(resolveLegacySilentLetterCss(unrelated)).toBe(unrelated);
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
  expect(isFaintSilkPairCss(css)).toBe(true);
  expect(css).not.toContain('DycRKBL9/image.jpg'); // former hard-coded right avatar
  expect(css).not.toMatch(/\.sully-chat-name::after\s*\{[^}]*background:\s*url/i);
  const previousSavedCss='/* Faint Silk 浅丝 by 落吟 | SullyOS 糯米机白框转换 */ .sully-chat-root{--faint-glass:rgba(239,239,239,.18)} .sully-chat-name::after{background:url("https://i.postimg.cc/DycRKBL9/image.jpg")}';
  expect(isFaintSilkPairCss(previousSavedCss)).toBe(true);
  expect(isFaintSilkPairCss(BUILTIN_WHITEBOX_PRESETS.find(x=>x.id==='builtin-ios6-crystal')!.read().parts.css)).toBe(false);
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

describe('微信 by 白榆 full whitebox native conversion',()=>{
 it('bundles a complete native theme while preserving controls',()=>{
  const item=BUILTIN_WHITEBOX_PRESETS.find(x=>x.id==='builtin-weixin-baiyu');
  expect(item).toBeDefined();
  const preset=item!.read(),css=preset.parts.css!;
  expect(Object.keys(preset.parts).sort()).toEqual(['background','bubbles','css','layout']);
  expect(preset.parts.layout?.chatHeaderAlign).toBe('center');
  expect(preset.parts.bubbles?.user.backgroundColor).toBe('#95EC69');
  expect(preset.parts.bubbles?.ai.backgroundColor).toBe('#ffffff');
  for(const sel of ['.sully-chat-root','.sully-chat-header','.sully-chat-inputbar','.sully-chat-composer','.sully-chat-input-wrap','.sully-chat-textarea','.sully-chat-actions-button','.sully-chat-send-button','.sully-bubble-user','.sully-bubble-ai','.sully-chat-reply','.sully-voice-bar','.sully-chat-transfer-card','.sully-chat-transfer-receipt','.sully-chat-transfer-accept','.sully-chat-transfer-return','.sully-chat-group-packet','.sully-chat-group-packet-receipt'])
   expect(css).toContain(sel);
  for(const old of ['.bubble-me-custom','.input-action-bar-custom','.msg-transfer-card'])
   expect(css).not.toContain(old);
  expect(css).toContain('.sully-chat-trigger[title="停止生成"]');
  expect(css).not.toContain('.sully-chat-composer::before');
  const changed=item!.read();changed.parts.css='changed';expect(item!.read().parts.css).not.toBe('changed');
 });
 it('replaces old character CSS without overlay and can set default group theme without changing sound',async()=>{
  const p=BUILTIN_WHITEBOX_PRESETS.find(x=>x.id==='builtin-weixin-baiyu')!.read();
  const local=await decorationPatches(p,['layout','bubbles','background','css'],'character',{id:'c',chromeCustomCss:'.old-theme{color:red}',chatSound:{src:'ding'}} as any,{} as any);
  expect(normalizeImages(await portableCssImages(local.character.chromeCustomCss!))).toBe(normalizeImages(p.parts.css!));
  expect(local.character.chromeCustomCss).not.toContain('.old-theme');
  expect(local.character.chatDecorationCssIsolated).toBe(true);
  expect(local.character.chatSound).toEqual({src:'ding'});
  const all=await decorationPatches(p,['layout','bubbles','background','css'],'global',{id:'c'} as any,{} as any);
  expect(all.theme.chatChromeCustomCss).toContain('.sully-chat-group-packet');
  expect(all.theme.chatDefaultBubbleStyle).toBeDefined();
  expect(all.theme.chatHeaderAlign).toBe('center');
 });
});

describe('Weixin top-bar phone / native reply lightning after earlier CSS was applied',()=>{
 it('does not turn the lightning icon into three dots and positions both actions independently',()=>{
  const p=BUILTIN_WHITEBOX_PRESETS.find(x=>x.id==='builtin-weixin-baiyu')!.read();
  const css=p.parts.css!;
  expect(css).toContain('/* 白榆顶栏原生闪电修复 v2');
  expect(css).not.toContain('.sully-chat-trigger:not([title="停止生成"])');
  expect(css).toContain('.sully-chat-header .sully-chat-trigger svg{');
  expect(css).toContain('visibility:visible!important');
  expect(css).toContain('.sully-chat-header button[aria-label="电话"]');
  expect(css).toContain('right:40px!important');
  expect(css).toContain('position:absolute!important');
 });
 it('repairs an already-applied version without replacing personal CSS and only once',()=>{
  const good=BUILTIN_WHITEBOX_PRESETS.find(x=>x.id==='builtin-weixin-baiyu')!.read().parts.css!;
  const marker='/* 白榆顶栏原生闪电修复 v2';
  const original=good.slice(0,good.indexOf(marker))+'\n.sully-chat-root .sully-chat-trigger::after{content:"•••"}\n.custom-private{color:purple}';
  expect(isWeixinBaiyuCss(original)).toBe(true);
  const upgraded=resolveLegacyWeixinBaiyuCss(original);
  expect(upgraded).toContain('.custom-private{color:purple}');
  expect(upgraded).toContain('.sully-chat-trigger::after');
  expect(upgraded).toContain('content:none!important;display:none!important');
  expect(resolveLegacyWeixinBaiyuCss(upgraded)).toBe(upgraded);
  expect(resolveLegacyWeixinBaiyuCss(good)).toBe(good);
  expect(resolveLegacyWeixinBaiyuCss('.sully-chat-trigger{color:red}')).toBe('.sully-chat-trigger{color:red}');
 });
});

describe('Weixin original source CSS fidelity / persisted wardrobe compatibility v3',()=>{
 it('keeps all native counterparts to source theme and does not strip real content or actions',()=>{
  const p=BUILTIN_WHITEBOX_PRESETS.find(x=>x.id==='builtin-weixin-baiyu')!.read();
  const css=p.parts.css!;
  for(const selector of ['.chat-image-thumbnail img','.sully-emoji-msg','.sully-chat-reply-preview','.sully-chat-interaction','.sully-chat-card[data-card-kind="chat_forward"]','.sully-chat-card[data-card-kind="sim_card"]','.sully-chat-group-packet[data-status="done"]','.sully-chat-group-packet-receipt'])
   expect(css).toContain(selector);
  expect(css).toContain('/* 微信 by 白榆 · 糯米机真实组件深度适配 v3');
  expect(css).not.toContain('.msg-sim-card *');
  expect(css).not.toContain('.msg-reply-block{display:none');
  expect(css).toContain('var(--safe-top,0px)');
  expect(css).toContain('calc(100vw - 108px)');
 });
 it('upgrades pre-v2 and v2-applied character/group whiteboxes without invalid escaped newline or duplicate patches',()=>{
  const full=BUILTIN_WHITEBOX_PRESETS.find(x=>x.id==='builtin-weixin-baiyu')!.read().parts.css!;
  const v2Mark='/* 白榆顶栏原生闪电修复 v2';
  const v3Mark='/* 微信 by 白榆 · 糯米机真实组件深度适配 v3';
  const storedV1=full.slice(0,full.indexOf(v2Mark))+'\n.user-override{letter-spacing:1px}';
  const storedV2=full.slice(0,full.indexOf(v3Mark))+'\n.user-override{letter-spacing:1px}';
  for(const stored of [storedV1,storedV2]){
   const migrated=resolveLegacyWeixinBaiyuCss(stored);
   expect(migrated).toContain('\n/* '+(stored===storedV1?'白榆顶栏原生闪电修复 v2':'微信 by 白榆 · 糯米机真实组件深度适配 v3'));
   expect(migrated).toContain('.user-override{letter-spacing:1px}');
   expect(migrated).toContain(v3Mark);
   expect(migrated).not.toContain('\\\\n/*');
   expect(resolveLegacyWeixinBaiyuCss(migrated)).toBe(migrated);
  }
  expect(resolveLegacyWeixinBaiyuCss(full)).toBe(full);
 });
});
