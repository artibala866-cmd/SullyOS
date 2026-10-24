// @vitest-environment jsdom
import {beforeEach,afterEach,describe,expect,it,vi} from 'vitest';
import {
  clearPhoneBrowserHistory, deletePhoneBrowserVisit,
  getBaiduSearchUrl, readCharacterPhoneBrowserHistory,
  recordPhoneBrowserNavigation, resolvePhoneBrowserNavigation,
} from './characterPhoneBrowser';
let seq=0;
beforeEach(()=>{localStorage.clear();seq=0;vi.stubGlobal('crypto',{randomUUID:()=>String(++seq)})});
afterEach(()=>vi.unstubAllGlobals());

describe('real Baidu navigation in character-owned browser',()=>{
  it('builds official Baidu query URLs without pretending to return search results',()=>{
    const url = getBaiduSearchUrl('漫画 角色设定')!;
    const parsed = new URL(url);
    expect(parsed.host).toBe('www.baidu.com');
    expect(parsed.pathname).toBe('/s');
    expect(parsed.searchParams.get('wd')).toBe('漫画 角色设定');
    expect(resolvePhoneBrowserNavigation('漫画 角色设定')).toMatchObject({
      kind:'baidu-search',query:'漫画 角色设定',url,
    });
  });

  it('accepts only safe web schemes, including pasted https addresses',()=>{
    expect(resolvePhoneBrowserNavigation('javascript:alert(1)')).toBeNull();
    expect(resolvePhoneBrowserNavigation('data:text/html,hi')).toBeNull();
    expect(resolvePhoneBrowserNavigation('file:///etc/passwd')).toBeNull();
    expect(resolvePhoneBrowserNavigation('https://user:pass@example.com')).toBeNull();
    expect(resolvePhoneBrowserNavigation('www.baidu.com')?.url).toBe('https://www.baidu.com/');
    expect(resolvePhoneBrowserNavigation('https://www.baidu.com/s?wd=test')?.kind).toBe('open-url');
  });

  it('isolates histories by Char and explicitly labels User rather than Char as the actor',()=>{
    const target=resolvePhoneBrowserNavigation('查资料')!;
    const saved=recordPhoneBrowserNavigation('char-a',target);
    expect(saved?.actor).toBe('user');
    expect(readCharacterPhoneBrowserHistory('char-a')).toHaveLength(1);
    expect(readCharacterPhoneBrowserHistory('char-b')).toHaveLength(0);
    const again=recordPhoneBrowserNavigation('char-a',target);
    expect(again?.url).toBe(saved?.url);
    expect(readCharacterPhoneBrowserHistory('char-a')).toHaveLength(1);
    expect(deletePhoneBrowserVisit('char-a',again!.id)).toBe(true);
    expect(readCharacterPhoneBrowserHistory('char-a')).toHaveLength(0);
    recordPhoneBrowserNavigation('char-b',target);
    expect(clearPhoneBrowserHistory('char-b')).toBe(true);
    expect(readCharacterPhoneBrowserHistory('char-b')).toHaveLength(0);
  });
});
