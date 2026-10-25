// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CHARACTER_PHONE_SOCIAL_APPS, isCharacterPhoneSocialAppId,
  readCharacterPhoneInstallPlan, saveCharacterPhoneInstallPlan,
  setCharacterPhoneSocialAppInstalled,
} from './characterPhoneAppInstall';

beforeEach(()=>localStorage.clear());

describe('per-Char optional app installation manifest',()=>{
  it('has nine optional apps while fixed and WeChat-internal apps remain fixed',()=>{
    expect(CHARACTER_PHONE_SOCIAL_APPS).toEqual(['x','bilibili','weibo','instagram','douban','douyin','email','jinjiang','netease']);
    expect(isCharacterPhoneSocialAppId('wechat')).toBe(false);
    expect(isCharacterPhoneSocialAppId('wallet')).toBe(false);
    expect(isCharacterPhoneSocialAppId('profile')).toBe(false);
    expect(isCharacterPhoneSocialAppId('settings')).toBe(false);
  });
  it('persists independently for each Char and removes duplicate/unknown ids',()=>{
    saveCharacterPhoneInstallPlan({
      characterId:'alice',installedAppIds:['x','bilibili','x','wechat' as never],
      reason:'有兴趣参与讨论',source:'ai',generatedAt:1000,
    });
    expect(readCharacterPhoneInstallPlan('alice')).toMatchObject({
      installedAppIds:['x','bilibili'],source:'ai',reason:'有兴趣参与讨论',
    });
    expect(readCharacterPhoneInstallPlan('bob')).toBeNull();
  });
  it('lets owner manage installation without rewriting previous generated content',()=>{
    saveCharacterPhoneInstallPlan({
      characterId:'alice',installedAppIds:['x'],reason:'喜欢文字',
      source:'ai',generatedAt:1000,
    });
    setCharacterPhoneSocialAppInstalled('alice','instagram',true);
    setCharacterPhoneSocialAppInstalled('alice','x',false);
    expect(readCharacterPhoneInstallPlan('alice')).toMatchObject({
      installedAppIds:['instagram'],source:'manual',generatedAt:1000,
    });
    expect(localStorage.getItem('sully_character_phone_wechat_v1:alice')).toBeNull();
  });
  it('reads legacy four-app plans unchanged and supports new optional installs without touching them',()=>{
    saveCharacterPhoneInstallPlan({
      characterId:'alice',installedAppIds:['x','instagram'],
      reason:'原有四款中的选择',generatedAt:1000,source:'ai',
    });
    setCharacterPhoneSocialAppInstalled('alice','netease',true);
    setCharacterPhoneSocialAppInstalled('alice','jinjiang',true);
    expect(readCharacterPhoneInstallPlan('alice')?.installedAppIds).toEqual(['x','instagram','netease','jinjiang']);
    expect(readCharacterPhoneInstallPlan('alice')?.reason).toBe('原有四款中的选择');
    expect(readCharacterPhoneInstallPlan('bob')).toBeNull();
  });
  it('does not invent installed apps when stored JSON is corrupt',()=>{
    localStorage.setItem('sully_character_phone_install_plan_v1:alice','not-json');
    expect(readCharacterPhoneInstallPlan('alice')).toBeNull();
  });
});
