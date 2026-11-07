import JSZip from 'jszip';
import { createBackupArchive } from './backupArchive';
import { openDB } from './db';
import { baseCharacter, beginUserSaveOperation, isSharedAsset, referencedBlobs, sharedStoreRows, SHARED_STORES } from './userSaves';
import { createSaveStorage, isSharedPreference, nativeLocalStorage, readUserSaves, scopedDatabaseName, USER_SAVE_ID, USER_SAVES_KEY, isUserSaveIndexKey, writeUserSaves } from './userSaveScope';

const FORMAT = 'sully-user-saves';
const MANIFEST = 'user-saves.json';
const KINDS = { main: 'AetherOS_Data', collaboration: 'SullyOS_Collaboration' } as const;
type Kind = keyof typeof KINDS;
type Progress = (message: string) => void;
type Wire = any;
interface StoreSnapshot {
    name: string; keyPath: string | string[] | null; autoIncrement: boolean;
    indexes: { name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean }[];
    parts: string[]; count: number;
}
interface DatabaseSnapshot { kind: Kind; version: number; stores: StoreSnapshot[] }
interface SaveSnapshot { id: string; name: string; preferences: Wire; databases: DatabaseSnapshot[] }
interface Manifest { format: typeof FORMAT; version: 1; saves: SaveSnapshot[]; files: Record<string, { size: number; sha256: string }> }
const constructors: Record<string, any> = { Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array, DataView };
const digest = async (data: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource)), byte => byte.toString(16).padStart(2, '0')).join('');

