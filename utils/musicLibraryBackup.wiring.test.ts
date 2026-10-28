import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('正式音乐备份调用链', () => {
  const os = readFileSync(new URL('../context/OSContext.tsx', import.meta.url), 'utf8');
  const db = readFileSync(new URL('./db.ts', import.meta.url), 'utf8');
  const mirror = readFileSync(new URL('./lsMirror.ts', import.meta.url), 'utf8');

  it('全量和文字备份带音乐元数据；媒体备份不伪造文本收藏', () => {
    expect(os).toContain("guestMusicLibrary: mode === 'full' || mode === 'text_only' ? loadGuestMusicLibrary() : undefined");
    expect(os).toContain('processObject(backupData.guestMusicLibrary');
    expect(os).toContain('stripBase64(backupData.guestMusicLibrary)');
  });

  it('导入前验证，ZIP 封面回填后保存，全部设置完成再刷新镜像', () => {
    const validation = os.indexOf('validateGuestMusicLibraryBackup(data.guestMusicLibrary)');
    const dbImport = os.indexOf('await DB.importFullData(data,');
    const coverRestore = os.indexOf("restoreAssetsInPlace(guestMusicToRestore, '音乐收藏与歌单')");
    const librarySave = os.indexOf('persistGuestMusicLibrary(guestMusicToRestore)');
    const mirrorRefresh = os.indexOf('await snapshotLocalStorageMirror();');
    const success = os.indexOf("addToast('恢复成功，系统即将重启...'");
    expect(validation).toBeGreaterThan(0);
    expect(validation).toBeLessThan(dbImport);
    expect(dbImport).toBeLessThan(coverRestore);
    expect(coverRestore).toBeLessThan(librarySave);
    expect(librarySave).toBeLessThan(mirrorRefresh);
    expect(mirrorRefresh).toBeLessThan(success);
  });

  it('通用 DB 导出导入对等，旧备份不清现有库', () => {
    expect(db).toContain('guestMusicLibrary: loadGuestMusicLibrary()');
    expect(db).toContain('guestMusicRestoredByCaller');
    expect(db).toContain('data.guestMusicLibrary === undefined');
    expect(db).toContain('persistGuestMusicLibrary(guestMusic)');
  });

  it('镜像注册的是本地库和旧数字收藏，不恢复易过期的伴听状态', () => {
    expect(mirror).toContain("'sully_music_guest_library_v1'");
    expect(mirror).toContain("'sully_music_guest_likes_v1'");
    expect(mirror).not.toMatch(/^\s*'sully_music_together_v1',/m);
  });
});
