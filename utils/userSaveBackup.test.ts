import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {IDBFactory} from 'fake-indexeddb';
import JSZip from 'jszip';
const SECOND='11111111-1111-4111-8111-111111111111';
const key='sully:user-saves:v1';
beforeEach(()=>{vi.resetModules();localStorage.clear();vi.stubGlobal('indexedDB',new IDBFactory());vi.stubGlobal('window',{localStorage,location:{reload:vi.fn()},addEventListener:vi.fn()});});
afterEach(()=>vi.unstubAllGlobals());
async function open(name:string):Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const req=indexedDB.open(name);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function rows(db:IDBDatabase,name:string):Promise<any[]>{return new Promise((resolve,reject)=>{const req=db.transaction(name).objectStore(name).getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function put(db:IDBDatabase,data:Record<string,any[]>){await new Promise<void>((resolve,reject)=>{const tx=db.transaction(Object.keys(data),'readwrite');for(const[name,values]of Object.entries(data))for(const value of values)tx.objectStore(name).put(value);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});}
async function seed(){
 const {openDB}=await import('./db');const db=await openDB();
 const registry={activeId:'original',saves:[{id:'original',name:'原来的故事'},{id:SECOND,name:'校园线'}]};localStorage.setItem(key,JSON.stringify(registry));
 await put(db,{characters:[{id:'c',name:'谢嬴',avatar:'blobref:avatar',description:'当前人设',systemPrompt:'人设',memories:[{summary:'A记忆'}]}],worldbooks:[{id:'w',name:'当前世界书'}],messages:[{id:11,charId:'c',content:'A聊天'}],user_profile:[{id:'me',name:'A身份',bio:'A设定',avatar:'blobref:avatar'}],blob_assets:[{id:'avatar',blob:new Blob(['头像'],{type:'image/png'})}]});
 const second=await new Promise<IDBDatabase>((resolve,reject)=>{const req=indexedDB.open('AetherOS_Data__user_'+SECOND,db.version);req.onupgradeneeded=()=>{const schema=db.transaction(Array.from(db.objectStoreNames));for(const name of Array.from(db.objectStoreNames)){const old=schema.objectStore(name);const target=req.result.createObjectStore(name,{keyPath:old.keyPath,autoIncrement:old.autoIncrement});for(const i of Array.from(old.indexNames)){const idx=old.index(i);target.createIndex(i,idx.keyPath,{unique:idx.unique,multiEntry:idx.multiEntry});}}};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
 await put(second,{characters:[{id:'c',name:'谢嬴',avatar:'blobref:avatar',description:'备份里的旧人设',systemPrompt:'人设',memories:[{summary:'B记忆'}]},{id:'only-b',name:'B独有角色',avatar:'blobref:b-avatar',description:'人设',systemPrompt:'人设',memories:[{summary:'B私密经历'}]}],worldbooks:[{id:'w',name:'备份旧世界书'},{id:'only-w',name:'B独有世界书'}],messages:[{id:22,charId:'c',content:'B聊天'}],memory_nodes:[{id:'m',charId:'c',content:'B宫殿'}],memory_vectors:[{memoryId:'m',charId:'c',vector:new Uint8Array(new Float32Array([1.25,-2,0]).buffer),dimensions:3}],blob_assets:[{id:'avatar',blob:new Blob(['头像'],{type:'image/png'})},{id:'b-avatar',blob:new Blob(['B头像'],{type:'image/png'})},{id:'private',blob:new Blob(['B私聊图片'],{type:'image/png'})}],user_profile:[{id:'me',name:'B身份',bio:'B设定',avatar:'blobref:avatar'}],assets:[{id:'ls_mirror_v1',data:{data:{os_remote_vector_config:'旧云端'}}}],story_theaters:[{id:'story-b',title:'B剧情'}]});
 second.close();localStorage.setItem('palace_hwm_c','11');localStorage.setItem(`sully:save-data:${SECOND}:palace_hwm_c`,'22');localStorage.setItem('os_theme','原外观');localStorage.setItem(`sully:save-data:${SECOND}:os_remote_vector_config`,'旧云端');
 return {db,registry};
}
it('round-trips all identities, palace vectors, media and story into separate copies without overwriting local saves',async()=>{
 const {db,registry}=await seed();const {createAllUserSaveBackup,prepareUserSaveRestore}=await import('./userSaveBackup');
 const backup=await createAllUserSaveBackup();const zip=await JSZip.loadAsync(await backup.arrayBuffer());const manifest=JSON.parse(await zip.file('user-saves.json')!.async('string'));
 expect(manifest.saves).toHaveLength(2);expect(Object.keys(manifest.files).length).toBeGreaterThan(4);
 const plan=(await prepareUserSaveRestore(backup))!;expect(plan.count).toBe(2);expect(await plan.restore()).toBe(2);
 const result=JSON.parse(localStorage.getItem(key)!);expect(result.activeId).toBe('original');expect(result.saves.slice(0,2)).toEqual(registry.saves);expect(result.saves).toHaveLength(4);
 const [a,b]=result.saves.slice(2);expect(a.id).not.toBe('original');expect(b.id).not.toBe(SECOND);
 const restoredA=await open('AetherOS_Data__user_'+a.id),restoredB=await open('AetherOS_Data__user_'+b.id);
 expect((await rows(restoredA,'messages'))[0].content).toBe('A聊天');expect((await rows(restoredB,'messages'))[0].content).toBe('B聊天');
 expect((await rows(restoredB,'memory_nodes'))[0].content).toBe('B宫殿');const vector=(await rows(restoredB,'memory_vectors'))[0].vector;expect(vector).toBeInstanceOf(Uint8Array);expect([...new Float32Array(vector.buffer)]).toEqual([1.25,-2,0]);
 expect(await (await rows(restoredB,'blob_assets')).find(v=>v.id==='private').blob.text()).toBe('B私聊图片');
 expect((await rows(restoredB,'story_theaters'))[0].title).toBe('B剧情');expect((await rows(restoredB,'user_profile'))[0].bio).toBe('B设定');
 expect(localStorage.getItem(`sully:save-data:${b.id}:palace_hwm_c`)).toBe('22');expect(localStorage.getItem(`sully:save-data:${b.id}:os_remote_vector_config`)).toBeNull();
 expect((await rows(restoredB,'assets')).some(r=>r.id==='ls_mirror_v1')).toBe(false);
 const original=await rows(db,'characters');expect(original.find(c=>c.id==='c').description).toBe('当前人设');expect(original.find(c=>c.id==='c').memories[0].summary).toBe('A记忆');expect(original.find(c=>c.id==='only-b').memories).toEqual([]);
 expect((await rows(db,'worldbooks')).find(w=>w.id==='w').name).toBe('当前世界书');expect((await rows(db,'worldbooks')).some(w=>w.id==='only-w')).toBe(true);
 expect((await rows(db,'blob_assets')).some(v=>v.id==='private')).toBe(false);expect((await rows(db,'blob_assets')).some(v=>v.id==='b-avatar')).toBe(true);
 expect(localStorage.getItem('os_theme')).toBe('原外观');expect(localStorage.getItem('palace_hwm_c')).toBe('11');
 await expect(plan.restore()).rejects.toThrow('已经使用');restoredA.close();restoredB.close();db.close();
});
it('rejects a damaged shard without publishing half-restored identities or changing current gameplay',async()=>{
 const {db,registry}=await seed();const {createAllUserSaveBackup,prepareUserSaveRestore}=await import('./userSaveBackup');const zip=await JSZip.loadAsync(await(await createAllUserSaveBackup()).arrayBuffer());const manifest=JSON.parse(await zip.file('user-saves.json')!.async('string'));const path=manifest.saves[1].databases[0].stores.find((s:any)=>s.name==='messages').parts[0];zip.file(path,'[]');
 const damaged=new Blob([await zip.generateAsync({type:'uint8array'}) as BlobPart]);const plan=(await prepareUserSaveRestore(damaged))!;await expect(plan.restore()).rejects.toThrow('损坏');expect(JSON.parse(localStorage.getItem(key)!)).toEqual(registry);expect((await rows(db,'messages'))[0].content).toBe('A聊天');db.close();
});
it('does not reinterpret legacy ZIP backups as all-identity archives',async()=>{const zip=new JSZip();zip.file('data.json','{}');const {prepareUserSaveRestore}=await import('./userSaveBackup');expect(await prepareUserSaveRestore(new Blob([await zip.generateAsync({type:'uint8array'}) as BlobPart]))).toBeNull();});
it('rename changes only the label; backup locks block switching and label edits',async()=>{
 const {db}=await seed();const {renameUserSave,beginUserSaveOperation,activateUserSave}=await import('./userSaves');renameUserSave('original','  新名称  ');expect(JSON.parse(localStorage.getItem(key)!).saves[0].name).toBe('新名称');expect((await rows(db,'user_profile'))[0].name).toBe('A身份');expect(()=>renameUserSave('original',' ')).toThrow();
 const release=beginUserSaveOperation('备份身份存档');await expect(activateUserSave(SECOND)).rejects.toThrow('备份');expect(()=>renameUserSave('original','其他')).toThrow('备份');release();renameUserSave('original','可用');db.close();
});
it('quota failure leaves old identities selected and removes prepared preference keys',async()=>{
 const {db,registry}=await seed();const {createAllUserSaveBackup,prepareUserSaveRestore}=await import('./userSaveBackup');const backup=await createAllUserSaveBackup();const original=localStorage.setItem.bind(localStorage);
 const spy=vi.spyOn(localStorage,'setItem').mockImplementation((name,value)=>{if(name.startsWith('sully:save-data:')&&!name.includes(SECOND))throw new DOMException('quota','QuotaExceededError');original(name,value);});
 await expect((await prepareUserSaveRestore(backup))!.restore()).rejects.toThrow('quota');spy.mockRestore();expect(JSON.parse(localStorage.getItem(key)!)).toEqual(registry);expect((await rows(db,'messages'))[0].content).toBe('A聊天');db.close();
});

it('a final index quota failure rolls back newly added base cards and leaves the current index intact',async()=>{
 const {db,registry}=await seed();const {createAllUserSaveBackup,prepareUserSaveRestore}=await import('./userSaveBackup');const backup=await createAllUserSaveBackup();const original=localStorage.setItem.bind(localStorage);
 const spy=vi.spyOn(localStorage,'setItem').mockImplementation((name,value)=>{if(name===key)throw new DOMException('index quota','QuotaExceededError');original(name,value);});
 await expect((await prepareUserSaveRestore(backup))!.restore()).rejects.toThrow('index quota');spy.mockRestore();expect(JSON.parse(localStorage.getItem(key)!)).toEqual(registry);
 expect((await rows(db,'characters')).map(c=>c.id)).toEqual(['c']);expect((await rows(db,'worldbooks')).map(w=>w.id)).toEqual(['w']);expect((await rows(db,'messages'))[0].content).toBe('A聊天');db.close();
});

it('a generated id collision cannot delete or overwrite an existing identity database',async()=>{
 const {db,registry}=await seed();const {createAllUserSaveBackup,prepareUserSaveRestore}=await import('./userSaveBackup');const backup=await createAllUserSaveBackup();
 const spy=vi.spyOn(crypto,'randomUUID').mockReturnValue(SECOND);
 await expect((await prepareUserSaveRestore(backup))!.restore()).rejects.toThrow('编号重复');spy.mockRestore();
 const second=await open('AetherOS_Data__user_'+SECOND);expect((await rows(second,'messages'))[0].content).toBe('B聊天');expect(JSON.parse(localStorage.getItem(key)!)).toEqual(registry);second.close();db.close();
});