/** No version bump, no silent creation of an absent inactive database. */
async function existingDatabase(name: string): Promise<IDBDatabase | null> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(name); let absent = false, blocked = false;
        req.onupgradeneeded = () => { absent = true; req.transaction!.abort(); };
        req.onerror = () => absent ? resolve(null) : reject(req.error);
        req.onsuccess = () => { if (blocked) req.result.close(); else resolve(req.result); };
        req.onblocked = () => { blocked = true; reject(new Error('数据库被其他页面占用，请关闭其他页面后重试')); };
    });
}
function snapshot(db: IDBDatabase, selectedNames?: string[]): Promise<{ schema: Omit<StoreSnapshot, 'parts' | 'count'>; rows: { key: IDBValidKey; value: any }[] }[]> {
    return new Promise((resolve, reject) => {
        const names = selectedNames ?? Array.from(db.objectStoreNames), tx = db.transaction(names, 'readonly');
        const result = names.map(name => {
            const store = tx.objectStore(name);
            const entry = { schema: { name, keyPath: store.keyPath, autoIncrement: store.autoIncrement,
                indexes: Array.from(store.indexNames).map(name => { const i = store.index(name); return {name, keyPath:i.keyPath, unique:i.unique, multiEntry:i.multiEntry}; }) }, rows: [] as {key: IDBValidKey; value: any}[] };
            const request = store.openCursor();
            request.onsuccess = () => { const cursor = request.result; if (cursor) { entry.rows.push({key:cursor.primaryKey, value:cursor.value}); cursor.continue(); } };
            return entry;
        });
        tx.oncomplete = () => resolve(result); tx.onerror = tx.onabort = () => reject(tx.error);
    });
}
export async function createAllUserSaveBackup(onProgress: Progress = () => {}): Promise<Blob> {
    const release = beginUserSaveOperation('备份身份存档');
    try {
        if (!nativeLocalStorage) throw new Error('本地存储不可用');
        const registry = readUserSaves(), revision = nativeLocalStorage.getItem(USER_SAVES_KEY);
        await openDB();
        const archive = createBackupArchive(), files: Manifest['files'] = Object.create(null), binaries = new Map<string, string>();
        let sequence = 0;
        const file = async (bytes: Uint8Array, extension: 'json' | 'bin') => {
            const hash = await digest(bytes);
            if (extension === 'bin' && binaries.has(hash)) return binaries.get(hash)!;
            const path = `data/${sequence++}.${extension}`;
            files[path] = {size:bytes.byteLength, sha256:hash}; archive.file(path, bytes, {compression: extension === 'bin' ? 'STORE' : 'DEFLATE'});
            if (extension === 'bin') binaries.set(hash, path);
            return path;
        };
        const encode = async (value: any, depth = 0): Promise<Wire> => {
            if (depth > 100) throw new Error('存档嵌套过深，无法备份');
            if (value === undefined) return {t:'undefined'};
            if (typeof value === 'number' && !Number.isFinite(value)) return {t:'number',v:String(value)};
            if (typeof value === 'bigint') return {t:'bigint',v:String(value)};
            if (value === null || ['string','number','boolean'].includes(typeof value)) return value;
            if (value instanceof Date) return {t:'date',v:value.getTime()};
            if (value instanceof Blob) return {t:'blob',p:await file(new Uint8Array(await value.arrayBuffer()),'bin'),mime:value.type,
                ...(typeof File !== 'undefined' && value instanceof File ? {name:value.name,modified:value.lastModified} : {})};
            if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
                const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
                return {t:'binary',p:await file(bytes,'bin'),kind:value instanceof ArrayBuffer ? 'ArrayBuffer' : value.constructor.name};
            }
            if (Array.isArray(value)) { const out = []; for (const item of value) out.push(await encode(item,depth+1)); return out; }
            if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('存档包含不支持的数据类型，未生成不完整备份');
            const entries = []; for (const [key,item] of Object.entries(value)) entries.push([key,await encode(item,depth+1)]);
            return {t:'object',v:entries};
        };
        const saves: SaveSnapshot[] = [];
        for (const [index,save] of registry.saves.entries()) {
            onProgress(`正在整理身份 ${index+1}/${registry.saves.length}：${save.name}`);
            const storage = createSaveStorage(nativeLocalStorage,save.id);
            const preferences: Record<string,string> = Object.create(null);
            for (let i=0;i<storage.length;i++) { const key=storage.key(i)!; preferences[key]=storage.getItem(key)!; }
            const databases: DatabaseSnapshot[] = [];
            for (const kind of Object.keys(KINDS) as Kind[]) {
                const db = await existingDatabase(scopedDatabaseName(KINDS[kind],save.id));
                if (!db) { if (kind === 'main') throw new Error(`身份「${save.name}」的存档不存在，备份已停止`); continue; }
                const version=db.version; let stores;
                try { stores = await snapshot(db); } finally { db.close(); }
                const packed: StoreSnapshot[] = [];
                for (const {schema,rows} of stores) {
                    const parts: string[] = []; let items: string[] = [], size = 0;
                    const flush = async () => { if (items.length) { parts.push(await file(new TextEncoder().encode('['+items.join(',')+']'),'json')); items=[];size=0; } };
                    for (const row of rows) {
                        const text=JSON.stringify(await encode(row));
                        if(text.length>64*1024*1024) throw new Error('单条记录过大，请先分开备份媒体');
                        if(items.length && (items.length>=256 || size+text.length>4*1024*1024)) await flush();
                        items.push(text);size+=text.length;
                    }
                    await flush(); packed.push({...schema,parts,count:rows.length});
                    rows.length=0;
                }
                databases.push({kind,version,stores:packed});
            }
            saves.push({id:save.id,name:save.name,preferences:await encode(preferences),databases});
        }
        if(nativeLocalStorage.getItem(USER_SAVES_KEY)!==revision) throw new Error('身份列表已在其他页面变化，请重新备份');
        archive.file(MANIFEST,JSON.stringify({format:FORMAT,version:1,saves,files} satisfies Manifest));
        return await archive.generateBlob(({percent})=>onProgress(`正在打包全部身份 ${Math.floor(percent)}%`));
    } finally { release(); }
}

