import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { putImageBlob } from '../utils/blobRef';
import { recognizeCourseImage, type CourseImageDraft } from '../utils/sullyTimetableVision';
import WorkspaceReminderControls from './WorkspaceReminderControls';
import StudyCommissionCalendar from './StudyCommissionCalendar';
import StudyWeekTimetable from './StudyWeekTimetable';
import StudyCharPicker from './StudyCharPicker';
import StudyCommissionEditor from './StudyCommissionEditor';
import StudyTimetableEditor from './StudyTimetableEditor';
import {
  loadStudyCourseOptions, setClassStudyCourseLink, deleteTimetableClass,
  orphanedClassContent, reassignOrphanContent, resolveLinkedCourse,
  type StudyCourseOption,
} from '../utils/studyCourseLinks';
import { cancelItemReminders, setWorkspaceChatPermission } from '../utils/studyRoomReminders';
import {pendingFocusProgress,settleFocusProgress} from '../utils/studyFocusProgress';
import {buildHomeworkReviewTopic} from '../utils/studyHomeworkReview';
import {nextDrawableCommissions,nextHomework,lessonNameForHomework,deadlineLabel} from '../utils/studyQuickActions';
import { mergeWorkspaceLocalEdit } from '../utils/workspaceEditMerge';
import {
  isPlanPreviewStale, previewCommissionPlanRisk, projectCommissionPlan,
  type CommissionPlanPreview,
} from '../utils/commissionPlanProposals';
import {
  calculatePlanRisks, dailyCapacityForecast, emptyWorkspace, localDate, newWorkspaceId,
  readWorkspaceIntegrityWarnings, recoverDamagedWorkspace,
  orderedCommissions, readWorkspace, mutateWorkspace, permissionForChar,
  type ClassHomework, type Commission, type TimetableClass, type WorkspaceData, type WorkKind, type WorkspaceShareCategory,
} from '../utils/sullyWorkspace';

type FocusItem = { id: string; source?: {kind: WorkKind; id: string} };
type FocusLog = { taskId: string; minutes: number; sessionId?: string; date?: string };
interface Props {
  section: 'commissions' | 'calendar';
  visible?: boolean;
  focusTasks: FocusItem[];
  records: FocusLog[];
  onFocus: (kind: WorkKind, id: string, title: string) => void;
  onOpenStudyCourse: (id:string) => void;
  onDiscuss: (topic: string, scope:'study'|'commission', itemId?:string) => void;
  onPlan: (workspace: WorkspaceData) => void;
  planPreview: CommissionPlanPreview | null;
  onClearPlan: () => void;
  selectedCharId: string;
  onSelectChar: (id:string) => void;
}
const inputClass = 'w-full min-w-0 bg-[#fafafa] border border-neutral-200 text-neutral-900 rounded-lg p-2.5 text-sm outline-none focus:border-neutral-700';
const buttonClass = 'min-h-11 rounded-xl border border-[#dfdfdf] bg-[#f1f1f1] text-[#292929] px-3 py-2.5 text-sm font-medium hover:bg-[#e9e9e9] disabled:opacity-40';
const primaryButton = 'min-h-11 rounded-xl bg-[#383838] text-white px-3 py-2.5 text-sm font-medium disabled:opacity-40';
const mutedButton = 'min-h-10 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-800 hover:bg-[#f6f6f6] disabled:opacity-40';
const cardClass = 'rounded-2xl border border-[#e9e9e9] p-3.5 sm:p-5 bg-white shadow-[0_2px_10px_rgba(0,0,0,0.018)] space-y-3';
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

