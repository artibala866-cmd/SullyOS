import React,{useEffect,useState} from 'react';
import {Trash,ShieldCheck,CheckSquare,WarningCircle} from '@phosphor-icons/react';
import {PHONE_CLEAR_GROUPS,clearSelectedPhoneData,type PhoneClearGroup} from '../../utils/characterPhoneClear';
export default function CharacterPhoneClearManager({characterId,disabled=false}:{
  characterId:string;disabled?:boolean;
}){
  const [open,setOpen]=useState(false);
  const [selected,setSelected]=useState<PhoneClearGroup[]>([]);
  const [confirm,setConfirm]=useState(false);
  const [notice,setNotice]=useState('');
  useEffect(()=>{setOpen(false);setSelected([]);setConfirm(false);setNotice('');},[characterId]);
  const toggle=(id:PhoneClearGroup,checked:boolean)=>setSelected(old=>
    checked?[...old.filter(x=>x!==id),id]:old.filter(x=>x!==id));
  const remove=()=>{
    if(disabled||!selected.length)return;
    try{
      const cleared=clearSelectedPhoneData(characterId,selected);
      setNotice('已清理 '+cleared.length+' 类手机内容。其他模块没有删除。');
      setConfirm(false);setSelected([]);
    }catch(e){setNotice('部分内容清理失败，请检查存储状态后重新核对。');setConfirm(false);}
  };
  return <section className="rounded-2xl bg-white p-4 text-[#333]">
    <button type="button" className="flex w-full items-center gap-3 text-left" aria-expanded={open} onClick={()=>{setOpen(v=>!v);setConfirm(false);}}>
      <Trash size={21} color="#777"/>
      <div className="min-w-0 flex-1"><h3 className="text-sm font-semibold">清除管理</h3>
        <p className="mt-1 text-xs leading-5 text-[#999]">按类别选择，单独清理此 Char 的查手机存档</p></div>
      <span className="text-xs text-[#888]">{open?'收起':'展开'}</span>
    </button>
    {open&&<div className="mt-4 space-y-3 border-t border-[#eee] pt-4">
      <p className="flex items-start gap-2 text-xs leading-5 text-[#777]"><ShieldCheck size={17} className="mt-0.5 shrink-0"/>
        不删除 User 的真实私聊数据库、角色头像库、记忆宫殿、原音乐人格和歌曲。清理某个功能后，新内容可能由 AI 再次生成。
      </p>
      <div className="divide-y divide-[#f0f0f0]">
        {PHONE_CLEAR_GROUPS.map(({id,label,description})=><label key={id} className="flex items-start gap-3 py-3">
          <input type="checkbox" checked={selected.includes(id)} onChange={e=>toggle(id,e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[#444]"/>
          <span className="min-w-0"><span className="block text-[13px] text-[#444]">{label}</span>
            <span className="mt-1 block text-[11px] leading-5 text-[#999]">{description}</span></span>
        </label>)}
      </div>
      {selected.includes('payments')&&!selected.includes('wallet')&&<p className="text-[11px] leading-5 text-[#8b8b8b]">
        注意：已同步进资产档案的历史流水不会跟随模拟账单一并删掉，如需清空请选择钱包分类。
      </p>}
      {!confirm?<button type="button" disabled={!selected.length||disabled} onClick={()=>setConfirm(true)}
        className="w-full rounded-xl border border-[#555] bg-[#f6f6f6] px-4 py-3 text-xs font-medium disabled:opacity-40">
        清理已选的 {selected.length} 类内容
      </button>:<div className="space-y-3 rounded-xl border border-[#d9d9d9] bg-[#f6f6f6] p-4">
        <p className="flex items-center gap-2 text-[13px] font-semibold"><WarningCircle size={20}/>确认永久清理？</p>
        <p className="text-xs leading-5 text-[#777]">将只清理此角色的：{PHONE_CLEAR_GROUPS.filter(x=>selected.includes(x.id)).map(x=>x.label).join('、')}。清理后无法在本机撤销。</p>
        <div className="grid grid-cols-2 gap-3"><button type="button" onClick={()=>setConfirm(false)}
          className="rounded-lg bg-white py-2.5 text-xs">取消</button>
          <button type="button" onClick={remove} disabled={disabled} className="rounded-lg bg-[#373737] py-2.5 text-xs text-white disabled:opacity-40">确认清理</button></div>
      </div>}
      {disabled&&<p className="text-xs text-[#999]">微信正在生成，当前暂停清理。</p>}
      {notice&&<p role="status" className="text-xs leading-5 text-[#555]">{notice}</p>}
    </div>}
  </section>;
}
