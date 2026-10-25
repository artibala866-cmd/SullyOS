// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CHARACTER_PHONE_SOCIAL_APPS, isCharacterPhoneSocialAppId,
  readCharacterPhoneInstallPlan, saveCharacterPhoneInstallPlan,
  setCharacterPhoneSocialAppInstalled,
} from './characterPhoneAppInstall';

beforeEach(()=>localStorage.clear());

describe('per-Char optional app installation manifest',()=>{
  it('has exactly four optional shells; never treats fixed apps as optional',()=>{
    expect(CHARACTER_PHONE_SOCIAL_APPS).toEqual(['x','bilibili','weibo','instagram']);
    expect(isCharacterPhoneSocialAppId('wechat')).toBe(false);
    expect(isCharacterPhoneSocialAppId('wallet')).toBe(false);
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
  it('does not invent installed apps when stored JSON is corrupt',()=>{
    localStorage.setItem('sully_character_phone_install_plan_v1:alice','not-json');
    expect(readCharacterPhoneInstallPlan('alice')).toBeNull();
  });
});
