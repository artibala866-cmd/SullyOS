import { describe,expect,it } from 'vitest';
import { changeChatBlock,configureCharacterBlocking,isPrivateChatBlocked } from './chatBlock';
describe('private chat block guards',()=>{
 it('two directions remain separate',()=>{
  const a=changeChatBlock(undefined,'user',true,{at:100});
  const b=changeChatBlock(a,'character',true,{at:200,reason:'严重越界'});
  const c=changeChatBlock(b,'user',false,{at:300});
  expect(isPrivateChatBlocked(c)).toBe(true);
  expect(c.characterBlockedAt).toBe(200);
  expect(c.history?.length).toBe(3);
 });
 it('disabling char autonomy removes only char block',()=>{
  const a=changeChatBlock(changeChatBlock(undefined,'user',true,{at:100}),'character',true,{at:200});
  const b=configureCharacterBlocking(a,false,300);
  expect(b.userBlockedAt).toBe(100);
  expect(b.characterBlockedAt).toBeUndefined();
 });
});
