/** Character-owned browser history.
 * A real Baidu search opens Baidu itself; this module does not claim to fetch
 * actual search results or silently impersonate Char's web activity.
 */
export type PhoneBrowserVisit = {
  id: string;
  characterId: string;
  actor: 'user' | 'char';
  kind: 'baidu-search' | 'open-url';
  query: string;
  url: string;
  visitedAt: number;
};
export const CHARACTER_PHONE_BROWSER_CHANGED = 'sully:character-phone-browser-changed';
const key = (id: string) => 'sully_character_phone_browser_v1:' + id;
const BAIDU_URL = 'https://www.baidu.com/s';

export function getBaiduSearchUrl(query: string): string | null {
  const q = query.trim().slice(0, 200);
  if (!q) return null;
  const url = new URL(BAIDU_URL);
  url.searchParams.set('wd', q);
  return url.toString();
}

/** Accept only public http(s) navigation; no javascript/data/file schemes. */
export function resolvePhoneBrowserNavigation(input: string): {
  kind: PhoneBrowserVisit['kind']; query: string; url: string;
} | null {
  const value = input.trim().slice(0, 2048);
  if (!value) return null;
  if (/^(?:javascript|data|file|blob|about|chrome|intent):/i.test(value)) return null;
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
      if (!url.hostname || url.username || url.password) return null;
      return { kind: 'open-url', query: '', url: url.toString() };
    } catch { return null; }
  }
  // Plain hostnames may be entered as URLs; do not accidentally treat words
  // with spaces as domain names. For anything else, use Baidu's real search.
  if (/^(?:[\w-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/i.test(value)) {
    try {
      const url = new URL('https://' + value);
      return { kind: 'open-url', query: '', url: url.toString() };
    } catch { /* fall through to search */ }
  }
  const url = getBaiduSearchUrl(value);
  return url ? { kind: 'baidu-search', query: value.slice(0, 200), url } : null;
}

export function readCharacterPhoneBrowserHistory(characterId: string): PhoneBrowserVisit[] {
  if (!characterId || typeof localStorage === 'undefined') return [];
  try {
    const value = JSON.parse(localStorage.getItem(key(characterId)) || '[]');
    return Array.isArray(value) ? value.filter((v): v is PhoneBrowserVisit =>
      !!v && v.characterId === characterId && typeof v.id === 'string' &&
      typeof v.url === 'string' && /^https?:\/\//i.test(v.url) &&
      Number.isFinite(v.visitedAt) && (v.actor === 'user' || v.actor === 'char') &&
      (v.kind === 'baidu-search' || v.kind === 'open-url')
    ).sort((a,b)=>b.visitedAt-a.visitedAt).slice(0, 100) : [];
  } catch { return []; }
}

function writeHistory(characterId: string, rows: PhoneBrowserVisit[]): boolean {
  try {
    localStorage.setItem(key(characterId), JSON.stringify(rows.slice(0,100)));
    if (typeof window !== 'undefined')
      window.dispatchEvent(new CustomEvent(CHARACTER_PHONE_BROWSER_CHANGED, {detail:{characterId}}));
    return true;
  } catch { return false; }
}

export function recordPhoneBrowserNavigation(
  characterId: string,
  navigation: { kind: PhoneBrowserVisit['kind']; query: string; url: string },
  actor: PhoneBrowserVisit['actor'] = 'user',
): PhoneBrowserVisit | null {
  if (!characterId || !/^https?:\/\//i.test(navigation.url)) return null;
  // Validating via URL also prevents forged non-web schemes reaching history.
  try {
    const url = new URL(navigation.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  } catch { return null; }
  const now = Date.now();
  const previous = readCharacterPhoneBrowserHistory(characterId);
  const entry: PhoneBrowserVisit = {
    id: crypto.randomUUID(), characterId, actor,
    kind: navigation.kind, query:navigation.query.slice(0,200),
    url:navigation.url.slice(0,2048), visitedAt:now,
  };
  const result = [entry, ...previous.filter(p=>p.url !== entry.url)].slice(0,100);
  return writeHistory(characterId,result) ? entry : null;
}

export function deletePhoneBrowserVisit(characterId: string, entryId: string): boolean {
  const current = readCharacterPhoneBrowserHistory(characterId);
  if (!current.some(r => r.id === entryId)) return false;
  return writeHistory(characterId,current.filter(r=>r.id!==entryId));
}

export function clearPhoneBrowserHistory(characterId: string): boolean {
  return writeHistory(characterId,[]);
}
