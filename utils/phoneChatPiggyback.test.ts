// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {writePhoneAutonomyPreferences,canUsePhoneApiBudget,readPhoneAutonomyPreferences} from './characterPhoneApiBudget';
import {readMomentInteractionPreferences,writeMomentInteractionPreferences,allowMomentComment,momentCommentFingerprint} from './momentInteractionPreferences';
import {extractChatPhoneEvents,chatPhonePiggybackPrompt,applyChatPhoneEvents} from './phoneChatPiggyback';
import {readCharacterMoments} from './characterPhoneMoments';
import {readCharacterPhoneChats} from './characterPhoneChats';
import {saveNpcProfiles} from './characterPhoneNpcs';

let uuid=0;
beforeEach(()=>{localStorage.clear();sessionStorage.clear();uuid=0;vi.stubGlobal('crypto',{randomUUID:()=>String(++uuid)});});
afterEach(()=>vi.unstubAllGlobals());

describe('phone API spending and private-chat sidecar',()=>{
 it('can stop all autonomous phone requests without stopping user-chat piggyback',()=>{
  writePhoneAutonomyPreferences('c',{backgroundApiEnabled:false,chatPiggybackEnabled:true});
  expect(canUsePhoneApiBudget('c')).toBe(false);
  expect(readPhoneAutonomyPreferences('c').chatPiggybackEnabled).toBe(true);
  expect(chatPhonePiggybackPrompt('c')).toContain('不单独发 API');
 });
 it('removes optional internal JSON from the visible chat and ignores malformed JSON',()=>{
  const value='我觉得这件事挺有意思。\n<sully_phone_events>{"chats":[],"moment":{"publish":false}}</sully_phone_events>';
  const result=extractChatPhoneEvents(value);
  expect(result.cleaned).toBe('我觉得这件事挺有意思。');
  expect(result.data).toMatchObject({chats:[]});
  expect(extractChatPhoneEvents('正常说话<sully_phone_events>bad</sully_phone_events>').data).toBeNull();
  expect(extractChatPhoneEvents('正常说话<sully_phone_events>{"chats":[').cleaned).toBe('正常说话');
 });
 it('persists one owner/NPC exchange and one motivated Char post with only the existing response',()=>{
  writePhoneAutonomyPreferences('c',{chatPiggybackEnabled:true});
  saveNpcProfiles('c',[{id:'n1',name:'好友小明',personality:'寡言',identity:'同事',relationship:'朋友',background:'书店同事',source:'generated',createdAt:1}]);
  const raw={chats:[{contactId:'n1',messages:[{speaker:'owner',text:'太激动了！'},{speaker:'contact',text:'啥事呀'}]}],moment:{publish:true,text:'今天真的很开心。',comments:[{authorId:'n1',text:'哦？挺好的'}]}};
  expect(applyChatPhoneEvents('c',raw,Date.now())).toBe(4);
  expect(readCharacterPhoneChats('c')[0].messages).toHaveLength(2);
  expect(readCharacterMoments('c')[0].comments).toHaveLength(1);
  expect(applyChatPhoneEvents('c',raw,Date.now())).toBe(0);
  expect(readCharacterPhoneChats('c')[0].messages).toHaveLength(2);
 });
 it('refuses invented contacts and user impersonation',()=>{
  writePhoneAutonomyPreferences('c',{chatPiggybackEnabled:true});
  const value={chats:[{contactId:'unknown',messages:[{speaker:'owner',text:'不应出现'}]}],moment:{publish:false}};
  expect(applyChatPhoneEvents('c',value)).toBe(0);
  expect(readCharacterPhoneChats('c')).toHaveLength(0);
 });
});
describe('relationship comment rules',()=>{
 it('lets established commenters respond without repeating or endless reply chains',()=>{
  const comments=[{id:'x',authorId:'n1',text:'好呀！'}];
  expect(allowMomentComment(comments,'n2','好呀')).toBe(false);
  expect(momentCommentFingerprint('好呀！')).toBe(momentCommentFingerprint('好呀'));
  expect(allowMomentComment(comments,'n2','恭喜你', 'x')).toBe(true);
  const next=[...comments,{id:'y',authorId:'n2',text:'恭喜你',replyToId:'x'}];
  expect(allowMomentComment(next,'n1','谢谢','y')).toBe(false);
  expect(allowMomentComment(next,'n2','再次回复','x')).toBe(false);
 });
 it('saves per-Char pace and clamps intervals',()=>{
  writeMomentInteractionPreferences('c',{pace:'lively',intervalMinutes:99999});
  expect(readMomentInteractionPreferences('c').intervalMinutes).toBe(1440);
  expect(readMomentInteractionPreferences('c').pace).toBe('lively');
  expect(readMomentInteractionPreferences('other').pace).toBe('balanced');
 });
});
