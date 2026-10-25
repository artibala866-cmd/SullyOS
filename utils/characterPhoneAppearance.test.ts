// @vitest-environment jsdom
import {beforeEach,describe,expect,it} from 'vitest';
import {readPhoneAppearance,savePhoneAppearance,relationshipDayCount} from './characterPhoneAppearance';

beforeEach(()=>localStorage.clear());

describe('character phone P1 wallpaper and widgets',()=>{
  it('keeps appearance completely separate for each character',()=>{
    savePhoneAppearance('a',{preset:'graphite',quote:'世界慢一点',location:'首尔'});
    expect(readPhoneAppearance('a')).toMatchObject({preset:'graphite',quote:'世界慢一点',location:'首尔'});
    expect(readPhoneAppearance('b')).toMatchObject({preset:'mist',quote:'',location:''});
  });
  it('rejects external URLs and invalid images rather than persisting arbitrary content',()=>{
    savePhoneAppearance('a',{wallpaper:'https://external.example/image.jpg',polaroidLeft:'javascript:alert(1)'});
    expect(readPhoneAppearance('a').wallpaper).toBe('');
    expect(readPhoneAppearance('a').polaroidLeft).toBe('');
  });
  it('uses user supplied anniversary, not a fabricated count',()=>{
    expect(relationshipDayCount('')).toBeNull();
    expect(relationshipDayCount('2026-02-30',new Date(2026,3,1))).toBeNull();
    expect(relationshipDayCount('2026-10-23',new Date(2026,9,25))).toBe(3);
    expect(relationshipDayCount('2026-10-26',new Date(2026,9,25))).toBeNull();
  });
  it('retains other desktop data on partial changes',()=>{
    savePhoneAppearance('char',{quote:'这不是告别',caption:'慢一点'});
    savePhoneAppearance('char',{preset:'paper'});
    expect(readPhoneAppearance('char')).toMatchObject({quote:'这不是告别',caption:'慢一点',preset:'paper'});
  });
  it('never changes the optional social app installation manifest',()=>{
    savePhoneAppearance('char',{location:'东京'});
    expect(localStorage.getItem('sully_character_phone_install_plan_v1:char')).toBeNull();
  });
});
