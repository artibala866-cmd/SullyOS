import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { NAVIGATION_SLOT_APPS, NAVIGATION_BALL_POSITION_KEY, subscribeNavigationBallPositionReset, useNavigationBallEnabled, useNavigationBallSlots, useNavigationPickerOpen } from '../../utils/navigationBall';
import { AppID, type APIConfig, type ApiPreset } from '../../types';
import { Icons } from '../../constants';
import { ArrowUUpLeft, CaretLeft, CaretRight, Check, GearSix, House, PlugsConnected, Plus, SlidersHorizontal, X } from '@phosphor-icons/react';
import { configFromPreset, findActivePresetId } from '../../utils/apiPresetSwitch';
import { syncAmsgLlmCredentials } from '../../utils/amsgStateSync';
import { normalizedQuickApiFields, quickApiConfigurationIssue } from '../../utils/quickApiValidation';
import { requestSettingsFocus } from '../../utils/settingsNavigation';
import { describeNavigationShortcut, type NavigationShortcut, type ShortcutCharacter } from '../../utils/navigationShortcuts';
import { launchNavigationShortcut } from '../../utils/navigationShortcutLaunch';
import { clampBubblePos, resolveSafeTopInset } from '../../utils/floatingBallBounds';
import { isIOSStandaloneWebApp, readSafeAreaInsets } from '../../utils/iosStandalone';
import './NavigationBall.css';

