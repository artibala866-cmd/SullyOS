import React, { useState } from 'react';
import { useOS } from '../context/OSContext';
import { cancelStudyReminder, createStudyReminder, inspectStudyReminderRemote, remindersFor, type StudyReminderRemoteInspection } from '../utils/studyRoomReminders';
import type { WorkspaceData, WorkspaceReminderKind } from '../utils/sullyWorkspace';

interface Props {
  kind: WorkspaceReminderKind;
  itemId: string;
  suggestedAt: string;
  data: WorkspaceData;
  selectedCharId: string;
  onSelectChar: (id: string) => void;
  onUpdate: (reminders: WorkspaceData['reminders']) => void;
}
const small = 'min-h-11 text-sm rounded-lg border border-[#dcdcdc] bg-[#f6f6f6] px-3 py-2.5 text-[#292929] hover:bg-[#ececec] disabled:opacity-50';
const timeLocal = (value: string) => {
  if (!value) return '';
  if (value.includes('T')) return value.slice(0, 16);
  return value + 'T18:00';
};
const friendly = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : '未知时间';
};

/** Explicit opt-in, no hidden scheduling, no AI call, no order details in fixed push. */
const WorkspaceReminderControls: React.FC<Props> = ({
  kind, itemId, suggestedAt, data, selectedCharId, onSelectChar, onUpdate,
}) => {
  const {characters, apiConfig, userProfile, groups, realtimeConfig, addToast} = useOS();
  const [at, setAt] = useState(() => timeLocal(suggestedAt));
  const [busy, setBusy] = useState(false);
  const [inspections, setInspections] = useState<Record<string,StudyReminderRemoteInspection>>({});
  const existing = remindersFor(data, kind, itemId);
  const isActive = kind==='commission'
    ? data.commissions.some(c=>c.id===itemId && c.status==='active')
    : data.homework.some(h=>h.id===itemId && !h.done);
  const schedule = async () => {
    if (busy || existing.length || !isActive) return;
    const char = characters.find(c=>c.id===selectedCharId);
    if (!char) { addToast('请选择负责提醒的 Char','error');return; }
    if (!window.confirm('确定让 '+char.name+' 在约定时间通过主动消息发送一条固定进度提醒吗？消息不会包含客户姓名、价格、备注或笔记。')) return;
    setBusy(true);
    try {
      const next = await createStudyReminder(kind,itemId,at,{
        char,apiConfig,userProfile,groups,realtimeConfig,
      });
      onUpdate(next.reminders);
      addToast('远端已确认创建，提醒身份已保存','success');
    } catch(error) {
      // "creating/needs_review" may have been persisted even on failure.
      // Refresh the link so the UI never offers a blind duplicate retry.
      const {readWorkspace} = await import('../utils/sullyWorkspace');
      try { onUpdate((await readWorkspace()).reminders); } catch {}
      addToast(error instanceof Error?error.message:String(error),'error');
    } finally { setBusy(false); }
  };
  const cancel = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await cancelStudyReminder(id);
      onUpdate(next.reminders);
      addToast('远端已确认取消提醒','success');
    } catch(error) {
      const {readWorkspace} = await import('../utils/sullyWorkspace');
      try { onUpdate((await readWorkspace()).reminders); } catch {}
      addToast(error instanceof Error?error.message:String(error),'error');
    } finally { setBusy(false); }
  };
  const inspect = async(id:string)=>{
    if(busy)return;
    setBusy(true);
    try{
      const result=await inspectStudyReminderRemote(id);
      setInspections(prev=>({...prev,[id]:result}));
      addToast('仅查询远端状态，未改变或新建任何提醒','info');
    }catch(error){
      setInspections(prev=>{const next={...prev};delete next[id];return next;});
      addToast('远端核查失败：'+String(error),'error');
    }finally{setBusy(false);}
  };
  return <details className="border-t border-neutral-200 pt-3 space-y-2">
    <summary className="min-h-11 py-3 text-sm font-medium text-neutral-800 cursor-pointer">到点提醒</summary>
    <div className="space-y-3 pt-2 text-sm">
      <p className="text-sm text-neutral-600">
        默认关闭。创建后，到点会在私聊收到一次固定提醒；不调用 AI，也不分享此事项的具体资料。
        正常私聊不会因此获得工作空间记录。需要先在 Char 的设置中开启 AMSG 2.0。
      </p>
      {existing.map(reminder=><div className="rounded-lg border border-neutral-300 p-3 space-y-2" key={reminder.id}>
        <div className="text-sm font-medium">{reminder.status==='scheduled'?'已确认':'需要处理'} · {friendly(reminder.fireAt)}</div>
        <p className="text-sm text-neutral-600">
          Char：{characters.find(c=>c.id===reminder.charId)?.name || '未知角色'}
          {reminder.taskUuid?' · 任务 '+reminder.taskUuid.slice(0,8):''}
        </p>
        {reminder.error && <p role="alert" className="text-sm text-neutral-800">{reminder.error}</p>}
        {(reminder.status==='creating' || reminder.status==='needs_review') &&
          <p className="text-sm text-neutral-700">创建状态不确定，切勿重复创建。请先核查 AMSG 云端任务。</p>}
        <button className={small} disabled={busy} onClick={()=>void inspect(reminder.id)}>
          {busy?'核查中…':'读取 AMSG 云端状态（不修改）'}
        </button>
        {inspections[reminder.id] && <div className="text-sm border border-neutral-200 rounded-lg p-2 space-y-1" role="status">
          <p>核查结果：{inspections[reminder.id].status==='matched'
            ? '匹配到云端任务'
            : inspections[reminder.id].status==='not_found'?'未在当前列表找到':'缺少可匹配的身份'}</p>
          {inspections[reminder.id].taskUuid && <p className="break-all">
            云端任务 UUID：{inspections[reminder.id].taskUuid}</p>}
          {inspections[reminder.id].remoteStatus && <p>云端状态：{inspections[reminder.id].remoteStatus}</p>}
          <p>{inspections[reminder.id].warning}</p>
        </div>}
        {reminder.taskUuid && <button className={small} disabled={busy}
          onClick={()=>void cancel(reminder.id)}>
          {busy?'处理中…':'请求远端取消（UUID 已确认）'}</button>}
      </div>)}
      {!existing.length && <>
        <label className="block text-sm">提醒 Char
          <select className="w-full min-h-11 mt-1 rounded-lg border border-neutral-300 px-2 py-2" value={selectedCharId}
            onChange={e=>onSelectChar(e.target.value)}>
            <option value="">请选择 Char</option>
            {characters.map(char=><option value={char.id} key={char.id}>{char.name}</option>)}
          </select>
        </label>
        <label className="block text-sm">本机时间（主动消息到点触发）
          <input type="datetime-local" className="w-full min-h-11 mt-1 rounded-lg border border-neutral-300 px-2 py-2"
            value={at} onChange={e=>setAt(e.target.value)}/>
        </label>
        <button className={small} disabled={busy || !at || !selectedCharId || !isActive}
          onClick={()=>void schedule()}>{busy?'正在联系远端…':'确认创建 Char 到点提醒'}</button>
        {!isActive && <p className="text-xs">已完成或暂停的事项不能新建提醒。</p>}
      </>}
    </div>
  </details>;
};
export default WorkspaceReminderControls;
