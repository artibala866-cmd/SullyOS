import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const date = readFileSync(new URL('../apps/DateApp.tsx', import.meta.url), 'utf8');
const music = readFileSync(new URL('../apps/MusicApp.tsx', import.meta.url), 'utf8');
const context = readFileSync(new URL('../context/MusicContext.tsx', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../apps/music/DateBgmPanel.tsx', import.meta.url), 'utf8');

describe('Meet BGM wired into real music and encounter entry', () => {
  it('has an isolated playlist section and song menu entry, using real Meet characters', () => {
    expect(music).toContain("['dateBgm', '见面 BGM']");
    expect(music).toContain('onBind={bindDateBgmCharacter}');
    expect(music).toContain('characters={characters}');
    expect(music).toContain('加入见面 BGM');
    expect(panel).toContain('onAdd(active.id, song)');
    expect(panel).toContain('checked={checked}');
    expect(panel).toContain('return <React.Fragment key={pl.id}><button');
    expect(panel).toContain('{chosen && active && <section');
    expect(music).toContain('music-category-tabs');
  });
  it('starts only at encounter session entry and silently skips unconfigured playlists', () => {
    expect(date).toContain('const list = findCharacterDateBgm(musicLibrary, target.id);');
    expect(date).toContain('if (!list) return;');
    expect(date).toContain('startDateBgm(char);');
    expect(date).toContain('stopDateBgm();');
    expect(date).not.toMatch(/const handleCharClick = [\s\S]*?\n\s*};\n[\s\S]*?startDateBgm\(c\)/);
  });
  it('stops only the active BGM; cancellation prevents slow remote playback after leaving', () => {
    expect(context).toContain('if (!ownerId || dateBgmOwnerRef.current !== ownerId) return;');
    expect(context).toContain('dateBgmOwnerRef.current = dateBgmOwner || null;');
    expect(context).toContain('dateBgmOwner: dateBgmOwnerRef.current || undefined');
    expect(date).toContain('dateBgmOwner: ownerId');
    expect(context).not.toContain('trackKeys.includes(musicSongKey(song))');
    expect(context).toContain('++playRequestSeq.current;');
    expect(context).toContain("audio.removeAttribute('src')");
    expect(date).toContain('stopDateBgmIfCurrent(active.ownerId)');
  });
});
