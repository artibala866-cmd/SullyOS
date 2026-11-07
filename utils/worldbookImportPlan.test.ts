import { describe,expect,it } from 'vitest';
import type { Worldbook } from '../types';
import { importedWorldbookSnapshot,planWorldbookImport } from './worldbookImportPlan';
const make=(id:string,key?:string,extra:Partial<Worldbook>={}):Worldbook=>({
    id,title:'角色记忆',content:'原始正文',category:'BabyLink · 世界',
    createdAt:1,updatedAt:1,key:['相遇'],keysecondary:[],constant:false,disable:false,
    position:0,order:100,probability:100,useProbability:false,depth:4,role:null,
    selective:false,selectiveLogic:0,scanDepth:999,caseSensitive:false,matchWholeWords:false,
    ...(key?{cardImportKey:key}:{}),...extra,
});
describe('standalone Link worldbook safe incremental import',()=>{
    it('adds once, skips an identical reimport, survives a simulated reload',()=>{
        const input=[make('source-temp','babylink-worldbook:one:two')];
        const first=planWorldbookImport([],input);
        expect(first.added).toHaveLength(1);
        expect(first.added[0].cardImportSnapshot).toBe(importedWorldbookSnapshot(input[0]));
        const second=planWorldbookImport(structuredClone(first.library),[make('another-temp','babylink-worldbook:one:two')]);
        expect(second.added).toEqual([]);expect(second.updated).toEqual([]);
        expect(second.skipped).toBe(1);
        expect(second.library[0].id).toBe('source-temp');
    });
    it('updates source-owned keyword / enabled flags without creating another entry',()=>{
        const first=planWorldbookImport([],[make('new','babylink-worldbook:B:E')]);
        const changed=make('another','babylink-worldbook:B:E',{
            key:['新版关键词'],disable:true,position:4,depth:0,order:-10000,
        });
        const second=planWorldbookImport(first.library,[changed]);
        expect(second.added).toHaveLength(0);
        expect(second.updated).toHaveLength(1);
        expect(second.library).toHaveLength(1);
        expect(second.library[0]).toMatchObject({
            id:'new',createdAt:1,key:['新版关键词'],disable:true,position:4,depth:0,order:-10000,
        });
        expect(planWorldbookImport(second.library,[changed]).skipped).toBe(1);
    });
    it('does not overwrite a locally edited worldbook, even with same source ID',()=>{
        const first=planWorldbookImport([],[make('original','babylink-worldbook:B:E')]);
        const handEdited=first.library.map(book=>({...book,content:'我自己修改过的内容',updatedAt:99}));
        const changed=make('new-file-id','babylink-worldbook:B:E',{content:'更新版本正文'});
        const next=planWorldbookImport(handEdited,[changed]);
        expect(next).toMatchObject({conflicts:1,added:[],updated:[]});
        expect(next.library[0].content).toBe('我自己修改过的内容');
    });
    it('does not overwrite legacy source data with no trustworthy snapshot',()=>{
        const legacy=[make('old','babylink-worldbook:B:E',{content:'之前导入的正文'})];
        const changed=make('new','babylink-worldbook:B:E',{content:'新版内容'});
        expect(planWorldbookImport(legacy,[changed]).conflicts).toBe(1);
    });
    it('two independent Link IDs may intentionally share prose but have different triggers',()=>{
        const one=make('one','babylink-worldbook:A:1',{key:['早晨']});
        const two=make('two','babylink-worldbook:A:2',{key:['午夜']});
        const result=planWorldbookImport([], [one,two]);
        expect(result.added).toHaveLength(2);
        expect(result.library.map(b=>b.key![0])).toEqual(['早晨','午夜']);
    });
    it('identical no-ID rows skip but changed trigger settings conflict rather than duplicate',()=>{
        const old=make('old');
        const same=make('new');
        const changed=make('new2',undefined,{disable:true,key:['不同']});
        expect(planWorldbookImport([old],[same])).toMatchObject({skipped:1,conflicts:0});
        expect(planWorldbookImport([old],[changed])).toMatchObject({skipped:0,conflicts:1});
    });
    it('duplicate source ID with different data in one batch aborts entire plan',()=>{
        const one=make('one','babylink-worldbook:A:E');
        const two=make('two','babylink-worldbook:A:E',{content:'冲突'});
        expect(()=>planWorldbookImport([], [one,two])).toThrow('冲突的来源条目 ID');
    });
    it('updates an imported TXT/PDF worldbook on second import without creating a duplicate',()=>{
        const key='document-worldbook:长篇世界.pdf';
        const one=make('doc-initial',key,{title:'长篇世界',category:'长篇世界',content:'旧世界背景',key:[],constant:true});
        const first=planWorldbookImport([], [one]);
        const revision=make('doc-new-file-id',key,{title:'长篇世界',category:'长篇世界',content:'新世界背景',key:[],constant:true});
        const next=planWorldbookImport(first.library,[revision]);
        expect(next.added).toHaveLength(0);
        expect(next.updated).toHaveLength(1);
        expect(next.library).toHaveLength(1);
        expect(next.library[0]).toMatchObject({id:'doc-initial',content:'新世界背景'});
        expect(planWorldbookImport(next.library,[revision]).skipped).toBe(1);
    });
    it('legacy document entries are adopted only with exact matching generated IDs and contents',()=>{
        const key='document-worldbook:人生.txt';
        const old=make('wb-1699999999999-0-a1b2c3',undefined,{
            title:'人生',category:'人生',content:'以前导入的故事',sourceUid:0,key:[],constant:true,
        });
        const same=make('fresh',key,{title:'人生',category:'人生',content:'以前导入的故事',key:[],constant:true});
        const adopted=planWorldbookImport([old],[same]);
        expect(adopted).toMatchObject({skipped:0,conflicts:0,added:[]});
        expect(adopted.updated).toHaveLength(1);
        expect(adopted.library[0].id).toBe(old.id);
        expect(adopted.library[0].cardImportKey).toBe(key);
        const different=make('newer',key,{title:'人生',category:'人生',content:'修订的故事',key:[],constant:true});
        const updated=planWorldbookImport(adopted.library,[different]);
        expect(updated).toMatchObject({conflicts:0,added:[]});
        expect(updated.library[0].content).toBe('修订的故事');
        expect(planWorldbookImport([old],[different])).toMatchObject({conflicts:1,added:[],updated:[]});
    });
    it('a conflicting filename never overwrites handwritten lore or another document',()=>{
        const first=planWorldbookImport([], [make('original','document-worldbook:世界.txt',{
            title:'世界',category:'世界',content:'分支 A',key:[],constant:true,
        })]);
        const second=make('other','document-worldbook:世界.pdf',{
            title:'世界',category:'世界',content:'分支 B',key:[],constant:true,
        });
        const conflicted=planWorldbookImport(first.library,[second]);
        expect(conflicted).toMatchObject({conflicts:1,added:[],updated:[]});
        expect(conflicted.library[0].content).toBe('分支 A');

        const handmade=make('custom-id',undefined,{
            title:'世界',category:'世界',content:'用户写的世界',key:[],constant:true,
        });
        const imported=planWorldbookImport([handmade],[second]);
        expect(imported).toMatchObject({conflicts:1,added:[],updated:[]});
        expect(imported.library.find(book=>book.id==='custom-id')?.content).toBe('用户写的世界');
    });
    it('a locally edited imported document blocks automatic replacement',()=>{
        const key='document-worldbook:秘密.docx';
        const first=planWorldbookImport([], [make('original',key,{
            title:'秘密',category:'秘密',content:'初稿',key:[],constant:true,
        })]);
        const edited=first.library.map(book=>({...book,content:'我自己编辑过的故事'}));
        const reimport=planWorldbookImport(edited,[make('next',key,{
            title:'秘密',category:'秘密',content:'新版文档',key:[],constant:true,
        })]);
        expect(reimport).toMatchObject({conflicts:1,added:[],updated:[]});
        expect(reimport.library[0].content).toBe('我自己编辑过的故事');
    });

    it('two documents with identical title and content skip one; different modules stay distinct',()=>{
        const one=make('1',undefined,{category:'文档世界书',constant:true,key:[]});
        const two=make('2',undefined,{category:'文档世界书',constant:true,key:[]});
        expect(planWorldbookImport([], [one,two])).toMatchObject({skipped:1});
    });
});