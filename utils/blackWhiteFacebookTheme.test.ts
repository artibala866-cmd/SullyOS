import { describe, expect, it } from 'vitest';
import { BLACK_WHITE_FACEBOOK_CSS, formatBlackWhiteTime, isBlackWhiteFacebookTheme, shouldStartBlackWhiteTimeGroup } from './blackWhiteFacebookTheme';

describe('black-white private-chat Facebook-style theme', () => {
  it('only targets the built-in 黑白气泡', () => {
    expect(isBlackWhiteFacebookTheme({id:'default',name:'黑白气泡'})).toBe(true);
    expect(isBlackWhiteFacebookTheme({id:'dream',name:'微信气泡'})).toBe(false);
    expect(isBlackWhiteFacebookTheme({id:'forest',name:'QQ气泡'})).toBe(false);
    expect(isBlackWhiteFacebookTheme({id:'custom-one',name:'黑白气泡'})).toBe(false);
  });
  it('groups times over five minutes apart and across midnight', () => {
    const start = new Date(2026, 9, 25, 16, 50).getTime();
    expect(shouldStartBlackWhiteTimeGroup(undefined,start)).toBe(true);
    expect(shouldStartBlackWhiteTimeGroup(start,start+4*60000)).toBe(false);
    expect(shouldStartBlackWhiteTimeGroup(start,start+9*60000)).toBe(true);
    expect(shouldStartBlackWhiteTimeGroup(start,new Date(2026,9,26,0,1).getTime())).toBe(true);
  });
  it('uses reference screenshot time labels', () => {
    const sunday = new Date(2026,9,25,16,50).getTime();
    expect(formatBlackWhiteTime(sunday,new Date(2026,9,25,20,0).getTime())).toBe('周日 16:50');
    expect(formatBlackWhiteTime(sunday,new Date(2026,9,26,12,0).getTime())).toBe('昨天 16:50');
  });
  it('scopes outgoing, incoming, quote and time spacing', () => {
    expect(BLACK_WHITE_FACEBOOK_CSS).toContain('.sully-chat-monochrome .sully-facebook-reply');
    expect(BLACK_WHITE_FACEBOOK_CSS).toContain('.sully-chat-message-user');
    expect(BLACK_WHITE_FACEBOOK_CSS).toContain('.sully-chat-message-ai');
    expect(BLACK_WHITE_FACEBOOK_CSS).toContain('.sully-facebook-time');
  });
});
