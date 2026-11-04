// @vitest-environment jsdom
import React from 'react';
import {act} from 'react-dom/test-utils';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,expect,it} from 'vitest';
import PhoneWeChatPayCards,{parseWeChatPayNotice} from '../components/chat/PhoneWeChatPayCards';
import type {PhoneMessage} from './characterPhoneIdentity';

let div:HTMLDivElement;let root:ReturnType<typeof createRoot>;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;div=document.createElement('div');document.body.appendChild(div);root=createRoot(div);});
afterEach(async()=>{await act(async()=>root.unmount());div.remove();});
it('preserves real saved notice data without inventing merchant or payment amount',()=>{
 expect(parseWeChatPayNotice('微信支付通知：深圳市黑刺纹身器材商行 · 支出 ¥680.00；定制纯黑割线色料与一次性针嘴补货')).toEqual({
  merchant:'深圳市黑刺纹身器材商行',direction:'支出',amount:'680.00',detail:'定制纯黑割线色料与一次性针嘴补货'
 });
 expect(parseWeChatPayNotice('微信支付通知：美宜佳便利店 · 支出 ¥46.00；两包烟和一罐冰美式')?.amount).toBe('46.00');
 expect(parseWeChatPayNotice('微信支付通知：虚构店 · 收入 ¥1,200.50；款项入账')?.amount).toBe('1,200.50');
 expect(parseWeChatPayNotice('随便一条普通聊天')).toBeNull();
 expect(parseWeChatPayNotice('微信支付通知：虚构店 · 支出 ¥0.00；无效')).toBeNull();
});
it('renders receipt cards at full width without clickable transaction details',async()=>{
 const messages:PhoneMessage[]=[{speaker:{role:'contact',contactId:'service:微信支付'},
 text:'微信支付通知：深圳市黑刺纹身器材商行 · 支出 ¥680.00；定制纯黑割线色料与一次性针嘴补货',
 createdAt:Date.UTC(2026,10,1,0,27)}];
 await act(async()=>root.render(React.createElement(PhoneWeChatPayCards,{messages})));
 expect(div.querySelectorAll('[data-testid="wechat-pay-card"]')).toHaveLength(1);
 expect(div.textContent).toContain('¥680.00');
 expect(div.textContent).toContain('深圳市黑刺纹身器材商行');
 expect(div.textContent).toContain('商品说明');
 expect(div.querySelectorAll('button,a')).toHaveLength(0);
});
