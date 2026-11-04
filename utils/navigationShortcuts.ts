import { INSTALLED_APPS } from '../constants';
import { AppID } from '../types';

export const NAVIGATION_SLOT_APPS = INSTALLED_APPS.filter(app => app.id !== AppID.CharCreatorDev);
type Entry = { id: string; name: string; detail: string; target?: 'characters' | 'resources' };
const pages = (...items: [string, string, Entry['target']?][]): Entry[] => items.map(([id, name, target]) => ({ id, name, detail: target === 'characters' ? '继续选择角色' : target === 'resources' ? '继续选择具体内容' : '直接打开这个页面', target }));
/** Only destinations with a matching App receiver belong here. No App modules are imported. */
export const APP_SHORTCUT_ENTRIES: Partial<Record<AppID, Entry[]>> = {
  [AppID.Character]: pages(['identity', '角色设定', 'characters'], ['memory', '记忆', 'characters'], ['impression', '印象', 'characters'], ['plates', '门牌', 'characters'], ['chibi', '手办柜', 'characters'], ['stats', '角色统计', 'characters']),
  [AppID.Date]: pages(['entry', '见面准备', 'characters'], ['settings', '见面设置', 'characters'], ['history', '见面记录', 'characters'], ['story', '剧情剧场']),
  [AppID.Call]: pages(['role-select', '通话准备', 'characters'], ['history', '通话记录']),
  [AppID.MemoryPalace]: pages(['palace', '记忆房间', 'characters'], ['pixelHome', '像素家园', 'characters'], ['all', '全部记忆', 'characters'], ['boxes', '记忆盒', 'characters'], ['settings', '角色记忆设置', 'characters'], ['globalSettings', '全局记忆设置']),
  [AppID.Music]: pages(['profile', '我的音乐'], ['search', '搜索音乐'], ['player', '正在播放'], ['visit_char', '角色音乐角落', 'characters'], ['settings', '音乐设置']),
  [AppID.Songwriting]: pages(['shelf', '乐谱', 'resources'], ['create', '新建乐谱', 'characters']),
  [AppID.Appearance]: pages(['theme', '系统主题'], ['icons', '应用图标'], ['presets', '外观预设'], ['sharing', '外观装扮']),
  [AppID.Social]: pages(['home', '动态首页'], ['me', '我的主页']),
  [AppID.Schedule]: pages(['tasks', '专注清单'], ['commissions', '排单'], ['calendar', '课程表'], ['study', '自习室']),
};
export const CHARACTER_SHORTCUT_APPS = [AppID.Room, AppID.Chat, AppID.Journal, AppID.XhsFreeRoam, AppID.Guidebook];
export const RESOURCE_SHORTCUT_APPS = [AppID.GroupChat, AppID.Worldbook];
export const hasShortcutChildren = (appId: AppID) => !!APP_SHORTCUT_ENTRIES[appId] || CHARACTER_SHORTCUT_APPS.includes(appId) || RESOURCE_SHORTCUT_APPS.includes(appId);
export const getShortcutEntry = (appId: AppID, entryId?: string) => APP_SHORTCUT_ENTRIES[appId]?.find(entry => entry.id === entryId);
export type NavigationShortcut = {
  appId: AppID;
  characterId?: string;
  entryId?: string;
  resourceId?: string;
  /** Display hint only; routing always uses the stable ID. */
  targetName?: string;
};
export type ShortcutCharacter = { id: string; name: string };
export type ShortcutWorld = { id: string; name: string };
export type ShortcutResources = Partial<Record<AppID, readonly ShortcutWorld[]>>;
export const normalizeShortcutSearchText = (value: string) => value.normalize('NFKC').toLocaleLowerCase().trim();
export const shortcutSearchTerms = (query: string) => normalizeShortcutSearchText(query).split(/\s+/).filter(Boolean);
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;
export function normalizeNavigationShortcut(value: unknown): NavigationShortcut | null {
  const raw: Record<string, unknown> | null = typeof value === 'string' ? { appId: value } : value && typeof value === 'object' ? value as Record<string, unknown> : null;
  const app = NAVIGATION_SLOT_APPS.find(item => item.id === raw?.appId);
  if (!raw || !app || (app.id === AppID.Room && raw.roomTab === 'worldHome')) return null;
  const shortcut: NavigationShortcut = { appId: app.id };
  const entry = getShortcutEntry(app.id, typeof raw.entryId === 'string' ? raw.entryId : undefined);
  if (entry) shortcut.entryId = entry.id;
  if (CHARACTER_SHORTCUT_APPS.includes(app.id) || entry?.target === 'characters' || (app.id === AppID.Character && !entry)) {
    if (validId(raw.characterId)) shortcut.characterId = raw.characterId;
  }
  if ((RESOURCE_SHORTCUT_APPS.includes(app.id) || entry?.target === 'resources') && validId(raw.resourceId)) shortcut.resourceId = raw.resourceId;
  if ((shortcut.characterId || shortcut.resourceId) && typeof raw.targetName === 'string') shortcut.targetName = raw.targetName.trim().slice(0, 80);
  return shortcut;
}
export function describeNavigationShortcut(shortcut: NavigationShortcut | null, characters: readonly ShortcutCharacter[] = []) {
  const app = NAVIGATION_SLOT_APPS.find(item => item.id === shortcut?.appId);
  if (!shortcut || !app) return { name: '未设置', detail: '选择 App 或具体入口' };
  const entry = getShortcutEntry(shortcut.appId, shortcut.entryId);
  const target = shortcut.characterId ? characters.find(item => item.id === shortcut.characterId)?.name || shortcut.targetName || '指定角色'
    : shortcut.resourceId ? shortcut.targetName || '指定内容' : '';
  return { name: target || entry?.name || app.name, detail: [app.name, entry?.name, target].filter(Boolean).filter((part, index, list) => index === 0 || part !== list[index - 1]).join(' › ') };
}
export function matchesShortcutSearch(text: string, query: string) {
  const haystack = normalizeShortcutSearchText(text);
  return shortcutSearchTerms(query).every(part => haystack.includes(part));
}
