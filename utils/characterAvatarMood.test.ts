// @vitest-environment jsdom
import {beforeEach,afterEach,describe,expect,it,vi} from 'vitest';
import {findAvatarForMood,chooseAvatarFromSavedMood} from './characterAvatarMood';
import {
  addCharacterAvatar, readCharacterAvatarLibrary, setAutonomousAvatarEnabled,
} from './characterAvatarLibrary';
import type {CharacterAvatarEntry} from './characterAvatarLibrary';

let i=0;
beforeEach(()=>{localStorage.clear();i=0;vi.stubGlobal('crypto',{randomUUID:()=>String(++i)})});
afterEach(()=>vi.unstubAllGlobals());

describe('AI-free mood matching against saved vision captions',()=>{
  const images:CharacterAvatarEntry[]=[
    {id:'smile',image:'https://example.invalid/smile.jpg',source:'upload',
      createdAt:1,visionDescription:'女孩穿着白色毛衣，眼睛弯弯，笑得很开心'},
    {id:'sleep',image:'https://example.invalid/sleep.jpg',source:'upload',
      createdAt:1,visionDescription:'穿灰色毛衣，眼睛半闭，神情困倦'},
    {id:'unknown',image:'https://example.invalid/no-caption.jpg',source:'upload',createdAt:1},
  ];
  it('chooses a pictured expression rather than image URLs',()=>{
    expect(findAvatarForMood(images,'sleep','今天真的好开心啊')?.id).toBe('smile');
    expect(findAvatarForMood(images,'smile','困倦得不行')?.id).toBe('sleep');
    expect(findAvatarForMood(images,'smile','开心地吃饭')).toBeUndefined();
    expect(findAvatarForMood(images,'smile','普通的日子')).toBeUndefined();
  });
  it('never guesses when the mood is mixed or an avatar has no caption',()=>{
    expect(findAvatarForMood(images,undefined,'开心但是很困倦')).toBeUndefined();
    expect(findAvatarForMood([images[2]],undefined,'开心')).toBeUndefined();
  });
  it('does not auto-swap while mood selection is paused; saved images remain untouched',async()=>{
    const smile=addCharacterAvatar('char','https://example.invalid/smile.jpg','upload',{
      description:'笑得很开心，阳光灿烂',model:'vision',
    });
    setAutonomousAvatarEnabled('char',true);
    const apply=vi.fn(async()=>{});
    expect(await chooseAvatarFromSavedMood('char','好开心！',apply)).toBe(false);
    expect(apply).not.toHaveBeenCalled();
    expect(readCharacterAvatarLibrary('char').entries.find(e=>e.id===smile.id)?.image).toBe(smile.image);
    expect(readCharacterAvatarLibrary('char').activeId).toBeUndefined();
    expect(await chooseAvatarFromSavedMood('char','还是很开心！',apply)).toBe(false);
    expect(apply).not.toHaveBeenCalled();
    expect(await chooseAvatarFromSavedMood('another','开心',apply)).toBe(false);
  });
});
