
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useOS, DEFAULT_WALLPAPER, DEFAULT_PAPER_APPEARANCE } from '../context/OSContext';
import { AppID, OSTheme, AppearancePreset, Toast } from '../types';
import { INSTALLED_APPS, Icons } from '../constants';
import { processImage, processImageToBlob } from '../utils/file';
import { deleteBlobRef, putImageBlob, useBlobRefUrl } from '../utils/blobRef';
import TokenImg from '../components/os/TokenImg';
import {
    companionAvatarSource,
    companionSkinSetPatchValue,
    hasDatePortraits,
    listCompanionDateOutfits,
    normalizeCompanionSkinSetId,
} from '../utils/companionAvatar';
import { DB } from '../utils/db';
import { resolveStatusBarMode, type StatusBarMode } from '../utils/iosStandalone';
import { confirmExportSafety } from '../utils/exportGuard';
import { trackEvent } from '../utils/analytics';
import { Check, ImageSquare, Sparkle, Trash, UploadSimple } from '@phosphor-icons/react';
import AppIconEditor from '../components/appearance/AppIconEditor';
import FullscreenSettings from '../components/appearance/FullscreenSettings';
import { shareOrDownloadBlob } from '../utils/shareExport';
import { readShareFile } from '../utils/pngShare';
import BeautyShareChannel from '../components/appearance/BeautyShareChannel';
import { hasBeautyReceiveRequest,hasBeautyLibraryRequest } from '../utils/beautyNavigation';

const CustomIconImage: React.FC<{ value: string; alt: string; preserveOutline?: boolean }> = ({ value, alt, preserveOutline = false }) => {
    const url = useBlobRefUrl(value);
    return url ? <img src={url} className={`w-full h-full ${preserveOutline ? 'object-contain' : 'object-cover rounded-2xl'}`} alt={alt} /> : null;
};

const CompanionPortraitPreview: React.FC<{ value?: string; alt: string }> = ({ value, alt }) => {
    const url = useBlobRefUrl(value);
    return url ? <img src={url} className="h-full w-full object-contain" alt={alt} /> : <ImageSquare size={28} className="text-slate-300" />;
};

/**
 * 这个令牌还挂在衣柜里吗？
 *
 * 桌面静态形象的令牌是「顶层 imageRef 指着现在穿的那套，衣柜里同时留着一条同令牌的条目」
 * （utils/companionWardrobe.ts 拿令牌当条目 id 认亲，id 与 imageRef 两个值位同值）。
 * 所以换图 / 移除时不能无条件删旧 Blob——衣柜里还留着的话，那套旧衣服就再也切不回去了。
 */
const isCompanionOutfitKeptInWardrobe = (
    companionAvatar: { imageWardrobe?: unknown } | undefined,
    ref: string,
): boolean => {
    const wardrobe = companionAvatar?.imageWardrobe;
    if (!Array.isArray(wardrobe)) return false;
    return wardrobe.some((outfit: any) => outfit?.imageRef === ref || outfit?.id === ref);
};

// Touch-friendly long-press wrapper. `onContextMenu` alone misses iOS Safari /
// Capacitor WebView, so we also wire pointer/touch timers to fire after ~550ms.
// When a long-press fires, the subsequent click is suppressed.
const LongPressArea: React.FC<{
    onLongPress: () => void;
    onClick?: () => void;
    delay?: number;
    className?: string;
    style?: React.CSSProperties;
    children?: React.ReactNode;
}> = ({ onLongPress, onClick, delay = 550, className, style, children }) => {
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const fired = useRef(false);
    const startPos = useRef<{ x: number; y: number } | null>(null);

    const clear = useCallback(() => {
        if (timer.current) { clearTimeout(timer.current); timer.current = null; }
        startPos.current = null;
    }, []);

    useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

    const start = (x: number, y: number) => {
        fired.current = false;
        startPos.current = { x, y };
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
            fired.current = true;
            onLongPress();
        }, delay);
    };
    const move = (x: number, y: number) => {
        const sp = startPos.current;
        if (!sp) return;
        if (Math.hypot(x - sp.x, y - sp.y) > 8) clear();
    };

    return (
        <div
            className={className}
            style={style}
            onContextMenu={(e) => { e.preventDefault(); onLongPress(); }}
            onTouchStart={(e) => { const t = e.touches[0]; if (t) start(t.clientX, t.clientY); }}
            onTouchMove={(e) => { const t = e.touches[0]; if (t) move(t.clientX, t.clientY); }}
            onTouchEnd={clear}
            onTouchCancel={clear}
            onPointerDown={(e) => { if (e.pointerType !== 'touch') start(e.clientX, e.clientY); }}
            onPointerMove={(e) => { if (e.pointerType !== 'touch') move(e.clientX, e.clientY); }}
            onPointerUp={clear}
            onPointerLeave={clear}
            onPointerCancel={clear}
            onClick={() => {
                if (fired.current) { fired.current = false; return; }
                onClick?.();
            }}
        >
            {children}
        </div>
    );
};

// --- 桌面整机风格（皮肤）---
const COMPANION_WALLPAPER = 'radial-gradient(90% 65% at 50% 5%, #6c5a91 0%, transparent 62%), radial-gradient(75% 55% at 100% 50%, #382e5b 0%, transparent 72%), linear-gradient(180deg, #211a36 0%, #100d1c 62%, #080711 100%)';

type DesktopSkinOption = { id: string; name: string; desc: string; swatch: string; config: Partial<OSTheme> };

const DESKTOP_SKINS: DesktopSkinOption[] = [
  {
    id: 'homely',
    name: '居家',
    desc: '小屋日常同步 · 面对面聊天 · 家园小手机',
    swatch: 'linear-gradient(90deg,#ebc2a1 0%,#f4dfcc 48%,#faf3e7 48%,#fffaf2 100%)',
    config: { skin: 'homely', wallpaper: 'linear-gradient(180deg,#faf3e7,#ebc2a1)', contentColor: '#695344' },
  },
  {
    id: 'companion',
    name: '触感陪伴',
    desc: '角色占据桌面 · 一次生成反馈包 · 轻触后本地轮播演出',
    swatch: 'radial-gradient(circle at 50% 25%,#a993d3 0%,#51436f 42%,#171222 100%)',
    config: {
      skin: 'companion',
      hue: 267, saturation: 46, lightness: 64,
      contentColor: '#f6efff',
      wallpaper: COMPANION_WALLPAPER,
    },
  },
  {
    id: 'default',
    name: '黑白灰 · 当前桌面',
    desc: '黑白灰 INS 桌面 · 对应当前黑胶与拍立得布局',
    swatch: DEFAULT_WALLPAPER,
    config: {
      skin: 'default',
      ...DEFAULT_PAPER_APPEARANCE,
      wallpaper: DEFAULT_WALLPAPER,
    },
  },
];

/**
 * 预设卡片顶部那条缩略图（壁纸打底 + 两个色块 + 装饰数量角标）。
 *
 * 预设是直接从 assets 表读出来的 JSON，没走 OSContext 那层壁纸解析，所以
 * `theme.wallpaper` 很可能还是个 `blobref:` 令牌，直接拼进 CSS 的 url() 加载不出来。
 * 这里过一道 useBlobRefUrl 把令牌换成 objectURL —— 它对 data: / http(s) / 渐变这类
 * 非令牌值是渲染期原样透传的，所以只有令牌会真的去读盘。
 * 因为 hook 不能写在 map 回调里，这块预览单独抽成组件，一个预设一份解析和回收。
 */
