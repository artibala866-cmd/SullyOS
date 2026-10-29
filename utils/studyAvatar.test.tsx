// @vitest-environment jsdom
import React,{act} from 'react';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {createRoot,type Root} from 'react-dom/client';
import StudyAvatar from '../apps/StudyAvatar';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement,root:Root;
beforeEach(()=>{
  host=document.createElement('div');document.body.appendChild(host);
  root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();});
function show(value:string,name='夜川'){
  act(()=>root.render(<StudyAvatar value={value} name={name} className="h-10 w-10"/>));
}
describe('美化头像 · 真实图片、旧表情与失效资源安全降级',()=>{
  it('旧版角色的表情头像显示表情而不是错误图片 URL',()=>{
    show('🐱','猫猫');
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('🐱');
  });
  it('有效图片使用图片组件，加载失败降级为角色名，并能切换到新头像',()=>{
    show('https://images.example.com/old.png');
    const image=host.querySelector('img');
    expect(image?.getAttribute('src')).toBe('https://images.example.com/old.png');
    act(()=>image?.dispatchEvent(new Event('error')));
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('夜');
    show('https://images.example.com/new.png');
    expect(host.querySelector('img')?.getAttribute('src')).toBe('https://images.example.com/new.png');
  });
  it('空头像正常显示首字占位',()=>{
    show('','知夏');
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('知');
  });
});
