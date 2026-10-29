/**
 * Lightweight wiring safeguards for the music interface.
 * Runtime playback behavior is covered by musicPlaybackState.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../apps/MusicApp.tsx', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../apps/music/MusicUI.tsx', import.meta.url), 'utf8');
const queueSheet = readFileSync(new URL('../apps/music/MusicQueueSheet.tsx', import.meta.url), 'utf8');
const playlistSheet = readFileSync(new URL('../apps/music/MusicPlaylistSheet.tsx', import.meta.url), 'utf8');
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
    expect(queueSheet).toContain('isPlaying={selected && playing} isLoading={selected && loading}');
  });
  it('加入队列用加号、喜欢用心形，保留辅助文字标签', () => {
    expect(app).toContain('<Plus size={18} weight="regular" />');
    expect(app).toContain('<Heart size={18}');
    expect(ui).toContain('<Heart size={16}');
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
  it('队列在迷你播放器右侧三横线打开，不再占用分类导航', () => {
    const dock = ui.split('export const MiniPlayer:')[1]?.split('// Same public component contract;')[0] || '';
    expect(dock).toContain('className="music-dock-queue');
    expect(dock).toContain('<List size={20}');
    expect(dock).toContain('aria-haspopup="dialog" aria-expanded={queueOpen}');
    expect(dock).toContain('onClick={onOpenQueue}');
    expect(app).toContain('queueCount={queue.length}');
    expect(app).toContain('queueOpen={queueSheetOpen}');
    expect(app).not.toContain("['queue', '播放队列']");
    expect(app).not.toContain("section === 'queue'");
  });
  it('播放列表底部弹层操作真实 MusicContext 队列，支持切歌、排序、移除、清空', () => {
    expect(app).toContain('queue={queue} activeIndex={idx} playing={playing} loading={loadingSong}');
    expect(app).toContain('onMove={moveQueueSong} onRemove={removeQueueSong}');
    expect(app).toContain('onClearUpcoming={clearUpcomingQueue}');
    expect(app).toContain('else { void playSong(song);');
    expect(queueSheet).toContain('role="dialog" aria-modal="true"');
    expect(queueSheet).toContain('role="list" aria-label="当前播放队列"');
    expect(queueSheet).toContain("e.target.value === 'up'");
    expect(queueSheet).toContain("e.target.value === 'down'");
    expect(queueSheet).toContain("e.target.value === 'remove'");
    expect(queueSheet).toContain('onClearUpcoming(); setConfirmClear(false)');
    expect(profile).toContain('onOpenQueue={onOpenQueue}');
    expect(app).toContain('queueOpen={queueSheetOpen}');
    expect(queueSheet).toContain('disabled={selected}');
    expect(queueSheet).toContain("e.key === 'Escape'");
    expect(queueSheet).toContain('env(safe-area-inset-bottom');
    expect(queueSheet).toContain('Math.min(activeIndex - 6, queue.length - pageSize)');
    expect(queueSheet).toContain('queue.slice(start, end)');
    expect(queueSheet).toContain('查看前面的歌曲');
    expect(queueSheet).toContain('查看后面的歌曲');
  });
  it('本地歌单仍有独立整理菜单，不再平铺三颗操作按钮', () => {
    expect(app).toContain('aria-label={`管理歌单歌曲');
    expect(app).toContain('movePlaylistSong(playlistId, i, i - 1)');
    expect(app).toContain('removeSongFromPlaylist(playlistId, musicSongKey(song))');
  });
  it('歌曲操作收在紧凑行，封面保留 48px 的易辨识尺寸', () => {
    expect(app).toContain('className="flex items-center min-w-0"');
    expect(app).toContain('className="flex items-center gap-0 shrink-0 pr-1"');
    expect(app).toContain('className="pl-[62px] pb-1.5 -mt-0.5 text-[10px] leading-tight truncate"');
    expect(ui).toContain('w-12 h-12 overflow-hidden rounded-[11px]');
    expect(ui).toContain('gap-3 px-2.5 py-1.5');
  });
  it('切歌不重建播放器，也不跳转页面；完整播放页有同一个列表入口', () => {
    expect(app).toContain('onOpenQueue={() => { setQueueSheetOpen(true); trackEvent(\'从完整播放器打开播放列表\'); }}');
    expect(ui).toContain('onOpenQueue && <Item label="播放列表"');
    expect(queueSheet).toContain('onClick={() => onSelect(song, index)}');
    expect(queueSheet).not.toContain('new Audio(');
  });
  it('切到喜欢/歌单/历史时隐藏无关搜索栏，手机小屏保留队列入口', () => {
    expect(app).toContain("section === 'results' && <>");
    expect(app).toContain('void doSearch(src)');
    expect(app).toContain("const source = sourceOverride || searchSource");
    expect(ui).toContain('@media(max-width:380px)');
    expect(ui).toContain('music-dock-previous{display:none}');
    expect(ui).toContain('music-dock-queue');
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


describe('歌单交互与移动端可用性', () => {
  it('歌曲行一直可直接打开歌单弹层，无需预先创建歌单', () => {
    expect(app).toContain('setPlaylistSheetSong(song)');
    expect(app).toContain('aria-haspopup="dialog"');
    expect(app).toContain('className="music-icon-press w-9 h-10 rounded-full');
    expect(app).toContain('{playlistSheetSong && <MusicPlaylistSheet');
    expect(app).not.toContain('library.playlists.length > 0 && <div className="relative w-8 h-8');
    expect(playlistSheet).toContain('role="dialog" aria-modal="true"');
    expect(playlistSheet).toContain('min-h-[54px]');
    expect(playlistSheet).toContain('env(safe-area-inset-bottom');
  });

  it('可选择既有歌单，也能一次创建并把当前歌加入', () => {
    expect(playlistSheet).toContain('新建歌单并加入这首歌');
    expect(playlistSheet).toContain('onCreateAndAdd(name.trim())');
    expect(playlistSheet).toContain('if (onAdd(pl.id)) onClose()');
    expect(playlistSheet).toContain('disabled={already || full}');
    expect(app).toContain('createPlaylistWithSong(name, playlistSheetSong)');
    expect(app).toContain('if (!playlist || !addSongToPlaylist(id, playlistSheetSong)) return false;');
    expect(playlistSheet).toContain("e.key === 'Enter' && !e.nativeEvent.isComposing");
    expect(playlistSheet).toContain("e.key === 'Escape'");
  });

  it('重命名在歌单卡片内完成，写入失败保留编辑内容', () => {
    expect(app).toContain('const [editingPlaylist, setEditingPlaylist]');
    expect(app).toContain('renamePlaylist(editingPlaylist.id, name)');
    expect(app).toContain('editingPlaylist?.id === pl.id');
    expect(app).toContain('aria-label={`编辑《${pl.name}》的新名称`}');
    expect(app).not.toContain("window.prompt('修改歌单名称'");
    expect(app).toContain('编辑歌单名称');
    expect(app).toContain('取消</button>');
  });
  it('删除歌单在卡片中确认，失败时不关闭也不谎报删除成功', () => {
    expect(app).not.toContain('window.confirm(');
    expect(app).toContain('deleteConfirmPlaylistId === pl.id');
    expect(app).toContain('if (deletePlaylist(pl.id))');
    expect(app).toContain('不会删除已喜欢的歌曲');
    expect(app).toContain('确认删除');
  });
});

describe('高级感灰阶排版与播放交互回归', () => {
  it('首页使用浅色层次、柔和音源选项，不恢复粉彩或深色巨型标题', () => {
    expect(app).toContain('SULLY / AUDIO');
    expect(app).toContain('我的私人曲库');
    expect(app).toContain('text-[25px] font-semibold');
    expect(app).toContain("background: searchSource === src ? '#eaeae8' : 'transparent'");
    expect(app).toContain('music-editorial-shell absolute inset-0');
    expect(ui).toContain('.music-editorial-shell .music-track-row');
  });
  it('浅色悬浮播放器不再是大黑条，详情和播控仍是独立按钮', () => {
    const dock = ui.split('export const MiniPlayer:')[1]?.split('// Same public component contract;')[0] || '';
    expect(dock).toContain('className="music-dock');
    expect(ui).toContain('.music-dock{background:#fff;border:1px solid #e9e9e6');
    expect(ui).toContain('box-shadow:0 6px 23px rgba(34,34,34,.09)');
    expect(dock).not.toContain("background: '#171717'");
    expect(dock).toContain('className="music-dock-open music-tap"');
    expect(dock).toContain('onClick={onTap}');
    expect(dock).toContain('onClick={onToggle}');
    expect(dock).toContain('onClick={onOpenQueue}');
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
    expect(ui).toContain("bg: '#f7f7f6'");
    expect(ui).not.toContain('#7163c9');
    expect(ui).not.toContain('#bd6da5');
    expect(ui).not.toContain('shizuku-twinkle');
    expect(ui).not.toContain('@keyframes shizuku-float');
    expect(app).toContain('title="MUSIC"');
    expect(app).not.toContain('rgba(255,222,237');
  });
  it('方形专辑封面、柔和列表、深色播放键与无粒子背景保持一致', () => {
    const cover = ui.split('export const VinylDisc:')[1]?.split('export const MetaChip:')[0] || '';
    expect(cover).toContain('rounded-md overflow-hidden');
    expect(cover).not.toContain('shizuku-vinyl');
    expect(cover).not.toContain('<Sparkle');
    expect(ui).toContain('No animated particles, colored halos');
    expect(ui).toContain('background: C.primary');
    expect(app).toContain("border: '1px solid #ebebe9'");
    expect(app).toContain('className="music-track-row rounded-[17px]');
    expect(ui).toContain('rounded-[21px] px-3.5 pt-2.5 pb-3.5');
  });
  it('切换成简约风也不能丢失搜索、播控、播放进度与无障碍操作', () => {
    expect(ui).toContain('aria-label="搜索歌曲或歌手"');
    expect(ui).toContain('aria-busy={isActive && isLoading}');
    expect(ui).toContain('aria-label="播放进度"');
    expect(ui).toContain("e.key === 'ArrowRight'");
    expect(ui).toContain('onKick(main.id)');
    expect(ui).toContain('getGuestMusicCover({ albumPic, picId, source })');
  });
  it('登录和个人页移除玻璃糖果式圆角与渐变，二维码和头像仍可显示', () => {
    expect(login).toContain('aria-pressed={mode === t.k}');
    expect(login).toContain('border-b-2 transition-colors');
    expect(login).not.toContain('rounded-3xl p-4 shizuku-glass-strong');
    expect(profile).toContain('rounded-sm p-4 shizuku-glass-strong');
    expect(profile).toContain('object-cover grayscale');
    expect(profile).not.toContain('linear-gradient(135deg, ${C.faint}');
    expect(profile).toContain('<LocalAlbumCard');
  });
  it('账号页与登录页也使用灰阶，不残留紫粉渐变按钮', () => {
    expect(profile).not.toContain('#e0b88a');
    expect(login).not.toContain('linear-gradient(135deg, ${C.primary}, ${C.accent})');
    expect(login).not.toContain('linear-gradient(180deg, #ffffff');
  });
});


describe('第二轮轻量化音乐详情与歌单交互回归', () => {
  it('播放页封面随短屏缩放，保留歌词滚动、进度与播控', () => {
    expect(app).toContain('music-now-playing flex flex-col h-full');
    expect(app).toContain('className="music-player-art"');
    expect(app).toContain('size={188} bitrate={actualQualityLabel}');
    expect(ui).toContain('@media(max-height:700px)');
    expect(ui).toContain('@media(max-height:580px)');
    expect(app).toContain('ref={lyricBoxRef}');
    expect(app).toContain('music-player-lyrics flex-1');
    expect(app).toContain('onSeek={seek}');
    expect(app).toContain('onToggle={togglePlay}');
    expect(app).toContain('onOpenQueue={() => { setQueueSheetOpen(true)');
  });
  it('本地歌单使用真实首曲封面，所有更名、删除与顺序播放回调保持不变', () => {
    expect(app).toContain('pl.songs[0].albumPic');
    expect(app).toContain('pl.songs[0].source');
    expect(app).toContain('我的本地歌单 · {pl.songs.length} 首');
    expect(app).toContain('rounded-[20px] p-2.5');
    expect(app).toContain('setEditingPlaylist(editingPlaylist?.id === pl.id');
    expect(app).toContain('setDeleteConfirmPlaylistId(deleteConfirmPlaylistId === pl.id');
    expect(app).toContain('if (deletePlaylist(pl.id))');
    expect(app).toContain('replaceQueue: pl.songs, startIdx: 0');
  });
  it('队列及歌单弹层共享轻色风格，触屏弹层和焦点保护仍然存在', () => {
    expect(queueSheet).toContain('rounded-t-[28px]');
    expect(playlistSheet).toContain('rounded-t-[28px]');
    expect(queueSheet).toContain('music-sheet-card my-1.5');
    expect(queueSheet).toContain('role="dialog" aria-modal="true"');
    expect(playlistSheet).toContain('role="dialog" aria-modal="true"');
    expect(queueSheet).toContain('env(safe-area-inset-bottom');
    expect(playlistSheet).toContain('env(safe-area-inset-bottom');
    expect(queueSheet).toContain('onClearUpcoming(); setConfirmClear(false)');
    expect(playlistSheet).toContain('if (onAdd(pl.id)) onClose()');
  });
});