const PresetPreview: React.FC<{ preset: AppearancePreset }> = ({ preset }) => {
    const { lightness, contentColor, wallpaper } = preset.theme;
    const resolvedWallpaper = useBlobRefUrl(wallpaper);

    const themeGradient = `linear-gradient(135deg, hsl(0, 0%, ${lightness}%), hsl(0, 0%, ${Math.max(lightness - 15, 10)}%))`;
    const isCssGradient = !!wallpaper
        && (wallpaper.startsWith('linear-gradient') || wallpaper.startsWith('radial-gradient') || wallpaper.startsWith('conic-gradient'));

    // 没设壁纸 → 主题色兜底；壁纸本身就是 CSS 渐变 → 原样用；否则当图片铺进 url()。
    // 令牌还在读盘、或者图已经丢了时 resolvedWallpaper 是 undefined，同样退回主题色，
    // 免得渲染出一个 url("undefined")。
    let background: string;
    if (!wallpaper) background = themeGradient;
    else if (isCssGradient) background = wallpaper;
    else background = resolvedWallpaper ? `url("${resolvedWallpaper}") center/cover` : themeGradient;

    return (
        <div className="h-14 relative overflow-hidden" style={{ background }}>
            <div className="absolute inset-0 bg-black/10" />
            <div className="absolute bottom-1.5 left-3 flex gap-1">
                <div className="w-4 h-4 rounded-full" style={{ backgroundColor: `hsl(0, 0%, ${lightness}%)` }} />
                <div className="w-4 h-4 rounded-full" style={{ backgroundColor: contentColor || '#ffffff' }} />
            </div>
        </div>
    );
};

// --- Preset Manager Component ---
interface PresetManagerProps {
    presets: AppearancePreset[];
    onSave: (name: string) => void;
    onApply: (id: string) => void;
    onDelete: (id: string) => void;
    onRename: (id: string, name: string) => void;
    onExport: (id: string) => Promise<Blob>;
    onImport: (file: File) => Promise<unknown>;
    addToast: (msg: string, type?: Toast['type']) => void;
    currentTheme: OSTheme;
}

