import React, {useEffect, useState} from 'react';
import {resolveCssImageUrls} from '../../utils/cssImageAssets';
import silentLetter from '../../presets/chat/silent-letter-dark.json';
import weixinBaiyu from '../../presets/chat/weixin-baiyu.json';
import friendRequestRain from '../../presets/chat/friend-request-rain.json';

/** Previously applied whitebox CSS is persisted per character or globally. Changing
 * a bundled preset does not update that copy. Upgrade only CSS bearing the known
 * SullyOS adaptation signatures; other imported/user themes stay untouched.
 * v2 keeps its cached blobref images and custom CSS; only the missing original
 * icon-replacement rules are appended (not another copy of the full outfit).
 */
const SILENT_LETTER_V1 = '/* 【糯叽机】无声回信（黑）by黛 — SullyOS 白框适配';
const SILENT_LETTER_V2 = '/* 【糯叽机】无声回信（黑）by黛 · 原版完整界面 SullyOS 适配 v2';
const ICON_REPLACEMENT_START = '/* 11. 贴图是真正的替换图标';
const ICON_REPLACEMENT_END = '/* 辅助功能：动态文字';
const SILENT_LETTER_V3 = '/* 12. 无声回信原生交互与原作细节补齐 v3';
const SILENT_LETTER_V4 = '/* 13. 无声回信独立引用条适配 v4';
const SILENT_LETTER_V5 = '/* 14. 无声回信输入区原作图标与实际热区对齐 v5';
const SILENT_LETTER_V6 = '/* 15. 无声回信群聊原版设置图标 v6';
export function resolveLegacySilentLetterCss(css: string): string {
    if (css.includes(SILENT_LETTER_V1) && css.includes('.sully-chat-message-avatar:not(.sully-chat-avatar-wrap)')) {
        return silentLetter.parts.css;
    }
    if (!css.includes(SILENT_LETTER_V2) || !css.includes('.sully-chat-actions-button')) return css;
    let upgraded = css;
    if (!upgraded.includes(ICON_REPLACEMENT_START)) {
        const from = silentLetter.parts.css.indexOf(ICON_REPLACEMENT_START);
        const to = silentLetter.parts.css.indexOf(ICON_REPLACEMENT_END, from);
        if (from >= 0 && to >= from) upgraded += '\n' + silentLetter.parts.css.slice(from, to);
    }
    if (!upgraded.includes(SILENT_LETTER_V3)) {
        const from = silentLetter.parts.css.indexOf(SILENT_LETTER_V3);
        if (from >= 0) upgraded += '\n' + silentLetter.parts.css.slice(from);
    }
    if (!upgraded.includes(SILENT_LETTER_V4)) {
        const from = silentLetter.parts.css.indexOf(SILENT_LETTER_V4);
        if (from >= 0) upgraded += '\n' + silentLetter.parts.css.slice(from);
    }
    if (!upgraded.includes(SILENT_LETTER_V5)) {
        const from = silentLetter.parts.css.indexOf(SILENT_LETTER_V5);
        if (from >= 0) upgraded += '\n' + silentLetter.parts.css.slice(from);
    }
    if (!upgraded.includes(SILENT_LETTER_V6)) {
        const from = silentLetter.parts.css.indexOf(SILENT_LETTER_V6);
        if (from >= 0) upgraded += '\n' + silentLetter.parts.css.slice(from);
    }
    return upgraded;
}


/** Already-applied whitebox CSS lives on the character/theme, not in the preset.
 * Bring the original reply lightning back without discarding custom additions or cached images.
 * The repaired built-in does not need migration; only the recognizable older copies do.
 */
const WEIXIN_BAIYU_SIGNATURE = '/* 微信 by 白榆 · SullyOS 原生白框整套转换';
const WEIXIN_HEADER_FIX = '/* 白榆顶栏原生闪电修复 v2';
const WEIXIN_NATIVE_FIX = '/* 微信 by 白榆 · 糯米机真实组件深度适配 v3';
const WEIXIN_DARK_FIX = '/* 微信 by 白榆 · 深色对比度补丁 v4';
const WEIXIN_NATIVE_ICONS_V5 = '/* 微信 by 白榆 · 真实原稿图标单层替换 v5';
export function isWeixinBaiyuCss(css?: string): boolean {
    return !!css?.includes(WEIXIN_BAIYU_SIGNATURE);
}
/** Persisted character and group CSS is a snapshot of the original whitebox.
 * Add only missing version patches, preserving user changes, blobrefs and other themes.
 */
