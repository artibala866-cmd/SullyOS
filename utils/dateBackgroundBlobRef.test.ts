import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// 角色的见面背景（characters.dateBackground）存的是 `blobref:` 令牌（见 utils/blobRef.ts），
// 二进制在 IndexedDB 里。令牌直接塞进裸 <img src> / CSS url() 就是一张裂图，所以：
//   · 场景布置页的预览底图和缩略图分别走 useBlobRefUrl / TokenImg；
//   · 上传时用 processImageToBlob + putImageBlob 产出令牌，别再写回 base64
//     （写端漏改的话，用户新设的背景又变成几 MB 的 data URL 塞在角色行里）。
const settingsSource = readFileSync(path.resolve(__dirname, '../components/date/DateSettings.tsx'), 'utf8');
const personaSimSource = readFileSync(path.resolve(__dirname, '../apps/PersonaSim.tsx'), 'utf8');

describe('见面背景的 blobref 读写路径', () => {
  it('上传后存的是令牌，不是 base64', () => {
    expect(settingsSource).toContain('const blob = await processImageToBlob(file, { skipCompression: true });');
    expect(settingsSource).toContain("updateBackground(uploadTarget === 'bg' ? 'default' : targetSceneKey, ref)");
    expect(settingsSource).toContain("if (key === 'default') updateCharacter(char.id, { dateBackground: value });");
    expect(settingsSource).not.toContain('updateCharacter(char.id, { dateBackground: base64 });');
  });

  it('场景布置页的预览底图先用 useBlobRefUrl 解析再拼进 CSS url()', () => {
    expect(settingsSource).toContain('const dateBackgroundUrl = useBlobRefUrl((previewSceneKey && char.dateSceneBackgrounds?.[previewSceneKey]) || char.dateBackground);');
    expect(settingsSource).toContain('backgroundImage: dateBackgroundUrl ?');
    expect(settingsSource).not.toContain('url(${char.dateBackground})');
  });

  it('单独配置场景背景仍走原来的 blobref 存取和默认背景兜底', () => {
    expect(settingsSource).toContain("else updateScene(key, value)");
    expect(settingsSource).toContain('const backgrounds = { ...(char.dateSceneBackgrounds || {}) }');
    expect(settingsSource).toContain('|| char.dateBackground);');
    expect(settingsSource).toContain('<TokenImg value={image}');
    expect(settingsSource).not.toContain('<img src={image}');
  });

  it('旧默认背景保留在统一场景网格，六个入口不重复、不显示英文与链接按钮', () => {
    expect(settingsSource).toContain("{ key: 'default', label: '默认' }");
    expect(settingsSource).toContain('...DATE_SCENES,');
    expect(settingsSource).toContain("key === 'default' ? char.dateBackground : char.dateSceneBackgrounds?.[key]");
    expect(settingsSource).toContain('<Section title="背景">');
    expect(settingsSource).not.toContain('<Section title="背景 (Background)">');
    expect(settingsSource).not.toContain('<Section title="基础场景背景">');
    expect(settingsSource).not.toContain('>{label} <span');
    expect(settingsSource).not.toContain('>链接</button>');
    expect(settingsSource).not.toContain('预览默认背景');
    expect(settingsSource).toContain('<TokenImg value={image}');
    expect(settingsSource).not.toContain('<img src={char.dateBackground}');
  });

  it('PersonaSim 的外壳底图在 Shell 里解析一次，覆盖全部调用点', () => {
    expect(personaSimSource).toContain('const wallpaperUrl = useBlobRefUrl(wallpaper);');
    expect(personaSimSource).toContain('url("${wallpaperUrl}")');
    expect(personaSimSource).not.toContain('url(${wallpaper})');
  });
});
