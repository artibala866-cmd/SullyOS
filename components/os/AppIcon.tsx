
import React from 'react';
import { AppConfig } from '../../types';
import { Icons } from '../../constants';
import { isPaperWallpaper, useOS } from '../../context/OSContext';
import { useBlobRefUrl } from '../../utils/blobRef';
import { getAcnhIcon } from './acnhIcons';
import { preloadApp } from './appPreload';

interface AppIconProps {
  app: AppConfig;
  onClick: () => void;
  size?: 'sm' | 'md' | 'lg';
  hideLabel?: boolean;
  variant?: 'default' | 'minimal' | 'dock';
}

// 动森（NookPhone）风格瓦片配色 —— 直接用 animal-island-ui 的应用色板（精确 hex）。
const NOOK_TILE_COLORS: Record<string, string> = {
  indigo: '#889DF0', violet: '#B77DEE', purple: '#B77DEE', fuchsia: '#F8A6B2',
  pink: '#F8A6B2', rose: '#FC736D', red: '#FC736D', orange: '#E59266',
  amber: '#F7CD67', lime: '#D1DA49', green: '#8AC68A', emerald: '#82D5BB',
  cyan: '#82D5BB', blue: '#889DF0', slate: '#9A835A',
};

const AppIcon: React.FC<AppIconProps> = React.memo(({ app, onClick, size = 'md', hideLabel = false, variant = 'default' }) => {
  const { customIcons, theme } = useOS();
  const IconComponent = Icons[app.icon] || Icons.Settings;
  const customIconUrl = useBlobRefUrl(customIcons[app.id]);
  const isNook = theme.skin === 'animalcrossing';
  const isPaperDesktop = theme.skin !== 'animalcrossing' && theme.skin !== 'mobilegame' && theme.skin !== 'tamagotchi' && isPaperWallpaper(theme.wallpaper);
  const preserveCustomOutline = !!customIconUrl && theme.preserveCustomIconOutlines === true;

  // Korean editorial / monochrome desktop: repository-level replacement.
  // Custom icon images are preserved so existing user assets remain available.
  const sizeClasses = size === 'lg' ? 'w-[4.25rem] h-[4.25rem]' : size === 'sm' ? 'w-[2.75rem] h-[2.75rem]' : 'w-[3.5rem] h-[3.5rem]';
  return (
    <button type="button" onClick={onClick} onPointerDown={() => preloadApp(app.id)}
      className="flex flex-col items-center gap-2 group relative active:scale-95 transition-transform duration-200"
      style={{ WebkitTapHighlightColor: 'transparent', color: '#222222' }}>
      <div className={`${sizeClasses} relative flex items-center justify-center overflow-hidden rounded-[1.35rem] bg-white border border-[#ededed] shadow-[0_4px_14px_rgba(0,0,0,0.045)] group-active:bg-[#f2f2f2]`}>
        {customIconUrl ? <img src={customIconUrl} className="w-full h-full object-cover" alt={app.name} loading="lazy" /> :
          <div className="w-[48%] h-[48%] text-[#262626]"><IconComponent className="w-full h-full" /></div>}
      </div>
      {!hideLabel && variant !== 'dock' && <span className="text-[10px] tracking-[0.03em] font-medium text-[#303030] max-w-[5.5rem] truncate">{app.name}</span>}
    </button>
  );

}, (prev, next) => {
    // Custom comparison to prevent re-render unless specific props change
    // We don't check 'onClick' deeply assuming it's stable or we want to ignore function ref changes
    return prev.app.id === next.app.id && 
           prev.size === next.size && 
           prev.hideLabel === next.hideLabel &&
           prev.variant === next.variant;
});

export default AppIcon;