export function resolveLegacyWeixinBaiyuCss(css: string): string {
    if (!isWeixinBaiyuCss(css) || css.includes(WEIXIN_NATIVE_ICONS_V5)) return css;
    const latest = weixinBaiyu.parts.css;
    const missing = [WEIXIN_HEADER_FIX, WEIXIN_NATIVE_FIX, WEIXIN_DARK_FIX, WEIXIN_NATIVE_ICONS_V5].find(marker => !css.includes(marker));
    if (!missing) return css;
    const index = latest.indexOf(missing);
    if (index < 0) return css;
    return css + '\n' + latest.slice(index);
}


/** Replace only the identifiable erroneous initial Friend Rain preset with its faithful file-based adaptation. */
const FRIEND_RAIN_BAD='/* 请求添加好友 · 雨梦 by 池谕 | SullyOS 原生整套白框适配';
const FRIEND_RAIN_FIXED='/* 请求添加好友__引用@池谕.css | SullyOS 原生逐项适配 v7';
const FRIEND_RAIN_PATCHES=[
 '/* 请求添加好友 · 尺寸与申请按钮适配 v8',
 '/* 请求添加好友 · 顶区操作与标签去重叠 v9',
 '/* 请求添加好友 · 原生动作按钮 + 原 SVG 五心 + 用户消息状态 v10',
 '/* 请求添加好友 · 仅缩小气泡 v13',
] as const;
const FRIEND_RAIN_V11 = '/* 请求添加好友 · 头像与整体尺寸回归 v11';
const FRIEND_RAIN_V12 = '/* 请求添加好友 · 原文件头部 82px 回归 v12';
/** Revert only our unrequested top/bottom changes in already-applied copies.
 * Retain independent custom CSS appended after the old patches. */
function stripUnrequestedFriendRainSizing(css:string):string {
 let result=css;
 const from=result.indexOf(FRIEND_RAIN_V11);
 const v12=result.indexOf(FRIEND_RAIN_V12);
 if(from>=0){
  let stop=-1;
  if(v12>=0){
   const end=result.indexOf('\n}',v12);
   if(end>=0)stop=end+2;
  }else{
   const dark=result.indexOf('@media(prefers-color-scheme:dark){',from);
   const end=dark>=0?result.indexOf('\n }\n}',dark):-1;
   if(end>=0)stop=end+5;
  }
  if(stop>from)result=result.slice(0,from)+result.slice(stop);
 }else if(v12>=0){
  const end=result.indexOf('\n}',v12);
  if(end>=0)result=result.slice(0,v12)+result.slice(end+2);
 }
 return result;
}
export function resolveLegacyFriendRequestRainCss(css:string):string {
 if(css.includes(FRIEND_RAIN_BAD))return friendRequestRain.parts.css;
 if(!css.includes(FRIEND_RAIN_FIXED))return css;
 const cleaned=stripUnrequestedFriendRainSizing(css);
 const missing=FRIEND_RAIN_PATCHES.find(marker=>!cleaned.includes(marker));
 if(!missing)return cleaned;
 const index=friendRequestRain.parts.css.indexOf(missing);
 return index<0?cleaned:cleaned+'\n'+friendRequestRain.parts.css.slice(index);
}

/** Keep persisted CSS independent of the short-lived browser object URLs. */
export default function BlobRefStyle({css}: {css: string}) {
    const effectiveCss = resolveLegacyFriendRequestRainCss(resolveLegacyWeixinBaiyuCss(resolveLegacySilentLetterCss(css)));
    const [resolved, setResolved] = useState<{source: string; css: string; alive: () => boolean} | null>(null);
    useEffect(() => {
        if (!effectiveCss.includes('blobref:')) return;
        let alive = true; let dispose: (() => void) | undefined;
        void resolveCssImageUrls(effectiveCss, true).then(result => {
            if (!alive) {result.dispose(); return;}
            dispose = result.dispose; setResolved({source: effectiveCss, css: result.css, alive: () => alive});
        }).catch(() => { /* Keep ordinary layout CSS usable if the asset store is unavailable. */ });
        return () => {alive = false; dispose?.();};
    }, [effectiveCss]);
    return <style>{resolved?.source === effectiveCss && resolved.alive() ? resolved.css : effectiveCss}</style>;
}
