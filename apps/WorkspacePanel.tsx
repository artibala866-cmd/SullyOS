import React, { useEffect, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { putImageBlob } from '../utils/blobRef';
import { recognizeCourseImage, type CourseImageDraft } from '../utils/sullyTimetableVision';
import {
  calculatePlanRisks, emptyWorkspace, localDate, newWorkspaceId,
  orderedCommissions, readWorkspace, writeWorkspace,
  type ClassHomework, type Commission, type TimetableClass, type WorkspaceData, type WorkKind,
} from '../utils/sullyWorkspace';

type FocusItem = { id: string; source?: {kind: WorkKind; id: string} };
type FocusLog = { taskId: string; minutes: number };
interface Props {
  section: 'commissions' | 'calendar';
  focusTasks: FocusItem[];
  records: FocusLog[];
  onFocus: (kind: WorkKind, id: string, title: string) => void;
  onDiscuss: (topic: string) => void;
}
const inputClass = 'w-full min-w-0 bg-white border border-neutral-300 text-neutral-900 rounded-lg p-2.5 text-sm';
const buttonClass = 'rounded-lg bg-neutral-900 text-white px-3 py-2 text-sm disabled:opacity-40';
const mutedButton = 'border border-neutral-300 rounded-lg px-3 py-2 text-sm text-neutral-800';
const cardClass = 'rounded-xl border border-neutral-200 p-4 bg-white space-y-3';
const weekdayNames = ['周日','周一','周二','周三','周四','周五','周六'];
const blankCommission = () => ({
  title:'',client:'',type:'',brief:'',acceptedAt:localDate(new Date()),
  dueDate:'',stage:'草稿',priority:2,remainingMinutes:120,bufferMinutes:60,
  plannedDate:'',price:'',paid:false,note:'',
});
const blankClass = () => ({
  name:'',weekday:1,start:'09:00',end:'10:00',until:'',
  teacher:'',location:'',note:'',
});

const WorkspacePanel: React.FC<Props> = ({section, focusTasks, records, onFocus, onDiscuss}) => {
  const { apiConfig, addToast } = useOS();
  const [data, setData] = useState<WorkspaceData>(emptyWorkspace);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [draft, setDraft] = useState(blankCommission);
  const [classDraft, setClassDraft] = useState(blankClass);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [homeworkTitle, setHomeworkTitle] = useState('');
  const [homeworkDue, setHomeworkDue] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState('');
  const [visionBusy, setVisionBusy] = useState(false);
  const [previewRows, setPreviewRows] = useState<CourseImageDraft[]>([]);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const touched = useRef(false);

  useEffect(() => {
    let alive = true;
    void readWorkspace().then(value => {
      if (alive) { setData(value); setLoaded(true); }
    }).catch(e => { if (alive) setError('无法读取本地工作空间：' + String(e)); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!loaded || !touched.current) return;
    const snapshot = data;
    // Writes are serialized to prevent a slow old IndexedDB transaction overwriting a newer edit.
    queue.current = queue.current.catch(() => {}).then(() => writeWorkspace(snapshot));
    void queue.current.catch(e => setError('保存失败，请勿清理浏览器数据：' + String(e)));
  }, [data, loaded]);

  const change = (fn: (old:WorkspaceData)=>WorkspaceData) => {
    touched.current = true;
    setData(fn);
  };
  const patchCommission = (id:string, patch:Partial<Commission>) =>
    change(v => ({...v, commissions: v.commissions.map(c=>c.id===id?{...c,...patch}:c)}));
  const patchClass = (id:string, patch:Partial<TimetableClass>) =>
    change(v => ({...v,classes:v.classes.map(c=>c.id===id?{...c,...patch}:c)}));

  const addCommission = (e:React.FormEvent) => {
    e.preventDefault();
    if (!draft.title.trim()) return;
    const commission:Commission = {
      ...draft,id:newWorkspaceId(),title:draft.title.trim(),status:'active',
      order: Math.max(0,...data.commissions.map(c=>c.order)) + 1,
    };
    change(v=>({...v,commissions:[...v.commissions,commission]}));
    setDraft(blankCommission());
  };
  const reorder = (id:string, direction:number) => {
    const list = orderedCommissions(data.commissions);
    const i = list.findIndex(c=>c.id===id), other = list[i+direction];
    if (i<0 || !other) return;
    const next = [...list];
    [next[i],next[i+direction]] = [next[i+direction],next[i]];
    const orders = new Map(next.map((c,k)=>[c.id,k+1]));
    change(v=>({...v,commissions:v.commissions.map(c=>orders.has(c.id)?{...c,order:orders.get(c.id)!}:c)}));
  };
  const addClass = (e:React.FormEvent) => {
    e.preventDefault();
    if (!classDraft.name.trim() || !classDraft.start || !classDraft.end || classDraft.end <= classDraft.start) {
      addToast('请检查课程名及上课起止时间', 'error'); return;
    }
    const id = newWorkspaceId();
    change(v=>({...v,classes:[...v.classes,{...classDraft,id,name:classDraft.name.trim()}]}));
    setSelectedClassId(id);
    setClassDraft(blankClass());
  };
  const addHomework = (e:React.FormEvent) => {
    e.preventDefault();
    if (!selectedClassId || !homeworkTitle.trim()) return;
    const task:ClassHomework = {
      id:newWorkspaceId(),classId:selectedClassId,title:homeworkTitle.trim(),
      dueAt:homeworkDue,minutes:60,done:false,note:'',
    };
    change(v=>({...v,homework:[...v.homework,task]}));
    setHomeworkTitle('');setHomeworkDue('');
  };
  const pickImage = (file?: File) => {
    setPreviewRows([]);
    setImageFile(file || null);
    setImagePreview('');
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 12*1024*1024) {
      addToast('请选择小于 12MB 的图片', 'error'); setImageFile(null);return;
    }
    const reader = new FileReader();
    reader.onload=()=>setImagePreview(typeof reader.result==='string'?reader.result:'');
    reader.onerror=()=>addToast('无法读取图片，请重试','error');
    reader.readAsDataURL(file);
  };
  const recognize = async () => {
    if (!imagePreview || !apiConfig.visionApi) { addToast('需要配置识图 API', 'error'); return; }
    setVisionBusy(true);
    try {
      const rows = await recognizeCourseImage(imagePreview, apiConfig.visionApi);
      setPreviewRows(rows);
      if (!rows.length) addToast('未能找到明确的课程，请手动录入', 'error');
    } catch(e) { addToast('识别失败：' + String(e), 'error'); }
    finally { setVisionBusy(false); }
  };
  const savePreview = async () => {
    if (!previewRows.length) return;
    if (previewRows.some(c=>!c.name.trim() || c.weekday<0 || !c.start || !c.end || c.end<=c.start)) {
      addToast('请先纠正所有课程名、星期与时间', 'error'); return;
    }
    try {
      const ref = imageFile ? await putImageBlob(imageFile) : undefined;
      change(v=>({...v,classes:[...v.classes,...previewRows.map(c=>({
        ...c, id:newWorkspaceId(), sourceImageRef:ref,
      }))]}));
      setPreviewRows([]);setImageFile(null);setImagePreview('');
      addToast('已保存确认后的课程', 'success');
    } catch(e) { addToast('课程保存失败：' + String(e), 'error'); }
  };
  const className = (id:string) => data.classes.find(c=>c.id===id)?.name || '已删除课程';
  const actualMinutes = (kind:WorkKind,id:string) => {
    const ids = new Set(focusTasks.filter(t=>t.source?.kind===kind && t.source.id===id).map(t=>t.id));
    return records.filter(r=>ids.has(r.taskId)).reduce((sum,r)=>sum+r.minutes,0);
  };
  const risk = new Map(calculatePlanRisks(data).map(v=>[v.commissionId,v]));
  const selectedClass = data.classes.find(c=>c.id===selectedClassId);
  if (!loaded) return <p className="p-6 text-neutral-700">{error || '正在读取工作空间…'}</p>;

  return <div className="text-neutral-900 space-y-5 pb-6">
    {error && <p role="alert" className="p-3 text-sm border border-neutral-500 rounded-lg">{error}</p>}
    {section==='commissions' ? <>
      <header className="space-y-2">
        <h2 className="text-xl font-semibold">画师排单</h2>
        <p className="text-sm text-neutral-600">委托只存入本地数据库，等待客户的稿件不算作绘画欠工。</p>
        <label className="block text-sm">每天可用于学习和绘画的时间（分钟）
          <input className={inputClass} type="number" min="0" max="1440" value={data.dailyAvailableMinutes}
            onChange={e=>change(v=>({...v,dailyAvailableMinutes:Math.max(0,Math.min(1440,Number(e.target.value)||0))}))}/>
        </label>
        <button className={mutedButton} onClick={() => onDiscuss(
          '请只给出可修改的排单建议，不要擅自更新或对客户承诺。当前委托：' +
          JSON.stringify(data.commissions.filter(c=>c.status==='active').map(c=>({
            name:c.title,stage:c.stage,due:c.dueDate,remainingMinutes:c.remainingMinutes,
            bufferMinutes:c.bufferMinutes,plannedDate:c.plannedDate,
          })))+'；课程：'+JSON.stringify(data.classes.map(c=>({name:c.name,weekday:c.weekday,start:c.start,end:c.end})))
        )}>让 Char 帮我排一下</button>
        <p className="text-xs text-neutral-600">点此才将上述委托时间及课程摘要发送给选定的 AI；回复只作建议，不会自动改动委托。</p>
      </header>
      <form onSubmit={addCommission} className={cardClass}>
        <h3 className="font-semibold">新增委托</h3>
        <input className={inputClass} required aria-label="稿件名称" placeholder="稿件名称（必填）" value={draft.title} onChange={e=>setDraft(v=>({...v,title:e.target.value}))}/>
        <div className="grid grid-cols-2 gap-2">
          <input className={inputClass} aria-label="委托人" placeholder="委托人/备注" value={draft.client} onChange={e=>setDraft(v=>({...v,client:e.target.value}))}/>
          <input className={inputClass} aria-label="稿件类型" placeholder="稿件类型" value={draft.type} onChange={e=>setDraft(v=>({...v,type:e.target.value}))}/>
          <label className="text-xs">交稿日期<input className={inputClass} type="date" value={draft.dueDate} onChange={e=>setDraft(v=>({...v,dueDate:e.target.value}))}/></label>
          <label className="text-xs">预计剩余分钟<input className={inputClass} type="number" min="0" value={draft.remainingMinutes} onChange={e=>setDraft(v=>({...v,remainingMinutes:Math.max(0,Number(e.target.value)||0)}))}/></label>
        </div>
        <textarea className={inputClass} placeholder="需求与参考资料说明（可稍后补充）" value={draft.brief} onChange={e=>setDraft(v=>({...v,brief:e.target.value}))}/>
        <button className={buttonClass} type="submit">加入排单</button>
      </form>
      <div className="flex justify-between items-center">
        <h3 className="font-semibold">工作队列 · {data.commissions.filter(c=>c.status!=='archived').length}</h3>
        <button className={mutedButton} onClick={()=>setShowArchived(x=>!x)}>{showArchived?'隐藏归档':'查看归档'}</button>
      </div>
      {orderedCommissions(data.commissions, showArchived)
        .map(c=><article className={cardClass} key={c.id}>
          <div className="flex justify-between gap-2">
            <div className="min-w-0"><h4 className="font-semibold break-words">{c.title}</h4>
              <p className="text-xs text-neutral-600">{c.client || '未填写客户'} · {c.stage}</p></div>
            <div className="flex gap-1 shrink-0">
              <button className={mutedButton} onClick={()=>reorder(c.id,-1)} aria-label={'上移'+c.title}>↑</button>
              <button className={mutedButton} onClick={()=>reorder(c.id,1)} aria-label={'下移'+c.title}>↓</button>
            </div>
          </div>
          <p className="text-xs text-neutral-700">交稿 {c.dueDate||'未设置'} · 已专注 {actualMinutes('commission',c.id)} 分钟 · 预计剩余 {c.remainingMinutes} 分钟</p>
          {risk.get(c.id)?.shortfallMinutes ? <p className="text-sm font-medium text-neutral-900">
            时间冲突：截至该稿约缺 {risk.get(c.id)?.shortfallMinutes} 分钟（含前序稿件、课程与作业）</p> : null}
          <div className="flex flex-wrap gap-2">
            <button className={buttonClass} onClick={()=>onFocus('commission',c.id,c.title)}>专注这张稿</button>
            <button className={mutedButton} onClick={()=>onDiscuss('请帮我看看这张委托的下一步（只建议，不更改）：'+JSON.stringify({
              title:c.title,stage:c.stage,dueDate:c.dueDate,remainingMinutes:c.remainingMinutes,note:c.note,
            }))}>问 Char</button>
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer text-neutral-700">编辑阶段、日期与详情</summary>
            <div className="grid grid-cols-2 gap-2 pt-3">
              <label>阶段<input className={inputClass} list="sully-stages" value={c.stage} onChange={e=>patchCommission(c.id,{stage:e.target.value})}/></label>
              <label>状态<select className={inputClass} value={c.status} onChange={e=>patchCommission(c.id,{status:e.target.value as Commission['status']})}>
                <option value="active">正在绘制</option><option value="waiting">等待客户确认</option><option value="paused">已暂停</option><option value="delivered">交付完成</option><option value="cancelled">已取消</option><option value="archived">归档</option>
              </select></label>
              <label>交稿日期<input className={inputClass} type="date" value={c.dueDate} onChange={e=>patchCommission(c.id,{dueDate:e.target.value})}/></label>
              <label>计划日期<input className={inputClass} type="date" value={c.plannedDate} onChange={e=>patchCommission(c.id,{plannedDate:e.target.value})}/></label>
              <label>剩余分钟<input className={inputClass} type="number" min="0" value={c.remainingMinutes} onChange={e=>patchCommission(c.id,{remainingMinutes:Number(e.target.value)||0})}/></label>
              <label>缓冲分钟<input className={inputClass} type="number" min="0" value={c.bufferMinutes} onChange={e=>patchCommission(c.id,{bufferMinutes:Number(e.target.value)||0})}/></label>
              <label>优先级<select className={inputClass} value={c.priority} onChange={e=>patchCommission(c.id,{priority:Number(e.target.value)})}>
                <option value="1">高</option><option value="2">中</option><option value="3">低</option>
              </select></label>
              <label>约定价格<input className={inputClass} value={c.price} onChange={e=>patchCommission(c.id,{price:e.target.value})}/></label>
              <label>接单日期<input className={inputClass} type="date" value={c.acceptedAt} onChange={e=>patchCommission(c.id,{acceptedAt:e.target.value})}/></label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={c.paid} onChange={e=>patchCommission(c.id,{paid:e.target.checked})}/>已收款（手动）</label>
            </div>
            <label className="block mt-2">委托人<input className={inputClass} value={c.client} onChange={e=>patchCommission(c.id,{client:e.target.value})}/></label>
            <label className="block mt-2">稿件类型<input className={inputClass} value={c.type} onChange={e=>patchCommission(c.id,{type:e.target.value})}/></label>
            <label className="block mt-2">需求<input className={inputClass} value={c.brief} onChange={e=>patchCommission(c.id,{brief:e.target.value})}/></label>
            <label className="block mt-2">备注<textarea className={inputClass} value={c.note} onChange={e=>patchCommission(c.id,{note:e.target.value})}/></label>
          </details>
        </article>)}
      <datalist id="sully-stages">{['待确认','排队','草稿','线稿','上色','细化','待审核','交付完成'].map(s=><option key={s} value={s}/>)}</datalist>
    </> : <>
      <header><h2 className="text-xl font-semibold">课程表</h2>
        <p className="text-sm text-neutral-600">报班时间表与已有 PDF 自习室分开保存。也可以完全手动录入。</p></header>
      <form className={cardClass} onSubmit={addClass}>
        <h3 className="font-semibold">新增课程</h3>
        <input className={inputClass} required placeholder="课程名称" aria-label="课程名称" value={classDraft.name} onChange={e=>setClassDraft(v=>({...v,name:e.target.value}))}/>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs">上课星期<select className={inputClass} value={classDraft.weekday} onChange={e=>setClassDraft(v=>({...v,weekday:Number(e.target.value)}))}>
            {weekdayNames.map((d,i)=><option key={d} value={i}>{d}</option>)}</select></label>
          <label className="text-xs">最后上课日期<input className={inputClass} type="date" value={classDraft.until} onChange={e=>setClassDraft(v=>({...v,until:e.target.value}))}/></label>
          <label className="text-xs">开始时间<input className={inputClass} type="time" value={classDraft.start} onChange={e=>setClassDraft(v=>({...v,start:e.target.value}))}/></label>
          <label className="text-xs">结束时间<input className={inputClass} type="time" value={classDraft.end} onChange={e=>setClassDraft(v=>({...v,end:e.target.value}))}/></label>
          <input className={inputClass} placeholder="老师/班级" aria-label="老师或班级" value={classDraft.teacher} onChange={e=>setClassDraft(v=>({...v,teacher:e.target.value}))}/>
          <input className={inputClass} placeholder="地点或上课链接" aria-label="上课地点" value={classDraft.location} onChange={e=>setClassDraft(v=>({...v,location:e.target.value}))}/>
        </div>
        <textarea className={inputClass} placeholder="调课、请假与备注" value={classDraft.note} onChange={e=>setClassDraft(v=>({...v,note:e.target.value}))}/>
        <button type="submit" className={buttonClass}>保存课程</button>
      </form>
      <section className={cardClass}>
        <h3 className="font-semibold">从图片识别</h3>
        <p className="text-xs text-neutral-600">选择图片后，需主动点击识别（会调用你设置的识图服务）；结果不会直接入库。</p>
        <input type="file" accept="image/*" aria-label="上传课程表图片" onChange={e=>pickImage(e.target.files?.[0])} className="w-full text-sm"/>
        {imagePreview && <img src={imagePreview} alt="待识别课程表预览" className="max-h-40 max-w-full object-contain"/>}
        {imagePreview && <button className={buttonClass} disabled={visionBusy} onClick={()=>void recognize()}>
          {visionBusy?'正在识别':'识别图片并校对'}</button>}
        {previewRows.length>0 && <div className="border-t border-neutral-200 pt-3 space-y-3">
          <h4 className="font-medium">可编辑校对 · {previewRows.length} 门课</h4>
          {previewRows.map((c,i)=><div key={i} className="border border-neutral-300 p-3 rounded-lg space-y-2">
            {c.uncertain.length>0 && <p className="text-xs text-neutral-700">待确认：{c.uncertain.join('、')}</p>}
            <input className={inputClass} aria-label="识别课程名" placeholder="课程名" value={c.name} onChange={e=>setPreviewRows(v=>v.map((x,j)=>j===i?{...x,name:e.target.value}:x))}/>
            <div className="grid grid-cols-3 gap-2">
              <select className={inputClass} aria-label="识别星期" value={c.weekday} onChange={e=>setPreviewRows(v=>v.map((x,j)=>j===i?{...x,weekday:Number(e.target.value)}:x))}>
                <option value={-1}>待确认</option>{weekdayNames.map((w,k)=><option key={w} value={k}>{w}</option>)}
              </select>
              <input className={inputClass} aria-label="识别开始时间" type="time" value={c.start} onChange={e=>setPreviewRows(v=>v.map((x,j)=>j===i?{...x,start:e.target.value}:x))}/>
              <input className={inputClass} aria-label="识别结束时间" type="time" value={c.end} onChange={e=>setPreviewRows(v=>v.map((x,j)=>j===i?{...x,end:e.target.value}:x))}/>
            </div>
            <input className={inputClass} aria-label="识别日期范围" type="date" value={c.until} onChange={e=>setPreviewRows(v=>v.map((x,j)=>j===i?{...x,until:e.target.value}:x))}/>
            <input className={inputClass} aria-label="识别地点" placeholder="地点" value={c.location} onChange={e=>setPreviewRows(v=>v.map((x,j)=>j===i?{...x,location:e.target.value}:x))}/>
            <button className={mutedButton} onClick={()=>setPreviewRows(v=>v.filter((_,j)=>j!==i))}>移除此行</button>
          </div>)}
          <button className={buttonClass} onClick={()=>void savePreview()}>确认并保存这些课程</button>
          <button className={mutedButton} onClick={()=>setPreviewRows([])}>放弃识别结果</button>
        </div>}
      </section>
      <section className="space-y-3">
        <h3 className="font-semibold">我的课程 · {data.classes.length}</h3>
        {data.classes.map(c=><article key={c.id} className={cardClass}>
          <div className="flex justify-between gap-3">
            <div><h4 className="font-semibold">{c.name}</h4>
              <p className="text-xs text-neutral-600">{weekdayNames[c.weekday] || '待确认'} {c.start}–{c.end} · {c.location||'地点未填'}</p></div>
            <button className={mutedButton} onClick={()=>setSelectedClassId(c.id)}>查看作业</button>
          </div>
          <details className="text-sm"><summary className="cursor-pointer">编辑课程</summary>
            <div className="space-y-2 pt-2">
              <input className={inputClass} aria-label="编辑课程名" value={c.name} onChange={e=>patchClass(c.id,{name:e.target.value})}/>
              <select className={inputClass} value={c.weekday} onChange={e=>patchClass(c.id,{weekday:Number(e.target.value)})}>{weekdayNames.map((w,i)=><option key={w} value={i}>{w}</option>)}</select>
              <input className={inputClass} type="time" value={c.start} onChange={e=>patchClass(c.id,{start:e.target.value})}/>
              <input className={inputClass} type="time" value={c.end} onChange={e=>patchClass(c.id,{end:e.target.value})}/>
              <input className={inputClass} type="date" value={c.until} onChange={e=>patchClass(c.id,{until:e.target.value})}/>
              <input className={inputClass} placeholder="老师" value={c.teacher} onChange={e=>patchClass(c.id,{teacher:e.target.value})}/>
              <input className={inputClass} placeholder="地点" value={c.location} onChange={e=>patchClass(c.id,{location:e.target.value})}/>
              <textarea className={inputClass} placeholder="调课/请假/补课" value={c.note} onChange={e=>patchClass(c.id,{note:e.target.value})}/>
              <button className={mutedButton} onClick={() => { if (window.confirm('确定删除这门课？相关作业笔记仍会保留。')) change(v=>({...v, classes:v.classes.filter(x=>x.id!==c.id)})); }}>删除课程</button>
            </div>
          </details>
        </article>)}
      </section>
      <section className={cardClass}>
        <h3 className="font-semibold">作业与笔记</h3>
        <label className="text-sm">选择课程<select className={inputClass} value={selectedClassId} onChange={e=>setSelectedClassId(e.target.value)}>
          <option value="">请选择</option>{data.classes.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        {selectedClass && <>
          <form onSubmit={addHomework} className="space-y-2">
            <input className={inputClass} required aria-label="新增作业" placeholder="新增作业" value={homeworkTitle} onChange={e=>setHomeworkTitle(e.target.value)}/>
            <input className={inputClass} type="datetime-local" aria-label="作业截止时间" value={homeworkDue} onChange={e=>setHomeworkDue(e.target.value)}/>
            <button className={buttonClass} type="submit">添加作业</button>
          </form>
          {data.homework.filter(h=>h.classId===selectedClassId).map(h=><div key={h.id} className="border-t border-neutral-200 pt-2 space-y-2">
            <div className="flex gap-2"><input aria-label={'完成'+h.title} type="checkbox" checked={h.done}
              onChange={e=>change(v=>({...v,homework:v.homework.map(x=>x.id===h.id?{...x,done:e.target.checked}:x)}))}/>
              <span className={h.done?'line-through text-neutral-600':''}>{h.title}</span></div>
            <p className="text-xs">截止 {h.dueAt||'未设置'} · 已专注 {actualMinutes('homework',h.id)} 分钟</p>
            <button className={mutedButton} onClick={()=>onFocus('homework',h.id,h.title)}>为作业开始专注</button>
            <details><summary className="text-sm">编辑作业</summary>
              <input className={inputClass} type="datetime-local" value={h.dueAt} onChange={e=>change(v=>({...v,homework:v.homework.map(x=>x.id===h.id?{...x,dueAt:e.target.value}:x)}))}/>
              <textarea className={inputClass} value={h.note} placeholder="备注" onChange={e=>change(v=>({...v,homework:v.homework.map(x=>x.id===h.id?{...x,note:e.target.value}:x)}))}/>
              <button className={mutedButton} onClick={()=>change(v=>({...v,homework:v.homework.filter(x=>x.id!==h.id)}))}>移除作业</button>
            </details>
          </div>)}
          <label className="block text-sm">学习笔记<textarea className={inputClass} value={noteBody} onChange={e=>setNoteBody(e.target.value)} placeholder="记下刚学到的知识"/></label>
          <button className={buttonClass} disabled={!noteBody.trim()} onClick={()=>{
            change(v=>({...v,notes:[...v.notes,{id:newWorkspaceId(),classId:selectedClassId,body:noteBody.trim(),createdAt:Date.now()}]}));
            setNoteBody('');
          }}>保存笔记</button>
          {data.notes.filter(n=>n.classId===selectedClassId).map(n=><div key={n.id} className="border-t border-neutral-200 py-2">
            <p className="text-sm whitespace-pre-wrap break-words">{n.body}</p>
            <button className={mutedButton} onClick={()=>onDiscuss('请让我把刚学到的 '+className(n.classId)+' 的内容讲给你听，然后根据笔记追问我，不要擅自判定作业完成。笔记：'+n.body)}>请 Char 提问</button>
          </div>)}
        </>}
        {!selectedClass && <p className="text-xs text-neutral-600">先选择一门课，再记录作业和笔记。</p>}
      </section>
      <p className="text-xs text-neutral-600">到点的 Char 云端提醒尚未自动建立；请以已有 AMSG 2.0 任务列表的实际确认状态为准。</p>
    </>}
  </div>;
};
export default WorkspacePanel;
