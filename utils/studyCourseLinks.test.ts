import {describe,expect,it,vi} from 'vitest';
import {emptyWorkspace,type ClassHomework,type ClassNote} from './sullyWorkspace';
import {
  toStudyCourseOptions,loadStudyCourseOptions,setClassStudyCourseLink,
  deleteTimetableClass,orphanedClassContent,reassignOrphanContent,resolveLinkedCourse,
} from './studyCourseLinks';

vi.mock('./db',()=>({DB:{getAllCourses:vi.fn(async()=>[
  {id:'book1',title:'代数',totalProgress:45,chapters:[{isCompleted:true},{isCompleted:false}]},
  {id:'book2',title:'速写',totalProgress:100,chapters:[{isCompleted:true}]},
])}}));

const sample=()=>{
  const data=emptyWorkspace();
  data.classes=[
    {id:'classA',name:'报班速写',weekday:1,start:'10:00',end:'12:00',until:'',
      teacher:'老师',location:'教室',note:'',studyCourseId:undefined},
    {id:'classB',name:'数学',weekday:3,start:'12:00',end:'13:00',until:'',
      teacher:'',location:'',note:'',studyCourseId:'missing-book'},
  ];
  data.homework=[{id:'h1',classId:'classA',title:'画人体',dueAt:'',minutes:50,
    done:false,note:'不会公开'} as ClassHomework];
  data.notes=[{id:'n1',classId:'classA',body:'笔记内容',createdAt:1} as ClassNote];
  return data;
};

describe('学习室与原有自习室课程 ID 关联',()=>{
  it('只读取旧课程元信息，旧章节进度正确且不返回 PDF 原文',async()=>{
    const options=await loadStudyCourseOptions();
    expect(options.map(c=>c.title)).toEqual(['代数','速写']);
    expect(options[0]).toMatchObject({id:'book1',totalProgress:45,chaptersCompleted:1,chaptersTotal:2});
    expect(JSON.stringify(options)).not.toContain('rawText');
  });
  it('已有课程可以关联/解除关联，原有课程与学习室作业笔记完全不变',()=>{
    const data=sample(),options=toStudyCourseOptions([
      {id:'book1',title:'书',totalProgress:40,chapters:[]} as any,
    ]);
    const linked=setClassStudyCourseLink(data,'classA','book1',options);
    expect(resolveLinkedCourse(linked.classes[0],options)?.id).toBe('book1');
    expect(linked.homework).toBe(data.homework);
    expect(linked.notes).toBe(data.notes);
    expect(data.classes[0].studyCourseId).toBeUndefined();
    const unlinked=setClassStudyCourseLink(linked,'classA','',options);
    expect(unlinked.classes[0].studyCourseId).toBeUndefined();
    expect(unlinked.homework).toEqual(data.homework);
  });
  it('旧备份里的缺失关联保留并显示为失效，禁止新建无效关联',()=>{
    const data=sample();
    expect(resolveLinkedCourse(data.classes[1],[])).toBeNull();
    expect(data.classes[1].studyCourseId).toBe('missing-book');
    expect(()=>setClassStudyCourseLink(data,'classA','ghost',[])).toThrow('不存在');
    expect(()=>setClassStudyCourseLink(data,'deleted','',[])).toThrow('已删除');
  });
  it('删除本地课程不会级联删除旧自习室、作业和笔记，可恢复归属',()=>{
    const data=sample();
    const deleted=deleteTimetableClass(data,'classA');
    expect(deleted.classes.map(c=>c.id)).toEqual(['classB']);
    expect(deleted.homework).toEqual(data.homework);
    expect(deleted.notes).toEqual(data.notes);
    expect(orphanedClassContent(deleted).homework.map(h=>h.id)).toEqual(['h1']);
    expect(orphanedClassContent(deleted).notes.map(n=>n.id)).toEqual(['n1']);
    const restored=reassignOrphanContent(deleted,'homework','h1','classB');
    const restoredBoth=reassignOrphanContent(restored,'note','n1','classB');
    expect(orphanedClassContent(restoredBoth)).toEqual({homework:[],notes:[]});
    expect(restoredBoth.homework[0].note).toBe('不会公开');
    expect(restoredBoth.notes[0].body).toBe('笔记内容');
    expect(data.homework[0].classId).toBe('classA');
    expect(()=>reassignOrphanContent(restoredBoth,'homework','h1','classB')).toThrow('不是未归属');
    expect(()=>reassignOrphanContent(deleted,'note','n1','missing')).toThrow('不存在');
  });
  it('历史 orphan 数据无需迁移就可查询和恢复',()=>{
    const data=emptyWorkspace();
    data.homework=[{id:'old-homework',classId:'deleted-class',title:'旧作业',dueAt:'',
      minutes:30,done:false,note:''}];
    expect(orphanedClassContent(data).homework[0].title).toBe('旧作业');
    expect(deleteTimetableClass(data,'not-here')).toBe(data);
  });
});