const WorkspacePanel: React.FC<Props> = ({section, focusTasks, records, onFocus, onOpenStudyCourse, onDiscuss, onPlan, planPreview, onClearPlan, selectedCharId, onSelectChar}) => {
  const { apiConfig, addToast, characters } = useOS();
  const [data, setData] = useState<WorkspaceData>(emptyWorkspace);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [integrityWarnings, setIntegrityWarnings] = useState<string[]>([]);
  const [recoveringWorkspace, setRecoveringWorkspace] = useState(false);
  const [settlementBusyId,setSettlementBusyId]=useState('');
  const [shareBusy, setShareBusy] = useState<WorkspaceShareCategory | null>(null);
  const [planChecked, setPlanChecked] = useState<string[]>([]);
  const [applyingPlan, setApplyingPlan] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showCommissionList,setShowCommissionList]=useState(false);
  const [editingCommissionId,setEditingCommissionId]=useState('');
  const [editingClassId,setEditingClassId]=useState('');
  useEffect(()=>{
    if(section!=='commissions'||!showCommissionList||!editingCommissionId)return;
    document.getElementById('study-commission-'+editingCommissionId)?.scrollIntoView({block:'center',behavior:'smooth'});
  },[section,showCommissionList,editingCommissionId]);
  const [draft, setDraft] = useState(blankCommission);
  const [classDraft, setClassDraft] = useState(blankClass);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [showAllHomework,setShowAllHomework]=useState(false);
  const [studyCourses, setStudyCourses] = useState<StudyCourseOption[]>([]);
  const [studyCoursesError, setStudyCoursesError] = useState('');
  const [studyCoursesLoading, setStudyCoursesLoading] = useState(false);
  const [studyCoursesRefresh, setStudyCoursesRefresh] = useState(0);
  const [linkBusyId, setLinkBusyId] = useState('');
  const [homeworkTitle, setHomeworkTitle] = useState('');
  const [homeworkDue, setHomeworkDue] = useState('');
  const [noteDrafts, setNoteDrafts] = useState<Record<string,string>>({});
  const [noteSaving,setNoteSaving] = useState(false);
  const [addingCommission,setAddingCommission] = useState(false);
  const [addingClass,setAddingClass] = useState(false);
  const [addingHomework,setAddingHomework] = useState(false);
  const addBusy = useRef({commission:false,course:false,homework:false});
  const noteSaveInFlight = useRef(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState('');
  const [visionBusy, setVisionBusy] = useState(false);
  const [previewRows, setPreviewRows] = useState<CourseImageDraft[]>([]);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const dataRef = useRef<WorkspaceData>(emptyWorkspace());
  const syncData = (update: (before: WorkspaceData) => WorkspaceData) => {
    const next = update(dataRef.current);
    dataRef.current = next;
    setData(next);
  };

  useEffect(() => {
    let alive = true;
    void Promise.all([readWorkspace(),readWorkspaceIntegrityWarnings()]).then(([value,warnings]) => {
      if (alive) {
        dataRef.current=value;setData(value);setIntegrityWarnings(warnings);setLoaded(true);
      }
    }).catch(e => { if (alive) setError('无法读取本地工作空间：' + String(e)); });
    return () => { alive = false; };
  }, []);

  useEffect(() => { setPlanChecked([]); }, [planPreview]);
  useEffect(()=>{
    if(!loaded || section!=='calendar')return;
    if(selectedClassId && data.classes.some(c=>c.id===selectedClassId))return;
    // Choose an existing course automatically; never override a valid choice.
    const first=data.classes.find(c=>!c.cancelled && c.weekday===new Date().getDay())
      ??data.classes.find(c=>!c.cancelled)??data.classes[0];
    if(first)setSelectedClassId(first.id);
  },[loaded,section,data.classes,selectedClassId]);
  useEffect(()=>{
    if (section!=='calendar') return;
    let alive=true;
    setStudyCoursesLoading(true);
    setStudyCoursesError('');
    void loadStudyCourseOptions().then(options=>{
      if(alive) setStudyCourses(options);
    }).catch(err=>{
      if(alive) setStudyCoursesError('无法读取旧自习室课程：'+String(err));
    }).finally(()=>{if(alive)setStudyCoursesLoading(false);});
    return ()=>{alive=false;};
  },[section,studyCoursesRefresh]);
  const change = (fn: (old:WorkspaceData)=>WorkspaceData): Promise<void> => {
    const before=dataRef.current;
    const after=fn(before);
    syncData(()=>after);
    const commit=queue.current.catch(()=>{}).then(async()=>{
      await mutateWorkspace(current=>mergeWorkspaceLocalEdit(before,after,current));
    });
    queue.current=commit;
    void commit.catch(e=>setError('本地保存冲突或失败，请勿清理浏览器数据：'+String(e)));
    return commit;
  };
  const resyncAfterFailedWrite=async()=>{
    try{await queue.current.catch(()=>{});const latest=await readWorkspace();syncData(()=>latest);}catch{}
  };
  const onReminderUpdate = (reminders: WorkspaceData['reminders']) =>
    syncData(prev => ({...prev,reminders}));

  const togglePrivateChat = async (category: WorkspaceShareCategory, enabled: boolean) => {
    if (shareBusy || !selectedCharId) return;
    if (enabled) {
      if (!window.confirm('允许当前 Char 在普通私聊中读取这一分类的最小摘要？不会分享客户、价格、需求、课堂笔记或 PDF 原文。')) return;
    } else if (!window.confirm(
      '关闭共享后，今后的普通私聊不再读取此分类。还会尝试取消该 Char 在此分类下的固定提醒；取消失败的仍可能触发。确定继续？'
    )) return;
    setShareBusy(category);
    try {
      const result = await setWorkspaceChatPermission(selectedCharId, category, enabled);
      syncData(prev => ({
        ...prev, privateChatPermissions: result.workspace.privateChatPermissions,
        reminders: result.workspace.reminders,
      }));
      if(result.failedCancellations) {
        addToast('共享已关闭，但 '+result.failedCancellations+' 条提醒取消失败或创建状态不明；请检查下方任务记录和 AMSG 云端管理。','error');
      } else {
        addToast(enabled ? '此 Char 的分类共享已开启' : '共享已关闭；关联提醒已处理','success');
      }
    } catch(e) {
      // If remote cancellation fails after revocation, show actual persisted access and links.
      try {
        const actual = await readWorkspace();
        syncData(prev => ({
          ...prev, privateChatPermissions: actual.privateChatPermissions,
          reminders: actual.reminders,
        }));
      } catch {}
      addToast('授权变更未完全确认：'+String(e),'error');
    } finally { setShareBusy(null); }
  };
  const recoverWorkspace = async () => {
    if(recoveringWorkspace || !integrityWarnings.length)return;
    const typed=window.prompt(
      '此操作会保留完整受损原件为独立本机备份，并用仍可识别的资料修复主工作空间。'+
      '部分损坏的提醒关联可能无法恢复，云端 AMSG 任务不会自动取消。请先确认你理解风险，输入：确认恢复并保留原件',
      ''
    );
    if(typed!=='确认恢复并保留原件')return;
    setRecoveringWorkspace(true);
    try{
      // A failed normal save is EXPECTED with corrupted data. Wait for it to
      // settle, but do not make that previous rejection block explicit recovery.
      await queue.current.catch(()=>{});
      const result=await recoverDamagedWorkspace(typed);
      syncData(()=>result.workspace);
      setIntegrityWarnings([]);
      setError('');
      addToast('恢复完成。损坏原件保留在本地快照 '+result.snapshotId+'，请保留完整备份并核对 AMSG 任务。','success');
    }catch(e){addToast('恢复未完成，原始数据仍保留：'+String(e),'error');}
    finally{setRecoveringWorkspace(false);}
  };
  const requestPlan = async () => {
    try {
      // Finish any pending manual edit before freezing the version the model sees.
      await queue.current;
      onPlan(await readWorkspace());
    } catch(e) {
      addToast('排单尚未保存，不能请求建议：'+String(e),'error');
    }
  };
  const applyPlan = async () => {
    if (applyingPlan || !planPreview || !planChecked.length) return;
    if (!window.confirm('确定只应用勾选的 '+planChecked.length+' 项排单调整？不会修改交稿截止日、价格、客户或作业完成状态。')) return;
    setApplyingPlan(true);
    try {
      await queue.current;
      // CAS at the latest serialized DB write, not against a stale React render.
      const updated=await mutateWorkspace(current=>projectCommissionPlan(current,planPreview,planChecked));
      syncData(()=>updated);
      setPlanChecked([]);
      onClearPlan();
      addToast('已应用 '+planChecked.length+' 项计划调整，并重新计算冲突风险','success');
    } catch(e) {
      addToast('方案未应用：'+(e instanceof Error?e.message:String(e)),'error');
      try {
        const latest=await readWorkspace();
        syncData(prev=>({...prev,commissions:latest.commissions,classes:latest.classes,
          homework:latest.homework,dailyAvailableMinutes:latest.dailyAvailableMinutes}));
      } catch {}
    } finally {setApplyingPlan(false);}
  };
  const linkStudyCourse = async (classId:string, courseId:string) => {
    if(linkBusyId) return;
    setLinkBusyId(classId);
    try {
      // Requery original StudyCourse store before accepting a link: do not trust stale UI options.
      const options=await loadStudyCourseOptions();
      if(courseId && !options.some(c=>c.id===courseId))
        throw new Error('自习室课程可能已被删除，请刷新列表后重试');
      await change(current=>setClassStudyCourseLink(current,classId,courseId,options));
      setStudyCourses(options);
      addToast(courseId?'已关联旧自习室课程':'已解除关联；旧课程及作业笔记均保留','success');
    } catch(e) {
      addToast('关联失败：'+String(e),'error');
    } finally { setLinkBusyId(''); }
  };
  const openStudyCourse = async (courseId:string) => {
    try {
      const options=await loadStudyCourseOptions();
      setStudyCourses(options);
      if(!options.some(c=>c.id===courseId)) {
        addToast('原有自习室课程已不存在；请刷新关联','error');
        return;
      }
      onOpenStudyCourse(courseId);
    } catch(e){addToast('无法核验自习室课程：'+String(e),'error');}
  };
  const deleteClass = (id:string) => {
    const items=data.homework.filter(h=>h.classId===id).length;
    const notes=data.notes.filter(n=>n.classId===id).length;
    if(!window.confirm('确定只删除这条学习室课程表记录？'+
      (items||notes?'其下 '+items+' 条作业、'+notes+' 条笔记将保留在「未归属资料」中，可重新归类。':'')+
      '原有自习室课程、PDF、章节与测验均不会删除。')) return;
    change(current=>deleteTimetableClass(current,id));
    if(selectedClassId===id)setSelectedClassId('');
  };
  const recoverOrphan = (kind:'homework'|'note',id:string,classId:string) => {
    try {
      void change(current=>reassignOrphanContent(current,kind,id,classId))
        .then(()=>addToast('已重新归入课程；原笔记和作业内容未改动','success'))
        .catch(e=>addToast('重新归类保存失败：'+String(e),'error'));
    } catch(e) {addToast('重新归类失败：'+String(e),'error');}
  };
  const stopItemReminders = async (kind:'commission'|'homework', id:string) => {
    try {
      const result = await cancelItemReminders(kind,id);
      onReminderUpdate(result.workspace.reminders);
      if(result.failed) addToast(
        '有 '+result.failed+' 条远端提醒取消失败，可能仍会触发。请到对应事项重试取消。','error');
      return result.failed===0;
    } catch(e) {
      addToast('取消远端提醒未确认，旧提醒仍可能触发：'+String(e),'error');
      return false;
    }
  };
  const saveCommissionEdits=async(id:string,patch:Partial<Commission>)=>{
    try{
      await change(v=>{
        if(!v.commissions.some(c=>c.id===id))throw new Error('稿件已被删除');
        return {...v,commissions:v.commissions.map(c=>c.id===id?{...c,...patch}:c)};
      });
    }catch(e){
      try{const latest=await readWorkspace();syncData(()=>latest);}catch{}
      throw e;
    }
    if(patch.status && patch.status!=='active') {
      // Preserve the old behavior of attempting to cancel reminders when
      // work is paused, delivered, cancelled or moved out of the active queue.
      const cancelled=await stopItemReminders('commission',id);
      if(!cancelled)addToast('稿件已保存，但远端提醒取消未确认，请到提醒列表核对','error');
    }
    addToast('委托已保存','success');
  };
  const changeHomeworkDone = async (id:string, done:boolean) => {
    try{
      await change(v => ({...v,homework:v.homework.map(h=>h.id===id?{...h,done}:h)}));
      if(done) await stopItemReminders('homework',id);
    }catch(e){
      await resyncAfterFailedWrite();
      addToast('作业状态未保存，请重试：'+String(e),'error');
    }
  };
  const removeHomework = async(id:string) => {
    if(!(await stopItemReminders('homework',id))) return;
    change(v=>({...v,homework:v.homework.filter(x=>x.id!==id)}));
  };
  // Course edits are drafted locally by StudyTimetableEditor; a single
  // explicit save replaces dozens of per-keystroke IndexedDB transactions.
  const saveClassEdits = (id:string,patch:Partial<TimetableClass>):Promise<void> =>
    change(v=>{
      if(!v.classes.some(c=>c.id===id))throw new Error('课程表记录已被移除');
      return {...v,classes:v.classes.map(c=>c.id===id?{...c,...patch}:c)};
    });

  const addCommission = async (e:React.FormEvent) => {
    e.preventDefault();
    if (!draft.title.trim() || addBusy.current.commission) return;
    addBusy.current.commission=true;
    setAddingCommission(true);
    const submitted=draft;
    const commission:Commission = {
      ...submitted,id:newWorkspaceId(),title:submitted.title.trim(),status:'active',
      order: Math.max(0,...data.commissions.map(c=>c.order)) + 1,
    };
    try{
      await change(v=>({...v,commissions:[...v.commissions,commission]}));
      setDraft(prev=>prev===submitted?blankCommission():prev);
      addToast('委托已加入排单','success');
      editCommission(commission.id);
    }catch(e){
      await resyncAfterFailedWrite();
      addToast('委托未保存，填写内容仍保留：'+String(e),'error');
    }finally{
      addBusy.current.commission=false;
      setAddingCommission(false);
    }
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
  const addClass = async (e:React.FormEvent) => {
    e.preventDefault();
    if(addBusy.current.course)return;
    if (!classDraft.name.trim() || !classDraft.start || !classDraft.end || classDraft.end <= classDraft.start) {
      addToast('请检查课程名及上课起止时间', 'error'); return;
    }
    const id = newWorkspaceId();
    const submitted=classDraft;
    addBusy.current.course=true;
    setAddingClass(true);
    try{
      await change(v=>({...v,classes:[...v.classes,{...submitted,id,name:submitted.name.trim()}]}));
      setClassDraft(prev=>prev===submitted?blankClass():prev);
      addToast('课程已保存','success');
      showClassWork(id);
    }catch(e){
      await resyncAfterFailedWrite();
      addToast('课程未保存，填写内容仍保留：'+String(e),'error');
    }finally{
      addBusy.current.course=false;
      setAddingClass(false);
    }
  };
  const addHomework = async (e:React.FormEvent) => {
    e.preventDefault();
    if (!selectedClassId || !homeworkTitle.trim() || addBusy.current.homework) return;
    const title=homeworkTitle,dueAt=homeworkDue,classId=selectedClassId;
    const task:ClassHomework = {
      id:newWorkspaceId(),classId,title:title.trim(),dueAt,minutes:60,done:false,note:'',
    };
    addBusy.current.homework=true;
    setAddingHomework(true);
    try{
      await change(v=>{
        if(!v.classes.some(c=>c.id===classId))throw new Error('目标课程已删除，请重新选择');
        return {...v,homework:[...v.homework,task]};
      });
      setHomeworkTitle(prev=>prev===title?'':prev);
      setHomeworkDue(prev=>prev===dueAt?'':prev);
      addToast('作业已添加','success');
    }catch(e){
      await resyncAfterFailedWrite();
      addToast('作业未保存，填写内容仍保留：'+String(e),'error');
    }finally{
      addBusy.current.homework=false;
      setAddingHomework(false);
    }
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
      const added=previewRows.map(c=>({...c,id:newWorkspaceId(),sourceImageRef:ref}));
      await change(v=>({...v,classes:[...v.classes,...added]}));
      setPreviewRows([]);setImageFile(null);setImagePreview('');
      addToast('已保存确认后的课程', 'success');
    } catch(e) { addToast('课程保存失败：' + String(e), 'error'); }
  };
  const className = (id:string) => data.classes.find(c=>c.id===id)?.name || '已删除课程';
  const settleLinkedFocus = async (kind:WorkKind,id:string,estimate:number) => {
    if(settlementBusyId)return;
    const candidate=pendingFocusProgress(data,focusTasks,records,kind,id);
    if(!candidate.sessions.length)return;
    const label=kind==='commission'?'这张稿件':'这项作业';
    if(!window.confirm('把 '+candidate.sessions.length+' 轮、共 '+candidate.minutes+
      ' 分钟的已完成专注记录，手动结算到'+label+'的剩余预计时间？预计剩余 '+
      estimate+' → '+Math.max(0,estimate-candidate.minutes)+
      ' 分钟。不会自动认定任务完成、改变交期或触发提醒。'))return;
    setSettlementBusyId(kind+id);
    try{
      await queue.current;
      const ids=candidate.sessions.map(r=>r.sessionId!);
      const updated=await mutateWorkspace(current=>
        settleFocusProgress(current,focusTasks,records,kind,id,ids,estimate));
      syncData(()=>updated);
      addToast('已手动结算 '+candidate.minutes+' 分钟，完成状态仍由你决定','success');
    }catch(e){
      addToast('专注结算未保存：'+String(e),'error');
      try{const latest=await readWorkspace();syncData(()=>latest);}catch{}
    }finally{setSettlementBusyId('');}
  };
  const pendingMinutes = (kind:WorkKind,id:string) =>
    pendingFocusProgress(data,focusTasks,records,kind,id);
  const actualMinutes = (kind:WorkKind,id:string) => {
    const ids = new Set(focusTasks.filter(t=>t.source?.kind===kind && t.source.id===id).map(t=>t.id));
    return records.filter(r=>ids.has(r.taskId)).reduce((sum,r)=>sum+r.minutes,0);
  };
  const todayKey=localDate(new Date());
  const risk=useMemo(()=>new Map(calculatePlanRisks(data,todayKey).map(v=>[v.commissionId,v])),[data,todayKey]);
  const weekCapacity=useMemo(()=>dailyCapacityForecast(data,todayKey,7),[data,todayKey]);
  const selectedClass = data.classes.find(c=>c.id===selectedClassId);
  const noteBody = noteDrafts[selectedClassId] || '';
  const quickCommissions=useMemo(()=>nextDrawableCommissions(data.commissions),[data.commissions]);
  const pendingHomework=useMemo(()=>nextHomework(data.homework),[data.homework]);
  const saveNote = async () => {
    const classId=selectedClassId;
    const raw=noteDrafts[classId] || '';
    const body=raw.trim();
    if(!classId || !body || noteSaveInFlight.current)return;
    noteSaveInFlight.current=true;
    setNoteSaving(true);
    try{
      await change(current=>{
        if(!current.classes.some(c=>c.id===classId))throw new Error('课程已被删除，请重新选择');
        const note={id:newWorkspaceId(),classId,body,createdAt:Date.now()};
        return {...current,notes:[...current.notes,note]};
      });
      setNoteDrafts(prev=>prev[classId]===raw?{...prev,[classId]:''}:prev);
      addToast('学习笔记已保存','success');
    }catch(e){
      addToast('笔记未保存，草稿仍保留：'+String(e),'error');
      await resyncAfterFailedWrite();
    }finally{
      noteSaveInFlight.current=false;
      setNoteSaving(false);
    }
  };
  const showClassWork=(id:string)=>{
    setSelectedClassId(id);
    requestAnimationFrame(()=>document.getElementById('study-homework-panel')?.scrollIntoView({block:'start',behavior:'smooth'}));
  };
  const editCommission=(id:string)=>{
    setEditingCommissionId(id);setShowCommissionList(true);
    requestAnimationFrame(()=>document.getElementById('study-commission-'+id)?.scrollIntoView({block:'center',behavior:'smooth'}));
  };
  const orphaned = orphanedClassContent(data);
  const planStale = !!planPreview && (isPlanPreviewStale(data, planPreview)
    || planPreview.charId !== selectedCharId);
  const projectedRisks = !planStale && planPreview && planChecked.length
    ? previewCommissionPlanRisk(data,planPreview,planChecked) : [];
  const riskChanges = new Map(projectedRisks.map(r=>[r.commissionId,r]));
  if (!loaded) return <p className="p-6 text-neutral-700">{error || '正在读取工作空间…'}</p>;

  return <div className="text-neutral-900 space-y-3 sm:space-y-4 pb-4">
    {error && <p role="alert" className="p-3 text-sm border border-neutral-500 rounded-lg">{error}</p>}
    {integrityWarnings.length>0 && <section className={cardClass} role="alert">
      <h3 className="font-semibold">本地学习室备份存在异常，已开启安全保护</h3>
      <p className="text-xs">仅显示仍可读取的资料；原始损坏记录没有被删除。为避免覆盖可恢复数据，本机写入会被拒绝。请先通过备份管理恢复健康备份，不要清除应用数据。</p>
      <p className="text-xs break-words">{integrityWarnings.slice(0,4).join('；')}{integrityWarnings.length>4?'；另有更多异常':''}</p>
      <button className={mutedButton} disabled={recoveringWorkspace}
        onClick={()=>void recoverWorkspace()}>
        {recoveringWorkspace?'正在备份与恢复…':'确认后备份原件并恢复可识别资料'}
      </button>
      <p className="text-xs text-neutral-600">这个操作不会自动执行，也不能保证恢复受损的原始文字；完整损坏原件另存本机以备之后人工修复。</p>
    </section>}
    <details className={cardClass} aria-label="普通私聊授权">
      <summary className="cursor-pointer font-medium text-sm flex items-center justify-between">
        <span>学习室设置 · 私聊授权</span>
      </summary>
      <p className="text-xs text-neutral-600">每个 Char 独立授权，默认全部关闭。开启仅分享课程时间、作业状态或画稿排期的有限摘要；永不自动分享客户、价格、详细需求、笔记与 PDF 原文。关闭后只阻止后续请求，已发送消息和历史记忆不会被自动删除。</p>
      <StudyCharPicker compact characters={characters} selectedId={selectedCharId} onSelect={onSelectChar}/>
      {(['study','commissions'] as const).map(category => {
        const enabled = permissionForChar(data, selectedCharId)[category];
        const pending = data.reminders.filter(r => r.charId===selectedCharId &&
          r.kind===(category==='study'?'homework':'commission')).length;
        return <div className="flex flex-col gap-1" key={category}>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" disabled={!selectedCharId||!!shareBusy} checked={enabled}
              onChange={e=>void togglePrivateChat(category,e.target.checked)}/>
            {category==='study'?'允许私聊了解课程与作业进度':'允许私聊了解画稿排期与进度'}
          </label>
          {pending>0 && <p className="text-xs text-neutral-700">
            此 Char 在该分类另有 {pending} 条固定提醒记录。关闭授权会尝试远端取消；
            状态不明时需在事项下方和 AMSG 管理中核查。
          </p>}
        </div>;
      })}
      {shareBusy && <p className="text-xs text-neutral-600">正在保存授权并核对远端提醒…</p>}
    </details>
    <div className={section==='commissions'?'':'hidden'}>
      <header className={cardClass}>
        <div><p className="text-xs tracking-wide text-neutral-500">CREATIVE PLANNER</p>
        <h2 className="mt-2 font-serif text-[23px] tracking-wide">画师排单</h2>
        </div>
        <details className="rounded-2xl border border-neutral-200 bg-white p-3 text-sm">
          <summary className="cursor-pointer text-xs font-medium">时间容量</summary>
        <label className="mt-3 block text-xs">每天可用于学习和绘画的时间（分钟）
          <input className={inputClass} type="number" min="0" max="1440" value={data.dailyAvailableMinutes}
            onChange={e=>change(v=>({...v,dailyAvailableMinutes:Math.max(0,Math.min(1440,Number(e.target.value)||0))}))}/>
        </label>
        <section className="border border-neutral-200 bg-white rounded-xl p-3 text-xs space-y-2" aria-label="未来七天可用时间">
          <h3 className="text-sm font-semibold">未来七天 · 时间容量预估</h3>
          <p className="text-neutral-600">同时间课程只扣一次；逾期作业按今天补做估算。仅按日汇总，并非精确到小时的自动预约。</p>
          <div className="grid grid-cols-7 gap-2 items-end pt-2">
            {weekCapacity.map(day=><div className="min-w-0 text-center" key={day.date}>
              <span className="block truncate text-xs text-neutral-500">{day.date.slice(-2)}日</span>
              <span title={'课程 '+day.classMinutes+' 分，作业 '+day.homeworkMinutes+' 分，可用 '+day.availableMinutes+' 分'}
                className={'mt-2 block w-full rounded-md '+(day.overbookedMinutes?'bg-neutral-900':'bg-[#d4d4d4]')}
                style={{height:Math.max(6,Math.round((day.classMinutes+day.homeworkMinutes)/Math.max(1,data.dailyAvailableMinutes)*65))+'px',maxHeight:'78px'}}/>
              <strong className="mt-1 block text-xs tabular-nums">{day.availableMinutes}</strong>
              {day.overbookedMinutes>0&&<span className="block text-xs text-red-700">超 {day.overbookedMinutes}</span>}
            </div>)}
          </div>
          {weekCapacity[0]?.unscheduledHomeworkCount>0 &&
            <p role="status">另有 {weekCapacity[0].unscheduledHomeworkCount} 项未完成作业没有有效截止日期，未纳入容量估算。请手动排入计划。</p>}
        </section>
        </details>
        <button className={buttonClass+' w-fit'} onClick={()=>void requestPlan()} disabled={!selectedCharId || applyingPlan}>✦ 让 Char 帮我排一下</button>
        
      </header>
      <section className={cardClass} aria-label="可直接继续的画稿">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">接下来画什么</h3>
          <span className="text-xs text-neutral-500">{data.commissions.filter(c=>c.status==='active').length} 张进行中</span>
        </div>
        {quickCommissions.length ? <div className="space-y-2">
          {quickCommissions.map(c=><div key={c.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-neutral-100 bg-neutral-50 p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{c.title}</p>
              <p className="text-xs text-neutral-600">{c.stage} · {deadlineLabel(c.dueDate,todayKey)} · 剩余 {c.remainingMinutes} 分</p>
              {!!risk.get(c.id)?.shortfallMinutes && <p className="text-xs text-red-700">预计缺口 {risk.get(c.id)?.shortfallMinutes} 分</p>}
            </div>
            <button type="button" className={primaryButton+' min-h-11'} onClick={()=>onFocus('commission',c.id,c.title)}>开始画</button>
            <button type="button" className={mutedButton+' min-h-11'} onClick={()=>editCommission(c.id)}>调整</button>
            {pendingMinutes('commission',c.id).minutes>0 && <button type="button"
              className={buttonClass+' min-h-11 w-full text-left'} disabled={!!settlementBusyId}
              onClick={()=>void settleLinkedFocus('commission',c.id,c.remainingMinutes)}>
              已完成 {pendingMinutes('commission',c.id).minutes} 分钟 · 确认是否手动结算
            </button>}
          </div>)}
        </div> : <p className="text-xs text-neutral-600">还没有正在绘制的画稿。可以在下方新增委托，或把等待中的稿件改为正在绘制。</p>}
        {data.commissions.filter(c=>c.status==='active').length>quickCommissions.length &&
          <button type="button" className="text-xs underline underline-offset-2" onClick={()=>setShowCommissionList(true)}>查看全部画稿并调整顺序</button>}
      </section>
      <StudyCommissionCalendar commissions={data.commissions}
        onFocus={(id,title)=>onFocus('commission',id,title)}
        onEdit={editCommission}/>
      {planPreview && <section className={cardClass} aria-label="Char 排单建议预览">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">Char 排单建议 · 逐项审核</h3>
          <button className={mutedButton} disabled={applyingPlan} onClick={onClearPlan}>放弃建议</button>
        </div>
        <p className="text-xs text-neutral-700">默认一项都不选。以下是 AI 提议，不代表实际交期已修改。只可调整计划日期、剩余分钟与优先级。</p>
        {planStale && <p role="alert" className="text-sm border border-neutral-500 rounded-lg p-2">
          生成后原排单或课程时间已变化，或换了 Char。此方案已过期，不能应用；请重新请求。
        </p>}
        {planPreview.changes.map(change=>{
          const current=data.commissions.find(c=>c.id===change.id);
          const riskDelta=riskChanges.get(change.id);
          return <div key={change.id} className="border-t border-neutral-200 pt-3 space-y-1">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" disabled={planStale||applyingPlan}
                checked={planChecked.includes(change.id)}
                onChange={e=>setPlanChecked(prev=>e.target.checked
                  ? [...prev,change.id] : prev.filter(id=>id!==change.id))}/>
              {current?.title || planPreview.commissions.find(c=>c.id===change.id)?.title || '未知委托'}
            </label>
            {change.plannedDate!==undefined && <p className="text-xs">计划日期：{current?.plannedDate||'未设置'} → {change.plannedDate}</p>}
            {change.remainingMinutes!==undefined && <p className="text-xs">剩余工时：{current?.remainingMinutes??'?'} 分钟 → {change.remainingMinutes} 分钟</p>}
            {change.priority!==undefined && <p className="text-xs">优先级：{current?.priority??'?'} → {change.priority}（1 为高）</p>}
            {change.reason && <p className="text-xs text-neutral-600">Char 的理由：{change.reason}</p>}
            {riskDelta && <p className="text-xs">截至交稿的预计缺口：{riskDelta.before} → {riskDelta.after} 分钟</p>}
          </div>;
        })}
        {!!projectedRisks.length && <p className="text-xs border-t border-neutral-200 pt-2">
          已选调整后的全部在绘稿件缺口：
          {projectedRisks.filter(r=>r.after>0).map(r=>
            (data.commissions.find(c=>c.id===r.commissionId)?.title||'稿件')+' '+r.after+' 分钟').join('；')||'暂无估算缺口'}。
          风险估算按交稿期限、剩余工时及课程/作业时间计算；改计划日期本身不会自动预留日程。
        </p>}
        <button className={buttonClass} disabled={planStale || !planChecked.length || applyingPlan}
          onClick={()=>void applyPlan()}>
          {applyingPlan?'正在保存…':'确认应用已选 '+planChecked.length+' 项'}
        </button>
        <p className="text-xs text-neutral-500">如模型返回无效或越权字段，整份建议将被拒绝；绝不自动发消息给客户或更改交稿截止日。</p>
      </section>}
      <details className={cardClass}>
        <summary className="cursor-pointer text-sm font-semibold">＋ 新增委托</summary>
      <form onSubmit={addCommission} className="space-y-3 pt-2">
        
        <input className={inputClass} required aria-label="稿件名称" placeholder="稿件名称（必填）" value={draft.title} onChange={e=>setDraft(v=>({...v,title:e.target.value}))}/>
        <div className="grid grid-cols-2 gap-2">
          <input className={inputClass} aria-label="委托人" placeholder="委托人/备注" value={draft.client} onChange={e=>setDraft(v=>({...v,client:e.target.value}))}/>
          <input className={inputClass} aria-label="稿件类型" placeholder="稿件类型" value={draft.type} onChange={e=>setDraft(v=>({...v,type:e.target.value}))}/>
          <label className="text-xs">交稿日期<input className={inputClass} type="date" value={draft.dueDate} onChange={e=>setDraft(v=>({...v,dueDate:e.target.value}))}/></label>
          <label className="text-xs">预计剩余分钟<input className={inputClass} type="number" min="0" value={draft.remainingMinutes} onChange={e=>setDraft(v=>({...v,remainingMinutes:Math.max(0,Number(e.target.value)||0)}))}/></label>
        </div>
        <textarea className={inputClass} placeholder="需求与参考资料说明（可稍后补充）" value={draft.brief} onChange={e=>setDraft(v=>({...v,brief:e.target.value}))}/>
        <button className={buttonClass+' min-h-11'} disabled={addingCommission} type="submit">{addingCommission?'保存中…':'加入排单'}</button>
      </form>
      </details>
      <details className={cardClass} open={showCommissionList} onToggle={e=>setShowCommissionList(e.currentTarget.open)}>
        <summary className="cursor-pointer text-sm font-semibold">全部委托（{data.commissions.filter(c=>c.status!=='archived').length}）</summary>
        <div className="flex justify-end"><button className={mutedButton} onClick={()=>setShowArchived(x=>!x)}>{showArchived?'隐藏归档':'查看归档'}</button></div>
      {orderedCommissions(data.commissions, showArchived)
        .sort((a,b)=>Number(b.id===editingCommissionId)-Number(a.id===editingCommissionId))
        .map(c=><article id={'study-commission-'+c.id} className={cardClass+' !shadow-none '+(editingCommissionId===c.id?'!border-neutral-900':'')} key={c.id}>
          <div className="flex justify-between gap-2">
            <div className="min-w-0"><h4 className="font-semibold break-words">{c.title}</h4>
              <p className="text-xs text-neutral-600">{c.client || '未填写客户'} · {c.stage}</p></div>
            <div className="flex gap-1 shrink-0">
              <button className={mutedButton} onClick={()=>reorder(c.id,-1)} aria-label={'上移'+c.title}>↑</button>
              <button className={mutedButton} onClick={()=>reorder(c.id,1)} aria-label={'下移'+c.title}>↓</button>
            </div>
          </div>
          <p className="text-xs text-neutral-700">交稿 {c.dueDate||'未设置'} · 已专注 {actualMinutes('commission',c.id)} 分钟 · 预计剩余 {c.remainingMinutes} 分钟</p>
          {pendingMinutes('commission',c.id).minutes>0 && c.status==='active' &&
            <button className={mutedButton} disabled={!!settlementBusyId}
              onClick={()=>void settleLinkedFocus('commission',c.id,c.remainingMinutes)}>
              手动结算尚未抵扣的 {pendingMinutes('commission',c.id).sessions.length} 轮专注（{pendingMinutes('commission',c.id).minutes} 分钟）
            </button>}
          {pendingMinutes('commission',c.id).legacyMinutes>0 &&
            <p className="text-xs text-neutral-600">另有 {pendingMinutes('commission',c.id).legacyMinutes} 分钟旧专注记录没有轮次编号，可自行调整剩余工时，不会自动重复抵扣。</p>}
          {risk.get(c.id)?.shortfallMinutes ? <p className="text-sm font-medium text-neutral-900">
            时间冲突：截至该稿约缺 {risk.get(c.id)?.shortfallMinutes} 分钟（含前序稿件、课程与作业）</p> : null}
          <div className="flex flex-wrap gap-2">
            <button className={buttonClass} onClick={()=>onFocus('commission',c.id,c.title)}>专注这张稿</button>
            <button className={mutedButton} onClick={()=>onDiscuss('请帮我看看这张委托的下一步（只建议，不更改）：'+JSON.stringify({
              title:c.title,stage:c.stage,dueDate:c.dueDate,remainingMinutes:c.remainingMinutes,
            }),'commission',c.id)}>问 Char</button>
          </div>
          <WorkspaceReminderControls kind="commission" itemId={c.id}
            suggestedAt={c.dueDate} data={data} selectedCharId={selectedCharId}
            onSelectChar={onSelectChar} onUpdate={onReminderUpdate}/>
          <details className="text-sm" open={editingCommissionId===c.id}
            onToggle={e=>{
              if(e.currentTarget.open)setEditingCommissionId(c.id);
              else setEditingCommissionId(prev=>prev===c.id?'':prev);
            }}>
            <summary className="cursor-pointer text-neutral-700">编辑委托</summary>
            {editingCommissionId===c.id && <StudyCommissionEditor key={c.id}
              commission={c} onSave={patch=>saveCommissionEdits(c.id,patch)}
              onClose={()=>setEditingCommissionId('')}/>}
          </details>
        </article>)}
      </details>
      <datalist id="sully-stages">{['待确认','排队','草稿','线稿','上色','细化','待审核','交付完成'].map(s=><option key={s} value={s}/>)}</datalist>
    </div><div className={section==='calendar'?'':'hidden'}>
      <header className={cardClass}><p className="text-xs tracking-wide text-neutral-500">WEEKLY SCHOOL PLANNER</p>
        <h2 className="font-serif text-[23px] tracking-wide">课程表</h2>
        <p className="text-xs text-neutral-500"></p></header>
      <section className={cardClass} aria-label="接下来要做的作业">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">接下来做什么作业</h3>
          <span className="text-xs text-neutral-600">{data.homework.filter(h=>!h.done).length} 项待做</span>
        </div>
        {pendingHomework.length ? <div className="space-y-2">
          {pendingHomework.map(h=><div key={h.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl bg-neutral-50 border border-neutral-100 p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{h.title}</p>
              <p className="text-xs text-neutral-600">{lessonNameForHomework(data.classes,h.classId)} · {deadlineLabel(h.dueAt,todayKey)}</p>
            </div>
            <button type="button" className={primaryButton+' min-h-11'} onClick={()=>onFocus('homework',h.id,h.title)}>开始学</button>
            {pendingMinutes('homework',h.id).minutes>0 && <button type="button"
              className={buttonClass+' min-h-11 w-full text-left'} disabled={!!settlementBusyId}
              onClick={()=>void settleLinkedFocus('homework',h.id,h.minutes)}>
              已完成 {pendingMinutes('homework',h.id).minutes} 分钟 · 确认是否手动结算
            </button>}
            {data.classes.some(c=>c.id===h.classId) &&
              <button type="button" className={mutedButton} onClick={()=>showClassWork(h.classId)}>查看作业</button>}
          </div>)}
        </div> : <p className="text-xs text-neutral-600">目前没有待完成的作业。可以从下方课程表选择课程并添加。</p>}
        {data.homework.filter(h=>!h.done).length>pendingHomework.length &&
          <button type="button" className="text-xs underline underline-offset-2" onClick={()=>setShowAllHomework(v=>!v)}>
            {showAllHomework?'收起其余作业':'查看全部待做作业'}
          </button>}
        {showAllHomework && <div className="space-y-1 border-t border-neutral-200 pt-2">
          {nextHomework(data.homework,data.homework.length).slice(pendingHomework.length).map(h=>
            <div key={h.id} className="flex items-center justify-between gap-2 py-1 text-xs">
              <span className="min-w-0 flex-1 truncate">{h.title} · {lessonNameForHomework(data.classes,h.classId)}</span>
              <button type="button" className="underline underline-offset-2" onClick={()=>onFocus('homework',h.id,h.title)}>开始学</button>
            </div>)}
        </div>}
      </section>
      <StudyWeekTimetable classes={data.classes} selectedId={selectedClassId}
        onSelect={showClassWork}/>
      <details className={cardClass}>
        <summary className="cursor-pointer text-sm font-semibold">＋ 新增课程</summary>
      <form className="space-y-3 pt-2" onSubmit={addClass}>
        
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
        <button type="submit" className={buttonClass+' min-h-11'} disabled={addingClass}>{addingClass?'保存中…':'保存课程'}</button>
      </form>
      </details>
      <details className={cardClass}>
        <summary className="cursor-pointer text-sm font-semibold">识别课表</summary>
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
      </details>
      <details className={cardClass}>
        <summary className="cursor-pointer text-sm font-semibold">课程管理与关联（{data.classes.length}）</summary>
        <p className="text-xs text-neutral-600">原有 PDF 自习室课程单独保存；这里只关联课程 ID，不复制、删除或重置旧章节及练习册。</p>
        {studyCoursesError && <p role="alert" className="text-sm text-red-700">{studyCoursesError}</p>}
        <button className={mutedButton} type="button" disabled={studyCoursesLoading}
          onClick={()=>setStudyCoursesRefresh(x=>x+1)}>
          {studyCoursesLoading?'正在读取旧课程…':'刷新自习室课程列表'}
        </button>
        {data.classes.map(c=><article key={c.id} className={cardClass}>
          <div className="flex justify-between gap-3">
            <div><h4 className="font-semibold">{c.name}</h4>
              <p className="text-xs text-neutral-600">{weekdayNames[c.weekday] || '待确认'} {c.start}–{c.end} · {c.location||'地点未填'}</p></div>
            <button className={mutedButton} onClick={()=>showClassWork(c.id)}>查看作业</button>
          </div>
          <div className="space-y-2 rounded-lg border border-neutral-200 p-3">
            <label className="text-xs block">关联原有自习室课程
              <select className={inputClass} aria-label={'关联自习室课程 '+c.name}
                disabled={!!linkBusyId || studyCoursesLoading || !!studyCoursesError}
                value={c.studyCourseId||''}
                onChange={e=>void linkStudyCourse(c.id,e.target.value)}>
                <option value="">不关联（保留两边原数据）</option>
                {!!c.studyCourseId && !resolveLinkedCourse(c,studyCourses) &&
                  <option value={c.studyCourseId}>旧关联已失效 · {c.studyCourseId}</option>}
                {studyCourses.map(old=><option key={old.id} value={old.id}>{old.title}</option>)}
              </select>
            </label>
            {c.studyCourseId && resolveLinkedCourse(c,studyCourses)
              ? <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span>旧课程进度 {resolveLinkedCourse(c,studyCourses)!.totalProgress}% · 完成章节 {resolveLinkedCourse(c,studyCourses)!.chaptersCompleted}/{resolveLinkedCourse(c,studyCourses)!.chaptersTotal}</span>
                  <button className={mutedButton} type="button" onClick={()=>void openStudyCourse(c.studyCourseId!)}>打开关联自习室课程</button>
                </div>
              : c.studyCourseId && !studyCoursesLoading
                ? <p className="text-xs text-red-700">找不到旧课程：可能已删除或备份中未包含。关联记录保留；可重新选择或解除。</p>
                : <p className="text-xs text-neutral-600">可在已有 PDF 自习室课程中继续学习；作业和笔记仍归这门课程表课程管理。</p>}
          </div>
          <details className="text-sm" open={editingClassId===c.id}
            onToggle={e=>{
              if(e.currentTarget.open)setEditingClassId(c.id);
              else setEditingClassId(prev=>prev===c.id?'':prev);
            }}>
            <summary className="cursor-pointer">编辑课程</summary>
            {editingClassId===c.id && <StudyTimetableEditor key={c.id}
              course={c} onSave={patch=>saveClassEdits(c.id,patch)}
              onClose={()=>setEditingClassId('')}/>}
          </details>
          <button className={mutedButton} onClick={()=>deleteClass(c.id)}>仅删除此课程表记录</button>
        </article>)}
      </details>
      <section id="study-homework-panel" className={cardClass+' scroll-mt-4'}>
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-xs tracking-[.22em] text-neutral-400">HOMEWORK & NOTES</p><h3 className="mt-1 text-[18px] font-semibold">作业与笔记</h3></div>
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#f1f1f1] text-lg">✎</span>
        </div>
        <label className="text-sm">选择课程<select className={inputClass} value={selectedClassId} onChange={e=>setSelectedClassId(e.target.value)}>
          <option value="">请选择</option>{data.classes.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        {selectedClass && <>
          {selectedClass.studyCourseId && resolveLinkedCourse(selectedClass,studyCourses) &&
            <button type="button" className={mutedButton}
              onClick={()=>void openStudyCourse(selectedClass.studyCourseId!)}>
              去关联自习室课程复习（保留当前作业及笔记）
            </button>}
          <form onSubmit={addHomework} className="space-y-2">
            <input className={inputClass} required aria-label="新增作业" placeholder="新增作业" value={homeworkTitle} onChange={e=>setHomeworkTitle(e.target.value)}/>
            <input className={inputClass} type="datetime-local" aria-label="作业截止时间" value={homeworkDue} onChange={e=>setHomeworkDue(e.target.value)}/>
            <button className={buttonClass+' min-h-11'} type="submit" disabled={addingHomework}>{addingHomework?'保存中…':'添加作业'}</button>
          </form>
          {data.homework.filter(h=>h.classId===selectedClassId).map(h=><div key={h.id} className="rounded-xl border-b border-neutral-100 bg-[#fafafa] p-3 space-y-3">
            <div className="flex gap-2"><input aria-label={'完成'+h.title} type="checkbox" checked={h.done}
              onChange={e=>void changeHomeworkDone(h.id,e.target.checked)}/>
              <span className={'font-medium text-sm '+(h.done?'line-through text-neutral-400':'text-neutral-900')}>{h.title}</span></div>
            <p className="text-xs text-neutral-500">截止 {h.dueAt||'未设置'} · 已专注 {actualMinutes('homework',h.id)} 分钟 · 预计剩余 {h.minutes} 分钟</p>
            {pendingMinutes('homework',h.id).minutes>0 && !h.done &&
              <button className={mutedButton} disabled={!!settlementBusyId}
                onClick={()=>void settleLinkedFocus('homework',h.id,h.minutes)}>
                手动结算 {pendingMinutes('homework',h.id).minutes} 分钟专注（不会自动完成作业）
              </button>}
            {pendingMinutes('homework',h.id).legacyMinutes>0 &&
              <p className="text-xs text-neutral-600">另有 {pendingMinutes('homework',h.id).legacyMinutes} 分钟旧记录需手动核算。</p>}
            <button className={mutedButton} onClick={()=>onFocus('homework',h.id,h.title)}>为作业开始专注</button>
            <button className={mutedButton} onClick={()=>onDiscuss(
              buildHomeworkReviewTopic(h,selectedClass?.name||'未归属',actualMinutes('homework',h.id)),
              'study',h.id)}>请 Char 陪我复盘作业</button>
            <WorkspaceReminderControls kind="homework" itemId={h.id}
              suggestedAt={h.dueAt} data={data} selectedCharId={selectedCharId}
              onSelectChar={onSelectChar} onUpdate={onReminderUpdate}/>
            <details><summary className="text-sm">编辑作业</summary>
              <label className="block text-xs">预计剩余分钟
                <input className={inputClass} type="number" min="0" max="10080" value={h.minutes}
                  onChange={e=>change(v=>({...v,homework:v.homework.map(x=>
                    x.id===h.id?{...x,minutes:Math.max(0,Math.min(10080,Number(e.target.value)||0))}:x)}))}/>
              </label>
              <input className={inputClass} type="datetime-local" value={h.dueAt} onChange={e=>change(v=>({...v,homework:v.homework.map(x=>x.id===h.id?{...x,dueAt:e.target.value}:x)}))}/>
              <textarea className={inputClass} value={h.note} placeholder="备注" onChange={e=>change(v=>({...v,homework:v.homework.map(x=>x.id===h.id?{...x,note:e.target.value}:x)}))}/>
              <button className={mutedButton} onClick={()=>void removeHomework(h.id)}>移除作业</button>
            </details>
          </div>)}
          <label className="block text-sm">学习笔记<textarea className={inputClass} value={noteBody} onChange={e=>setNoteDrafts(prev=>({...prev,[selectedClassId]:e.target.value}))} placeholder="记下刚学到的知识"/></label>
          <button className={buttonClass+' min-h-11'} disabled={!noteBody.trim()||noteSaving} onClick={()=>void saveNote()}>
            {noteSaving?'正在保存…':'保存笔记'}
          </button>
          {data.notes.filter(n=>n.classId===selectedClassId).map(n=><div key={n.id} className="rounded-xl border-b border-neutral-100 bg-[#fafafa] p-3 space-y-2">
            <p className="text-sm whitespace-pre-wrap break-words">{n.body}</p>
            <button className={mutedButton} onClick={()=>onDiscuss('请让我把刚学到的 '+className(n.classId)+' 的内容讲给你听，然后根据笔记追问我，不要擅自判定作业完成。笔记：'+n.body.slice(0,1500),'study',n.id)}>请 Char 提问</button>
          </div>)}
        </>}
        {!selectedClass && <p className="text-xs text-neutral-600">先选择一门课，再记录作业和笔记。</p>}
      </section>
      {(orphaned.homework.length>0 || orphaned.notes.length>0) &&
        <details className={cardClass} aria-label="未归属作业与笔记">
          <summary className="cursor-pointer font-semibold text-sm">未归属资料（{orphaned.homework.length+orphaned.notes.length}）</summary>
          <p className="text-xs text-neutral-600">来自已删除的学习室课程表记录或旧备份，原文保留。可以重新归类；不会修改旧自习室 PDF 或测验。</p>
          {orphaned.homework.map(h=><div key={h.id} className="border-t pt-2 space-y-2">
            <p className="text-sm">{h.done?'✓ ':''}作业：{h.title} · 截止 {h.dueAt||'未设置'} · 原课程 ID：{h.classId}</p>
            <p className="text-xs whitespace-pre-wrap">{h.note}</p>
            <button className={mutedButton} onClick={()=>onFocus('homework',h.id,h.title)}>继续为这项作业专注</button>
            <button className={mutedButton} onClick={()=>onDiscuss(
              buildHomeworkReviewTopic(h,'未归属课程',actualMinutes('homework',h.id)),
              'study',h.id)}>请 Char 复盘未归属作业</button>
            {pendingMinutes('homework',h.id).minutes>0 && !h.done &&
              <button className={mutedButton} disabled={!!settlementBusyId}
                onClick={()=>void settleLinkedFocus('homework',h.id,h.minutes)}>
                手动结算 {pendingMinutes('homework',h.id).minutes} 分钟到未归属作业（不更改归类）
              </button>}
            <WorkspaceReminderControls kind="homework" itemId={h.id}
              suggestedAt={h.dueAt} data={data} selectedCharId={selectedCharId}
              onSelectChar={onSelectChar} onUpdate={onReminderUpdate}/>
            <select className={inputClass} aria-label={'重新归类作业 '+h.title} value=""
              onChange={e=>{if(e.target.value)recoverOrphan('homework',h.id,e.target.value);}}>
              <option value="">将作业重新归入课程…</option>
              {data.classes.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>)}
          {orphaned.notes.map(n=><div key={n.id} className="border-t pt-2 space-y-2">
            <p className="text-sm whitespace-pre-wrap">笔记：{n.body}</p>
            <p className="text-xs text-neutral-500">原课程 ID：{n.classId}</p>
            <select className={inputClass} aria-label="重新归类笔记" value=""
              onChange={e=>{if(e.target.value)recoverOrphan('note',n.id,e.target.value);}}>
              <option value="">将笔记重新归入课程…</option>
              {data.classes.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>)}
        </details>}
      
    </div>
  </div>;
};
// While hidden, ignore parent timer ticks that only recreate callback lambdas.
// Re-enable normal rendering immediately when the section becomes visible.
const MemoWorkspacePanel=React.memo(WorkspacePanel,(previous,next)=>
  previous.visible===false && next.visible===false
  && previous.section===next.section
  && previous.records===next.records
  && previous.focusTasks===next.focusTasks
  && previous.selectedCharId===next.selectedCharId
  && previous.planPreview===next.planPreview
);
export default MemoWorkspacePanel;
