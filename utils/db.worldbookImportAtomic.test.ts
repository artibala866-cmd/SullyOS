import {afterEach,describe,expect,it,vi} from 'vitest';
import type {CharacterProfile,Worldbook} from '../types';
import {DB} from './db';
import {toMountedWorldbook} from './worldbook';
const source='babylink-worldbook:qa-v2:row-';
const make=(n:string,updates:Partial<Worldbook>={}):Worldbook=>({
    id:'atomic-'+n,title:'导入条目'+n,content:'原文'+n,category:'BabyLink · 原世界书',
    key:['关键词'+n],keysecondary:[],constant:false,selective:false,disable:false,
    order:100,position:0,depth:4,role:null,probability:100,useProbability:false,scanDepth:999,
    createdAt:1,updatedAt:1,cardImportKey:source+n,...updates,
});
afterEach(()=>vi.restoreAllMocks());
describe('real IndexedDB standalone Link worldbook import transaction',()=>{
    it('stores complete batch then reloads, and second import never duplicates',async()=>{
        const label='fresh-'+Date.now().toString(36);
        const rows=[make(label+'-a'),make(label+'-b')];
        const first=await DB.importWorldbooksSmartAtomic(rows);
        expect(first).toMatchObject({added:2,updated:0,skipped:0,conflicts:0});
        const stored=await DB.getAllWorldbooks();
        expect(rows.every(row=>stored.some(book=>book.cardImportKey===row.cardImportKey))).toBe(true);
        const second=await DB.importWorldbooksSmartAtomic(rows.map(book=>({...book,id:'different-'+book.id})));
        expect(second).toMatchObject({added:0,updated:0,skipped:2,conflicts:0});
        expect((await DB.getAllWorldbooks()).filter(book=>rows.some(x=>x.cardImportKey===book.cardImportKey))).toHaveLength(2);
    });
    it('updating Link keywords and disabled status also synchronizes existing role mounts',async()=>{
        const suffix='mount-'+Date.now().toString(36),input=make(suffix);
        await DB.importWorldbooksSmartAtomic([input]);
        const char={
            id:'world-import-char-'+suffix,name:'未修改的人设',systemPrompt:'不可修改的人格',
            avatar:'',mountedWorldbooks:[toMountedWorldbook(input)],memories:[{id:'memory-unchanged',content:'私人记忆'}],
        } as unknown as CharacterProfile;
        await DB.saveCharacter(char);
        const next=make(suffix,{id:'new-file-id-'+suffix,content:'新的剧情',disable:true,key:['新版触发'],position:4,depth:0});
        const result=await DB.importWorldbooksSmartAtomic([next]);
        expect(result).toMatchObject({added:0,updated:1,skipped:0,conflicts:0});
        const saved=await DB.getCharacter(char.id);
        expect(saved).toMatchObject({name:'未修改的人设',systemPrompt:'不可修改的人格',memories:char.memories});
        expect(saved?.mountedWorldbooks?.[0]).toMatchObject({id:input.id,content:'新的剧情',disable:true,key:['新版触发'],position:4,depth:0});
        expect((await DB.getAllWorldbooks()).find(book=>book.id===input.id)?.content).toBe('新的剧情');
    });
    it('forced IndexedDB write abort restores all books (no partial success)',async()=>{
        const suffix='abort-'+Date.now().toString(36),rows=[make(suffix+'1'),make(suffix+'2')];
        const original=IDBObjectStore.prototype.add;
        vi.spyOn(IDBObjectStore.prototype,'add').mockImplementation(function(this:IDBObjectStore,...args:any[]){
            const request=(original as any).apply(this,args) as IDBRequest;
            if(this.name==='worldbooks'&&(args[0] as Worldbook)?.cardImportKey===rows[1].cardImportKey)
                request.addEventListener('success',()=>this.transaction.abort());
            return request;
        });
        await expect(DB.importWorldbooksSmartAtomic(rows)).rejects.toBeTruthy();
        const stored=await DB.getAllWorldbooks();
        expect(stored.filter(book=>rows.some(x=>book.cardImportKey===x.cardImportKey))).toHaveLength(0);
    });
    it('concurrent repeated imports serialize and share a single durable entry',async()=>{
        const suffix='race-'+Date.now().toString(36),row=make(suffix);
        const [a,b]=await Promise.all([
            DB.importWorldbooksSmartAtomic([row]),
            DB.importWorldbooksSmartAtomic([{...row,id:'other-'+suffix}]),
        ]);
        expect(a.added+b.added).toBe(1);
        expect(a.skipped+b.skipped).toBe(1);
        expect((await DB.getAllWorldbooks()).filter(book=>book.cardImportKey===row.cardImportKey)).toHaveLength(1);
    });
});