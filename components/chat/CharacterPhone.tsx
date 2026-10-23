import React, { useState } from 'react';
import { ArrowLeft, ChatCircleDots, GearSix, Wallet, UsersThree, Images, House } from '@phosphor-icons/react';

type Screen = 'home' | 'wechat' | 'contacts' | 'moments' | 'wallet' | 'settings';
const apps = [
  { id: 'wechat' as const, label: '微信', Icon: ChatCircleDots },
];
// A standalone, extensible character-phone shell. Future apps belong in this registry,
// not in the user phone launcher. No synthetic NPC activity is generated on opening.
export default function CharacterPhone({ name, onClose }: { name: string; onClose: () => void }) {
  const [screen, setScreen] = useState<Screen>('home');
  const title: Record<Screen, string> = { home: name + '的手机', wechat: '微信', contacts: '联系人', moments: '朋友圈', wallet: '钱包', settings: '设置' };
  const goBack = () => screen === 'home' ? onClose() : screen === 'wechat' ? setScreen('home') : setScreen('wechat');
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-3" role="dialog" aria-modal="true" aria-label={title[screen]}>
      <div className="relative flex h-[min(92dvh,800px)] w-full max-w-[420px] flex-col overflow-hidden rounded-[34px] border-[6px] border-slate-900 bg-[#f6f7f9] shadow-2xl">
        <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-4">
          <button type="button" onClick={screen === 'home' ? onClose : goBack} aria-label={screen === 'home' ? '关闭查手机' : '返回'}><ArrowLeft size={22} /></button>
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-slate-800">{title[screen]}</h2>
          <button type="button" onClick={onClose} className="text-xs text-slate-500">关闭</button>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto p-5">
          {screen === 'home' && <div className="grid grid-cols-4 gap-x-3 gap-y-7 pt-6">{apps.map(({ id, label, Icon }) =>
            <button key={id} type="button" onClick={() => setScreen(id)} className="flex flex-col items-center gap-2 text-xs text-slate-700">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm"><Icon size={29} weight="regular" /></span>{label}
            </button>)}</div>}
          {screen === 'wechat' && <div className="space-y-3">
            <button type="button" onClick={() => setScreen('contacts')} className="flex w-full items-center gap-3 rounded-xl bg-white p-4 text-left"><UsersThree size={24} />联系人</button>
            <button type="button" onClick={() => setScreen('moments')} className="flex w-full items-center gap-3 rounded-xl bg-white p-4 text-left"><Images size={24} />朋友圈</button>
            <button type="button" onClick={() => setScreen('wallet')} className="flex w-full items-center gap-3 rounded-xl bg-white p-4 text-left"><Wallet size={24} />钱包</button>
            <button type="button" onClick={() => setScreen('settings')} className="flex w-full items-center gap-3 rounded-xl bg-white p-4 text-left"><GearSix size={24} />设置</button>
            <div className="rounded-xl bg-white p-5 text-center text-sm text-slate-400">聊天记录将在接入 NPC 事件后显示</div>
          </div>}
          {screen === 'contacts' && <p className="rounded-xl bg-white p-5 text-sm text-slate-500">联系人框架已就绪，等待接入角色设定中的 NPC。</p>}
          {screen === 'moments' && <p className="rounded-xl bg-white p-5 text-sm text-slate-500">朋友圈框架已就绪，暂不生成虚构动态。</p>}
          {screen === 'wallet' && <p className="rounded-xl bg-white p-5 text-sm text-slate-500">钱包框架已就绪，余额和交易将在接入集市后显示。</p>}
          {screen === 'settings' && <p className="rounded-xl bg-white p-5 text-sm text-slate-500">预留 NPC 互动、真人模式与 API 设置入口；当前不更改现有配置。</p>}
        </main>
        <footer className="flex shrink-0 justify-center border-t border-slate-200 bg-white py-3">
          <button type="button" onClick={() => setScreen('home')} aria-label="返回手机桌面" className="rounded-full px-8 py-1 text-slate-500"><House size={22} /></button>
        </footer>
      </div>
    </div>
  );
}
