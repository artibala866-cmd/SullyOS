// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import HomeLifePanel from '../apps/room3d/HomeLifePanel';
import type {HomeRecord} from '../apps/room3d/types';

const cleanup=vi.hoisted(()=>vi.fn());
vi.mock('./homeHistoryCleanup',()=>({clearHomeHistory:cleanup}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let records:HomeRecord[]=[];
const scene={roomId:'r',roomName:'客厅',present:true,busy:false,activity:'休息',actions:[]};
const editor={
 getHomeScene:()=>scene,
 getState:()=>({records}),
 updateRecords:(value:HomeRecord[])=>{records=value;},
};
const record=(id:string,kind:HomeRecord['kind']='message'):HomeRecord=>({
 id,kind,at:Date.now(),source:'user',actor:'user',text:id,roomId:'r',roomName:'客厅',
});
let root:ReturnType<typeof createRoot>|null=null;
const host=document.createElement('div');
document.body.append(host);
const render=async(panel:string|null)=>{
 root=createRoot(host);
 await act(async()=>root!.render(React.createElement(HomeLifePanel,{
  editor:editor as any,character:{id:'char',name:'TA'} as any,
  panel,onPanel:()=>{},
 })));
};
const click=async()=>{
 await act(async()=>{const button=host.querySelector<HTMLButtonElement>('[aria-label="一键清空家园聊天和动作记录"]');
  expect(button).toBeTruthy();button!.click();
 });
};
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=null;records=[];host.innerHTML='';
 vi.restoreAllMocks();vi.clearAllMocks();});

it('keeps cleanup icon in top-right chat header only and never deletes on cancelled confirmation',async()=>{
 records=[record('chat'),record('gesture','action')];
 vi.spyOn(window,'confirm').mockReturnValue(false);
 await render('chat');
 expect(host.querySelector('header .home-life-header-actions .home-clear-history')).not.toBeNull();
 await click();
 expect(cleanup).not.toHaveBeenCalled();
 expect(records).toHaveLength(2);
});
it('clears journal including action rows after database commit',async()=>{
 records=[record('chat'),record('gesture','action'),record('presence','presence')];
 vi.spyOn(window,'confirm').mockReturnValue(true);
 cleanup.mockResolvedValue({records:3,messages:3});
 await render('chat');await click();
 expect(cleanup).toHaveBeenCalledWith('char');
 expect(records).toEqual([]);
 expect(host.querySelectorAll('.home-record')).toHaveLength(0);
});
it('retains visible records if database cleanup fails',async()=>{
 records=[record('chat')];
 vi.spyOn(window,'confirm').mockReturnValue(true);
 cleanup.mockRejectedValue(Error('清理失败'));
 await render('chat');await click();
 expect(records).toHaveLength(1);
 expect(host.textContent).toContain('清理失败');
});
