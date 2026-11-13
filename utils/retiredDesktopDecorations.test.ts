import { describe, expect, it } from 'vitest';
import { stripRetiredDesktopDecorations, stripRetiredDecorationPreset, isRetiredDecorationAssetId } from './retiredDesktopDecorations';

describe('retired desktop decoration migration', () => {
  it('removes old stickers, preserves widgets and wallpaper, and does not mutate source', () => {
    const source = { wallpaper: 'wallpaper', launcherWidgets: { tl: 'widget' }, desktopDecorations: [{ id: 'deco-1' }] };
    const result = stripRetiredDesktopDecorations(source);
    expect(result).toEqual({ wallpaper: 'wallpaper', launcherWidgets: source.launcherWidgets });
    expect(source.desktopDecorations).toHaveLength(1);
    expect(stripRetiredDesktopDecorations(result)).toBe(result);
  });
  it('preserves preset icons and chat decoration independently', () => {
    const source = { theme: { desktopDecorations: [1], contentColor: '#333' }, customIcons: { chat: 'icon' }, chatThemes: [{ decoration: 'unrelated' }] };
    expect(stripRetiredDecorationPreset(source)).toEqual({ theme: { contentColor: '#333' }, customIcons: source.customIcons, chatThemes: source.chatThemes });
  });
  it('purges only the retired asset prefix', () => {
    expect(isRetiredDecorationAssetId('deco_deco-1')).toBe(true);
    expect(isRetiredDecorationAssetId('decoration_origin_ap_1')).toBe(false);
    expect(isRetiredDecorationAssetId('widget_tl')).toBe(false);
  });
});
