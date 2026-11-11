import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Live2D update notification references', () => {
  it('does not queue feature-release essays in the self-use interface', () => {
    const source = readFileSync(path.resolve(__dirname, '../components/UpdateNotificationEvent.tsx'), 'utf8');
    const queue = source.slice(source.indexOf('const UPDATE_QUEUE:'), source.indexOf('export const shouldShowUpdateNotification'));
    expect(queue).toContain('NETWORK_TRANSIT_NOTICE_KEY_2026_08');
    for (const announcement of ['NavigationBallAnnouncement', 'HomeUpdateAnnouncement', 'SmallUpdatesPopup', 'DecorationUpdatePopup', 'Live2DUpdatePopup']) {
      expect(queue).not.toContain(announcement);
    }
    expect(source).toContain('联网请求');
    expect(source).not.toContain('例行维护 · 说明补充');
  });

  it('links the handbook collaboration entry to its detailed release note', () => {
    const source = readFileSync(path.resolve(__dirname, '../components/UpdateNotificationEvent.tsx'), 'utf8');
    const detailSource = readFileSync(path.resolve(__dirname, '../public/changelogs/2026-8-30.html'), 'utf8');
    expect(source).toContain("openReleaseNotes('2026-8-30')");
    expect(detailSource).toContain('ChatApp');
    expect(detailSource).toContain('设置 → 导出');
    expect(detailSource).toContain('长按删除');
  });

  it('replaces the theater popup with the Live2D release and its two promised features', () => {
    const source = readFileSync(path.resolve(__dirname, '../components/UpdateNotificationEvent.tsx'), 'utf8');

    expect(source).not.toContain('StoryPremierePopup');
    expect(source).not.toContain('STORY_FEATURES');
    expect(source).toContain('Live2DUpdatePopup');
    expect(source).toContain("UPDATE_NOTIFICATION_KEY_2026_08_10 = 'sullyos_update_2026_08_10_live2d_seen'");
    expect(source).toContain("eyebrow: '视频通话'");
    expect(source).toContain("eyebrow: 'L2D 陪伴桌面'");
    expect(source).toContain('openReleaseNotes(\'2026-8-10\')');
  });

  it('keeps the handbook card and detail page linked to the same changelog id', () => {
    const source = readFileSync(path.resolve(__dirname, '../components/UpdateNotificationEvent.tsx'), 'utf8');
    const detailSource = readFileSync(path.resolve(__dirname, '../public/changelogs/2026-8-10.html'), 'utf8');

    expect(source).toContain("openReleaseNotes('2026-8-10')");
    expect(detailSource).toContain('新增视频通话');
    expect(detailSource).toContain('新增面向 L2D 的桌面主题');
  });
});
