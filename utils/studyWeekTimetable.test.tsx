// @vitest-environment jsdom
import React,{act} from 'react';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {createRoot,type Root} from 'react-dom/client';
import StudyWeekTimetable from '../apps/StudyWeekTimetable';
import type {TimetableClass} from './sullyWorkspace';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let container:HTMLDivElement;
let root:Root;
const pick=vi.fn();
const make=(name:string,weekday:number,until=''):TimetableClass=>({
 id:name,name,weekday,start:'09:00',end:'10:15',until,teacher:'',location:'',
 note:'私人课程备注',cancelled:false,
});
beforeEach(()=>{
  container=document.createElement('div');
  document.body.append(container);
  root=createRoot(container);
  pick.mockReset();
});
afterEach(()=>{
  act(()=>root.unmount());container.remove();
});
const render=(classes:TimetableClass[])=>{
  act(()=>root.render(<StudyWeekTimetable classes={classes} selectedId="" onSelect={pick}/>));
};
const tap=(label:string)=>{
  const element=Array.from(container.querySelectorAll('button')).find(x=>x.getAttribute('aria-label')===label);
  expect(element).toBeTruthy();
  act(()=>element?.dispatchEvent(new MouseEvent('click',{bubbles:true})));
};

describe('学习室七日课程可视日历',()=>{
 it('前后周与本周可反复切换，原课程资料不被写入或改变',()=>{
   const monday=new Date();
   const classRow=make('透视课',monday.getDay());
   const original=JSON.stringify(classRow);
   render([classRow]);
   expect(container.textContent).toContain('透视课');
   tap('下一周');
   expect(container.textContent).toContain('透视课');
   tap('上一周');
   tap('上一周');
   tap('回到本周');
   expect(container.textContent).toContain('本周');
   expect(JSON.stringify(classRow)).toBe(original);
   tap('查看 透视课 作业');
   expect(pick).toHaveBeenCalledWith('透视课');
 });
 it('截止日期之后的课程不出现在将来周，已取消课程不显示',()=>{
   const now=new Date();
   const sunday=new Date(now); sunday.setDate(now.getDate()-now.getDay());
   const saturday=new Date(sunday);saturday.setDate(sunday.getDate()+6);
   const until=saturday.toLocaleDateString('sv-SE');
   const active=make('本周终课',now.getDay(),until);
   const cancelled={...make('取消课程',now.getDay()),cancelled:true};
   render([active,cancelled]);
   expect(container.textContent).toContain('本周终课');
   expect(container.textContent).not.toContain('取消课程');
   tap('下一周');
   expect(container.textContent).not.toContain('本周终课');
   tap('回到本周');
   expect(container.textContent).toContain('本周终课');
 });
});
