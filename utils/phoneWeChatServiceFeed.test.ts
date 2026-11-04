// @vitest-environment jsdom
import React from 'react';
import {act} from 'react-dom/test-utils';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect} from 'vitest';
import PhoneWeChatServiceFeed,{resolvePhoneServiceFeedKind} from '../components/chat/PhoneWeChatServiceFeed';
import type {PhoneMessage} from './characterPhoneIdentity';

const messages:PhoneMessage[]=[
  {speaker:{role:'contact',contactId:'service:绘画教室'},text:'课程通知：正课改图班0期内测来了！',createdAt:Date.UTC(2026,10,4,7,0)},
  {speaker:{role:'contact',contactId:'service:绘画教室'},text:'毛厂的模特写生练习与作画心得',createdAt:Date.UTC(2026,10,3,7,0)},
  {speaker:{role:'contact',contactId:'service:绘画教室'},text:'构图知识整理与技法分享',createdAt:Date.UTC(2026,10,2,7,0)},
];
let element:HTMLDivElement;let root:Root;
beforeEach(()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  element=document.createElement('div');document.body.appendChild(element);root=createRoot(element);
});
afterEach(async()=>{await act(async()=>root.unmount());element.remove();});
it('routes explicit and legacy service/public-account types without relying on display name alone',()=>{
  expect(resolvePhoneServiceFeedKind({name:'绘画教室',kind:'service',serviceType:'official'})).toBe('official');
  expect(resolvePhoneServiceFeedKind({name:'Krenz绘画教室',kind:'service',serviceType:'service'})).toBe('service');
  expect(resolvePhoneServiceFeedKind({name:'某某日报',kind:'service'})).toBe('official');
  expect(resolvePhoneServiceFeedKind({name:'物流通知',kind:'service'})).toBe('service');
});
it('shows service notice + two-column gray-image posts using only stored text',async()=>{
 await act(async()=>root.render(React.createElement(PhoneWeChatServiceFeed,{messages,name:'绘画教室',kind:'service'})));
 expect(element.querySelector('[data-testid="phone-service-feed"]')).not.toBeNull();
 expect(element.textContent).toContain('通知');expect(element.textContent).toContain('贴图');
 expect(element.textContent).toContain('正课改图班0期内测来了');
 expect(element.querySelectorAll('[data-testid="service-feed-tile"]')).toHaveLength(2);
 expect(element.querySelectorAll('[aria-label="图片占位"]').length).toBeGreaterThan(1);
 expect(element.querySelector('img')).toBeNull();
});
it('shows official quick news + read feed with neutral thumbnails, no fake articles',async()=>{
 await act(async()=>root.render(React.createElement(PhoneWeChatServiceFeed,{messages,name:'某某日报',kind:'official'})));
 expect(element.querySelector('[data-testid="phone-official-feed"]')).not.toBeNull();
 expect(element.textContent).toContain('快讯');expect(element.textContent).toContain('看一看');
 expect(element.textContent).toContain('查看其余2条');
 expect(element.textContent).toContain('构图知识整理');
 expect(element.querySelectorAll('[aria-label="图片占位"]').length).toBeGreaterThan(3);
 expect(element.querySelector('img')).toBeNull();
 expect(element.querySelector('button')).toBeNull();
});

it('never invents fixed sample content, subscription status or empty article cards',async()=>{
 const saved:PhoneMessage[]=[
   {speaker:{role:'contact',contactId:'service:测试'},text:'通知',createdAt:Date.UTC(2026,10,4,7,0)},
 ];
 await act(async()=>root.render(React.createElement(PhoneWeChatServiceFeed,{messages:saved,name:'角色自己的服务通知',kind:'service'})));
 expect(element.textContent).toContain('角色自己的服务通知');
 expect(element.textContent).not.toContain('我的关注');
 expect(element.textContent).not.toContain('正课改图班');
 expect(element.textContent).not.toContain('贴图');
 expect(element.textContent).not.toContain('服务通知');
 expect(element.querySelectorAll('[data-testid="service-feed-tile"]')).toHaveLength(0);
 await act(async()=>root.render(React.createElement(PhoneWeChatServiceFeed,{messages:saved,name:'角色订阅的公众号',kind:'official'})));
 expect(element.textContent).not.toContain('看一看');
 expect(element.textContent).not.toContain('更多消息');
 expect(element.querySelectorAll('[data-testid="official-article-tile"]')).toHaveLength(0);
 await act(async()=>root.render(React.createElement(PhoneWeChatServiceFeed,{messages:[],name:'空账号',kind:'official'})));
 expect(element.textContent).toBe('');
 expect(element.querySelectorAll('[aria-label="图片占位"]')).toHaveLength(0);
});
