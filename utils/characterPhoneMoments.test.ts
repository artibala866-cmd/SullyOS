import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addMomentComment, deleteCharacterMoment, deleteMomentComment, publishCharacterMoment, readCharacterMoments, setMomentLike } from './characterPhoneMoments';

const store = new Map<string,string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key:string) => store.get(key) ?? null,
    setItem: (key:string,value:string) => {store.set(key,value);},
    removeItem: (key:string) => {store.delete(key);}
  });
  vi.stubGlobal('window', {dispatchEvent:()=>true});
  vi.stubGlobal('CustomEvent', class { constructor(public type:string, public init:unknown) {} });
});
describe('Char Moments persistence and interactions', () => {
  const publish = () => publishCharacterMoment({characterId:'char-a',origin:'char',text:'日常',imageUrls:[],visibility:'all'});
  it('isolates characters and retains posts', () => {
    const post=publish();
    expect(post).not.toBeNull();
    expect(readCharacterMoments('char-a')).toHaveLength(1);
    expect(readCharacterMoments('char-b')).toHaveLength(0);
  });
  it('supports idempotent likes and comments with stable IDs', () => {
    const post=publish()!;
    expect(setMomentLike('char-a',post.id,'npc-1',true)).toBe(true);
    expect(setMomentLike('char-a',post.id,'npc-1',true)).toBe(true);
    expect(readCharacterMoments('char-a')[0].likes).toHaveLength(1);
    expect(addMomentComment('char-a',post.id,{id:'c1',authorId:'npc-1',text:'好',createdAt:1})).toBe(true);
    expect(addMomentComment('char-a',post.id,{id:'c2',authorId:'char-a',text:'谢谢',createdAt:2,replyToId:'c1'})).toBe(true);
    expect(deleteMomentComment('char-a',post.id,'c1','char-a')).toBe(false);
    expect(deleteMomentComment('char-a',post.id,'c1','npc-1')).toBe(true);
  });
  it('preserves soft deletion and disallows new interactions', () => {
    const post=publish()!;
    expect(deleteCharacterMoment('char-a',post.id,'user')).toBe(true);
    expect(readCharacterMoments('char-a')[0].deletedBy).toBe('user');
    expect(setMomentLike('char-a',post.id,'npc-1',true)).toBe(false);
    expect(addMomentComment('char-a',post.id,{id:'c',authorId:'npc-1',text:'hi',createdAt:1})).toBe(false);
  });
  it('rejects empty selected audience and over nine images', () => {
    expect(publishCharacterMoment({characterId:'char-a',origin:'char',text:'hi',imageUrls:[],visibility:'selected'})).toBeNull();
    expect(publishCharacterMoment({characterId:'char-a',origin:'char',text:'hi',imageUrls:Array(10).fill('image'),visibility:'all'})).toBeNull();
  });
});
