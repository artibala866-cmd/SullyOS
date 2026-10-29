import { describe, expect, it } from 'vitest';
import { DB, openDB } from './db';
import type { CharPlaylistSong } from '../types';
import { appendCharPlaylistSong, charPlaylistSongIdentity } from './charMusicPlaylist';

const song = (id:number, musicSource:'netease'|'tencent'='netease',platformId=String(id)):CharPlaylistSong =>
  ({id,musicSource,platformId,name:'同名歌',artists:'歌手',album:'',albumPic:'',duration:180,fee:0,source:'discovered'});

describe('Char 歌单数据原子性',()=>{
  it('网易云与 QQ 相同数字 ID 保留两首；相同 QQ MID 不重复',()=>{
    const a=appendCharPlaylistSong(undefined,song(42),{kind:'new',title:'收藏'},100)!;
    const b=appendCharPlaylistSong(a.profile,song(42,'tencent','MID42'),{kind:'new',title:'收藏'},101)!;
    const c=appendCharPlaylistSong(b.profile,song(999,'tencent','MID42'),{kind:'new',title:'收藏'},102)!;
    expect(b.profile.playlists[0].songs).toHaveLength(2);
    expect(c.inserted).toBe(false);
    expect(c.profile.playlists[0].songs).toHaveLength(2);
  });
  it('指定的目标不存在时绝不保存到错误歌单或篡改旧资料',()=>{
    const a=appendCharPlaylistSong(undefined,song(1),{kind:'new',title:'我的专属'},10)!;
    const snapshot=JSON.stringify(a.profile);
    expect(appendCharPlaylistSong(a.profile,song(2),{kind:'existing',title:'不存在'},20)).toBeNull();
    expect(appendCharPlaylistSong(a.profile,song(2),{kind:'existing',title:'  '},20)).toBeNull();
    expect(JSON.stringify(a.profile)).toBe(snapshot);
  });
  it('真实 IndexedDB 两次并发收藏串行落盘，不丢歌，也不覆盖其他角色字段',async()=>{
    const id='music-char-atomic-race-1';
    const db=await openDB();
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction('characters','readwrite');
      tx.objectStore('characters').put({id,name:'原始名字',myCustomField:'原样保留'});
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error);
    });
    const changes=await Promise.all([
      DB.appendSongToCharPlaylist(id,song(101,'tencent','MID-A'),{kind:'new',title:'角色收藏'}),
      DB.appendSongToCharPlaylist(id,song(102),{kind:'new',title:'角色收藏'}),
    ]);
    expect(changes.every(Boolean)).toBe(true);
    const saved=await DB.getCharacter(id);
    expect(saved?.name).toBe('原始名字');
    expect((saved as any)?.myCustomField).toBe('原样保留');
    expect(saved?.musicProfile?.playlists).toHaveLength(1);
    expect(saved?.musicProfile?.playlists[0].songs.map(s=>charPlaylistSongIdentity(s)).sort())
      .toEqual(['netease:102','tencent:MID-A']);
    expect(await DB.appendSongToCharPlaylist('missing-character',song(9))).toBeNull();
  });
});
