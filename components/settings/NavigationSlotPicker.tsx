import React, { useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CaretRight, MagnifyingGlass, X } from '@phosphor-icons/react';
import { Icons } from '../../constants';
import { AppID } from '../../types';
import { useLocalBackHandler } from '../../hooks/useLocalBackHandler';
import { normalizeShortcutSearchText, shortcutSearchTerms, NAVIGATION_SLOT_APPS, APP_SHORTCUT_ENTRIES, RESOURCE_SHORTCUT_APPS, hasShortcutChildren, getShortcutEntry, type NavigationShortcut, type ShortcutCharacter, type ShortcutWorld, type ShortcutResources } from '../../utils/navigationShortcuts';
import './NavigationSlotPicker.css';
import { setNavigationPickerOpen } from '../../utils/navigationBall';

type Option = { id: string; name: string; detail: string; icon?: string; aliases?: string; onChoose: () => void };
const EMPTY_RESOURCES: ShortcutResources = {};
const APP_SEARCH_ALIASES: Partial<Record<AppID, string>> = {
  [AppID.Room]: '小屋 小小窝 家园 拜访 3D', [AppID.Chat]: '消息 聊天 私聊', [AppID.Character]: '角色 设定',
};
/** Fixed-height rows keep large character libraries bounded without mounting every avatar. */
function OptionList({ options }: { options: Option[] }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(320), [top, setTop] = useState(0);
  useLayoutEffect(() => {
    const node = viewport.current; if (!node) return;
    const measure = () => setHeight(node.clientHeight || 320);
    measure(); const observer = new ResizeObserver(measure); observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const rowHeight = 68, start = Math.max(0, Math.floor(top / rowHeight) - 3);
  const visible = options.slice(start, start + Math.ceil(height / rowHeight) + 6);
  return <div ref={viewport} className="navigation-picker-list" role="list" aria-label="快捷入口选项" style={{ height: Math.min(options.length * rowHeight, 340), maxHeight: '40dvh' }} onScroll={event => setTop(event.currentTarget.scrollTop)}>
    <div style={{ height: options.length * rowHeight, position: 'relative' }}>
      {visible.map((option, index) => {
        const Icon = option.icon ? Icons[option.icon] : null;
        return <div key={option.id} role="listitem" aria-posinset={start + index + 1} aria-setsize={options.length}
          style={{ position: 'absolute', top: (start + index) * rowHeight, left: 0, right: 0, height: rowHeight }}>
          <button type="button" className="navigation-picker-option" onClick={option.onChoose}>
            <span className="navigation-picker-symbol" aria-hidden="true">{Icon ? <Icon /> : option.name.slice(0, 1)}</span>
            <span className="navigation-picker-option-copy"><strong>{option.name}</strong><small>{option.detail}</small></span>
            <CaretRight size={16} aria-hidden="true" />
          </button>
        </div>;
      })}
    </div>
  </div>;
}
export default function NavigationSlotPicker({ slot, characters, resources = EMPTY_RESOURCES, onSelect, onClose }: {
  slot: number; characters: readonly ShortcutCharacter[];
  resources?: ShortcutResources;
  onSelect: (shortcut: NavigationShortcut | null) => void; onClose: () => void;
}) {
  const [appId, setAppId] = useState<AppID | null>(null);
  const [entryId, setEntryId] = useState<string>();
  const [query, setQuery] = useState(''), deferredQuery = useDeferredValue(query);
  const panel = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null);
  const titleId = useId();
  useLayoutEffect(() => { setNavigationPickerOpen(true); return () => setNavigationPickerOpen(false); }, []);
  const entry = appId ? getShortcutEntry(appId, entryId) : undefined;
  const isAppMode = !!appId && !!APP_SHORTCUT_ENTRIES[appId] && !entryId;
  const isResource = !!appId && (entry?.target === 'resources' || RESOURCE_SHORTCUT_APPS.includes(appId));
  const stage = !appId ? 'apps' : isAppMode ? 'modes' : isResource ? 'resources' : 'characters';
  useEffect(() => { search.current?.focus(); }, [stage, entryId]);
  const back = () => { setQuery(''); if (entryId) setEntryId(undefined); else if (appId) setAppId(null); else onClose(); };
  useLocalBackHandler(() => { back(); return true; }, 80);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    search.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const nodes = panel.current?.querySelectorAll<HTMLElement>('button,input,[tabindex="0"]');
      if (!nodes?.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('keydown', keyboard); opener?.focus(); };
  }, [onClose]);
  const chooseApp = (id: AppID) => {
    setQuery('');
    if (hasShortcutChildren(id)) setAppId(id);
    else onSelect({ appId: id });
  };
  const appName = NAVIGATION_SLOT_APPS.find(app => app.id === appId)?.name;
  const modeName = entry?.name;
  const destination = () => ({ appId: appId!, ...(entryId ? { entryId } : {}) });
  const options = useMemo<Option[]>(() => {
    if (!appId) return NAVIGATION_SLOT_APPS.map(app => ({ id: app.id, name: app.name, detail: hasShortcutChildren(app.id) ? '可选择具体入口' : '打开 App', icon: app.icon, aliases: APP_SEARCH_ALIASES[app.id], onChoose: () => chooseApp(app.id) }));
    if (isAppMode) return APP_SHORTCUT_ENTRIES[appId]!.map(mode => ({ ...mode, onChoose: () => { if (mode.target) { setEntryId(mode.id); setQuery(''); } else onSelect({ appId, entryId: mode.id }); } }));
    if (isResource) return (resources[appId] || []).map(item => ({ id: item.id, name: item.name, detail: `打开${modeName || appName}中的这项内容`, onChoose: () => onSelect({ ...destination(), resourceId: item.id, targetName: item.name }) }));
    return characters.map(character => ({ id: character.id, name: character.name,
      detail: appId === AppID.Chat ? '进入与 ta 的聊天' : `打开 ta 的${modeName || appName}`,
      onChoose: () => onSelect({ appId, ...(entryId ? { entryId } : {}), characterId: character.id, targetName: character.name }) }));
  }, [appId, entryId, characters, resources, onSelect]);
  const searchKeys = useMemo(() => options.map(option => normalizeShortcutSearchText(`${option.name} ${option.detail} ${option.id} ${option.aliases || ''}`)), [options]);
  const filtered = useMemo(() => {
    const terms = shortcutSearchTerms(deferredQuery);
    return terms.length ? options.filter((_, index) => terms.every(term => searchKeys[index].includes(term))) : options;
  }, [options, searchKeys, deferredQuery]);
  return <div className="navigation-picker-overlay">
    <div className="navigation-picker-backdrop" onClick={onClose} />
    <div ref={panel} className="navigation-picker" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header><button type="button" aria-label="返回选择上一级" onClick={back}><ArrowLeft size={20} /></button>
        <div><small>槽位 {slot + 1}</small><h3 id={titleId}>{!appId ? '选择快捷入口' : isAppMode ? '选择 App 分区' : isResource ? '选择具体内容' : '选择角色'}</h3></div>
        <button type="button" aria-label="关闭快捷入口选择" onClick={onClose}><X size={20} /></button></header>
      {appId && <p className="navigation-picker-path">{[appName, modeName].filter(Boolean).join(' / ')}</p>}
      <label className="navigation-picker-search"><MagnifyingGlass size={18} aria-hidden="true" />
        <input ref={search} value={query} aria-label="搜索快捷入口" placeholder={stage === 'apps' ? '搜索 App 名称' : stage === 'modes' ? '搜索分区' : isResource ? '搜索内容名称' : '搜索角色名称'} onChange={event => setQuery(event.target.value)} />
        {query && <button type="button" aria-label="清空搜索" onClick={() => { setQuery(''); search.current?.focus(); }}><X size={16} /></button>}
      </label>
      {appId && <button type="button" className="navigation-picker-main-entry" onClick={() => onSelect(entry?.target === 'characters' ? { appId } : destination())}>只打开{entry?.target === 'characters' ? appName : modeName || appName}{stage === 'modes' || entry?.target === 'characters' ? '首页' : '列表'}<CaretRight size={16} /></button>}
      <p className="navigation-picker-count" role="status">{`${filtered.length} 个${stage === 'apps' ? 'App' : stage === 'modes' ? '分区' : isResource ? '内容' : '角色'}`}</p>
      {filtered.length ? <OptionList key={`${stage}:${deferredQuery}`} options={filtered} />
        : <div className="navigation-picker-empty">{query ? '没有匹配结果，试试其他关键词' : isResource ? '暂无内容，可以先打开 App 添加' : '暂无可选角色'}</div>}
      <footer><button type="button" onClick={() => onSelect(null)}>清空槽位</button><button type="button" onClick={onClose}>取消</button></footer>
    </div>
  </div>;
}
