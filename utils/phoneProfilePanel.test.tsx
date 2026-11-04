// @vitest-environment jsdom
import React from 'react';
import {act} from 'react-dom/test-utils';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import CharacterPhoneProfilePanel from '../components/chat/CharacterPhoneProfilePanel';

let root:Root;let element:HTMLDivElement;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;element=document.createElement('div');document.body.appendChild(element);root=createRoot(element);});
afterEach(async()=>{await act(async()=>root.unmount());element.remove();});
it('keeps all original profile controls with matching cards and no long footer',async()=>{
 const avatar=vi.fn(),toggle=vi.fn(),poke=vi.fn(),adjust=vi.fn();
 await act(async()=>root.render(<CharacterPhoneProfilePanel
   name="爸爸" avatar="" onOpenAvatarLibrary={avatar}
   manualGlimpseEnabled={false} onToggleManualGlimpse={toggle}
   glimpseNotice="" glimpseCount={2} lifeHistory={<div data-testid="real-life-list">真实记录</div>}
   pokeSuffix="的肩膀" onPoke={poke} onAdjustProfile={adjust} selfAutoBusy={false}
 />));
 expect(element.textContent).toContain('头像库');
 expect(element.textContent).toContain('独立生活侧面 AI 展开');
 expect(element.textContent).toContain('已发生的生活片段');
 expect(element.textContent).toContain('戳一戳后缀');
 expect(element.textContent).not.toContain('与私聊共用头像库和戳一戳功能');
 const input=element.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
 await act(async()=>input.click());expect(toggle).toHaveBeenCalledWith(true);
 const library=Array.from(element.querySelectorAll('button')).filter(x=>x.getAttribute('aria-label')==='打开角色头像库'||x.textContent?.includes('头像库'));
 await act(async()=>library[0].click());expect(avatar).toHaveBeenCalled();
 const buttons=Array.from(element.querySelectorAll('button'));
 await act(async()=>buttons.find(x=>x.textContent==='戳一戳')!.click());expect(poke).toHaveBeenCalledTimes(1);
 await act(async()=>buttons.find(x=>x.textContent==='让 Char 自改')!.click());expect(adjust).toHaveBeenCalledTimes(1);
});
