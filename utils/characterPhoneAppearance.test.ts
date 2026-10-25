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
  it('defaults to a narrow phone frame and saves fullscreen separately for each Char',()=>{
    expect(readPhoneAppearance('char').fullscreen).toBe(false);
    savePhoneAppearance('char',{fullscreen:true,preset:'paper',quote:'日常'});
    expect(readPhoneAppearance('char')).toMatchObject({fullscreen:true,preset:'paper',quote:'日常'});
    expect(readPhoneAppearance('other').fullscreen).toBe(false);
    savePhoneAppearance('char',{fullscreen:false});
    expect(readPhoneAppearance('char')).toMatchObject({fullscreen:false,quote:'日常'});
  });
  it('is backward compatible with older wallpaper records without the fullscreen field',()=>{
    localStorage.setItem('sully_character_phone_appearance_v1:old',JSON.stringify({
      preset:'graphite',quote:'原来的文案',polaroidLeft:'',polaroidRight:'',wallpaper:'',
    }));
    expect(readPhoneAppearance('old')).toMatchObject({fullscreen:false,preset:'graphite',quote:'原来的文案'});
  });
  it('sanitizes unexpected fullscreen values instead of enabling full screen',()=>{
    savePhoneAppearance('char',{fullscreen:'yes' as never});
    expect(readPhoneAppearance('char').fullscreen).toBe(false);
  });
  it('never changes the optional social app installation manifest',()=>{
    savePhoneAppearance('char',{location:'东京'});
    expect(localStorage.getItem('sully_character_phone_install_plan_v1:char')).toBeNull();
  });
});
