/**
 * Lightweight wiring safeguards for the music interface.
 * Runtime playback behavior is covered by musicPlaybackState.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../apps/MusicApp.tsx', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../apps/music/MusicUI.tsx', import.meta.url), 'utf8');
const profile = readFileSync(new URL('../apps/music/NeteaseProfilePage.tsx', import.meta.url), 'utf8');
const login = readFileSync(new URL('../apps/music/NeteaseLoginPanel.tsx', import.meta.url), 'utf8');

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
    expect(app).toContain('key={view} className="absolute inset-0 music-panel-enter"');
    expect(app).toContain('songs.slice(0, visibleCount)');
    expect(ui).toContain('.music-tap:active');
    expect(ui).toContain('@media(prefers-reduced-motion:reduce)');
  });
  it('点击队列其他歌曲会更新当前索引，不能只换音频地址', () => {
    const queueView = app.split("section === 'queue' &&")[1]?.split('{characters.length')[0] || '';
    expect(queueView).toContain('else void playSong(song);');
    expect(queueView).not.toContain('playSong(song, { alsoSetQueue: false })');
  });

  it('缺失封面才解析 pic_id，完整播放器显示真实音质而非请求档位', () => {
    expect(app).toContain('picId={song.picId} source={song.source}');
    expect(app).toContain('bitrate={actualQualityLabel}');
    expect(app).toContain('lyricMessage ||');
    expect(ui).toContain('IntersectionObserver');
    expect(ui).toContain('getGuestMusicCover({ albumPic, picId, source })');
    expect(ui).toContain('ref={coverRef}');
  });

  it('触屏滚动关闭高成本玻璃模糊和无限背景动画，保留操作弹性', () => {
    expect(ui).toContain('@media(pointer:coarse)');
    expect(ui).toContain('backdrop-filter:none!important');
    expect(ui).toContain('.shizuku-bokeh [style*="animation"]');
    expect(ui).toContain('.music-tap:active');
  });

  it('真实空搜索展示无匹配提示，切换来源不会残留上一来源的结果', () => {
    expect(app).toContain('const [hasSearched, setHasSearched] = useState(false)');
    expect(app).toContain('setHasSearched(true)');
    expect(app).toContain('setHasSearched(false); setResults([]); setSection');
    expect(app).toContain('搜索完成，没有找到匹配歌曲');
    expect(app).toContain('hasSearched && !results.length && !searching');
  });

  it('迷你播放器有加载、播放/暂停状态和进度条', () => {
    expect(ui).toContain("loading ? '正在获取音源…'");
    expect(ui).toContain('progress / duration * 100');
    expect(ui).toContain('aria-label={loading ?');
    expect(app).toContain('loading={loadingSong}');
    expect(app).toContain('progress={progress}');
  });
});


describe('高级感灰阶排版与播放交互回归', () => {
  it('首页使用编辑式字级层次、线性音源导航，不恢复粉彩药丸按钮', () => {
    expect(app).toContain('SULLY / AUDIO');
    expect(app).toContain('我的私人曲库');
    expect(app).toContain('text-[34px] font-bold');
    expect(app).toContain('searchSource === src ? C.primary : C.muted');
    expect(app).toContain('music-editorial-shell absolute inset-0');
    expect(ui).toContain('.music-editorial-shell .music-track-row');
  });
  it('黑色悬浮播放器把打开详情和播控拆成并列按钮，避免嵌套交互', () => {
    const dock = ui.split('export const MiniPlayer:')[1]?.split('// Same public component contract;')[0] || '';
    expect(dock).toContain('className="music-dock');
    expect(dock).toContain('background: \'#171717\'');
    expect(dock).toContain('className="music-dock-open music-tap"');
    expect(dock).toContain('onClick={onTap}');
    expect(dock).toContain('onClick={onToggle}');
    expect(dock).not.toContain('role="button" tabIndex={0}');
    expect(dock).not.toContain('e.stopPropagation()');
    expect(dock).toContain('env(safe-area-inset-bottom');
  });
  it('设置页诊断不泄露 MUSIC_U Cookie 前缀，输入框与保存操作保持简洁', () => {
    expect(app).toContain('已配置（敏感值不显示）');
    expect(app).not.toContain("ck.slice(0, 18)");
    expect(app).toContain('className="w-full py-3.5 rounded-sm text-[13px] font-semibold');
    expect(app).not.toContain('linear-gradient(90deg, transparent 30%');
  });
  it('中文输入法确认候选字不会误提交搜索，歌词仍可键盘拖动进度', () => {
    expect(ui).toContain("e.key === 'Enter' && !e.nativeEvent.isComposing");
    expect(ui).toContain('aria-label="播放进度"');
    expect(ui).toContain("e.key === 'ArrowLeft'");
    expect(ui).toContain('@media(prefers-reduced-motion:reduce)');
  });
});

describe('MONO 黑白灰音乐视觉回归', () => {
  it('统一中性色票，不能回到旧紫粉色和星芒水滴主题', () => {
    expect(ui).toContain("primary: '#171717'");
    expect(ui).toContain("accent: '#454545'");
    expect(ui).toContain("bg: '#f6f6f5'");
    expect(ui).not.toContain('#7163c9');
    expect(ui).not.toContain('#bd6da5');
    expect(ui).not.toContain('shizuku-twinkle');
    expect(ui).not.toContain('@keyframes shizuku-float');
    expect(app).toContain('title="MUSIC"');
    expect(app).not.toContain('rgba(255,222,237');
  });
  it('方形专辑封面、简洁列表、黑色播放键与无粒子背景必须保留', () => {
    const cover = ui.split('export const VinylDisc:')[1]?.split('export const MetaChip:')[0] || '';
    expect(cover).toContain('rounded-md overflow-hidden');
    expect(cover).not.toContain('shizuku-vinyl');
    expect(cover).not.toContain('<Sparkle');
    expect(ui).toContain('No animated particles, colored halos');
    expect(ui).toContain('background: C.primary');
    expect(app).toContain('borderBottom: \'1px solid #ebebeb\'');
  });
  it('切换成简约风也不能丢失搜索、播控、播放进度与无障碍操作', () => {
    expect(ui).toContain('aria-label="搜索歌曲或歌手"');
    expect(ui).toContain('aria-busy={isActive && isLoading}');
    expect(ui).toContain('aria-label="播放进度"');
    expect(ui).toContain("e.key === 'ArrowRight'");
    expect(ui).toContain('onKick(main.id)');
    expect(ui).toContain('getGuestMusicCover({ albumPic, picId, source })');
  });
  it('账号页与登录页也使用灰阶，不残留紫粉渐变按钮', () => {
    expect(profile).not.toContain('#e0b88a');
    expect(login).not.toContain('linear-gradient(135deg, ${C.primary}, ${C.accent})');
    expect(login).not.toContain('linear-gradient(180deg, #ffffff');
  });
});
