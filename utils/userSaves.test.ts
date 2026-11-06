import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

const SECOND = '11111111-1111-4111-8111-111111111111';
const THIRD = '22222222-2222-4222-8222-222222222222';
let reload: ReturnType<typeof vi.fn>;
beforeEach(() => {
    vi.resetModules(); localStorage.clear();
    vi.stubGlobal('indexedDB', new IDBFactory());
    reload = vi.fn();
    vi.stubGlobal('window', { localStorage, location: { reload }, addEventListener: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());
async function rows(db: IDBDatabase, store: string): Promise<any[]> {
    return new Promise((resolve, reject) => { const req = db.transaction(store).objectStore(store).getAll(); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}
async function write(db: IDBDatabase, entries: Record<string, any[]>) {
    await new Promise<void>((resolve, reject) => { const tx = db.transaction(Object.keys(entries), 'readwrite'); for (const [name, data] of Object.entries(entries)) for (const row of data) tx.objectStore(name).put(row); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
}
async function open(name: string): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => { const req = indexedDB.open(name); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}
describe('user 身份存档隔离', () => {
    it('isolates unknown local data, waterlines, enumeration, deletion and clear, preserving appearance', async () => {
        const { createSaveStorage, USER_SAVES_KEY } = await import('./userSaveScope');
        const a = createSaveStorage(localStorage, 'original'), b = createSaveStorage(localStorage, SECOND);
        localStorage.setItem(USER_SAVES_KEY, 'registry');
        a.setItem('palace_hwm_c1', '123'); a.setItem('vr_sar_simulations_v1', 'old'); a.setItem('os_theme', 'theme');
        expect(b.getItem('palace_hwm_c1')).toBeNull(); expect(b.getItem('vr_sar_simulations_v1')).toBeNull();
        expect(b.getItem('os_theme')).toBe('theme');
        b.setItem('palace_hwm_c1', '9'); b['draft'] = 'second';
        expect(a.getItem('palace_hwm_c1')).toBe('123'); expect(a.getItem('draft')).toBeNull();
        expect(Object.keys(b).sort()).toEqual(['draft', 'os_theme', 'palace_hwm_c1']);
        expect(Array.from({ length: a.length }, (_, i) => a.key(i))).not.toContain('draft');
        b.clear(); expect(a.getItem('palace_hwm_c1')).toBe('123'); expect(localStorage.getItem(USER_SAVES_KEY)).toBe('registry');
    });
    it('creates empty gameplay stores, keeps base cards/worldbooks/decoration, copies only referenced images', async () => {
        const { openDB } = await import('./db'); const source = await openDB();
        const char = { id: 'c1', name: '谢嬴', avatar: 'blobref:avatar', description: '角色人设', systemPrompt: '人设',
            memories: [{ summary: '旧身份的经历' }], refinedMemories: { month: '旧总结' }, impression: { text: '旧印象' },
            savedDateState: { scene: '旧剧情' }, chatBlock: { blockedByUser: true }, activeBuffs: ['旧情绪'],
            chatBackground: 'blobref:background', unknownFutureHistory: '不可继承', home3D: { version: 1, rooms: [], activeRoomId: 'r', records: ['旧记录'], romanticPairs: [['u','c1']], autonomy: true } };
        await write(source, { characters: [char], worldbooks: [{ id: 'w1', name: '已有世界书' }], messages: [{ id: 1, charId: 'c1', content: '旧私聊' }],
            memory_nodes: [{ id: 'm1', charId: 'c1', content: '旧宫殿' }], story_theaters: [{ id: 's1', title: '旧剧情进度' }],
            pixel_home_layouts: [{charId:'c1',roomId:'living_room',furniture:[],wallColor:'#fff',floorColor:'#eee',ambiance:'原身份互动产生的氛围',lastUpdatedAt:100,lastDecoratedBy:'character'}],
            assets: [{ id: 'wallpaper', data: 'blobref:background' }, { id: 'palace_hwm_c1', data: '123' }],
            blob_assets: [{ id: 'avatar', blob: 'avatar-bytes' }, { id: 'background', blob: 'bg-bytes' }, { id: 'private-chat-image', blob: 'private' }] });
        const { activateUserSave, readUserSaves } = await import('./userSaves');
        await activateUserSave(SECOND, { name: '校园线', profile: { name: '旧身份', avatar: 'blobref:avatar', bio: '旧设定', vrState: { enabled: true, activity: '旧状态' } } });
        expect(reload).toHaveBeenCalledOnce(); expect(readUserSaves().activeId).toBe(SECOND);
        const target = await open(`AetherOS_Data__user_${SECOND}`);
        const [saved] = await rows(target, 'characters');
        expect(saved.name).toBe('谢嬴'); expect(saved.memories).toEqual([]); expect(saved.chatBackground).toBe('blobref:background');
        for (const key of ['refinedMemories','impression','savedDateState','chatBlock','activeBuffs','unknownFutureHistory']) expect(saved[key]).toBeUndefined();
        expect(saved.home3D.records).toBeUndefined(); expect(saved.home3D.romanticPairs).toBeUndefined(); expect(saved.home3D.autonomy).toBe(false);
        for (const store of ['messages', 'memory_nodes', 'story_theaters']) expect(await rows(target, store)).toEqual([]);
        expect((await rows(target, 'pixel_home_layouts'))[0]).toMatchObject({charId:'c1',wallColor:'#fff',ambiance:'',lastUpdatedAt:0,lastDecoratedBy:'user'});
        expect(await rows(target, 'worldbooks')).toEqual([{ id: 'w1', name: '已有世界书' }]);
        expect((await rows(target, 'blob_assets')).map(r => r.id).sort()).toEqual(['avatar', 'background']);
        expect((await rows(target, 'user_profile'))[0]).toMatchObject({ name: '校园线', bio: '', avatar: 'blobref:avatar' });
        expect((await rows(source, 'messages'))[0].content).toBe('旧私聊');
        target.close(); source.close();
    });
    it('merging common edits preserves target-specific memories and relationship/runtime data', async () => {
        const { baseCharacter, mergeCharacterBase } = await import('./userSaves');
        const previous: any = { id:'c', name:'旧名字', systemPrompt:'旧人设', description:'', avatar:'', memories:[{summary:'B的记忆'}],
            impression:{text:'B的印象'}, chatBlock:{blockedByUser:true}, contextUserStartMessageId:42,
            home3D:{version:1,rooms:[],activeRoomId:'r',records:['B记录'],autonomy:true} };
        const base = baseCharacter({...previous,name:'新名字',memories:[{summary:'A的记忆'}],home3D:{...previous.home3D,records:['A记录']}});
        const merged = mergeCharacterBase(base, previous);
        expect(merged.name).toBe('新名字'); expect(merged.memories).toEqual(previous.memories);
        expect(merged.impression).toEqual(previous.impression); expect(merged.contextUserStartMessageId).toBe(42);
        expect(merged.home3D?.records).toEqual(['B记录']); expect(merged.home3D?.autonomy).toBe(true);
    });
    it('aborted target transaction never changes selection or original records', async () => {
        const { openDB } = await import('./db'); const db = await openDB();
        await write(db, { characters: [{ id:'c',name:'角色',avatar:'',description:'',systemPrompt:'',memories:[] }], messages:[{id:1,charId:'c',content:'原记录'}] });
        const { activateUserSave, readUserSaves } = await import('./userSaves');
        const real = IDBObjectStore.prototype.put;
        const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, ...args: any[]) {
            if (this.transaction.db.name.includes(SECOND) && this.name === 'characters') { this.transaction.abort(); throw new DOMException('quota', 'QuotaExceededError'); }
            return real.apply(this, args as any);
        });
        await expect(activateUserSave(SECOND, {name:'测试',profile:{name:'',avatar:'',bio:''}})).rejects.toThrow(); spy.mockRestore();
        expect(readUserSaves().activeId).toBe('original'); expect(reload).not.toHaveBeenCalled();
        expect((await rows(db, 'messages'))[0].content).toBe('原记录'); db.close();
    });
    it('invalid registry fails closed, and a stale page cannot activate another identity', async () => {
        const { USER_SAVES_KEY } = await import('./userSaveScope'); const { activateUserSave } = await import('./userSaves');
        localStorage.setItem(USER_SAVES_KEY, JSON.stringify({activeId:SECOND,saves:[{id:SECOND,name:'另一个页面'}]}));
        await expect(activateUserSave(THIRD,{name:'新',profile:{name:'',avatar:'',bio:''}})).rejects.toThrow('其他页面');
        expect(reload).not.toHaveBeenCalled();
    });
});

it('remote memory reads, writes and deletes use the active identity namespace', async () => {
    localStorage.setItem('sully:user-saves:v1', JSON.stringify({activeId:SECOND,saves:[{id:'original',name:'原'}, {id:SECOND,name:'新'}]}));
    const fetcher = vi.fn().mockResolvedValue({ok:true,json:async()=>[]}); vi.stubGlobal('fetch',fetcher);
    const remote = await import('./memoryPalace/supabaseVector');
    const config:any = {supabaseUrl:'https://example.invalid',supabaseAnonKey:'test'};
    await remote.upsertVector(config,'memory','char',[0.1],{content:'本档记忆',room:'living_room',tags:[],createdAt:1} as any,1);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({memory_id:`user:${SECOND}:memory`,char_id:`user:${SECOND}:char`});
    await remote.searchVectors(config,[0.1],'char');
    expect(JSON.parse(fetcher.mock.calls[1][1].body).match_char_id).toBe(`user:${SECOND}:char`);
    await remote.deleteVector(config,'memory');
    expect(decodeURIComponent(fetcher.mock.calls[2][0])).toContain(`memory_id=eq.user:${SECOND}:memory`);
    await remote.fetchRemoteByRoom(config,'char','living_room');
    expect(decodeURIComponent(fetcher.mock.calls[3][0])).toContain(`char_id=eq.user:${SECOND}:char`);
});
