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
 await put(db,{characters:[{id:'c',name:'谢嬴',avatar:'blobref:avatar',description:'当前人设',systemPrompt:'人设',memories:[{summary:'A记忆'}]}],character_groups:[{id:'group-a',name:'A分组',createdAt:1}],worldbooks:[{id:'w',name:'当前世界书'}],messages:[{id:11,charId:'c',content:'A聊天'}],user_profile:[{id:'me',name:'A身份',bio:'A设定',avatar:'blobref:avatar'}],blob_assets:[{id:'avatar',blob:new Blob(['头像'],{type:'image/png'})}]});
 const second=await new Promise<IDBDatabase>((resolve,reject)=>{const req=indexedDB.open('AetherOS_Data__user_'+SECOND,db.version);req.onupgradeneeded=()=>{const schema=db.transaction(Array.from(db.objectStoreNames));for(const name of Array.from(db.objectStoreNames)){const old=schema.objectStore(name);const target=req.result.createObjectStore(name,{keyPath:old.keyPath,autoIncrement:old.autoIncrement});for(const i of Array.from(old.indexNames)){const idx=old.index(i);target.createIndex(i,idx.keyPath,{unique:idx.unique,multiEntry:idx.multiEntry});}}};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
 await put(second,{characters:[{id:'c',name:'谢嬴',avatar:'blobref:avatar',description:'备份里的旧人设',systemPrompt:'人设',memories:[{summary:'B记忆'}]},{id:'only-b',name:'B独有角色',avatar:'blobref:b-avatar',description:'人设',systemPrompt:'人设',memories:[{summary:'B私密经历'}]}],character_groups:[{id:'only-group',name:'B旧分组',createdAt:2}],themes:[{id:'only-theme',name:'备份旧主题',type:'custom',user:{},ai:{}}],emoji_categories:[{id:'only-category',name:'备份旧分类'}],emojis:[{name:'only-emoji',url:'old.png',categoryId:'only-category'}],worldbooks:[{id:'w',name:'备份旧世界书'},{id:'only-w',name:'B独有世界书'}],messages:[{id:22,charId:'c',content:'B聊天'}],memory_nodes:[{id:'m',charId:'c',content:'B宫殿'}],memory_vectors:[{memoryId:'m',charId:'c',vector:new Uint8Array(new Float32Array([1.25,-2,0]).buffer),dimensions:3}],blob_assets:[{id:'avatar',blob:new Blob(['头像'],{type:'image/png'})},{id:'b-avatar',blob:new Blob(['B头像'],{type:'image/png'})},{id:'private',blob:new Blob(['B私聊图片'],{type:'image/png'})}],user_profile:[{id:'me',name:'B身份',bio:'B设定',avatar:'blobref:avatar'}],assets:[{id:'ls_mirror_v1',data:{data:{os_remote_vector_config:'旧云端'}}},{id:'wallpaper',data:'旧壁纸'}],story_theaters:[{id:'story-b',title:'B剧情'}]});
 second.close();localStorage.setItem('palace_hwm_c','11');localStorage.setItem(`sully:save-data:${SECOND}:palace_hwm_c`,'22');localStorage.setItem('os_theme','原外观');localStorage.setItem(`sully:save-data:${SECOND}:os_remote_vector_config`,'旧云端');
 return {db,registry};
}
it('opt-in exports each identity\'s own AMSG2 backend link and restores it to the matching copy',async()=>{
 const {db}=await seed();
 const {ActiveMsgStore,importAmsg2GlobalConfig}=await import('./activeMsgStore');
 const {createAllUserSaveBackup,prepareUserSaveRestore}=await import('./userSaveBackup');
 await ActiveMsgStore.saveGlobalConfig({
  workerUrl:'https://worker-a.example.workers.dev',serverToken:'token-a',masterKey:'master-a',userId:'user-a',instantChatEnabled:true,
 });
 await importAmsg2GlobalConfig({
  workerUrl:'https://worker-b.example.workers.dev',serverToken:'token-b',masterKey:'master-b',userId:'user-b',
 },{identityId:SECOND,allowBackendConnection:true});

 const defaultBackup=await createAllUserSaveBackup();
 const defaultZip=await JSZip.loadAsync(await defaultBackup.arrayBuffer());
 const defaultManifest=JSON.parse(await defaultZip.file('user-saves.json')!.async('string'));
 expect(defaultManifest.saves.every((save:any)=>save.amsg2GlobalConfig===undefined)).toBe(true);

 const backup=await createAllUserSaveBackup(()=>{}, {includeBackendConnection:true});
 const plan=(await prepareUserSaveRestore(backup))!;
 expect(plan.backendConnections).toEqual([
  {identityName:'原来的故事',workerUrl:'https://worker-a.example.workers.dev'},
  {identityName:'校园线',workerUrl:'https://worker-b.example.workers.dev'},
 ]);
 db.close();

 // Restore on a clean browser profile. Each new identity must receive its own
 // connection record rather than inheriting the currently active identity's link.
 localStorage.clear();
 vi.stubGlobal('indexedDB',new IDBFactory());
 vi.resetModules();
 const {prepareUserSaveRestore:prepareFresh}=await import('./userSaveBackup');
 const freshPlan=(await prepareFresh(backup))!;
 expect(freshPlan.backendConnections).toHaveLength(2);
 await freshPlan.restore(()=>{}, {allowBackendConnections:true});
 const registry=JSON.parse(localStorage.getItem(key)!);
 const restored=registry.saves.slice(1);
 const {exportAmsg2GlobalConfig}=await import('./activeMsgStore');
 const configs=await Promise.all(restored.map((save:any)=>exportAmsg2GlobalConfig({
  includeBackendConnection:true,identityId:save.id,
 })));
 expect(configs[0]).toMatchObject({
  workerUrl:'https://worker-a.example.workers.dev',serverToken:'token-a',masterKey:'master-a',userId:'user-a',
 });
 expect(configs[1]).toMatchObject({
  workerUrl:'https://worker-b.example.workers.dev',serverToken:'token-b',masterKey:'master-b',userId:'user-b',
 });
});

it('does not reconnect any identity Worker unless the all-identity restore is confirmed',async()=>{
 const {db}=await seed();
 const {ActiveMsgStore}=await import('./activeMsgStore');
 const {createAllUserSaveBackup}=await import('./userSaveBackup');
 await ActiveMsgStore.saveGlobalConfig({
  workerUrl:'https://worker-private.example.workers.dev',serverToken:'private-token',masterKey:'private-master',
  userId:'private-user',instantChatEnabled:true,
 });
 const backup=await createAllUserSaveBackup(()=>{}, {includeBackendConnection:true});
 db.close();

 localStorage.clear();
 vi.stubGlobal('indexedDB',new IDBFactory());
 vi.resetModules();
 const {prepareUserSaveRestore}=await import('./userSaveBackup');
 const plan=(await prepareUserSaveRestore(backup))!;
 expect(plan.backendConnections).toHaveLength(1);
 await plan.restore(); // No approval: only harmless local AMSG2 settings may be restored.
 const registry=JSON.parse(localStorage.getItem(key)!);
 const restored=registry.saves[1];
 const activeMsgDb=await open('ActiveMsg__user_'+restored.id);
 const stored=await new Promise<any>((resolve,reject)=>{
  const request=activeMsgDb.transaction('kv','readonly').objectStore('kv').get('global-config');
  request.onsuccess=()=>resolve(request.result?.value);
  request.onerror=()=>reject(request.error);
 });
 expect(stored.workerUrl).toBeUndefined();
 expect(stored.serverToken).toBeUndefined();
 expect(stored.masterKey).toBeUndefined();
 expect(stored.userId).toBeUndefined();
 expect(stored.instantChatEnabled).toBe(true);
 activeMsgDb.close();
});

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
it('does not silently restore remote account tokens or cloud auto-sync settings when shared preferences are missing',async()=>{
  const {db}=await seed();
  const dangerous={
    'os_cloud_backup_config':'{"enabled":true,"token":"cloud-old"}',
    'os_remote_vector_config':'{"enabled":true,"token":"vector-old"}',
    'os_realtime_config':'{"enabled":true,"token":"realtime-old"}',
    'push_vapid_v1':'{"vapidPrivateKey":"secret"}',
    'sully_proxy_worker_url_v1':'https://untrusted.example/malicious-proxy',
    'aetheros.mcp.servers':'[{"name":"remote","headers":{"Authorization":"secret"}}]',
    'aetheros.mcd.mcpToken':'mcd-token',
    'aetheros.luckin.mcpToken':'luckin-token',
    'sully-beauty-author-session-v1':'{"token":"beauty-session"}'
  };
  for(const [key,value]of Object.entries(dangerous))localStorage.setItem(key,value);
  const {createAllUserSaveBackup,prepareUserSaveRestore}=await import('./userSaveBackup');
  const backup=await createAllUserSaveBackup();
  for(const key of Object.keys(dangerous))localStorage.removeItem(key);
  await (await prepareUserSaveRestore(backup))!.restore();
  for(const key of Object.keys(dangerous))expect(localStorage.getItem(key),key).toBeNull();
  expect(localStorage.getItem('os_theme')).toBe('原外观');
  db.close();
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

it('restores missing shared theme settings with their theme-only photo bytes on a device without those assets',async()=>{
 const {db}=await seed();const {createAllUserSaveBackup,prepareUserSaveRestore}=await import('./userSaveBackup');
 const theme=JSON.stringify({launcherWidgets:{filmPhoto1:'blobref:theme-only-photo'}});
 localStorage.setItem('os_theme',theme);await put(db,{blob_assets:[{id:'theme-only-photo',blob:new Blob(['film bytes'],{type:'image/png'})}]});
 const backup=await createAllUserSaveBackup();localStorage.removeItem('os_theme');
 await new Promise<void>((resolve,reject)=>{const tx=db.transaction('blob_assets','readwrite');tx.objectStore('blob_assets').delete('theme-only-photo');tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});
 await (await prepareUserSaveRestore(backup))!.restore();
 expect(localStorage.getItem('os_theme')).toBe(theme);
 expect(await (await rows(db,'blob_assets')).find(row=>row.id==='theme-only-photo').blob.text()).toBe('film bytes');
 expect((await rows(db,'messages'))[0].content).toBe('A聊天');db.close();
});

it('restores both identities from the exported file alone, excluding legacy deleted entries',async()=>{
 const {db,registry}=await seed();
 localStorage.setItem(key,JSON.stringify({...registry,deletedSaves:[{id:'22222222-2222-4222-8222-222222222222',name:'已删测试',deletedAt:1}]}));
 const backup=await (await import('./userSaveBackup')).createAllUserSaveBackup();
 db.close();
 // A different browser profile has neither the old identity index nor its databases.
 localStorage.clear();vi.stubGlobal('indexedDB',new IDBFactory());vi.resetModules();
 const {prepareUserSaveRestore}=await import('./userSaveBackup');
 const plan=(await prepareUserSaveRestore(backup))!;expect(await plan.restore()).toBe(2);
 const imported=JSON.parse(localStorage.getItem(key)!);
 expect(imported.saves.map((save:any)=>save.name)).toEqual(['原有身份','原来的故事','校园线']);
 for(const [index,save] of imported.saves.slice(1).entries()){
   const restored=await open('AetherOS_Data__user_'+save.id);
   const label=index===0?'A':'B';
   expect((await rows(restored,'messages'))[0].content).toBe(label+'聊天');
   expect((await rows(restored,'user_profile'))[0].bio).toBe(label+'设定');
   restored.close();
 }
});

it('updates indexes when switching to an older restored identity without losing its chat',async()=>{
 const {db}=await seed();
 const {createAllUserSaveBackup,prepareUserSaveRestore}=await import('./userSaveBackup');
 const backup=await createAllUserSaveBackup();
 const zip=await JSZip.loadAsync(await backup.arrayBuffer());
 const manifest=JSON.parse(await zip.file('user-saves.json')!.async('string'));
 const main=manifest.saves[1].databases.find((database:any)=>database.kind==='main');
 main.version--;
 const messages=main.stores.find((store:any)=>store.name==='messages');
 messages.indexes=messages.indexes.filter((index:any)=>index.name!=='charId_type');
 zip.file('user-saves.json',JSON.stringify(manifest));
 const oldBackup=new Blob([await zip.generateAsync({type:'uint8array'}) as BlobPart]);
 await (await prepareUserSaveRestore(oldBackup))!.restore();
 const registry=JSON.parse(localStorage.getItem(key)!);
 const copy=registry.saves.at(-1);
 await (await import('./userSaves')).activateUserSave(copy.id);
 const restored=await open('AetherOS_Data__user_'+copy.id);
 expect(restored.version).toBe(db.version);
 expect(restored.transaction('messages').objectStore('messages').indexNames.contains('charId_type')).toBe(true);
 expect((await rows(restored,'messages'))[0].content).toBe('B聊天');
 restored.close();db.close();
});
it('round-trips shared deletion markers and does not restore deleted base cards/books',async()=>{
  const {db,registry}=await seed();
  const scope=await import('./userSaveScope');
  scope.writeUserSaves({...registry,sharedDeletions:{characters:['only-b'],worldbooks:['only-w'],characterGroups:['only-group'],stores:{themes:[JSON.stringify('only-theme')],emoji_categories:[JSON.stringify('only-category')],emojis:[JSON.stringify('only-emoji')],assets:[JSON.stringify('wallpaper')]} }},localStorage.getItem(key));
  const {createAllUserSaveBackup,prepareUserSaveRestore}=await import('./userSaveBackup');
  const backup=await createAllUserSaveBackup();
  const zip=await JSZip.loadAsync(await backup.arrayBuffer());
  const manifest=JSON.parse(await zip.file('user-saves.json')!.async('string'));
  expect(manifest.sharedDeletions).toEqual({characters:['only-b'],worldbooks:['only-w'],characterGroups:['only-group'],stores:{themes:[JSON.stringify('only-theme')],emoji_categories:[JSON.stringify('only-category')],emojis:[JSON.stringify('only-emoji')],assets:[JSON.stringify('wallpaper')]}});
  const restored=(await prepareUserSaveRestore(backup))!;
  await restored.restore();
  expect(scope.readUserSaves().sharedDeletions).toEqual({characters:['only-b'],worldbooks:['only-w'],characterGroups:['only-group'],stores:{themes:[JSON.stringify('only-theme')],emoji_categories:[JSON.stringify('only-category')],emojis:[JSON.stringify('only-emoji')],assets:[JSON.stringify('wallpaper')]}});
  expect((await rows(db,'characters')).some(row=>row.id==='only-b')).toBe(false);
  expect((await rows(db,'worldbooks')).some(row=>row.id==='only-w')).toBe(false);
  expect((await rows(db,'character_groups')).some(row=>row.id==='only-group')).toBe(false);
  expect((await rows(db,'themes')).some(row=>row.id==='only-theme')).toBe(false);
  expect((await rows(db,'emoji_categories')).some(row=>row.id==='only-category')).toBe(false);
  expect((await rows(db,'emojis')).some(row=>row.name==='only-emoji')).toBe(false);
  expect((await rows(db,'assets')).some(row=>row.id==='wallpaper')).toBe(false);
  db.close();
 });

