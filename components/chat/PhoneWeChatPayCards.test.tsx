// @vitest-environment jsdom
import React from 'react';
import {act} from 'react-dom/test-utils';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,expect,it} from 'vitest';
import PhoneWeChatPayCards,{parseWeChatPayNotice} from './PhoneWeChatPayCards';
import type {PhoneMessage} from '../../utils/characterPhoneIdentity';

let element:HTMLDivElement;
let root:Root;
beforeEach(()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  element=document.createElement('div');
  document.body.appendChild(element);
  root=createRoot(element);
});
afterEach(async()=>{
  await act(async()=>root.unmount());
  element.remove();
});

it('uses only saved merchant, amount, detail; gracefully handles old arbitrary service messages',()=>{
  const parsed=parseWeChatPayNotice('微信支付通知：深圳市黑刺纹身器材商行 · 支出 ¥680.00；定制纯黑割线色料与一次性针嘴补货');
  expect(parsed).toEqual({
    merchant:'深圳市黑刺纹身器材商行',direction:'支出',amount:'680.00',
    detail:'定制纯黑割线色料与一次性针嘴补货'
  });
  expect(parseWeChatPayNotice('微信支付通知：美宜佳便利店 · 支出 ¥46.00；两包烟和一罐冰美式')?.amount).toBe('46.00');
  expect(parseWeChatPayNotice('微信支付通知：虚构店 · 收入 ¥1,200.50；款项入账')?.amount).toBe('1,200.50');
  expect(parseWeChatPayNotice('随便一条聊天内容')).toBeNull();
  expect(parseWeChatPayNotice('微信支付通知：虚构店 · 支出 ¥0.00；无效')).toBeNull();
});

it('shows screenshot-sized, read-only WeChat Pay merchant cards instead of chat bubbles',async()=>{
  const messages:PhoneMessage[]=[
    {speaker:{role:'contact',contactId:'service:微信支付'},
      text:'微信支付通知：深圳市黑刺纹身器材商行 · 支出 ¥680.00；定制纯黑割线色料与一次性针嘴补货',
      createdAt:Date.UTC(2026,10,1,0,27)},
    {speaker:{role:'contact',contactId:'service:微信支付'},text:'一次旧服务提醒',createdAt:Date.UTC(2026,10,2,0,27)}
  ];
  await act(async()=>root.render(<PhoneWeChatPayCards messages={messages}/>));
  expect(element.querySelectorAll('[data-testid="wechat-pay-card"]')).toHaveLength(2);
  expect(element.textContent).toContain('深圳市黑刺纹身器材商行');
  expect(element.textContent).toContain('¥680.00');
  expect(element.textContent).toContain('商品说明');
  expect(element.textContent).toContain('一次旧服务提醒');
  expect(element.querySelector('button')).toBeNull();
  expect(element.querySelector('a')).toBeNull();
  expect(element.textContent).not.toContain('输入聊天方向');
  expect(element.textContent).not.toContain('虚构银行卡');
});
