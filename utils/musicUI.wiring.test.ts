/**
 * Lightweight wiring safeguards for the music interface.
 * Runtime playback behavior is covered by musicPlaybackState.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../apps/MusicApp.tsx', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../apps/music/MusicUI.tsx', import.meta.url), 'utf8');
const profile = readFileSync(new URL('../apps/music/NeteaseProfilePage.tsx', import.meta.url), 'utf8');

describe('音乐首页与网易云独立入口', () => {
  it('已登录账号资料不再重复占据音乐主页，专属入口保留', () => {
    expect(app).toContain('进入网易云账号专页');
    expect(app).not.toContain('profile.nickname');
    expect(app).not.toContain('profile.avatarUrl');
  });
  it('网易云左上角返回音乐页，而不是 closeApp 退出小手机', () => {
    expect(app).toMatch(/<NeteaseProfilePage\s+onBack=\{\(\) => setView\('search'\)\}/);
    expect(profile).toContain('onBack={onBack}');
  });
});

describe('搜索结果、喜欢、历史、队列与迷你播放器的状态反馈', () => {
  it('歌曲行有封面播放暂停、加载反馈和正在播放动效', () => {
    expect(ui).toContain('aria-busy={isActive && isLoading}');
    expect(ui).toContain('<Play size={20} color="white" weight="fill" />');
    expect(ui).toContain('<Pause size={20} color="white" weight="fill" />');
    expect(ui).toContain('music-eq');
    expect(app).toContain('isPlaying={isActive && playing} isLoading={isActive && loadingSong}');
    expect(app).toContain('isPlaying={active && playing} isLoading={active && loadingSong}');
  });
  it('加入队列用加号、喜欢用心形，保留辅助文字标签', () => {
    expect(app).toContain('<Plus size={17} weight="bold" />');
    expect(app).toContain('<Heart size={18}');
    expect(app).toContain('title="加入播放队列"');
    expect(app).toContain('title={isLiked ?');
    expect(app).not.toContain('>加入队列</button>');
    expect(app).not.toContain('>取消本地喜欢</button>');
  });
  it('分类切换有弹性动画，列表分批渲染，尊重减少动态效果设置', () => {
    expect(app).toContain('key={section} role="tabpanel" className="music-panel-enter');
    expect(app).toContain('songs.slice(0, visibleCount)');
    expect(ui).toContain('.music-tap:active');
    expect(ui).toContain('@media(prefers-reduced-motion:reduce)');
  });
  it('迷你播放器有加载、播放/暂停状态和进度条', () => {
    expect(ui).toContain("loading ? '正在获取音源…'");
    expect(ui).toContain('progress / duration * 100');
    expect(ui).toContain('aria-label={loading ?');
    expect(app).toContain('loading={loadingSong}');
    expect(app).toContain('progress={progress}');
  });
});