const PresetManager: React.FC<PresetManagerProps> = ({ presets, onSave, onApply, onDelete, onRename, onExport, onImport, addToast, currentTheme }) => {
    const [newName, setNewName] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const importRef = useRef<HTMLInputElement>(null);

    const handleSave = () => {
        const name = newName.trim() || `预设 ${new Date().toLocaleDateString('zh-CN')}`;
        onSave(name);
        setNewName('');
    };

    const handleExport = async (id: string) => {
        try {
            const preset = presets.find(p => p.id === id);
            // 导出前明文密钥体检 + 二次确认（外观预设正常不含密钥 → 提示「安全，可分享」）。
            if (!(await confirmExportSafety(preset))) return;
            const blob = await onExport(id);
            const fileName = `appearance_${preset?.name || 'preset'}.zip`;
            const title = `外观预设 - ${preset?.name || 'preset'}`;

            const result = await shareOrDownloadBlob({ blob, fileName, shareTitle: title, card: { kind: 'appearance', title: preset?.name || '外观预设' } });
            if (result === 'cancelled') return;
            addToast(result === 'shared' ? '已打开预设分享面板' : '预设已导出', 'success');
        } catch (e: any) {
            addToast(e.message || '导出失败', 'error');
        }
    };

    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            await onImport(await readShareFile(file, 'appearance'));
            trackEvent('导入外观预设文件');
        } catch (err: any) {
            addToast(err.message || '导入失败', 'error');
        }
        if (importRef.current) importRef.current.value = '';
    };

    const handleRename = (id: string) => {
        if (editName.trim()) {
            onRename(id, editName.trim());
        }
        setEditingId(null);
        setEditName('');
    };

    return (
        <div className="space-y-5">
            {/* Save Current */}
            <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-3">保存当前外观</h2>
                <p className="text-[10px] text-slate-400 mb-3">将当前的主题色、壁纸、字体、图标等外观保存为预设，方便随时切换。</p>
                <div className="flex gap-2">
                    <input
                        value={newName}
                        onChange={e => setNewName(e.target.value)}
                        placeholder="预设名称（可选）"
                        className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs outline-none focus:border-primary transition-all"
                        onKeyDown={e => e.key === 'Enter' && handleSave()}
                    />
                    <button onClick={handleSave}
                        className="px-5 py-2.5 bg-primary text-white font-bold text-xs rounded-xl shadow-md active:scale-95 transition-transform shrink-0">
                        保存
                    </button>
                </div>
            </section>

            {/* Import */}
            <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-3">导入外观预设</h2>
                
                <input type="file" ref={importRef} className="hidden" accept=".png,.zip,.json,image/png,application/zip,application/json" onChange={handleImport} />
                <button onClick={() => importRef.current?.click()}
                    className="w-full py-2.5 bg-gradient-to-r from-neutral-50 to-neutral-50 text-neutral-500 font-bold text-xs rounded-xl border border-neutral-200 active:scale-95 transition-transform flex items-center justify-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                    选择文件导入
                </button>
            </section>

            {/* Preset List */}
            <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-3">已保存预设 ({presets.length})</h2>
                {presets.length === 0 ? (
                    <div className="text-center py-8">
                        <div className="text-3xl mb-2 opacity-40">
                            <Sparkle size={48} weight="fill" className="mx-auto text-slate-300" />
                        </div>
                        <p className="text-xs text-slate-400">还没有外观预设</p>
                        <p className="text-[10px] text-slate-300 mt-1">保存当前外观或导入预设文件开始使用</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {presets.map(preset => (
                            <div key={preset.id} className="bg-slate-50 rounded-2xl border border-slate-100 overflow-hidden">
                                {/* Preview bar */}
                                <PresetPreview preset={preset} />

                                {/* Info & actions */}
                                <div className="p-3">
                                    {editingId === preset.id ? (
                                        <div className="flex gap-2 mb-2">
                                            <input
                                                value={editName}
                                                onChange={e => setEditName(e.target.value)}
                                                className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs outline-none focus:border-primary"
                                                autoFocus
                                                onKeyDown={e => { if (e.key === 'Enter') handleRename(preset.id); if (e.key === 'Escape') setEditingId(null); }}
                                            />
                                            <button onClick={() => handleRename(preset.id)} className="px-3 py-1.5 bg-primary text-white text-[10px] font-bold rounded-lg">确定</button>
                                            <button onClick={() => setEditingId(null)} className="px-3 py-1.5 bg-slate-100 text-slate-500 text-[10px] font-bold rounded-lg">取消</button>
                                        </div>
                                    ) : (
                                        <div className="flex items-center justify-between mb-2">
                                            <div>
                                                <div className="text-xs font-bold text-slate-700">{preset.name}</div>
                                                <div className="text-[9px] text-slate-400">{new Date(preset.createdAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex gap-1.5 flex-wrap">
                                        <button onClick={() => { onApply(preset.id); trackEvent('应用已保存外观预设'); }}
                                            className="px-3 py-1.5 bg-primary text-white text-[10px] font-bold rounded-lg active:scale-95 transition-transform shadow-sm">
                                            应用
                                        </button>
                                        <button onClick={() => handleExport(preset.id)}
                                            className="px-3 py-1.5 bg-neutral-50 text-neutral-600 text-[10px] font-bold rounded-lg border border-neutral-200 active:scale-95 transition-transform">
                                            导出
                                        </button>
                                        <button onClick={() => { setEditingId(preset.id); setEditName(preset.name); }}
                                            className="px-3 py-1.5 bg-slate-100 text-slate-500 text-[10px] font-bold rounded-lg border border-slate-200 active:scale-95 transition-transform">
                                            重命名
                                        </button>
                                        {confirmDeleteId === preset.id ? (
                                            <div className="flex gap-1">
                                                <button onClick={() => { onDelete(preset.id); setConfirmDeleteId(null); }}
                                                    className="px-3 py-1.5 bg-neutral-500 text-white text-[10px] font-bold rounded-lg active:scale-95 transition-transform">
                                                    确认删除
                                                </button>
                                                <button onClick={() => setConfirmDeleteId(null)}
                                                    className="px-3 py-1.5 bg-slate-100 text-slate-500 text-[10px] font-bold rounded-lg active:scale-95 transition-transform">
                                                    取消
                                                </button>
                                            </div>
                                        ) : (
                                            <button onClick={() => setConfirmDeleteId(preset.id)}
                                                className="px-3 py-1.5 bg-neutral-50 text-neutral-400 text-[10px] font-bold rounded-lg border border-neutral-200 active:scale-95 transition-transform">
                                                删除
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <div className="text-[10px] text-slate-400 text-center px-4 pb-4">
                外观预设既可以单独导入/导出，也会随系统整合备份一起保存。你可以保存多个预设并随时切换。
            </div>
        </div>
    );
};

const Appearance: React.FC = () => {
  const { theme, updateTheme, closeApp, openApp, setCustomIcon, customIcons, addToast, appearancePresets, saveAppearancePreset, applyAppearancePreset, deleteAppearancePreset, renameAppearancePreset, exportAppearancePreset, importAppearancePreset, characters, activeCharacterId, updateCharacter } = useOS();
  const [activeTab, setActiveTab] = useState<'theme' | 'icons' | 'presets' | 'sharing'>(() => (hasBeautyReceiveRequest()||hasBeautyLibraryRequest()) ? 'sharing' : 'theme');
  useAppShortcut(ShortcutAppID.Appearance, intent => setActiveTab((intent.entryId || 'theme') as typeof activeTab));
  const [shareBusy, setShareBusy] = useState(false);
  const wallpaperInputRef = useRef<HTMLInputElement>(null);
  const [wallpaperUrl, setWallpaperUrl] = useState('');
  const lockWallpaperInputRef = useRef<HTMLInputElement>(null);
  const [lockWallpaperUrl, setLockWallpaperUrl] = useState('');
  const widgetInputRef = useRef<HTMLInputElement>(null);
  const [activeWidgetSlot, setActiveWidgetSlot] = useState<string | null>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const fontInputRef = useRef<HTMLInputElement>(null);
  const companionPortraitInputRef = useRef<HTMLInputElement>(null);
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  
  // Font State
  const [fontMode, setFontMode] = useState<'local' | 'web'>('local');
  const [webFontUrl, setWebFontUrl] = useState('');

  const appearanceCharacter = characters.find(character => character.id === activeCharacterId) || characters[0];
  const companionSource = companionAvatarSource(appearanceCharacter);
  const companionDateOutfits = listCompanionDateOutfits(appearanceCharacter);
  const selectedCompanionOutfitId = normalizeCompanionSkinSetId(appearanceCharacter?.companionAvatar?.skinSetId);
  const selectedCompanionOutfit = companionDateOutfits.find(outfit => outfit.id === selectedCompanionOutfitId)
      || companionDateOutfits[0];
  const companionPreview = companionSource === 'upload'
      ? appearanceCharacter?.companionAvatar?.imageRef
      : companionSource === 'date' ? selectedCompanionOutfit?.preview : appearanceCharacter?.avatar;

  const chooseCompanionSource = (source: 'model' | 'upload' | 'date') => {
      if (!appearanceCharacter) {
          addToast('请先创建并选择一个角色', 'error');
          return;
      }
      if (source === 'upload' && !appearanceCharacter.companionAvatar?.imageRef) {
          companionPortraitInputRef.current?.click();
          return;
      }
      if (source === 'date' && !hasDatePortraits(appearanceCharacter)) {
          addToast('这个角色还没有见面立绘，请先去见面模式添加', 'info');
          openApp(AppID.Date);
          return;
      }
      updateCharacter(appearanceCharacter.id, {
          companionAvatar: {
              version: 1,
              ...appearanceCharacter.companionAvatar,
              source,
          },
      });
      trackEvent('切换桌面陪伴形象来源', {
          来源: source === 'model' ? '动态模型' : source === 'upload' ? '静态图片' : '见面立绘',
      });
      addToast(source === 'model' ? '桌面已使用动态模型' : source === 'date' ? '已沿用见面模式立绘' : '已使用导入图片', 'success');
  };

  const handleCompanionPortraitUpload = async (file: File) => {
      if (!appearanceCharacter) return;
      const extension = file.name.split('.').pop()?.toLowerCase();
      if (!['png', 'gif'].includes(extension || '') || !['image/png', 'image/gif'].includes(file.type)) {
          addToast('图片上传仅支持 PNG / GIF', 'error');
          return;
      }
      if (file.size > 20 * 1024 * 1024) {
          addToast('图片超过 20 MB，请压缩后再导入', 'error');
          return;
      }
      try {
          const previousRef = appearanceCharacter.companionAvatar?.imageRef;
          const imageRef = await putImageBlob(file);
          updateCharacter(appearanceCharacter.id, {
              companionAvatar: {
                  version: 1,
                  ...appearanceCharacter.companionAvatar,
                  source: 'upload',
                  imageRef,
                  fileName: file.name,
                  mimeType: file.type,
                  importedAt: Date.now(),
              },
          });
          if (previousRef && previousRef !== imageRef
              && !isCompanionOutfitKeptInWardrobe(appearanceCharacter.companionAvatar, previousRef)) {
              await deleteBlobRef(previousRef);
          }
          trackEvent('导入桌面静态形象', { 格式: file.type === 'image/gif' ? 'GIF' : 'PNG' });
          addToast(file.type === 'image/gif' ? 'GIF 已原样导入，动画会保留' : 'PNG 形象已导入', 'success');
      } catch (error: any) {
          addToast(error?.message || '图片形象导入失败', 'error');
      }
  };

  const chooseCompanionOutfit = (outfitId: string) => {
      if (!appearanceCharacter) return;
      updateCharacter(appearanceCharacter.id, {
          companionAvatar: {
              version: 1,
              ...appearanceCharacter.companionAvatar,
              source: 'date',
              skinSetId: companionSkinSetPatchValue(outfitId),
          },
      });
      trackEvent('切换桌面见面立绘衣服');
      addToast('桌面衣服已切换，见面模式的选择不会被改动', 'success');
  };

  const removeCompanionUpload = async () => {
      if (!appearanceCharacter?.companionAvatar?.imageRef) return;
      const previousRef = appearanceCharacter.companionAvatar.imageRef;
      updateCharacter(appearanceCharacter.id, {
          companionAvatar: {
              ...appearanceCharacter.companionAvatar,
              source: hasDatePortraits(appearanceCharacter) ? 'date' : 'model',
              imageRef: undefined,
              fileName: undefined,
              mimeType: undefined,
              importedAt: undefined,
          },
      });
      if (!isCompanionOutfitKeptInWardrobe(appearanceCharacter.companionAvatar, previousRef)) {
          await deleteBlobRef(previousRef);
      }
      trackEvent('移除桌面静态形象');
      addToast('已移除导入图片', 'success');
  };

  const THEME_PRESETS: { name: string, config: Partial<OSTheme>, color: string }[] = [
      { name: 'Indigo', config: { hue: 245, saturation: 25, lightness: 65, contentColor: '#ffffff' }, color: 'hsl(245, 25%, 65%)' },
      { name: 'Sakura', config: { hue: 350, saturation: 70, lightness: 80, contentColor: '#3f3f3f' }, color: 'hsl(350, 70%, 80%)' },
      { name: 'Cyber', config: { hue: 170, saturation: 100, lightness: 45, contentColor: '#ffffff' }, color: 'hsl(170, 100%, 45%)' },
      { name: 'Noir', config: { hue: 0, saturation: 0, lightness: 20, contentColor: '#ffffff' }, color: 'hsl(0, 0%, 20%)' },
      { name: 'Sunset', config: { hue: 20, saturation: 90, lightness: 60, contentColor: '#ffffff' }, color: 'hsl(20, 90%, 60%)' },
  ];

  const handleWallpaperUpload = async (file: File) => {
      try {
          addToast('正在处理壁纸 (原画质)...', 'info');
          // 改存 Blob：原画质不重绘，二进制进 blob_assets，字段只存 blobref 令牌（省 ~33% 空间、不占 JS 堆）。
          const blob = await processImageToBlob(file, { skipCompression: true });
          const ref = await putImageBlob(blob);
          await updateTheme({ wallpaper: ref });
          addToast('壁纸更新成功', 'success');
      } catch (e: any) {
          addToast(e.message, 'error');
      }
  };

  const applyWallpaperUrl = async () => {
      const url = wallpaperUrl.trim();
      if (!url) return;
      if (!/^https?:\/\//i.test(url) && !url.startsWith('data:') && !url.startsWith('blob:')) {
          addToast('请填写以 http(s):// 开头的图片地址', 'error');
          return;
      }
      await updateTheme({ wallpaper: url });
      setWallpaperUrl('');
      addToast('壁纸已应用', 'success');
  };

  const handleLockWallpaperUpload = async (file: File) => {
      try {
          addToast('正在处理锁屏壁纸 (原画质)...', 'info');
          const blob = await processImageToBlob(file, { skipCompression: true });
          const ref = await putImageBlob(blob);
          await updateTheme({ lockWallpaper: ref });
          addToast('锁屏壁纸更新成功', 'success');
      } catch (e: any) {
          addToast(e.message, 'error');
      }
  };

  const applyLockWallpaperUrl = async () => {
      const url = lockWallpaperUrl.trim();
      if (!url) return;
      if (!/^https?:\/\//i.test(url) && !url.startsWith('data:') && !url.startsWith('blob:')) {
          addToast('请填写以 http(s):// 开头的图片地址', 'error');
          return;
      }
      await updateTheme({ lockWallpaper: url });
      setLockWallpaperUrl('');
      addToast('锁屏壁纸已应用', 'success');
  };

  const handleWidgetUpload = async (file: File) => {
      if (!activeWidgetSlot) return;
      try {
          const maxW = activeWidgetSlot === 'wide' ? 800 : activeWidgetSlot === 'dsq' ? 600 : 500;
          const blob = await processImageToBlob(file, { maxWidth: maxW, quality: 0.9 });
          const ref = await putImageBlob(blob);
          const current = theme.launcherWidgets || {};
          updateTheme({ launcherWidgets: { ...current, [activeWidgetSlot]: ref } });
          addToast('小组件已更新', 'success');
      } catch (e: any) {
          addToast(e.message, 'error');
      }
  };

  const removeWidget = (slot: string) => {
      const current = { ...(theme.launcherWidgets || {}) };
      delete current[slot];
      updateTheme({ launcherWidgets: Object.keys(current).length > 0 ? current : undefined });
  };

  const handleFontUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      
      const allowedExts = ['.ttf', '.otf', '.woff', '.woff2'];
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      
      if (!allowedExts.includes(ext)) {
          addToast('仅支持 ttf/otf/woff/woff2 格式', 'error');
          return;
      }

      addToast('正在处理字体文件...', 'info');
      
      const reader = new FileReader();
      reader.onload = async (ev) => {
          try {
              const dataUrl = ev.target?.result as string;
              updateTheme({ customFont: dataUrl });
              addToast('系统字体已更新', 'success');
          } catch(err) {
              addToast('字体加载失败', 'error');
          }
      };
      reader.onerror = () => addToast('读取失败', 'error');
      reader.readAsDataURL(file);
      
      // Clear input
      if (fontInputRef.current) fontInputRef.current.value = '';
  };

  const applyWebFont = () => {
      if (!webFontUrl.trim()) return;
      updateTheme({ customFont: webFontUrl.trim() });
      setWebFontUrl('');
      addToast('网络字体已应用', 'success');
  };

  // 切换桌面整机风格：只保留仍受支持的主题。
  // 壁纸处理：进入非默认主题前备份用户原壁纸（data URI 存 IndexedDB，渐变/URL 存 localStorage），
  // 切回默认时还原，避免覆盖用户自己设的桌面壁纸。
  const DESKTOP_WP_BACKUP_KEY = 'acnh_wallpaper_backup'; // Legacy key retained only to restore user wallpapers.
  const currentDesktopSkinId = DESKTOP_SKINS.some(skin => skin.id === theme.skin && skin.id !== 'default')
      ? theme.skin
      : 'default';
  const applyDesktopSkin = async (skin: DesktopSkinOption) => {
      const goingDefault = skin.id === 'default';
      const currentlyThemed = currentDesktopSkinId !== 'default';

      let wallpaper: string;
      if (!goingDefault) {
          // 非默认皮肤使用各自预设的壁纸
          wallpaper = (skin.config.wallpaper as string) || DEFAULT_WALLPAPER;
          // 仅从「默认 → 某皮肤」时备份一次用户原壁纸；皮肤之间互切不再覆盖备份，保住最初的用户壁纸
          if (!currentlyThemed) {
              const dbWp = await DB.getAsset('wallpaper'); // 用户若用 data URI 壁纸，真值在这
              const cur = dbWp || theme.wallpaper || '';
              if (cur && cur.startsWith('data:')) {
                  await DB.saveAsset('wallpaper_user_backup', cur);
                  localStorage.setItem(DESKTOP_WP_BACKUP_KEY, '__asset__');
              } else {
                  localStorage.setItem(DESKTOP_WP_BACKUP_KEY, cur);
                  await DB.deleteAsset('wallpaper_user_backup');
              }
          }
      } else {
          // 切回默认：还原备份的用户壁纸
          const marker = localStorage.getItem(DESKTOP_WP_BACKUP_KEY);
          if (marker === '__asset__') {
              wallpaper = (await DB.getAsset('wallpaper_user_backup')) || DEFAULT_WALLPAPER;
          } else if (marker !== null) {
              wallpaper = marker || DEFAULT_WALLPAPER; // 空字符串=用户原本就是默认
          } else {
              wallpaper = DEFAULT_WALLPAPER; // 没有备份记录（老用户首次切回）
          }
      }

      // skin.config 里写死的 wallpaper 不用，改用上面算出的（备份/还原后的）值
      const { wallpaper: _ignored, ...restConfig } = skin.config;
      await updateTheme({ ...restConfig, wallpaper });
      addToast(`已切换到「${skin.name}」`, 'success');
      trackEvent('切换桌面整机风格', { skin: skin.id });
  };

  const handleIconUpload = async (file: File) => {
      if (!selectedAppId) return;
      try {
          const blob = await processImageToBlob(file, { maxWidth: 512, quality: 0.92 });
          const ref = await putImageBlob(blob);
          await setCustomIcon(selectedAppId, ref);
          addToast('应用图标已更新', 'success');
      } catch (e: any) {
          addToast(e.message, 'error');
      }
  };

  return (
    <div className="h-full w-full bg-slate-50 flex flex-col font-light">
      {activeTab !== 'sharing' && <><div className="bg-white/70 backdrop-blur-md border-b border-white/40 shrink-0 z-10 sticky top-0" style={{ paddingTop: 'var(--safe-top)' }}>
        <div className="flex items-center px-4 py-3">
          <div className="flex items-center gap-2 w-full">
              <button disabled={shareBusy} onClick={closeApp} className="p-2 -ml-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-slate-600">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                  </svg>
              </button>
              <h1 className="text-xl font-medium text-slate-700 tracking-wide">外观定制</h1>
          </div>
        </div>
      </div>

      <fieldset disabled={shareBusy} className="flex border-0 border-b border-slate-200 bg-white sticky top-0 z-20 m-0 p-0 min-w-0">
          <button onClick={() => { setActiveTab('theme'); trackEvent('切换外观定制标签页', { tab: 'theme' }); }} className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'theme' ? 'text-primary border-b-2 border-primary' : 'text-slate-400'}`}>系统主题</button>
          <button onClick={() => { setActiveTab('icons'); trackEvent('切换外观定制标签页', { tab: 'icons' }); }} className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'icons' ? 'text-primary border-b-2 border-primary' : 'text-slate-400'}`}>应用图标</button>
          <button onClick={() => { setActiveTab('presets'); trackEvent('切换外观定制标签页', { tab: 'presets' }); }} className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'presets' ? 'text-primary border-b-2 border-primary' : 'text-slate-400'}`}>外观预设</button>
          <button onClick={() => setActiveTab('sharing')} className="flex-1 py-3 text-sm font-medium transition-colors text-slate-400">外观装扮</button>
      </fieldset></>}

      <div className={activeTab === 'sharing' ? 'flex-1 overflow-y-auto min-h-0 no-scrollbar' : 'flex-1 overflow-y-auto p-5 space-y-6 no-scrollbar'}>
        {activeTab === 'theme' ? (
            <>
                <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                    <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-1">动画与过场</h2>
                    
                    <div className="divide-y divide-slate-100">
                        {([
                            {
                                key: 'bootAnimationEnabled' as const,
                                title: '开机动画',
                                description: '启动 宝宝狗 时的整机入场过场。',
                            },
                            {
                                key: 'chatCharacterSwitchAnimationEnabled' as const,
                                title: '聊天切换角色动画',
                                description: '进入聊天或换角色时的头像登场过场。',
                            },
                            {
                                key: 'appLoadingAnimationEnabled' as const,
                                title: '进入 App 加载动画',
                                description: 'App 首次加载较慢时显示的柔光等待画面。',
                            },
                        ]).map(option => {
                            const enabled = theme[option.key] !== false;
                            return (
                                <div key={option.key} className="flex items-center gap-3 py-3">
                                    <div className="min-w-0 flex-1">
                                        <div className="text-xs font-bold text-slate-700">{option.title}</div>
                                        <div className="mt-0.5 text-[10px] leading-relaxed text-slate-400">{option.description}</div>
                                    </div>
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={enabled}
                                        aria-label={option.title}
                                        onClick={() => {
                                            updateTheme({ [option.key]: !enabled });
                                            trackEvent('设置外观动画', { animation: option.key, enabled: !enabled });
                                        }}
                                        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${enabled ? 'bg-primary' : 'bg-slate-300'}`}
                                    >
                                        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0'}`} style={{ left: 2 }} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </section>

                <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                    <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-1">桌面风格</h2>
                    
                    <div className="grid grid-cols-2 gap-3">
                        {DESKTOP_SKINS.map(skin => {
                            const active = currentDesktopSkinId === skin.id;
                            return (
                                <button
                                    key={skin.id}
                                    onClick={() => applyDesktopSkin(skin)}
                                    className={`relative text-left rounded-2xl p-3 border-2 transition-all active:scale-[0.98] ${active ? 'border-primary ring-2 ring-primary/20' : 'border-slate-200 hover:border-slate-300'}`}
                                >
                                    <div className="h-16 w-full rounded-xl mb-2 shadow-inner" style={{ background: skin.swatch }} />
                                    <div className="text-xs font-bold text-slate-700 flex items-center gap-1">
                                        {skin.name}
                                        {active && <span className="text-[9px] font-bold text-primary">· 当前</span>}
                                    </div>
                                    <div className="text-[9px] text-slate-400 mt-0.5 leading-snug">{skin.desc}</div>
                                </button>
                            );
                        })}
                    </div>
                </section>

                {currentDesktopSkinId === 'companion' && (
                    <section className="overflow-hidden rounded-3xl border border-neutral-100 bg-white shadow-sm" data-testid="companion-static-avatar-settings">
                        <input
                            ref={companionPortraitInputRef}
                            type="file"
                            className="hidden"
                            accept=".png,.gif,image/png,image/gif"
                            onChange={event => {
                                const file = event.target.files?.[0];
                                if (file) void handleCompanionPortraitUpload(file);
                                event.target.value = '';
                            }}
                        />
                        <div className="flex items-center gap-4 p-5">
                            <div className="flex h-24 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-b from-neutral-50 to-slate-100 p-1.5 shadow-inner">
                                <CompanionPortraitPreview value={companionPreview} alt={`${appearanceCharacter?.name || '角色'}桌面形象`} />
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <h2 className="text-sm font-bold text-slate-700">陪伴形象</h2>
                                    <span className="rounded-full bg-neutral-50 px-2 py-0.5 text-[8px] font-bold tracking-wide text-neutral-500">PNG / GIF</span>
                                </div>
                                <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
                                    桌面与视频通话共用这里的选择。单图保持原样；见面立绘会按 AI 情绪切换同套表情。
                                </p>
                                <button
                                    type="button"
                                    onClick={() => companionPortraitInputRef.current?.click()}
                                    className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-neutral-600 px-3 py-2 text-[10px] font-bold text-white active:scale-95"
                                >
                                    <UploadSimple size={13} weight="bold" /> {appearanceCharacter?.companionAvatar?.imageRef ? '更换图片' : '导入 PNG / GIF'}
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-3 border-y border-slate-100 bg-slate-50/80 p-1.5">
                            {([
                                ['model', '动态模型'],
                                ['upload', '图片 / GIF'],
                                ['date', '见面立绘'],
                            ] as const).map(([source, label]) => (
                                <button
                                    key={source}
                                    type="button"
                                    aria-pressed={companionSource === source}
                                    onClick={() => chooseCompanionSource(source)}
                                    className={`flex items-center justify-center gap-1 rounded-xl px-2 py-2 text-[10px] font-semibold transition ${companionSource === source ? 'bg-white text-neutral-600 shadow-sm' : 'text-slate-400'}`}
                                >
                                    {companionSource === source && <Check size={11} weight="bold" />}{label}
                                </button>
                            ))}
                        </div>

                        {companionSource === 'date' && (
                            <div className="p-5 pt-4">
                                <div className="mb-2 flex items-center justify-between">
                                    <div>
                                        <div className="text-[11px] font-bold text-slate-600">桌面衣橱</div>
                                        <div className="mt-0.5 text-[9px] text-slate-400">独立选择，不会改掉见面模式正在穿的衣服</div>
                                    </div>
                                    <button type="button" onClick={() => openApp(AppID.Date)} className="text-[9px] font-semibold text-neutral-500">补立绘表情 →</button>
                                </div>
                                <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                                    {companionDateOutfits.map(outfit => {
                                        const active = selectedCompanionOutfit?.id === outfit.id;
                                        return (
                                            <button
                                                key={outfit.id}
                                                type="button"
                                                onClick={() => chooseCompanionOutfit(outfit.id)}
                                                className={`w-20 shrink-0 rounded-2xl border p-2 text-left transition active:scale-95 ${active ? 'border-neutral-400 bg-neutral-50' : 'border-slate-100 bg-slate-50'}`}
                                            >
                                                <div className="flex h-16 items-center justify-center overflow-hidden rounded-xl bg-white">
                                                    <CompanionPortraitPreview value={outfit.preview} alt={outfit.name} />
                                                </div>
                                                <div className="mt-1.5 truncate text-[9px] font-bold text-slate-600">{outfit.name}</div>
                                                <div className={`mt-0.5 text-[8px] ${outfit.expressionCount >= 5 ? 'text-neutral-500' : 'text-neutral-500'}`}>{outfit.expressionCount}/5 表情</div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {appearanceCharacter?.companionAvatar?.imageRef && (
                            <button
                                type="button"
                                onClick={() => { void removeCompanionUpload(); }}
                                className="flex w-full items-center justify-center gap-1.5 border-t border-slate-100 py-3 text-[9px] font-semibold text-slate-400 active:bg-neutral-50 active:text-neutral-500"
                            >
                                <Trash size={12} /> 移除已导入图片
                            </button>
                        )}
                    </section>
                )}

                <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                    <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">Preset Themes</h2>
                    <div className="flex gap-3 mb-6 overflow-x-auto no-scrollbar pb-1">
                        {THEME_PRESETS.map(preset => (
                            <button 
                                key={preset.name}
                                onClick={() => { updateTheme(preset.config); trackEvent('应用配色预设', { preset: preset.name }); }}
                                className="flex flex-col items-center gap-1.5 shrink-0 group"
                            >
                                <div className="w-10 h-10 rounded-full shadow-sm border-2 border-white ring-1 ring-black/5 transition-transform group-active:scale-95" style={{ backgroundColor: preset.color }}></div>
                                <span className="text-[10px] text-slate-500 font-medium">{preset.name}</span>
                            </button>
                        ))}
                    </div>

                    <div className="space-y-5">
                        <div>
                            <div className="flex justify-between text-xs text-slate-500 mb-2 font-medium">
                                <span>Hue</span><span>{theme.hue}°</span>
                            </div>
                            <input type="range" min="0" max="360" value={theme.hue} onChange={(e) => updateTheme({ hue: parseInt(e.target.value) })} className="w-full h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer accent-primary" />
                            <div className="h-2 w-full rounded-full mt-3 opacity-50" style={{ background: `linear-gradient(to right, hsl(0, 80%, 65%), hsl(60, 80%, 65%), hsl(120, 80%, 65%), hsl(180, 80%, 65%), hsl(240, 80%, 65%), hsl(300, 80%, 65%), hsl(360, 80%, 65%))`}}></div>
                        </div>
                        <div>
                            <div className="flex justify-between text-xs text-slate-500 mb-2 font-medium">
                                <span>Saturation</span><span>{theme.saturation}%</span>
                            </div>
                            <input type="range" min="0" max="100" value={theme.saturation} onChange={(e) => updateTheme({ saturation: parseInt(e.target.value) })} className="w-full h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer accent-primary" />
                        </div>
                        <div>
                            <div className="flex justify-between text-xs text-slate-500 mb-2 font-medium">
                                <span>Lightness</span><span>{theme.lightness}%</span>
                            </div>
                            <input type="range" min="10" max="95" value={theme.lightness} onChange={(e) => updateTheme({ lightness: parseInt(e.target.value) })} className="w-full h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer accent-primary" />
                        </div>
                        <div>
                            <div className="flex justify-between text-xs text-slate-500 mb-2 font-medium">
                                <span>Text/Widget Color</span>
                            </div>
                            <div className="flex gap-4 items-center bg-slate-50 p-2 rounded-xl border border-slate-100">
                                <div 
                                    onClick={() => updateTheme({ contentColor: '#ffffff' })}
                                    className={`w-8 h-8 rounded-full border-2 cursor-pointer shadow-sm ${theme.contentColor === '#ffffff' ? 'border-primary ring-2 ring-primary/20' : 'border-slate-200'}`} 
                                    style={{ backgroundColor: '#ffffff' }}
                                />
                                <div 
                                    onClick={() => updateTheme({ contentColor: '#3f3f3f' })} // Slate-700
                                    className={`w-8 h-8 rounded-full border-2 cursor-pointer shadow-sm ${theme.contentColor === '#3f3f3f' ? 'border-primary ring-2 ring-primary/20' : 'border-slate-200'}`} 
                                    style={{ backgroundColor: '#3f3f3f' }}
                                />
                                <div className="h-6 w-px bg-slate-200 mx-1"></div>
                                <input 
                                    type="color" 
                                    value={theme.contentColor || '#ffffff'} 
                                    onChange={(e) => updateTheme({ contentColor: e.target.value })}
                                    className="w-8 h-8 rounded-lg border-none cursor-pointer bg-transparent p-0" 
                                />
                                <span className="text-xs text-slate-400 font-mono">{theme.contentColor}</span>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Global Font Section */}
                <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                    <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">全局字体 (Global Font)</h2>
                    <div className="mb-5">
                        <div className="text-xs text-slate-500 mb-2">首页时间字体（更换壁纸时保持）</div>
                        <div className="flex gap-2">
                            {([['serif', '经典衬线'], ['bold', '粗体数字'], ['system', '跟随全局字体']] as const).map(([value, label]) => (
                                <button key={value} onClick={() => updateTheme({ desktopClockStyle: value })}
                                    className={`flex-1 py-2 rounded-xl text-xs ${(theme.desktopClockStyle || 'serif') === value ? 'bg-primary text-white' : 'bg-slate-100 text-slate-500'}`}>
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>
                    
                    <div className="flex bg-slate-100 p-1 rounded-xl mb-4">
                        <button onClick={() => setFontMode('local')} className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${fontMode === 'local' ? 'bg-white text-primary shadow-sm' : 'text-slate-400'}`}>本地文件</button>
                        <button onClick={() => setFontMode('web')} className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${fontMode === 'web' ? 'bg-white text-primary shadow-sm' : 'text-slate-400'}`}>网络 URL</button>
                    </div>

                    {fontMode === 'local' ? (
                        <>
                            <div 
                                className="w-full h-24 bg-slate-100 rounded-2xl overflow-hidden relative shadow-inner mb-2 group cursor-pointer border-2 border-dashed border-slate-200 hover:border-primary/50 flex items-center justify-center flex-col gap-2" 
                                onClick={() => fontInputRef.current?.click()}
                            >
                                {theme.customFont && theme.customFont.startsWith('data:') ? (
                                    <>
                                        <span className="text-lg font-bold text-slate-700">Abc 字体预览</span>
                                        <span className="text-[10px] text-slate-400">已应用本地字体</span>
                                    </>
                                ) : (
                                    <>
                                        <span className="text-2xl text-slate-400">Aa</span>
                                        <span className="text-xs text-slate-400">上传字体文件 (.ttf / .otf)</span>
                                    </>
                                )}
                                <div className="absolute inset-0 bg-black/5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <span className="text-white text-xs font-bold bg-black/40 px-3 py-1 rounded-full backdrop-blur-md">更换字体</span>
                                </div>
                            </div>
                            <input type="file" ref={fontInputRef} className="hidden" accept=".ttf,.otf,.woff,.woff2" onChange={handleFontUpload} />
                        </>
                    ) : (
                        <div className="space-y-2">
                            <input 
                                value={webFontUrl} 
                                onChange={e => setWebFontUrl(e.target.value)} 
                                placeholder="输入字体文件 URL (https://...)" 
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs outline-none focus:border-primary transition-all"
                            />
                            <button onClick={applyWebFont} className="w-full py-2 bg-primary text-white font-bold text-xs rounded-xl shadow-md active:scale-95 transition-transform">
                                应用网络字体
                            </button>
                            <div className="text-[10px] text-slate-400 px-1">
                                {theme.customFont && theme.customFont.startsWith('http') ? (
                                    <span className="text-neutral-500">当前使用: {theme.customFont}</span>
                                ) : '提示: 请确保链接直通字体文件 (.ttf/.woff)'}
                            </div>
                        </div>
                    )}

                    {theme.customFont && (
                        <button onClick={() => updateTheme({ customFont: undefined })} className="w-full py-2 text-xs font-bold text-neutral-400 bg-neutral-50 rounded-lg hover:bg-neutral-100 mt-2">恢复默认字体</button>
                    )}
                </section>

                <FullscreenSettings />

                {/* Status Bar Layout */}
                <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                    <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">状态栏 (Status Bar)</h2>
                    <div className="grid grid-cols-3 gap-2">
                        {([
                            { id: 'standard', label: '安全显示', hint: '额外留一行', icon: '◫' },
                            { id: 'compact', label: '紧凑显示', hint: '保留时间并上移', icon: '⌃' },
                            { id: 'hidden', label: '隐藏时间', hint: '只留安全区', icon: '—' },
                        ] as Array<{ id: StatusBarMode; label: string; hint: string; icon: string }>).map(option => {
                            const active = resolveStatusBarMode(theme.statusBarMode, theme.hideStatusBar) === option.id;
                            return (
                                <button
                                    key={option.id}
                                    type="button"
                                    aria-pressed={active}
                                    onClick={() => updateTheme({ statusBarMode: option.id, hideStatusBar: option.id === 'hidden' })}
                                    className={`min-w-0 rounded-2xl border px-2 py-3 text-center transition-all active:scale-[0.98] ${active ? 'border-primary bg-primary/10 text-primary shadow-sm' : 'border-slate-100 bg-slate-50 text-slate-500'}`}
                                >
                                    <div className="text-lg leading-none mb-1.5" aria-hidden="true">{option.icon}</div>
                                    <div className="text-xs font-bold whitespace-nowrap">{option.label}</div>
                                    <div className="text-[9px] mt-1 leading-tight opacity-70">{option.hint}</div>
                                </button>
                            );
                        })}
                    </div>
                    <p className="mt-3 text-[10px] leading-relaxed text-slate-400">
                        有刘海或灵动岛优先用“紧凑显示”：时间、电量进入顶部安全区，按钮仍从遮挡区下方开始；若系统已显示时间，可选“隐藏时间”。
                    </p>
                </section>

                {/* Desktop Music Widget Style */}
                <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                    <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">桌面组件</h2>
                    <label className="flex items-center gap-2 mb-4 text-sm text-slate-700">
                        <input type="checkbox" checked={theme.launcherMusicVisible !== false} onChange={e => updateTheme({ launcherMusicVisible: e.target.checked })} />
                        显示音乐组件
                    </label>
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm font-medium text-slate-700">音乐卡片浅色系</div>
                            <div className="text-[10px] text-slate-400 mt-0.5">桌面第二页「正在播放」卡片改用浅色样式。仅默认皮肤生效。</div>
                        </div>
                        <button
                            onClick={() => updateTheme({ nowPlayingWidgetLight: !theme.nowPlayingWidgetLight })}
                            className={`w-12 h-7 rounded-full transition-colors relative shrink-0 ml-3 ${theme.nowPlayingWidgetLight ? 'bg-primary' : 'bg-slate-200'}`}
                        >
                            <div className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${theme.nowPlayingWidgetLight ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                    </div>
                </section>

                {/* Wallpaper Section */}
                <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                    <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">手机壁纸</h2>
                    <LongPressArea
                        className="aspect-[9/16] w-1/2 mx-auto bg-slate-100 rounded-2xl overflow-hidden relative shadow-inner mb-4 group cursor-pointer"
                        onClick={() => wallpaperInputRef.current?.click()}
                        onLongPress={async () => {
                            if (theme.wallpaper === DEFAULT_WALLPAPER) {
                                addToast('当前已是默认壁纸', 'info');
                                return;
                            }
                            await updateTheme({ wallpaper: DEFAULT_WALLPAPER });
                            addToast('已恢复默认壁纸', 'success');
                        }}
                    >
                         <div
                            className="w-full h-full"
                            style={{
                                background: !theme.wallpaper
                                    ? '#e7e7e7'
                                    : (theme.wallpaper.startsWith('linear-gradient') || theme.wallpaper.startsWith('radial-gradient') || theme.wallpaper.startsWith('conic-gradient'))
                                        ? theme.wallpaper
                                        : `url("${theme.wallpaper}") center/cover`,
                            }}
                         />
                         <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                             <span className="text-white text-xs font-bold bg-black/20 px-3 py-1 rounded-full backdrop-blur-md">更换壁纸</span>
                         </div>
                    </LongPressArea>
                    <input type="file" ref={wallpaperInputRef} className="hidden" accept="image/*" onChange={(e) => e.target.files?.[0] && handleWallpaperUpload(e.target.files[0])} />
                    <p className="text-center text-[10px] text-slate-400 mb-4">点击上传 / 长按恢复默认壁纸 (支持原画质)</p>

                    <div className="border-t border-slate-100 pt-4 space-y-2">
                        <p className="text-[11px] font-bold text-slate-500">从 URL 导入</p>
                        <input
                            value={wallpaperUrl}
                            onChange={e => setWallpaperUrl(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') applyWallpaperUrl(); }}
                            placeholder="输入图片地址 (https://...)"
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs outline-none focus:border-primary transition-all"
                        />
                        <button
                            onClick={applyWallpaperUrl}
                            disabled={!wallpaperUrl.trim()}
                            className="w-full py-2 bg-primary text-white font-bold text-xs rounded-xl shadow-md active:scale-95 transition-transform disabled:opacity-40 disabled:active:scale-100"
                        >
                            应用网络壁纸
                        </button>
                        <p className="text-[10px] text-slate-400">直接引用网络图片，不占用本地存储</p>
                    </div>
                </section>

                {/* Lock Screen Wallpaper Section */}
                <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                    <div className="flex items-center justify-between mb-1">
                        <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest">锁屏壁纸</h2>
                        <span className="text-[9px] px-2 py-0.5 rounded-full bg-stone-100 text-stone-500 font-bold">
                            {theme.lockWallpaper ? '独立设置' : '跟随桌面'}
                        </span>
                    </div>
                    <p className="text-[10px] text-slate-400 mb-4">单独设置锁屏画面，不会修改桌面壁纸。</p>
                    <LongPressArea
                        className="aspect-[9/16] w-1/2 mx-auto bg-slate-100 rounded-2xl overflow-hidden relative shadow-inner mb-4 group cursor-pointer"
                        onClick={() => lockWallpaperInputRef.current?.click()}
                        onLongPress={async () => {
                            if (!theme.lockWallpaper) {
                                addToast('锁屏当前已跟随桌面壁纸', 'info');
                                return;
                            }
                            await updateTheme({ lockWallpaper: undefined });
                            addToast('锁屏已恢复跟随桌面壁纸', 'success');
                        }}
                    >
                        <div
                            className="w-full h-full"
                            style={{
                                background: (() => {
                                    const value = theme.lockWallpaper || theme.wallpaper;
                                    if (!value) return '#e7e7e7';
                                    return (value.startsWith('linear-gradient') || value.startsWith('radial-gradient') || value.startsWith('conic-gradient'))
                                        ? value
                                        : `url("${value}") center/cover`;
                                })(),
                            }}
                        />
                        <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <span className="text-white text-xs font-bold bg-black/20 px-3 py-1 rounded-full backdrop-blur-md">更换锁屏</span>
                        </div>
                    </LongPressArea>
                    <input
                        type="file"
                        ref={lockWallpaperInputRef}
                        className="hidden"
                        accept="image/*"
                        onChange={(e) => {
                            if (e.target.files?.[0]) handleLockWallpaperUpload(e.target.files[0]);
                            e.target.value = '';
                        }}
                    />
                    <p className="text-center text-[10px] text-slate-400 mb-4">点击上传 / 长按恢复跟随桌面</p>

                    <div className="border-t border-slate-100 pt-4 space-y-2">
                        <p className="text-[11px] font-bold text-slate-500">从 URL 导入</p>
                        <input
                            value={lockWallpaperUrl}
                            onChange={e => setLockWallpaperUrl(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') applyLockWallpaperUrl(); }}
                            placeholder="输入锁屏图片地址 (https://...)"
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs outline-none focus:border-primary transition-all"
                        />
                        <button
                            onClick={applyLockWallpaperUrl}
                            disabled={!lockWallpaperUrl.trim()}
                            className="w-full py-2 bg-primary text-white font-bold text-xs rounded-xl shadow-md active:scale-95 transition-transform disabled:opacity-40 disabled:active:scale-100"
                        >
                            应用网络锁屏壁纸
                        </button>
                    </div>
                </section>

                {/* Page 1 Desktop Square Image */}
                <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                    <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-2">主页 2 · 拍立得照片</h2>
                    <label className="flex items-center gap-2 mb-3 text-sm text-slate-700">
                        <input type="checkbox" checked={theme.launcherImageVisible !== false} onChange={e => updateTheme({ launcherImageVisible: e.target.checked })} />
                        显示图片组件
                    </label>
                    
                    <div className="flex justify-center bg-slate-50 p-3 rounded-2xl border border-slate-100">
                        {(() => {
                            const slot = 'dsq';
                            const img = (theme.launcherWidgets || {})[slot];
                            return (
                                <LongPressArea
                                    className={`w-40 aspect-square rounded-2xl overflow-hidden relative cursor-pointer transition-transform active:scale-95 ${img ? 'shadow-sm' : 'border-2 border-dashed border-slate-200 bg-white flex items-center justify-center'}`}
                                    onClick={() => { setActiveWidgetSlot(slot); widgetInputRef.current?.click(); }}
                                    onLongPress={() => {
                                        if (img) {
                                            removeWidget(slot);
                                            addToast('已移除方图', 'success');
                                        }
                                    }}
                                >
                                    {img ? (
                                        <>
                                            <TokenImg value={img} className="w-full h-full object-cover" />
                                            <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 hover:opacity-100">
                                                <span className="text-white text-[10px] font-bold bg-black/40 px-2 py-0.5 rounded-full">更换</span>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="text-slate-300 text-center">
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7 mx-auto mb-1"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                                            <span className="text-[10px]">拍立得</span>
                                        </div>
                                    )}
                                </LongPressArea>
                            );
                        })()}
                    </div>
                </section>

                {/* Home page 1 filmstrip positions; existing source-photo slots below remain unchanged. */}
                <section className="bg-white rounded-3xl p-5 shadow-sm border border-neutral-200">
                    <h2 className="text-sm font-bold text-neutral-800 mb-2">当前桌面 · 独立照片位置</h2>
                    
                    <div className="grid grid-cols-2 gap-3">
                        {([
                            ['film1', '主页 1 · 胶片 ①', 'tl'],
                            ['film2', '主页 1 · 胶片 ②', 'tr'],
                            ['film3', '主页 1 · 胶片 ③', 'wide'],
                            ['film4', '主页 1 · 胶片 ④', 'dsq'],
                        ] as const).map(([slot, label, fallback]) => {
                            const custom = theme.launcherWidgets?.[slot];
                            const img = custom || theme.launcherWidgets?.[fallback];
                            return <div key={slot} className="min-w-0">
                                <div className="text-[11px] text-neutral-600 mb-1.5">{label}</div>
                                <LongPressArea
                                    className="h-24 rounded-2xl overflow-hidden relative bg-neutral-100 border border-neutral-200 cursor-pointer flex items-center justify-center"
                                    onClick={() => { setActiveWidgetSlot(slot); widgetInputRef.current?.click(); }}
                                    onLongPress={() => { if (custom) { removeWidget(slot); addToast('已恢复原有照片', 'success'); } }}
                                >
                                    {img ? <TokenImg value={img} className="w-full h-full object-cover" alt={label} /> : <span className="text-neutral-400 text-xl">＋</span>}
                                </LongPressArea>
                                <div className="text-[10px] text-neutral-400 mt-1">{custom ? '已单独设置 · 长按恢复' : '点击添加 / 更换'}</div>
                            </div>;
                        })}
                    </div>
                </section>

                {/* Page 2 Widget Images */}
                <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                    <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-2">原有照片素材 · 基础图槽</h2>
                    
                    <input type="file" ref={widgetInputRef} className="hidden" accept="image/*" onChange={(e) => e.target.files?.[0] && handleWidgetUpload(e.target.files[0])} />
                    <div className="space-y-2 bg-slate-50 p-3 rounded-2xl border border-slate-100">
                        <div className="flex gap-2">
                            {['tl', 'tr'].map(slot => {
                                const img = (theme.launcherWidgets || {})[slot];
                                return (
                                    <LongPressArea
                                        key={slot}
                                        className={`flex-1 aspect-square rounded-xl overflow-hidden relative cursor-pointer transition-transform active:scale-95 ${img ? 'shadow-sm' : 'border-2 border-dashed border-slate-200 bg-white flex items-center justify-center'}`}
                                        onClick={() => { setActiveWidgetSlot(slot); widgetInputRef.current?.click(); }}
                                        onLongPress={() => {
                                            if (img) {
                                                removeWidget(slot);
                                                addToast('已移除小组件', 'success');
                                            }
                                        }}
                                    >
                                        {img ? (
                                            <>
                                                <TokenImg value={img} className="w-full h-full object-cover" />
                                                <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 hover:opacity-100">
                                                    <span className="text-white text-[10px] font-bold bg-black/40 px-2 py-0.5 rounded-full">更换</span>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="text-slate-300 text-center">
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 mx-auto mb-1"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                                                <span className="text-[9px]">图片</span>
                                            </div>
                                        )}
                                    </LongPressArea>
                                );
                            })}
                        </div>
                        {(() => {
                            const slot = 'wide';
                            const img = (theme.launcherWidgets || {})[slot];
                            return (
                                <LongPressArea
                                    className={`w-full h-20 rounded-xl overflow-hidden relative cursor-pointer transition-transform active:scale-[0.98] ${img ? 'shadow-sm' : 'border-2 border-dashed border-slate-200 bg-white flex items-center justify-center'}`}
                                    onClick={() => { setActiveWidgetSlot(slot); widgetInputRef.current?.click(); }}
                                    onLongPress={() => {
                                        if (img) {
                                            removeWidget(slot);
                                            addToast('已移除横幅', 'success');
                                        }
                                    }}
                                >
                                    {img ? (
                                        <>
                                            <TokenImg value={img} className="w-full h-full object-cover" />
                                            <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 hover:opacity-100">
                                                <span className="text-white text-[10px] font-bold bg-black/40 px-2 py-0.5 rounded-full">更换</span>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="text-slate-300 text-center">
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 mx-auto mb-0.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                                            <span className="text-[9px]">横幅</span>
                                        </div>
                                    )}
                                </LongPressArea>
                            );
                        })()}
                    </div>
                </section>

            </>
        ) : activeTab === 'icons' ? (
            <div className="space-y-5">
              <AppIconEditor />
              <section className="bg-white rounded-3xl p-4 shadow-sm border border-slate-100">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-700">保留透明图标原轮廓</div>
                    <div className="text-[10px] text-slate-400 mt-0.5 leading-snug">开启后按图片原轮廓完整显示，不套系统圆角底框；默认关闭。</div>
                  </div>
                  <button
                    onClick={() => updateTheme({ preserveCustomIconOutlines: !theme.preserveCustomIconOutlines })}
                    className={`w-12 h-7 rounded-full transition-colors relative shrink-0 ${theme.preserveCustomIconOutlines ? 'bg-primary' : 'bg-slate-200'}`}
                    aria-label="保留透明图标原轮廓"
                  >
                    <div className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${theme.preserveCustomIconOutlines ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>
              </section>
              <div className="grid grid-cols-3 gap-4">
                {INSTALLED_APPS.map(app => {
                    const Icon = Icons[app.icon];
                    const customUrl = customIcons[app.id];
                    const preserveOutline = !!customUrl && theme.preserveCustomIconOutlines === true;
                    return (
                        <div key={app.id} className="flex flex-col items-center gap-2">
                              <div
                                className={`w-16 h-16 relative group cursor-pointer ${preserveOutline ? '' : 'rounded-2xl shadow-sm bg-slate-200 overflow-hidden'}`}
                                onClick={() => { setSelectedAppId(app.id); iconInputRef.current?.click(); }}
                              >
                                  {customUrl ? (
                                     <CustomIconImage value={customUrl} alt={`${app.name} 自定义图标`} preserveOutline={preserveOutline} />
                                  ) : (
                                     <div className={`w-full h-full ${app.color} flex items-center justify-center text-white`}>
                                         <Icon className="w-8 h-8" />
                                     </div>
                                 )}
                                 <div className="absolute inset-0 rounded-2xl bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                     <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6 text-white"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" /></svg>
                                 </div>
                             </div>
                             <span className="text-[10px] text-slate-500 font-medium">{app.name}</span>
                             {customUrl && (
                                 <button onClick={() => setCustomIcon(app.id, undefined)} className="text-[10px] text-neutral-400">重置</button>
                             )}
                        </div>
                    );
                })}
                <input type="file" ref={iconInputRef} className="hidden" accept="image/*" onChange={(e) => e.target.files?.[0] && handleIconUpload(e.target.files[0])} />
              </div>
            </div>
        ) : activeTab === 'presets' ? (
            <PresetManager
                presets={appearancePresets}
                onSave={saveAppearancePreset}
                onApply={applyAppearancePreset}
                onDelete={deleteAppearancePreset}
                onRename={renameAppearancePreset}
                onExport={exportAppearancePreset}
                onImport={importAppearancePreset}
                addToast={addToast}
                currentTheme={theme}
            />

        ) : activeTab === 'sharing' ? (
            <BeautyShareChannel presets={appearancePresets} onExport={exportAppearancePreset} onImport={importAppearancePreset} onBusyChange={setShareBusy} onBack={() => setActiveTab('theme')}/>
        ) : null}
      </div>
    </div>
  );
};

export default Appearance;
import { useAppShortcut } from '../utils/appShortcutLaunch';
import { AppID as ShortcutAppID } from '../types';
