// @vitest-environment jsdom
import {beforeEach,describe,expect,it} from 'vitest';
import {reserveAvatarVisionBackfill} from './characterAvatarVisionBudget';
beforeEach(()=>localStorage.clear());
describe('Bounded automatic legacy avatar recognition',()=>{
  const now=new Date(2026,9,25,8,0,0).getTime();
  it('reserves at most three vision requests per Char per day',()=>{
    expect(reserveAvatarVisionBackfill('char-a',now)).toBe(true);
    expect(reserveAvatarVisionBackfill('char-a',now+1000)).toBe(true);
    expect(reserveAvatarVisionBackfill('char-a',now+2000)).toBe(true);
    expect(reserveAvatarVisionBackfill('char-a',now+3000)).toBe(false);
    expect(reserveAvatarVisionBackfill('char-b',now+3000)).toBe(true);
    expect(reserveAvatarVisionBackfill('char-a',now+24*3600_000)).toBe(true);
  });
  it('does not allow empty identities to bypass the budget',()=>{
    expect(reserveAvatarVisionBackfill('',now)).toBe(false);
  });
});
