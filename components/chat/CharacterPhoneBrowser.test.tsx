// @vitest-environment jsdom
import React from 'react';
import {act} from 'react-dom/test-utils';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import CharacterPhoneBrowser from './CharacterPhoneBrowser';
import {recordPhoneBrowserNavigation,resolvePhoneBrowserNavigation} from '../../utils/characterPhoneBrowser';
import type {CharacterProfile,UserProfile} from '../../types';

vi.mock('../../utils/characterPhoneBrowserAutonomy',()=>({
  runCharacterPhoneBrowserAutonomy:vi.fn(async()=>({status:'skipped',count:0,reason:'没有搜索需求'})),
}));

let container:HTMLDivElement;
let root:Root|null=null;
beforeEach(()=>{
  localStorage.clear();
  vi.stubGlobal('crypto',{randomUUID:()=> 'ui-test-visit'});
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  container=document.createElement('div');
  document.body.appendChild(container);
  root=createRoot(container);
});
afterEach(async()=>{
  if(root) await act(async()=>{root?.unmount();});
  root=null;
  container.remove();
  vi.unstubAllGlobals();
});

it('shows an actual saved query as a visual card, with insights and verification only on detail view',async()=>{
  const navigation=resolvePhoneBrowserNavigation('冷藏曲奇面团烘烤温度')!;
  recordPhoneBrowserNavigation('char-ui',navigation,'char',{
    title:'曲奇面团烘烤处理',summary:'想知道面团需不需要回温',
    aiJudgement:'今天想给妹妹烤饼干',afterSearchThought:'噢，可能关键在预热和烤制时长，打开结果再确认一下。',
    mood:'兴奋',origin:'ai-generated',
  });
  await act(async()=>{root?.render(<CharacterPhoneBrowser
    characterId="char-ui" char={{id:'char-ui',name:'小麦'} as CharacterProfile}
    userProfile={{name:'User'} as UserProfile} groups={[]}
    api={{baseUrl:'',apiKey:'',model:''}}
  />);});
  expect(container.querySelector('[aria-label="搜索记录图文封面"]')).not.toBeNull();
  expect(container.textContent).toContain('百度');
  expect(container.textContent).toContain('网页');
  expect(container.textContent).not.toContain('卡片直接展示');
  expect(container.textContent).not.toContain('这里展示保存的搜索词');
  expect(container.textContent).toContain('想了解');
  expect(container.textContent).toContain('心声');
  expect(container.textContent).not.toContain('记录缩略预览');
  expect(container.textContent).toContain('冷藏曲奇面团烘烤温度');
  expect(container.textContent).not.toContain('搜完后的心声');
  const card=container.querySelector<HTMLButtonElement>('[aria-label="查看浏览记录详情：曲奇面团烘烤处理"]');
  expect(card).not.toBeNull();
  await act(async()=>card!.click());
  expect(container.textContent).toContain('想了解');
  expect(container.textContent).toContain('搜完后的心声');
  expect(container.textContent).toContain('可能关键在预热和烤制时长');
  const link=Array.from(container.querySelectorAll('a')).find(a=>a.textContent?.includes('打开真实百度搜索核验'));
  expect(link?.href).toBe(navigation.url);
  expect(link?.target).toBe('_blank');
  expect(link?.rel).toBe('noopener noreferrer');
  const back=Array.from(container.querySelectorAll('button')).find(b=>b.textContent?.includes('返回浏览记录'));
  await act(async()=>back!.click());
  expect(container.textContent).not.toContain('搜完后的心声');
});