const POSITION_KEY = NAVIGATION_BALL_POSITION_KEY;
const SIZE = 40;
type Position = { x: number; y: number };
function readPosition(): Position | null {
  try {
    const value = JSON.parse(localStorage.getItem(POSITION_KEY) || 'null');
    if (Number.isFinite(value?.x) && Number.isFinite(value?.y)) return value;
  } catch { /* Use the default position. */ }
  return null;
}
function measure(parent: HTMLElement) {
  const rect = parent.getBoundingClientRect(), style = getComputedStyle(parent), safe = readSafeAreaInsets();
  const vv = window.visualViewport;
  const visualBottom = vv ? vv.offsetTop + vv.height - rect.top : rect.height;
  const visibleHeight = vv && visualBottom > SIZE + 20 ? Math.min(rect.height, visualBottom) : rect.height;
  const top = resolveSafeTopInset({
    standaloneSafeTop: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--standalone-safe-area-top')) || 0,
    probedSafeTop: safe.top, isIOSStandalone: isIOSStandaloneWebApp(),
  });
  return { rect, bounds: { parentW: rect.width, parentH: visibleHeight, bubble: SIZE,
    insetTop: Math.max(parseFloat(style.paddingTop) || 0, top),
    insetBottom: Math.max(parseFloat(style.paddingBottom) || 0, safe.bottom) } };
}
type NavigationActions = {
  onBack: () => void; onHome: () => void; onApi: () => void;
  onShortcut: (shortcut: NavigationShortcut) => void; onConfigure: () => void;
  onSwitchPreset: (preset: ApiPreset) => void;
  onManualApi: (patch: Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>) => void;
  apiPresets: ApiPreset[];
  apiConfig: APIConfig;
  independentApiCharacterName?: string;
  characters?: readonly ShortcutCharacter[];
};
type MenuView = 'main' | 'api' | 'manual';
export function DraggableNavigationBall({
  onBack, onHome, onApi, onShortcut, onConfigure, onSwitchPreset, onManualApi,
  apiPresets, apiConfig, independentApiCharacterName, characters = [],
}: NavigationActions) {
  const slots = useNavigationBallSlots();
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Position | null>(readPosition);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<MenuView>('main');
  const [panelHeight, setPanelHeight] = useState(0);
  const [manual, setManual] = useState({ baseUrl: '', apiKey: '', model: '' });
  const [manualError, setManualError] = useState('');
  const activePresetId = findActivePresetId(apiPresets, apiConfig);
  const [parentSize, setParentSize] = useState({ width: 0, height: 0, top: 0, bottom: 0 });
  const latest = useRef(position); latest.current = position;
  // Keep the desired position when the keyboard briefly shrinks the visible viewport.
  const preferredPosition = useRef(position);
  const suppressClick = useRef(false);
  const drag = useRef<{ pointerId: number; startX: number; startY: number; origin: Position;
    bounds: ReturnType<typeof measure>['bounds']; moved: boolean } | null>(null);
  useLayoutEffect(() => {
    const parent = root.current?.parentElement;
    if (!parent) return;
    const constrain = () => {
      const { bounds } = measure(parent);
      setParentSize({ width: bounds.parentW, height: bounds.parentH, top: bounds.insetTop, bottom: bounds.insetBottom });
      const value = preferredPosition.current || { x: bounds.parentW - SIZE - 12, y: bounds.parentH - SIZE - 96 };
      const next = clampBubblePos(value.x, value.y, bounds);
      latest.current = next; setPosition(next);
    };
    constrain();
    const unsubscribeReset = subscribeNavigationBallPositionReset(() => {
      drag.current = null; suppressClick.current = false; setOpen(false);
      preferredPosition.current = null; latest.current = null; constrain();
    });
    const observer = new ResizeObserver(constrain); observer.observe(parent);
    // Android/iOS keyboard can resize visualViewport without resizing the shell.
    window.visualViewport?.addEventListener('resize', constrain);
    window.visualViewport?.addEventListener('scroll', constrain);
    return () => {
      observer.disconnect(); unsubscribeReset();
      window.visualViewport?.removeEventListener('resize', constrain);
      window.visualViewport?.removeEventListener('scroll', constrain);
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [open]);
  // No layout reads during drag; recalculate panel bounds after view changes only.
  useLayoutEffect(() => {
    if (!open || !panel.current) return;
    const height = panel.current.getBoundingClientRect().height;
    setPanelHeight(previous => Math.abs(previous - height) < 1 ? previous : height);
  }, [open, view, parentSize.width, parentSize.height, apiPresets.length, slots]);
  const finish = (event: React.PointerEvent<HTMLButtonElement>, cancelled = false) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    suppressClick.current = cancelled || drag.current.moved;
    if (drag.current.moved && latest.current) {
      try { localStorage.setItem(POSITION_KEY, JSON.stringify(latest.current)); } catch { /* Keep the current position. */ }
    }
    drag.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* Already released. */ }
  };
  const close = () => { setOpen(false); setView('main'); setManualError(''); };
  const run = (action: () => void) => { close(); action(); };
  const showView = (next: MenuView) => {
    setPanelHeight(0);
    if (next === 'manual') {
      setManual({ baseUrl: apiConfig.baseUrl, apiKey: apiConfig.apiKey, model: apiConfig.model });
      setManualError('');
    }
    setView(next);
  };
  const saveManual = () => {
    const issue = quickApiConfigurationIssue(manual);
    if (issue) { setManualError(issue); return; }
    run(() => onManualApi(normalizedQuickApiFields(manual)));
  };
  const panelWidth = Math.max(120, Math.min(232, parentSize.width - 16));
  const availableHeight = Math.min(288, Math.max(80, parentSize.height - parentSize.top - parentSize.bottom - 20));
  const posX = position?.x ?? Math.max(8, parentSize.width - SIZE - 12);
  const posY = position?.y ?? Math.max(8, parentSize.height - SIZE - 96);
  const preferredX = posX > parentSize.width / 2 ? posX - panelWidth - 10 : posX + SIZE + 10;
  const panelX = Math.max(8, Math.min(preferredX, parentSize.width - panelWidth - 8));
  const visiblePanelHeight = Math.min(panelHeight || (view === 'main' ? 240 : 320), availableHeight);
  const panelY = Math.max(parentSize.top + 10, Math.min(
    posY + SIZE / 2 - visiblePanelHeight / 2,
    parentSize.height - parentSize.bottom - visiblePanelHeight - 10,
  ));
  const slotButton = (index: number) => {
    const shortcut = slots[index];
    if (!shortcut) return null; // Empty slots are edited in Settings, not displayed in this compact list.
    const app = NAVIGATION_SLOT_APPS.find(item => item.id === shortcut.appId);
    const label = describeNavigationShortcut(shortcut, characters);
    const Icon = app ? Icons[app.icon] || GearSix : Plus;
    return <button type="button" className="navigation-ball-row" key={index}
      aria-label={'打开' + label.detail} title={label.detail}
      onClick={() => run(() => onShortcut(shortcut))}>
      <span className="navigation-ball-row-icon"><Icon className="navigation-ball-action-icon" /></span>
      <span className="navigation-ball-row-label">{label.name}
        {shortcut.characterId && <small className="navigation-ball-target-kind">{label.detail.split(' › ').slice(0, -1).pop()}</small>}
      </span><CaretRight className="navigation-ball-chevron" />
    </button>;
  };
  return <div ref={root} className="navigation-ball" style={position ? { left: position.x, top: position.y } : { right: 12, bottom: 96 }}>
    <button type="button" className="navigation-ball-toggle" aria-label="快捷导航悬浮球" aria-expanded={open}
      onPointerDown={event => {
        if (event.button !== 0 || !root.current?.parentElement || !latest.current) return;
        const { bounds } = measure(root.current.parentElement);
        suppressClick.current = false;
        drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: latest.current, bounds, moved: false };
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer events remain usable. */ }
      }}
      onPointerMove={event => {
        const state = drag.current;
        if (!state || state.pointerId !== event.pointerId) return;
        const dx = event.clientX - state.startX, dy = event.clientY - state.startY;
        if (!state.moved && Math.hypot(dx, dy) <= 4) return;
        state.moved = true; setOpen(false);
        const next = clampBubblePos(state.origin.x + dx, state.origin.y + dy, state.bounds);
        preferredPosition.current = next;
        latest.current = next; setPosition(next);
      }} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)}
      onClick={event => {
        if (event.detail !== 0 && suppressClick.current) { suppressClick.current = false; return; }
        if (!open) { setView('main'); setPanelHeight(0); }
        setOpen(value => !value);
      }}>
      <span aria-hidden="true" />
    </button>
    {open && <div ref={panel} className="navigation-ball-panel" role="dialog" aria-label="快捷导航"
      style={{ left: panelX - posX, top: panelY - posY, width: panelWidth, maxHeight: availableHeight }}>
      <div className="navigation-ball-panel-header">
        {view !== 'main' && <button type="button" className="navigation-ball-header-back" aria-label="返回快捷操作"
          onClick={() => showView(view === 'manual' ? 'api' : 'main')}><CaretLeft size={16} /></button>}
        <strong>{view === 'main' ? '快捷操作' : view === 'api' ? '切换对话 API' : '手动设置 API'}</strong>
        <button type="button" className="navigation-ball-header-close" aria-label="收起悬浮窗"
          onClick={close}><X size={14} /></button>
      </div>
      {view === 'main' && <>
        <div className="navigation-ball-section">
          <button type="button" className="navigation-ball-row navigation-ball-api-entry" onClick={() => showView('api')}>
            <span className="navigation-ball-row-icon"><PlugsConnected className="navigation-ball-action-icon" /></span>
            <span className="navigation-ball-row-label">切换 API<small>{apiConfig.model || '尚未配置模型'}</small></span>
            <CaretRight className="navigation-ball-chevron" />
          </button>
          <button type="button" className="navigation-ball-row" onClick={() => run(onBack)}>
            <span className="navigation-ball-row-icon"><ArrowUUpLeft className="navigation-ball-action-icon" /></span>
            <span className="navigation-ball-row-label">上一级</span><CaretRight className="navigation-ball-chevron" />
          </button>
          <button type="button" className="navigation-ball-row" onClick={() => run(onHome)}>
            <span className="navigation-ball-row-icon"><House className="navigation-ball-action-icon" /></span>
            <span className="navigation-ball-row-label">回到桌面</span><CaretRight className="navigation-ball-chevron" />
          </button>
        </div>
        {slots.some(Boolean) && <div className="navigation-ball-section navigation-ball-shortcuts">
          {slots.map((_, index) => slotButton(index))}
        </div>}
        <div className="navigation-ball-panel-footer">
          <button type="button" onClick={() => run(onConfigure)}><SlidersHorizontal size={15} /> 自定义快捷入口</button>
        </div>
      </>}
      {view === 'api' && <>
        <div className="navigation-ball-api-current"><span>当前全局模型</span>
          <strong title={apiConfig.model}>{apiConfig.model || '尚未设置'}</strong>
        </div>
        <div className="navigation-ball-section navigation-ball-preset-list" aria-label="可用 API 预设">
          {apiPresets.length === 0 && <p className="navigation-ball-empty">还没有保存的 API 预设，可以先手动填写。</p>}
          {apiPresets.map(preset => {
            const issue = quickApiConfigurationIssue(preset.config);
            return <button type="button" key={preset.id}
              disabled={!!issue} title={issue || preset.name}
              className={'navigation-ball-row navigation-ball-preset' + (activePresetId === preset.id && !issue ? ' is-active' : '')}
              aria-label={issue ? preset.name + '（' + issue + '，请在完整设置里修正）' : '切换到' + preset.name}
              aria-current={activePresetId === preset.id && !issue ? 'true' : undefined}
              onClick={() => run(() => onSwitchPreset(preset))}>
              <span className="navigation-ball-row-label">{preset.name}
                <small>{issue || preset.config.model || '未设置模型'}{!issue && preset.group ? ' · ' + preset.group : ''}</small>
              </span>
              {activePresetId === preset.id && !issue ? <Check className="navigation-ball-selected" size={18} /> : <CaretRight className="navigation-ball-chevron" />}
            </button>;
          })}
        </div>
        <div className="navigation-ball-panel-footer navigation-ball-api-actions">
          <button type="button" onClick={() => showView('manual')}>手动填写</button>
          <button type="button" onClick={() => run(onApi)}>完整设置</button>
        </div>
        <p className="navigation-ball-hint">{independentApiCharacterName
          ? `${independentApiCharacterName} 有独立 API：普通见面继续使用角色配置；剧情剧场使用此处的全局配置。`
          : '切换全局 API 仅影响下一次请求；独立的角色或玩法 API 不会被覆盖。'}</p>
      </>}
      {view === 'manual' && <div className="navigation-ball-manual">
        <label>URL<input type="url" inputMode="url" autoComplete="off" value={manual.baseUrl}
          onChange={event => setManual(previous => ({ ...previous, baseUrl: event.target.value }))} placeholder="https://..." /></label>
        <label>KEY<input type="password" autoComplete="off" value={manual.apiKey}
          onChange={event => setManual(previous => ({ ...previous, apiKey: event.target.value }))} placeholder="sk-..." /></label>
        <label>MODEL<input type="text" autoComplete="off" value={manual.model}
          onChange={event => setManual(previous => ({ ...previous, model: event.target.value }))} placeholder="输入模型名称" /></label>
        {manualError && <p className="navigation-ball-manual-error" role="alert">{manualError}</p>}
        <button type="button" className="navigation-ball-manual-save" onClick={saveManual}>保存并切换</button>
        <p className="navigation-ball-hint">仅修改主对话 URL、Key、模型；其他 API 保持不变。</p>
      </div>}
    </div>}
  </div>;
}
export default function NavigationBall() {
  const enabled = useNavigationBallEnabled();
  const pickerOpen = useNavigationPickerOpen();
  const { isLocked, isDataLoaded, activeApp, activeCharacterId, handleBack, closeApp, openApp, characters = [], setActiveCharacterId, addToast,
    apiConfig, updateApiConfig, apiPresets } = useOS();
  const openSettingsAt = (target: 'api' | 'navigation') => { requestSettingsFocus(target); openApp(AppID.Settings); };
  // Keep the global-config and cloud-credential writes together, as Settings does.
  const applyApi = (patch: Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'> | ReturnType<typeof configFromPreset>): boolean => {
    if (updateApiConfig(patch) === false) return false;
    syncAmsgLlmCredentials({ ...apiConfig, ...patch });
    return true;
  };
  const activeCharacter = characters.find(char => char.id === activeCharacterId);
  return enabled && isDataLoaded && !isLocked && !pickerOpen ? <DraggableNavigationBall onBack={handleBack} onHome={closeApp}
    onApi={() => openSettingsAt('api')} apiConfig={apiConfig} apiPresets={apiPresets} characters={characters}
    independentApiCharacterName={activeApp === AppID.Date && activeCharacter?.dialogueApi ? activeCharacter.name : undefined}
    onSwitchPreset={preset => { if (applyApi(configFromPreset(preset))) addToast('已切换到「' + preset.name + '」，下一次请求生效', 'success'); }}
    onManualApi={patch => { if (applyApi(patch)) addToast('API 已保存，下一次请求生效', 'success'); }}
    onShortcut={shortcut => launchNavigationShortcut(shortcut, { characters, openApp, setActiveCharacterId,
      onMissingTarget: () => { addToast('这个角色已不存在，请重新设置槽位', 'error'); openSettingsAt('navigation'); } })}
    onConfigure={() => openSettingsAt('navigation')} /> : null;
}