export interface UserSaveRestorePlan { count: number; restore: (onProgress?: Progress) => Promise<number> }
/** Detects this format; old ZIP/JSON backups continue through their existing importer. */
export async function prepareUserSaveRestore(input: Blob): Promise<UserSaveRestorePlan | null> {
    // Read only the central directory when detecting the format. A legacy ZIP
    // then goes straight to its old importer without a second full-file buffer.
    const {ZipReader,BlobReader}=await import('@zip.js/zip.js');
    const probe=new ZipReader(new BlobReader(input),{useWebWorkers:false});
    let containsManifest=false;
    try {containsManifest=(await probe.getEntries()).some(entry=>entry.filename===MANIFEST && !entry.directory);} finally {await probe.close();}
    if(!containsManifest)return null;
    const zip = await JSZip.loadAsync(await input.arrayBuffer());
    const entry = zip.file(MANIFEST)!;
    const manifest: Manifest = JSON.parse(await entry.async('string'));
    if(manifest.format!==FORMAT || manifest.version!==1 || !Array.isArray(manifest.saves) || !manifest.saves.length || !manifest.files || typeof manifest.files!=='object') throw new Error('全部身份备份格式无效');
    const ids=new Set<string>();
    for(const save of manifest.saves) {
        if(typeof save.id!=='string' || ids.has(save.id) || typeof save.name!=='string' || !save.name.trim() || save.name.length>100 || !Array.isArray(save.databases)) throw new Error('身份索引无效');
        ids.add(save.id);
        const kinds=new Set<string>();
        for(const db of save.databases) {
            if(!Object.hasOwn(KINDS,db.kind) || kinds.has(db.kind) || !Number.isSafeInteger(db.version) || db.version<1 || !Array.isArray(db.stores) || !db.stores.length || db.stores.length>256) throw new Error('身份数据库结构无效');
            kinds.add(db.kind);const names=new Set<string>();
            for(const store of db.stores) {
                if(typeof store.name!=='string' || names.has(store.name) || !Array.isArray(store.parts) || !Number.isSafeInteger(store.count) || store.count<0 || !Array.isArray(store.indexes)) throw new Error('存档数据表结构无效');
                names.add(store.name);
            }
            if(db.kind==='main' && !['characters','messages','assets','blob_assets','user_profile','worldbooks'].every(name=>names.has(name))) throw new Error('身份备份缺少核心数据表');
        }
        if(!kinds.has('main')) throw new Error('身份备份缺少主存档');
    }
    const read = async (path: string): Promise<Uint8Array> => {
        const meta=manifest.files[path], item=zip.file(path);
        if(!/^data\/\d+\.(json|bin)$/.test(path) || !meta || !item || !Number.isSafeInteger(meta.size) || meta.size<0) throw new Error('身份备份缺少数据文件');
        const bytes=await item.async('uint8array');
        if(bytes.byteLength!==meta.size || await digest(bytes)!==meta.sha256) throw new Error('身份备份文件损坏，未替换现有存档');
        return bytes;
    };
    const decode = async (value: Wire, depth=0): Promise<any> => {
        if(depth>100) throw new Error('身份备份嵌套过深');
        if(value===null || ['string','number','boolean'].includes(typeof value)) return value;
        if(Array.isArray(value)) { const result=[];for(const item of value)result.push(await decode(item,depth+1));return result; }
        if(!value || typeof value!=='object') throw new Error('身份备份记录无效');
        switch(value.t) {
            case 'undefined':return undefined;
            case 'number':if(!['NaN','Infinity','-Infinity'].includes(value.v))throw new Error('数值无效');return Number(value.v);
            case 'bigint':return BigInt(value.v);
            case 'date':if(!Number.isFinite(value.v))throw new Error('日期无效');return new Date(value.v);
            case 'object': {
                if(!Array.isArray(value.v))throw new Error('对象记录无效');
                const entries: [string,any][]=[];const names=new Set<string>();
                for(const pair of value.v) {if(!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='string'||names.has(pair[0]))throw new Error('对象字段无效');names.add(pair[0]);entries.push([pair[0],await decode(pair[1],depth+1)]);}
                return Object.fromEntries(entries);
            }
            case 'blob': {const bytes=await read(value.p);return typeof value.name==='string' && typeof File!=='undefined' ? new File([bytes as BlobPart],value.name,{type:value.mime,lastModified:value.modified}) : new Blob([bytes as BlobPart],{type:value.mime});}
            case 'binary': {const bytes=await read(value.p);const buffer=bytes.slice().buffer;if(value.kind==='ArrayBuffer')return buffer;if(!Object.hasOwn(constructors,value.kind))throw new Error('二进制类型无效');return new constructors[value.kind](buffer);}
            default:throw new Error('身份备份包含未知记录类型');
        }
    };
    let used=false;
    return {count:manifest.saves.length,restore:async (onProgress=()=>{}) => {
        if(used)throw new Error('这份恢复任务已经使用，请重新选择备份');used=true;
        const release=beginUserSaveOperation('恢复身份存档');
        const created: string[]=[], localKeys: string[]=[];
        let baseChanges: {db: IDBDatabase; rows: {store: string; key: IDBValidKey; text: string}[]} | undefined;
        try {
            if(!nativeLocalStorage)throw new Error('本地存储不可用');
            const registry=readUserSaves(), revision=nativeLocalStorage.getItem(USER_SAVES_KEY);
            if(registry.activeId!==USER_SAVE_ID)throw new Error('身份已在其他页面切换，请刷新');
            const added: {id:string;name:string}[]=[], missingShared = new Map<string,string>();
            for(const [index,save] of manifest.saves.entries()) {
                onProgress(`正在恢复身份 ${index+1}/${manifest.saves.length}：${save.name}`);
                const id=crypto.randomUUID();if(registry.saves.some(save=>save.id===id)||added.some(save=>save.id===id))throw new Error('身份编号重复，请重新导入');added.push({id,name:(save.name+' · 恢复').slice(0,100)});
                for(const database of save.databases) {
                    const name=scopedDatabaseName(KINDS[database.kind],id);
                    const db=await new Promise<IDBDatabase>((resolve,reject)=>{
                        let fresh=false;const request=indexedDB.open(name,database.version);
                        request.onupgradeneeded=(event)=>{
                            if(event.oldVersion!==0){request.transaction!.abort();return;}
                            fresh=true;created.push(name);
                            try {for(const schema of database.stores) {const store=request.result.createObjectStore(schema.name,{keyPath:schema.keyPath,autoIncrement:schema.autoIncrement});for(const i of schema.indexes)store.createIndex(i.name,i.keyPath,{unique:i.unique,multiEntry:i.multiEntry});}}
                            catch {request.transaction!.abort();}
                        };
                        request.onsuccess=()=>{if(fresh)resolve(request.result);else{request.result.close();reject(new Error('身份数据库已存在，请重新导入'));}};request.onerror=()=>reject(request.error);
                    });
                    try {
                        for(const store of database.stores) {
                            let count=0;
                            for(const path of store.parts) {
                                const part=JSON.parse(new TextDecoder().decode(await read(path)));
                                if(!Array.isArray(part))throw new Error('身份备份分片无效');
                                const records: {key: IDBValidKey; value: any}[]=[];for(const row of part)records.push(await decode(row));
                                await new Promise<void>((resolve,reject)=>{
                                    const tx=db.transaction(store.name,'readwrite'), target=tx.objectStore(store.name);
                                    try {for(const row of records) {if(target.keyPath===null)target.add(row.value,row.key);else target.add(row.value);}}
                                    catch(error){tx.abort();reject(error);}
                                    tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error);
                                });count+=records.length;
                            }
                            if(count!==store.count)throw new Error('身份备份记录数量不完整');
                        }
                    } finally {db.close();}
                }
                const preferences=await decode(save.preferences);
                if(!preferences || typeof preferences!=='object' || Array.isArray(preferences))throw new Error('身份设置格式无效');
                for(const [key,value] of Object.entries(preferences)) {
                    // Restored copies must not reconnect to the source identity's remote
                    // memories, cloud backup target or unattended online account.
                    if(typeof value==='string' && isSharedPreference(key)) { if(nativeLocalStorage.getItem(key)===null) missingShared.set(key,value); continue; }
                    if(typeof value!=='string' || isSharedPreference(key) || isUserSaveIndexKey(key) || key.startsWith('sully:save-data:') || ['os_remote_vector_config','os_cloud_backup_config','os_realtime_config'].includes(key))continue;
                    const rawKey=`sully:save-data:${id}:${key}`;localKeys.push(rawKey);nativeLocalStorage.setItem(rawKey,value);
                }
                // Old mirrors must not re-enable the remote services excluded above.
                const main=await existingDatabase(scopedDatabaseName(KINDS.main,id));
                if(main) {try{await new Promise<void>((resolve,reject)=>{const tx=main.transaction('assets','readwrite');tx.objectStore('assets').delete('ls_mirror_v1');tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(tx.error);});}finally{main.close();}}
            }
            if(nativeLocalStorage.getItem(USER_SAVES_KEY)!==revision)throw new Error('身份列表已在其他页面变化，请重新导入');
            // Add only absent base resources, in one transaction. Existing cards,
            // worldbooks, decoration and gameplay are never overwritten by an import.
            const current=await openDB();const additions=new Map<string,Map<string,any>>();
            const names=['characters','blob_assets','assets',...SHARED_STORES].filter(name=>current.objectStoreNames.contains(name));
            const currentRows=await snapshot(current,names);
            for(const {schema,rows} of currentRows)if(names.includes(schema.name))additions.set(schema.name,new Map(rows.map(row=>[JSON.stringify(row.key),null])));
            for(const save of added) {
                const incoming=await existingDatabase(scopedDatabaseName(KINDS.main,save.id));
                if(!incoming)throw new Error('恢复副本不完整');
                try {
                    const common: any[]=[];
                    for(const {schema,rows} of await snapshot(incoming,names.filter(name=>name!=='blob_assets' && incoming.objectStoreNames.contains(name)))) {
                        const items=additions.get(schema.name);if(!items)continue;
                        for(const row of rows) {
                            if(schema.name==='assets'&&!isSharedAsset(row.value.id))continue;
                            const value=schema.name==='characters'?baseCharacter(row.value):sharedStoreRows(schema.name,[row.value])[0];
                            common.push(value);
                            const key=JSON.stringify(row.key);if(!items.has(key))items.set(key,value);
                        }
                    }
                    for(const row of await referencedBlobs(incoming,common)) {
                        const items=additions.get('blob_assets')!,key=JSON.stringify(row.id);if(!items.has(key))items.set(key,row);
                    }
                } finally {incoming.close();}
            }
            await new Promise<void>((resolve,reject)=>{const tx=current.transaction(names,'readwrite');for(const [name,items]of additions)for(const value of items.values())if(value!==null)tx.objectStore(name).add(value);tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error);});
            baseChanges={db:current,rows:[...additions].filter(([name])=>name!=='blob_assets').flatMap(([store,items])=>[...items].filter(([,value])=>value!==null).map(([key,value])=>({store,key:JSON.parse(key),text:JSON.stringify(value)})))};
            if(nativeLocalStorage.getItem(USER_SAVES_KEY)!==revision)throw new Error('身份列表已变化，请重新导入');
            for(const [key,value] of missingShared) if(nativeLocalStorage.getItem(key)===null) {localKeys.push(key);nativeLocalStorage.setItem(key,value);}
            writeUserSaves({...registry,saves:[...registry.saves,...added]}, revision);
            onProgress(`已恢复 ${added.length} 个身份副本，现有存档已保留`);
            return added.length;
        } catch(error) {
            // If the final registry write fails, undo only base rows inserted by
            // this attempt, and only if no other page has edited them meanwhile.
            if(baseChanges?.rows.length) {
                try {const {db,rows}=baseChanges;await new Promise<void>((resolve,reject)=>{
                    const tx=db.transaction([...new Set(rows.map(row=>row.store))],'readwrite');
                    for(const row of rows) {const store=tx.objectStore(row.store),request=store.get(row.key);request.onsuccess=()=>{if(JSON.stringify(request.result)===row.text)store.delete(row.key);};}
                    tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(tx.error);
                });} catch { /* Existing gameplay was never overwritten; unreferenced media can be collected later. */ }
            }
            for(const key of localKeys)nativeLocalStorage?.removeItem(key);
            for(const name of created)indexedDB.deleteDatabase(name);
            throw error;
        } finally {release();}
    }};
}
