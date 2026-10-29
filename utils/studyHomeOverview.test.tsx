// @vitest-environment jsdom
import React,{act} from 'react';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {createRoot,type Root} from 'react-dom/client';
import StudyHomeOverview from '../apps/StudyHomeOverview';
import {emptyWorkspace,localDate,readWorkspace,type Commission,type TimetableClass} from './sullyWorkspace';

vi.mock('./sullyWorkspace',async importOriginal=>{
  const original=await importOriginal<typeof import('./sullyWorkspace')>();
  return {...original,readWorkspace:vi.fn()};
});
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const goCommission=vi.fn(),goCourse=vi.fn();
let host:HTMLDivElement,root:Root;
const makeCommission=(date:string):Commission=>({
  id:'c1',title:'真实画稿',client:'客户名字保密',type:'头像',brief:'私密需求',
  acceptedAt:'',dueDate:date,plannedDate:date,stage:'线稿',priority:1,status:'active',
  remainingMinutes:100,bufferMinutes:20,price:'2000',paid:false,note:'合同原文',order:1,
});
const makeCourse=():TimetableClass=>({
  id:'class-1',name:'真实素描课',weekday:new Date().getDay(),
  start:'09:00',end:'10:30',location:'教室',teacher:'',note:'私密笔记',until:'',
});
beforeEach(()=>{
  vi.mocked(readWorkspace).mockReset();
  goCommission.mockReset();goCourse.mockReset();
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();});
const render=async()=>{
  await act(async()=>{root.render(<StudyHomeOverview onCommissions={goCommission} onCourses={goCourse}/>);});
};
describe('P2 密度的真实学习室概览卡',()=>{
  it('读取原本委托、课程、作业，展示紧凑月历并可跳到原页面',async()=>{
    const day=localDate(new Date());
    vi.mocked(readWorkspace).mockResolvedValueOnce({
      ...emptyWorkspace(),commissions:[makeCommission(day)],
      classes:[makeCourse()],
      homework:[{id:'h1',classId:'class-1',title:'真实手绘作业',dueAt:day+'T18:00',minutes:30,done:false,note:'隐私'}],
    });
    await render();
    expect(host.textContent).toContain('委托日程');
    expect(host.textContent).toContain('真实素描课');
    expect(host.textContent).toContain('真实手绘作业');
    expect(host.textContent).not.toContain('客户名字保密');
    expect(host.textContent).not.toContain('合同原文');
    const dates=host.querySelectorAll('button[aria-label*="项委托事件"]');
    expect(dates.length).toBeGreaterThanOrEqual(28);
    const todayButton=host.querySelector<HTMLButtonElement>(`button[aria-label^="${day}"]`);
    expect(todayButton).toBeTruthy();
    expect(todayButton?.getAttribute('aria-pressed')).toBe('true');
    expect(host.textContent).toContain('真实画稿');
    act(()=>{host.querySelector<HTMLButtonElement>('button[aria-label="查看全部课程"]')?.click();});
    expect(goCourse).toHaveBeenCalledOnce();
    const fullMonth=Array.from(host.querySelectorAll('button')).find(x=>x.textContent?.includes('完整月历'));
    act(()=>{fullMonth?.dispatchEvent(new MouseEvent('click',{bubbles:true}));});
    expect(goCommission).toHaveBeenCalledOnce();
  });
  it('空工作空间没有伪造数据，数据库失败不假装资料为零',async()=>{
    vi.mocked(readWorkspace).mockRejectedValueOnce(new Error('IndexedDB unavailable'));
    await render();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('无法读取');
    expect(host.textContent).not.toContain('真实画稿');
  });
});
