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
    it('starts every private store and all identity fields fresh, then preserves edited A/B profiles on return', async () => {
        const { openDB } = await import('./db'); const source = await openDB();
        const { SHARED_STORES, freshUserProfile, activateUserSave } = await import('./userSaves');
        const special = new Set(['characters', 'assets', 'blob_assets', 'user_profile', ...SHARED_STORES]);
        const privateStores = Array.from(source.objectStoreNames).filter(name => !special.has(name));
        // Seed every private store from the real schema, including future stores;
        // a fresh identity must not acquire any of these records.
        for (const name of privateStores) {
            await new Promise<void>((resolve, reject) => {
                const tx = source.transaction(name, 'readwrite'), store = tx.objectStore(name);
                const value: any = { privateSentinel: 'A-private' };
                const paths = typeof store.keyPath === 'string' ? [store.keyPath] : store.keyPath ?? [];
                for (const path of paths) {
                    const parts = path.split('.'); let node = value;
                    for (const part of parts.slice(0, -1)) node = node[part] ??= {};
                    node[parts.at(-1)!] = 'private-record';
                }
                if (store.keyPath) store.put(value); else store.put(value, 'private-record');
                tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error);
            });
        }
        expect(privateStores.length).toBeGreaterThan(25);
        const originalProfile = {id:'me',name:'原身份',bio:'原设定',avatar:'blobref:private-face',perCharAvatars:{c:'blobref:private-chat-face'},
            imageAppearance:'原外貌',imageReference:'blobref:private-ref',imageLockEnabled:true,wardrobeOutfits:[{id:'private-outfit'}],
            chibiStudio:{userChibi:{img:'blobref:private-body'}},vrState:{enabled:true,chibi:{img:'blobref:private-vr'},activity:'旧活动'}};
        await write(source, {user_profile:[originalProfile],worldbooks:[{id:'w',name:'基础世界书'}],
            characters:[{id:'c',name:'基础角色',avatar:'blobref:card-face',systemPrompt:'人设',memories:[{summary:'A记忆'}],
                phoneState:{records:['A手机']},socialProfile:{handle:'A生成账号'},savedDateState:{scene:'A剧情'},activeMsg2Config:{enabled:true},
                home3D:{version:1,activeRoomId:'r',rooms:[],records:['A生活'],petLife:{events:['A宠物']},romanticPairs:[['u','c']]}}],
            assets:[{id:'wallpaper',data:'blobref:decoration'},{id:'private-runtime',data:'A私密'}],
            blob_assets:['private-face','private-chat-face','private-ref','private-body','private-vr','card-face','decoration'].map(id=>({id,blob:id}))});
        await activateUserSave(SECOND,{name:'新身份'});
        const target=await open(`AetherOS_Data__user_${SECOND}`);
        expect(await rows(target,'user_profile')).toEqual([{id:'me',...freshUserProfile('新身份')}]);
        for(const name of privateStores) {expect(await rows(target,name),name).toEqual([]);expect((await rows(source,name))[0].privateSentinel,name).toBe('A-private');}
        expect((await rows(target,'blob_assets')).map(r=>r.id).sort()).toEqual(['card-face','decoration']);
        const [char]=await rows(target,'characters');
        for(const key of ['phoneState','socialProfile','savedDateState','activeMsg2Config'])expect(char[key],key).toBeUndefined();
        expect(char.home3D.records).toBeUndefined();expect(char.home3D.petLife).toBeUndefined();expect(char.home3D.romanticPairs).toBeUndefined();
        const bProfile={id:'me',name:'B改名',bio:'B设定',avatar:'blobref:b-face',perCharAvatars:{c:'blobref:b-chat-face'},imageAppearance:'B外貌',imageReference:'blobref:b-ref',imageLockEnabled:true};
        await write(target,{user_profile:[bProfile]});source.close();target.close();
        vi.resetModules();await (await import('./userSaves')).activateUserSave('original');
        const a=await open('AetherOS_Data');expect(await rows(a,'user_profile')).toEqual([originalProfile]);a.close();
        vi.resetModules();await (await import('./userSaves')).activateUserSave(SECOND);
        const b=await open(`AetherOS_Data__user_${SECOND}`);expect(await rows(b,'user_profile')).toEqual([bProfile]);
        expect((await rows(b,'worldbooks'))[0].name).toBe('基础世界书');b.close();
    });
    it('keeps settings and chat decoration preferences shared while interaction memory stays private', async () => {
        const { createSaveStorage, isSharedPreference, promoteSharedPreferences } = await import('./userSaveScope');
        const a = createSaveStorage(localStorage, 'original'), b = createSaveStorage(localStorage, SECOND);
        const common = [
            'os_theme', 'os_api_config', 'os_realtime_config', 'os_cloud_backup_config',
            'os_remote_vector_config', 'os_vision_available_models', 'sully_image_api_v1',
            'sully_image_presets_v1', 'sully_proxy_worker_url_v1', 'aetheros.mcp.servers',
            'aetheros.mcp.useNativeTools', 'push_vapid_v1', 'sullyos_backup_reminder',
            'sully-chat-input-preferences-v1', 'sullyos_chat_wardrobe_guide_v2_done',
            'chat_translate_enabled_c1',
        ];
        for (const key of common) {
            expect(isSharedPreference(key), key).toBe(true);
            a.setItem(key, 'common:' + key);
            expect(b.getItem(key), key).toBe('common:' + key);
        }
        for (const key of ['mp_lastMsgId_c1', 'palace_hwm_c1', 'os_last_active_char_id', 'chat_draft_c1']) {
            expect(isSharedPreference(key), key).toBe(false);
            a.setItem(key, 'private-a');
            expect(b.getItem(key), key).toBeNull();
            b.setItem(key, 'private-b');
            expect(a.getItem(key), key).toBe('private-a');
        }
        localStorage.removeItem('os_cloud_backup_config');
        localStorage.setItem('sully:save-data:' + SECOND + ':os_cloud_backup_config', 'old-b-setting');
        promoteSharedPreferences(localStorage, SECOND);
        expect(a.getItem('os_cloud_backup_config')).toBe('old-b-setting');
        // If a pre-existing common preference is present, never overwrite it with a
        // stale identity-local value during a later migration.
        localStorage.setItem('sully:save-data:' + SECOND + ':os_realtime_config', 'old-b');
        promoteSharedPreferences(localStorage, SECOND);
        expect(a.getItem('os_realtime_config')).toBe('common:os_realtime_config');
        expect(localStorage.getItem('sully:save-data:' + SECOND + ':os_cloud_backup_config')).toBe('old-b-setting');
    });
    it('retains all saved chat backgrounds across A/B/A, with role memories and chats isolated', async () => {
        const { openDB } = await import('./db');
        const original = await openDB();
        const { activateUserSave } = await import('./userSaves');
        const makePreset = (id: string) => ({
            _libraryId: id, format: 'sullyos-chat-decoration', version: 1,
            name: '我的聊天背景', parts: { background: { image: 'data:image/png;base64,AA==', style: 'plain' } },
        });
        await write(original, {
            characters: [{ id: 'c', name: '角色', avatar: '', systemPrompt: '', memories: [{ summary: 'A的独立记忆' }] }],
            messages: [{ id: 1, charId: 'c', content: 'A的聊天记录' }],
            assets: [
                { id: 'chat_decoration_presets_v1', data: JSON.stringify([makePreset('background-a')]) },
                { id: 'decoration_origin_background-a', data: JSON.stringify({ kind: 'self' }) },
            ],
        });
        await activateUserSave(SECOND, { name: '新身份' });
        original.close();
        const b = await open('AetherOS_Data__user_' + SECOND);
        const backgroundIds = Array.from({ length: 10 }, (_, i) => 'background-b-' + i);
        await write(b, {
            assets: [
                { id: 'chat_decoration_presets_v1', data: JSON.stringify([makePreset('background-a'), ...backgroundIds.map(makePreset)]) },
                { id: 'decoration_origin_background-b-0', data: JSON.stringify({ kind: 'self' }) },
            ],
            messages: [{ id: 2, charId: 'c', content: 'B的聊天记录' }],
        });
        b.close();
        vi.resetModules();
        await (await import('./userSaves')).activateUserSave('original');
        const aAgain = await open('AetherOS_Data');
        const assets = await rows(aAgain, 'assets');
        const saved = JSON.parse(assets.find(row => row.id === 'chat_decoration_presets_v1').data);
        expect(saved.map((item: any) => item._libraryId)).toEqual(['background-a', ...backgroundIds]);
        expect(assets.find(row => row.id === 'decoration_origin_background-b-0')).toBeDefined();
        expect((await rows(aAgain, 'messages')).map(row => row.content)).toEqual(['A的聊天记录']);
        expect((await rows(aAgain, 'characters'))[0].memories).toEqual([{ summary: 'A的独立记忆' }]);
        aAgain.close();
        vi.resetModules();
        await (await import('./userSaves')).activateUserSave(SECOND);
        const bAgain = await open('AetherOS_Data__user_' + SECOND);
        const restored = JSON.parse((await rows(bAgain, 'assets')).find(row => row.id === 'chat_decoration_presets_v1').data);
        expect(restored.map((item: any) => item._libraryId)).toEqual(['background-a', ...backgroundIds]);
        expect((await rows(bAgain, 'messages')).map(row => row.content)).toEqual(['B的聊天记录']);
        expect((await rows(bAgain, 'characters'))[0].memories).toEqual([]);
        bAgain.close();
    });
    it('copies theme-only and CSS image bytes, and repairs an existing broken save without private media', async () => {
        const {openDB}=await import('./db');const source=await openDB();
        const theme={launcherWidgets:{film1:'blobref:theme-photo'},chatChromeCustomCss:'background:url("blobref:css-photo")'};
        localStorage.setItem('os_theme',JSON.stringify(theme));
        await write(source,{blob_assets:[{id:'theme-photo',blob:'desktop bytes'},{id:'css-photo',blob:'CSS bytes'},{id:'private-face',blob:'private avatar'},{id:'private-chat',blob:'private chat'}],user_profile:[{id:'me',name:'A',bio:'private',avatar:'blobref:private-face'}]});
        const {activateUserSave}=await import('./userSaves');await activateUserSave(SECOND,{name:'B'});
        const target=await open(`AetherOS_Data__user_${SECOND}`);
        expect((await rows(target,'blob_assets')).map(r=>r.id).sort()).toEqual(['css-photo','theme-photo']);
        await new Promise<void>((resolve,reject)=>{const tx=target.transaction('blob_assets','readwrite');tx.objectStore('blob_assets').clear();tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});
        // Simulate a save damaged by the previous release. Even a soft-deleted
        // original identity remains a valid donor for these shared image IDs.
        localStorage.setItem('sully:user-saves:v1',JSON.stringify({activeId:SECOND,saves:[{id:SECOND,name:'B'}],deletedSaves:[{id:'original',name:'A',deletedAt:1}]}));
        source.close();vi.resetModules();
        const {repairSharedAppearanceBlobs}=await import('./userSaves');await repairSharedAppearanceBlobs(target);
        expect((await rows(target,'blob_assets')).map(r=>r.id).sort()).toEqual(['css-photo','theme-photo']);
        expect((await rows(target,'user_profile'))[0].name).toBe('B');
        expect(localStorage.getItem('os_theme')).toBe(JSON.stringify(theme));target.close();
    });
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
        await activateUserSave(SECOND, { name: '校园线' });
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
        expect((await rows(target, 'user_profile'))[0]).toEqual({ id: 'me', ...(await import('./userSaves')).freshUserProfile('校园线') });
        expect((await rows(source, 'messages'))[0].content).toBe('旧私聊');
        target.close(); source.close();
    });
    it('keeps target-only roles, worlds and private histories after a mismatched A/B/A/B roster', async () => {
        const { openDB } = await import('./db');
        const original = await openDB();
        const sourceChar = { id:'a',name:'甲角色',avatar:'',description:'原始设定',systemPrompt:'人设A',memories:[{summary:'A身份的私密记忆'}],
            linkGreetings:[{id:'opening-a',title:'原生开场',content:'原始开场内容'}],
            spriteConfigLandscape:{scale:1.4,offsetX:4,offsetY:-10} };
        await write(original,{characters:[sourceChar],worldbooks:[{id:'world-a',name:'原世界书'}]});
        await (await import('./userSaves')).activateUserSave(SECOND,{name:'B身份'});
        const fresh = await open('AetherOS_Data__user_'+SECOND);
        const [created] = await rows(fresh,'characters');
        expect(created.linkGreetings).toEqual(sourceChar.linkGreetings);
        expect(created.spriteConfigLandscape).toEqual(sourceChar.spriteConfigLandscape);
        expect(created.memories).toEqual([]);
        fresh.close();original.close();

        // B -> A completes; a delayed B-tab write or recovered older data then
        // makes B's roster diverge from A. B's private state must survive A -> B.
        vi.resetModules();
        await (await import('./userSaves')).activateUserSave('original');
        const target = await open('AetherOS_Data__user_'+SECOND);
        await write(target,{
            characters:[{id:'b',name:'B独有角色',avatar:'',description:'B的卡片',systemPrompt:'角色B人设',
                memories:[{summary:'只属于B的经历'}],impression:{text:'B的印象'},phoneState:{records:['B的手机']}}],
            messages:[{id:99,charId:'b',content:'B独有私聊'}],
            memory_nodes:[{id:'memory-b',charId:'b',content:'B独有宫殿记忆'}],
            worldbooks:[{id:'world-b',name:'B独有世界书'}],
        });
        target.close();

        vi.resetModules();
        await (await import('./userSaves')).activateUserSave(SECOND);
        const restored = await open('AetherOS_Data__user_'+SECOND);
        const roles = await rows(restored,'characters');
        expect(roles.map(role=>role.id).sort()).toEqual(['a','b']);
        expect(roles.find(role=>role.id==='b')).toMatchObject({
            memories:[{summary:'只属于B的经历'}],impression:{text:'B的印象'},phoneState:{records:['B的手机']}
        });
        expect((await rows(restored,'messages')).find(row=>row.charId==='b')?.content).toBe('B独有私聊');
        expect((await rows(restored,'memory_nodes')).find(row=>row.charId==='b')?.content).toBe('B独有宫殿记忆');
        expect((await rows(restored,'worldbooks')).map(row=>row.id).sort()).toEqual(['world-a','world-b']);
        restored.close();
        const a = await open('AetherOS_Data');
        expect((await rows(a,'characters')).map(row=>row.id)).toEqual(['a']);
        expect((await rows(a,'messages')).find(row=>row.charId==='b')).toBeUndefined();
        a.close();
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
        await expect(activateUserSave(SECOND, {name:'测试'})).rejects.toThrow(); spy.mockRestore();
        expect(readUserSaves().activeId).toBe('original'); expect(reload).not.toHaveBeenCalled();
        expect((await rows(db, 'messages'))[0].content).toBe('原记录'); db.close();
    });
    it('invalid registry fails closed, and a stale page cannot activate another identity', async () => {
        const { USER_SAVES_KEY } = await import('./userSaveScope'); const { activateUserSave } = await import('./userSaves');
        localStorage.setItem(USER_SAVES_KEY, JSON.stringify({activeId:SECOND,saves:[{id:SECOND,name:'另一个页面'}]}));
        await expect(activateUserSave(THIRD,{name:'新'})).rejects.toThrow('其他页面');
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

it('deleting an identity switches safely before purging private data, retaining the shared library', async () => {
    const {openDB}=await import('./db'); const db=await openDB();
    await write(db,{characters:[{id:'c',name:'角色',avatar:'',description:'',systemPrompt:'',memories:[{summary:'原身份的记忆'}]}],messages:[{id:1,charId:'c',content:'原身份聊天'}],
        assets:[{id:'wallpaper',data:'blobref:shared-wallpaper'}],blob_assets:[{id:'shared-wallpaper',blob:'图片内容'}]});
    const scope=await import('./userSaveScope');
    await (await import('./userSaves')).activateUserSave(SECOND,{name:'另一个身份'});
    localStorage.setItem(scope.USER_SAVES_KEY,JSON.stringify({activeId:'original',saves:[{id:'original',name:'原'},{id:SECOND,name:'另一个身份'}]}));
    vi.resetModules();
    const {deleteCurrentUserSave}=await import('./userSaves');await deleteCurrentUserSave();
    const registry=scope.readUserSaves();expect(registry.activeId).toBe(SECOND);expect(registry.saves.map(s=>s.id)).toEqual([SECOND]);expect(registry.deletedSaves?.[0]).toMatchObject({id:'original',purgePending:true});
    expect((await rows(db,'messages'))[0].content).toBe('原身份聊天');
    localStorage.setItem('private-draft','旧草稿');
    localStorage.setItem('os_theme','共用外观');
    db.close();
    (await open('SullyOS_Collaboration')).close();
    (await open('ActiveMsg')).close();
    vi.resetModules();
    const {purgeDeletedUserSaves,activateUserSave}=await import('./userSaves');
    await purgeDeletedUserSaves();
    expect((await indexedDB.databases()).map(db=>db.name)).toEqual([`AetherOS_Data__user_${SECOND}`]);
    expect(localStorage.getItem('private-draft')).toBeNull();
    expect(localStorage.getItem('os_theme')).toBe('共用外观');
    expect(scope.readUserSaves().deletedSaves).toEqual([]);
    await expect(activateUserSave('original')).rejects.toThrow('找不到这个身份');
    const target=await open(`AetherOS_Data__user_${SECOND}`);expect(await rows(target,'messages')).toEqual([]);expect((await rows(target,'characters'))[0].name).toBe('角色');expect((await rows(target,'characters'))[0].memories).toEqual([]);
    expect(await rows(target,'blob_assets')).toEqual([{id:'shared-wallpaper',blob:'图片内容'}]);target.close();
});
it('the last identity cannot be deleted',async()=>{
    const {deleteCurrentUserSave}=await import('./userSaves');await expect(deleteCurrentUserSave()).rejects.toThrow('至少保留');expect(reload).not.toHaveBeenCalled();
});

it('the profile return marker is one-shot, target-bound and does not change a normal cold launch',async()=>{
    const rawSession = new Map<string,string>();
    const session = {getItem:(key:string)=>rawSession.get(key)??null,setItem:(key:string,value:string)=>rawSession.set(key,value),removeItem:(key:string)=>rawSession.delete(key)};
    vi.stubGlobal('window',{localStorage,sessionStorage:session,location:{reload},addEventListener:vi.fn()});
    const scope=await import('./userSaveScope');expect(scope.RETURN_TO_USER_PROFILE).toBe(false);
    scope.returnToProfileAfterUserSaveSwitch(SECOND);
    localStorage.setItem(scope.USER_SAVES_KEY,JSON.stringify({activeId:SECOND,saves:[{id:SECOND,name:'新身份'}]}));vi.resetModules();
    expect((await import('./userSaveScope')).RETURN_TO_USER_PROFILE).toBe(true);vi.resetModules();
    expect((await import('./userSaveScope')).RETURN_TO_USER_PROFILE).toBe(false);
});

it('recovers a missing or corrupt primary index from its mirror without losing identity histories', async () => {
    const {openDB}=await import('./db');const db=await openDB();
    await write(db,{messages:[{id:1,charId:'c',content:'保留原来的经历'}]});
    const scope=await import('./userSaveScope');const saves=await import('./userSaves');
    await saves.activateUserSave(SECOND,{name:'独立身份'});
    const expected=scope.readUserSaves();
    localStorage.setItem(scope.USER_SAVES_KEY,'{broken');
    expect(scope.readUserSaves()).toEqual(expected);
    localStorage.removeItem(scope.USER_SAVES_KEY);
    vi.resetModules();const recovered=await import('./userSaveScope');
    expect(recovered.USER_SAVE_ID).toBe(SECOND);expect(recovered.readUserSaves()).toEqual(expected);
    expect((await rows(db,'messages'))[0].content).toBe('保留原来的经历');db.close();
});
it('rejects a corrupt primary and recovery index instead of silently selecting an empty original save', async () => {
    const scope=await import('./userSaveScope');
    localStorage.setItem(scope.USER_SAVES_KEY,'broken');localStorage.setItem(scope.USER_SAVES_RECOVERY_KEY,'broken');
    expect(()=>scope.readUserSaves()).toThrow('恢复失败');
});
it('a per-save storage clear cannot remove either identity index', async () => {
    const scope=await import('./userSaveScope');
    const raw=JSON.stringify(scope.readUserSaves());localStorage.setItem(scope.USER_SAVES_KEY,raw);localStorage.setItem(scope.USER_SAVES_RECOVERY_KEY,raw);
    const facade=scope.createSaveStorage(localStorage,'original');facade.setItem('draft','私有草稿');facade.setItem(scope.USER_SAVES_KEY,'伪造索引');facade.removeItem(scope.USER_SAVES_RECOVERY_KEY);facade.clear();
    expect(localStorage.getItem(scope.USER_SAVES_KEY)).toBe(raw);expect(localStorage.getItem(scope.USER_SAVES_RECOVERY_KEY)).toBe(raw);
});
it('a missing registered database never becomes a silently recreated empty save', async () => {
    const {openDB}=await import('./db');const db=await openDB();
    await write(db,{messages:[{id:1,charId:'c',content:'A经历'}]});
    const scope=await import('./userSaveScope');const saves=await import('./userSaves');
    const registry={activeId:'original',saves:[{id:'original',name:'原'},{id:SECOND,name:'丢失的身份'}]};
    scope.writeUserSaves(registry,null);
    await expect(saves.activateUserSave(SECOND)).rejects.toThrow('数据库不存在');
    expect(scope.readUserSaves()).toEqual(registry);expect(reload).not.toHaveBeenCalled();
    expect((await rows(db,'messages'))[0].content).toBe('A经历');db.close();
});
it('a fresh id collision with an unlisted old database neither overwrites nor deletes its history', async () => {
    const {openDB}=await import('./db');const source=await openDB();
    const old=await open('AetherOS_Data__user_'+SECOND);old.close();
    const {activateUserSave}=await import('./userSaves');
    // The unlisted database exists at an older schema version. Creation must
    // abort its upgrade rather than treating it as a fresh identity.
    await expect(activateUserSave(SECOND,{name:'新'})).rejects.toThrow('已存在');
    expect((await indexedDB.databases()).some(db=>db.name==='AetherOS_Data__user_'+SECOND)).toBe(true);source.close();
});
it('switching cannot overwrite a concurrent rename or additional identity in the manifest', async () => {
    const {openDB}=await import('./db');const source=await openDB();
    const scope=await import('./userSaveScope');const {activateUserSave}=await import('./userSaves');
    const real=IDBObjectStore.prototype.put;let changed=false;
    const spy=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,...args:any[]) {
        if(!changed&&this.transaction.db.name.includes(SECOND)) {
            changed=true;localStorage.setItem(scope.USER_SAVES_KEY,JSON.stringify({activeId:'original',saves:[{id:'original',name:'另一页刚改的名称'},{id:THIRD,name:'另一页增加的身份'}]}));
        }
        return real.apply(this,args as any);
    });
    await expect(activateUserSave(SECOND,{name:'新身份'})).rejects.toThrow('列表已');spy.mockRestore();
    expect(scope.readUserSaves().saves.map(s=>s.name)).toEqual(['另一页刚改的名称','另一页增加的身份']);expect(reload).not.toHaveBeenCalled();source.close();
});
it('mirror quota failure blocks publication and primary-write failure restores the previous mirror', async () => {
    const scope=await import('./userSaveScope');const previous=scope.readUserSaves();scope.writeUserSaves(previous,null);
    const next={...previous,saves:[...previous.saves,{id:SECOND,name:'新'}]};const raw=localStorage.getItem(scope.USER_SAVES_KEY);const real=localStorage.setItem.bind(localStorage);
    for(const failKey of [scope.USER_SAVES_RECOVERY_KEY,scope.USER_SAVES_KEY]) {
        const spy=vi.spyOn(localStorage,'setItem').mockImplementation((key,value)=>{if(key===failKey)throw new Error('quota');real(key,value);});
        expect(()=>scope.writeUserSaves(next,raw)).toThrow('quota');spy.mockRestore();
        expect(scope.readUserSaves()).toEqual(previous);expect(localStorage.getItem(scope.USER_SAVES_RECOVERY_KEY)).toBe(raw);
    }
});
it('never activates a legacy removed identity, even when its old database still exists', async () => {
    const {openDB}=await import('./db');const db=await openDB();
    const {USER_SAVES_KEY,readUserSaves}=await import('./userSaveScope');
    const registry={activeId:'original',saves:[{id:'original',name:'保留'}],deletedSaves:[{id:SECOND,name:'已删测试',deletedAt:1}]};
    localStorage.setItem(USER_SAVES_KEY,JSON.stringify(registry));
    const legacy=await open('AetherOS_Data__user_'+SECOND);legacy.close();
    const {activateUserSave,purgeDeletedUserSaves}=await import('./userSaves');
    await expect(activateUserSave(SECOND)).rejects.toThrow('找不到这个身份');
    await purgeDeletedUserSaves();
    expect(readUserSaves()).toEqual(registry);
    expect(reload).not.toHaveBeenCalled();db.close();
});
