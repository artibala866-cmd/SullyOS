// @vitest-environment jsdom
import {beforeEach,describe,expect,it} from 'vitest';
import {readPhoneInboxPreferences,writePhoneInboxPreferences} from './characterPhoneInboxPrefs';
beforeEach(()=>localStorage.clear());
describe('Char phone WeChat suite preferences',()=>{
  it('defaults to manual mode and keeps existing inbox-generation preferences',()=>{
    expect(readPhoneInboxPreferences('a')).toEqual({
      autoFullWeChat:false,officialAccounts:true,paymentNotices:true,chatDensity:'normal',
    });
  });
  it('enables automatic suite per Char only, preserving other toggles',()=>{
    writePhoneInboxPreferences('a',{chatDensity:'rich',paymentNotices:false});
    writePhoneInboxPreferences('a',{autoFullWeChat:true});
    expect(readPhoneInboxPreferences('a')).toEqual({
      autoFullWeChat:true,officialAccounts:true,paymentNotices:false,chatDensity:'rich',
    });
    expect(readPhoneInboxPreferences('b').autoFullWeChat).toBe(false);
  });
  it('reads pre-existing inbox preferences without activating automation',()=>{
    localStorage.setItem('sully_character_phone_inbox_prefs_v1:old',
      JSON.stringify({chatDensity:'compact',officialAccounts:false}));
    expect(readPhoneInboxPreferences('old')).toMatchObject({
      autoFullWeChat:false,officialAccounts:false,chatDensity:'compact',
    });
  });
});
