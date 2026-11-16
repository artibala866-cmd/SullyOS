// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vitest';
import 'fake-indexeddb/auto';
import { OSPreviewProvider } from '../context/OSContext';
import { StoryTheaterThemeProvider } from '../components/date/story/StoryTheaterTheme';
import StoryTheaterSession from '../components/date/story/StoryTheaterSession';
import { DB } from './db';
import { getStoryGenerationSnapshot } from './storyTheaterBackground';
import { listStoryVectorMemories } from './storyTheaterVectorMemory';
import StoryTheaterEditor from '../components/date/story/StoryTheaterEditor';
import StoryArchivePanel from '../components/date/story/StoryArchivePanel';
import StoryVectorMemoryPanel from '../components/date/story/StoryVectorMemoryPanel';
import { MemoryNodeDB } from './memoryPalace/db';
import {BUILTIN_NIGHT_SCREENING_PRESET, createStoryTheaterDraft, createBlankStoryPreset} from './storyTheater';
import {applyStoryRegex, type StoryRegexRule} from './storyRegex';

vi.mock('./storyRegexRunner', () => ({
    runStoryRegex: async (texts: string[], rules: StoryRegexRule[], stage: 'display' | 'history') =>
        texts.map(text => applyStoryRegex(text, rules, stage)),
}));

vi.mock('../components/os/TokenImg',()=>({default:()=>null}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async()=>{if(root)await act(async()=>root!.unmount());host?.remove();root=undefined;host=undefined;vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});

async function openEditor(onSave: (entry: any)=>Promise<void> | void = async()=>{}) {
    host=document.createElement('div');document.body.append(host);root=createRoot(host);
    const entry={...createStoryTheaterDraft(),title:'原版见面剧情',characterIds:['a'],writesToCharacterMemory:true,carryCharacterMemory:true};
    const character={id:'a',name:'角色A',memories:[],mountedWorldbooks:[],systemPrompt:'原有设定'};
    await act(async()=>{root!.render(React.createElement(StoryTheaterEditor,{
        initial:entry,
        characters:[character] as any,
        user:{name:'用户'} as any,
        masks:[],maskLocked:false,presets:[createBlankStoryPreset('原版剧情')],onCancel:()=>{},
        onSave,onImportPreset:async()=>null,onEditPreset:()=>{},onOpenMaskBox:()=>{},
    }));});
    return host;
}
function click(text:string){
    const button=[...host!.querySelectorAll('button')].find(el=>el.textContent?.trim()===text||el.getAttribute('aria-label')===text);
    expect(button).toBeTruthy();button!.click();
}
describe('原作者见面剧情记忆模式移植',()=>{
    it('真实陪伴只按真实收发时间说明，无独立虚构日期输入框',async()=>{
        const node=await openEditor();
        expect(node.textContent).toContain('剧情将记为共同经历');
        expect(node.querySelector('input[type="datetime-local"]')).toBeNull();
        expect(node.querySelector('[aria-label="启用自动记忆 API"]')?.getAttribute('aria-pressed')).toBe('false');
        expect(node.querySelector('[data-story-memory-summary="true"]')).toBeTruthy();
    });
    it('虚构剧场保留原版事件盒手动转记忆，不把它误写成永久不可转存',async()=>{
        const node=await openEditor();
        await act(async()=>click('虚构剧场'));
        expect(node.textContent).toContain('事件盒');
        expect(node.textContent).toContain('自动记忆输出');
    });
    it('适配不破坏糯米机已有的保存失败提示',async()=>{
        const node=await openEditor(async()=>{throw Error('磁盘写入失败');});
        await act(async()=>click('保存并进入'));
        expect(node.querySelector('[role=alert]')?.textContent).toContain('磁盘写入失败');
    });
});

it.each([
    { failSave: false, delayedHeaders: false, realCompanion: false },
    { failSave: true, delayedHeaders: false, realCompanion: false },
    { failSave: false, delayedHeaders: true, realCompanion: false },
    { failSave: false, delayedHeaders: false, realCompanion: true },
])('离开剧情后原请求仍交付（存储不足 $failSave，响应头超过 5 分钟 $delayedHeaders，真实陪伴 $realCompanion）', async ({ failSave, delayedHeaders, realCompanion }) => {
    if (failSave) {
        const save = DB.saveStoryTheaterTurn;
        let blocked = false;
        vi.spyOn(DB, 'saveStoryTheaterTurn').mockImplementation(async (central, mirrors) => {
            if (central.role === 'assistant' && !blocked) {
                blocked = true;
                throw new DOMException('浏览器空间不足', 'QuotaExceededError');
            }
            return save(central, mirrors);
        });
    }
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const entry = {
        ...createStoryTheaterDraft(), characterIds: ['a'], carryCharacterMemory: true, writesToCharacterMemory: realCompanion,
        archiveAfter: 2, archiveKeepRecent: 1,
        ...(delayedHeaders ? { outputMaxTokens: 30_000, streamStoryOutput: true } : {}),
        memorySummaryApi: { baseUrl: 'https://memory.invalid/v1', apiKey: 'fixture', model: 'memory' },
    };
    const thread = 'story-theater:' + entry.id;
    for (const [index, role] of (['user', 'assistant', 'user', 'assistant'] as const).entries()) {
        await DB.saveMessage({
            charId: thread, role, type: 'text', content: '原有楼层 ' + (index + 1),
            metadata: { source: 'story_theater', theaterId: entry.id },
        });
    }
    const preset = createBlankStoryPreset('剧情');
    preset.document.generation.maxTokens = 8_000;
    const os = {
        characters: [{ id: 'a', name: '角色A', mountedWorldbooks: [], memoryPalaceEnabled: true }],
        worldbooks: [],
        userProfile: { name: '用户' },
        apiConfig: { baseUrl: 'https://fixture.invalid/v1', apiKey: 'fixture', model: 'story' },
        memoryPalaceConfig: { embedding: { baseUrl: 'https://embedding.invalid/v1', apiKey: 'fixture', model: 'embedding' } },
        remoteVectorConfig: {},
        theme: { storyAppearance: { preset: 'none' } },
        addToast: vi.fn(),
    } as any;
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
        finish = resolve;
    }));
    vi.stubGlobal('fetch', fetchMock);
    HTMLElement.prototype.scrollTo = vi.fn();
    const openSession = () => root!.render(
        <OSPreviewProvider value={os}><StoryTheaterThemeProvider>
            <StoryTheaterSession entry={entry} preset={preset} masks={[]} onBack={() => {}}
                onEdit={() => {}} onEntryChange={() => {}} onArchiveCommitted={() => {}} />
        </StoryTheaterThemeProvider></OSPreviewProvider>,
    );

    await act(async () => openSession());
    if (delayedHeaders) vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await act(async () => host!.querySelector<HTMLButtonElement>('[aria-label="继续当前剧情"]')!.click());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe('https://fixture.invalid/v1/chat/completions');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
        max_tokens: 8_000, // even with legacy 30000 override, the active preset controls the request
        stream: delayedHeaders,
    });
    await act(async () => root!.render(null));
    if (delayedHeaders) {
        await vi.advanceTimersByTimeAsync(360000);
        expect(fetchMock.mock.calls[0][1]?.signal?.aborted).not.toBe(true);
        vi.useRealTimers();
    }
    const content = delayedHeaders ? '他刚推开门，就听见熟悉的脚步声。'.repeat(1_875) : '他刚推开门，就听见';
    await act(async () => finish(delayedHeaders
        ? new Response([
            'data: ' + JSON.stringify({ choices: [{ delta: { content } }] }),
            'data: ' + JSON.stringify({ choices: [{ finish_reason: 'stop' }] }),
            'data: [DONE]',
            '',
        ].join('\n\n'), { headers: { 'Content-Type': 'text/event-stream' } })
        : Response.json({ choices: [{ finish_reason: 'length', message: { content } }] })));
    if (failSave) {
        await act(async () => openSession());
        const retry = await vi.waitFor(async () => {
            await act(async () => {});
            expect(host!.textContent).toContain('浏览器空间不足');
            expect(host!.textContent).toContain('他刚推开门，就听见');
            expect(host!.querySelector<HTMLButtonElement>('[aria-label="继续当前剧情"]')?.disabled).toBe(true);
            const button = [...host!.querySelectorAll('button')].find(item => item.textContent === '重试本地保存');
            expect(button).toBeDefined();
            return button!;
        });
        await act(async () => retry.click());
    }
    await vi.waitFor(async () => {
        const messages = await DB.getMessagesByCharId(`story-theater:${entry.id}`, true);
        expect(messages.filter(message => message.role === 'assistant').at(-1)).toMatchObject({
            content,
            metadata: { theaterInterruption: delayedHeaders ? undefined : expect.stringContaining('length') },
        });
    });
    await act(async () => openSession());
    await vi.waitFor(async () => {
        await act(async () => {});
        expect(host!.textContent).toContain(content);
    });
    if (delayedHeaders) expect(host!.textContent).not.toContain('已达到输出上限');
    else expect(host!.textContent).toContain('已达到输出上限');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const messages = await DB.getMessagesByCharId(thread, true);
    expect(messages.some(message => message.metadata?.theaterArchived)).toBe(false);
    if (realCompanion) {
        const actorHistory = await DB.getMessagesByCharId('a', true);
        expect(actorHistory).toContainEqual(expect.objectContaining({
            role: 'assistant', content,
            metadata: expect.objectContaining({ theaterId: entry.id, source: 'story_theater_memory' }),
        }));
    }
});

it.each([200, 400])('自动独立向量：一次增量提取、逐条建向量，Embedding %s 不再额外发请求', async status => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const entry = {
        ...createStoryTheaterDraft(), title: '夜间车站', characterIds: ['a'],
        automaticMemoryApiEnabled: true, archiveStrategy: 'vector' as const, archiveAfter: 4, archiveKeepRecent: 1,
        memorySummaryApi: { baseUrl: 'https://memory.invalid/v1', apiKey: 'fixture', model: 'memory' },
    };
    const thread = 'story-theater:' + entry.id;
    await DB.saveStoryTheater(entry);
    const facts = ['小雨接过侧门钥匙。', '阿泽向小雨解释了误会。'];
    const sourceIds: number[] = [];
    for (const [i, role] of (['user', 'assistant', 'user', 'assistant'] as const).entries()) {
        sourceIds.push(await DB.saveMessage({
            charId: thread, role, type: 'text', content: facts[i] ?? '旧原文第 ' + (i + 1) + ' 楼',
            metadata: { source: 'story_theater', theaterId: entry.id },
        }));
    }
    const complete = (content: string) => Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }] });
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async url => {
        if (String(url).startsWith('https://memory.invalid/')) return complete(JSON.stringify({ changes: facts.map((text, index) => ({
            action: 'add', kind: 'fact', key: ['侧门钥匙/持有人', '阿泽与小雨/解释误会'][index],
            text, terms: ['小雨'], sourceMessageId: sourceIds[index], quote: text,
        })) }));
        if (String(url).startsWith('https://embedding.invalid/')) {
            return status === 200 ? Response.json({ data: facts.map((_, index) => ({ index, embedding: [1, 0, 0] })) })
                : Response.json({ error: '不支持该请求' }, { status });
        }
        return complete('续写已返回并保存。');
    });
    vi.stubGlobal('fetch', fetchMock);
    HTMLElement.prototype.scrollTo = vi.fn();
    const os = {
        characters: [{ id: 'a', name: '阿泽', mountedWorldbooks: [] }], worldbooks: [], userProfile: { name: '小雨' },
        apiConfig: { baseUrl: 'https://prose.invalid/v1', apiKey: 'fixture', model: 'story' },
        memoryPalaceConfig: { embedding: { baseUrl: 'https://embedding.invalid/v1', apiKey: 'fixture', model: 'embedding', dimensions: 3 } },
        theme: {}, addToast: vi.fn(),
    } as any;
    await act(async () => root!.render(
        <OSPreviewProvider value={os}><StoryTheaterThemeProvider>
            <StoryTheaterSession entry={entry} preset={createBlankStoryPreset('剧情')} masks={[]} onBack={() => {}}
                onEdit={() => {}} onEntryChange={() => {}} onArchiveCommitted={() => {}} />
        </StoryTheaterThemeProvider></OSPreviewProvider>,
    ));
    await act(async () => click('继续当前剧情'));
    await vi.waitFor(async () => {
        expect((await DB.getMessagesByCharId(thread, true)).at(-1)?.content).toBe('续写已返回并保存。');
        expect(getStoryGenerationSnapshot(entry.id)?.phase).not.toBe('running');
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        'https://memory.invalid/v1/chat/completions', 'https://embedding.invalid/v1/embeddings', 'https://prose.invalid/v1/chat/completions',
    ]);
    const embeddingRequest = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(embeddingRequest.input).toEqual(facts);
    const stored = await listStoryVectorMemories(entry.id);
    expect(stored).toHaveLength(status === 200 ? facts.length : 0);
    const archives = (await DB.getStoryTheaters()).find(row => row.id === entry.id)?.archives;
    expect(archives).toHaveLength(status === 200 ? 1 : 0);
    const proseRequest = String(fetchMock.mock.calls[2][1]?.body);
    expect(proseRequest).toContain(facts[0]);
    expect(proseRequest.includes('剧情记忆时间线（按原剧情楼层排列）')).toBe(status === 200);
});

it('事件盒页面按条数归档后，可以本地撤销并用相同楼层重建', async () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const entry = { ...createStoryTheaterDraft(), title: '选择归档楼层' };
    await DB.saveStoryTheater(entry);
    const thread = 'story-theater:' + entry.id;
    for (const content of ['第一楼的旧事', '第二楼交还钥匙', '第三楼解除误会']) {
        await DB.saveMessage({
            charId: thread, role: 'assistant', type: 'text', content,
            metadata: { source: 'story_theater', theaterId: entry.id },
        });
    }
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
        const input = JSON.parse(String(init?.body)).messages[1].content as string;
        const sourceMessageId = Number(input.match(/记录ID (\d+)\]\n第二楼交还钥匙/)?.[1]);
        const changes = [{ action: 'add', kind: 'fact', key: '钥匙/交还', text: '钥匙已交还。',
            terms: ['钥匙'], sourceMessageId, quote: '第二楼交还钥匙' }];
        return Response.json({ choices: [{ message: { content: JSON.stringify({ changes }) }, finish_reason: 'stop' }] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const updated = vi.fn();
    const os = {
        characters: [], userProfile: { name: '用户' },
        apiConfig: { baseUrl: 'https://fixture.invalid/v1', apiKey: 'fixture', model: 'summary' },
        memoryPalaceConfig: {}, theme: {}, addToast: vi.fn(),
    } as any;
    const renderPanel = (current: typeof entry) => root!.render(
        <OSPreviewProvider value={os}><StoryTheaterThemeProvider>
            <StoryArchivePanel entry={current} masks={[]} onBack={() => {}} onUpdated={updated} />
        </StoryTheaterThemeProvider></OSPreviewProvider>,
    );
    await act(async () => renderPanel(entry));
    await vi.waitFor(async () => {
        await act(async () => {});
        const button = Array.from(host!.querySelectorAll('button')).find(node => node.getAttribute('aria-label') === '手动归档楼层');
        expect(button?.disabled).toBe(false);
    });
    const selectFloors = async () => {
        await act(async () => click('手动归档楼层'));
        const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        const controls = host!.querySelectorAll<HTMLInputElement>('input[type="number"]');
        for (const [input, value] of [[controls[0], '2'], [controls[2], '2']] as const) {
            await act(async () => {
                setInput.call(input, value);
                input.dispatchEvent(new Event('input', { bubbles: true }));
            });
        }
    };
    await selectFloors();
    expect([...host!.querySelectorAll<HTMLInputElement>('input[type="number"]')].map(input => input.value))
        .toEqual(['2', '3', '2']);
    expect(host!.textContent).toContain('预计整理 1 批');
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => click('开始整理'));
    await vi.waitFor(async () => {
        await act(async () => {});
        expect(updated).toHaveBeenCalledOnce();
    });
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(request.messages[1].content).toContain('第三楼解除误会');
    expect(request.messages[1].content).not.toContain('第一楼的旧事');
    expect(fetchMock).toHaveBeenCalledOnce();
    await act(async () => renderPanel(updated.mock.calls[0][0]));
    await act(async () => click('撤销归档'));
    await act(async () => click('确认撤销'));
    await vi.waitFor(async () => {
        await act(async () => {});
        expect(updated).toHaveBeenCalledTimes(2);
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    await act(async () => renderPanel(updated.mock.calls[1][0]));
    await selectFloors();
    await act(async () => click('开始整理'));
    await vi.waitFor(async () => {
        await act(async () => {});
        expect(updated).toHaveBeenCalledTimes(3);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

});


it('真实归档页面把同一次分段里变更过的旧状态显示成历史，不冒充现在', async () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const entry = { ...createStoryTheaterDraft(), title: '三日寻钥匙' };
    const thread = 'story-theater:' + entry.id;
    const floors = [];
    for (const content of [
        '第一天傍晚，林星持有铜钥匙。',
        '第二天清晨，林星把钥匙给阿泽。',
        '第三天深夜，阿泽把钥匙交给小雨。',
    ]) {
        const id = await DB.saveMessage({
            charId: thread, role: 'assistant', type: 'text', content,
            metadata: { source: 'story_theater', theaterId: entry.id, theaterArchived: true },
        });
        floors.push(id);
    }
    entry.archives = [{
        id: 'three-days', strategy: 'summary', createdAt: 1, messageCount: 3,
        fromMessageId: floors[0], toMessageId: floors[2],
        summary: '此段旧摘要不应该覆盖结构化时间线',
        facts: [{ key: '钥匙/持有人', kind: 'fact', terms: ['钥匙'],
            text: '铜钥匙现在由小雨保管。', storyTime: '第三天深夜', sourceMessageId: floors[2] }],
        historyFacts: [
            { key: '钥匙/持有人', kind: 'fact', terms: ['钥匙'],
                text: '林星曾保管铜钥匙。', storyTime: '第一天傍晚', sourceMessageId: floors[0] },
            { key: '钥匙/持有人', kind: 'fact', terms: ['钥匙'],
                text: '阿泽随后保管铜钥匙。', storyTime: '第二天清晨', sourceMessageId: floors[1] },
        ],
    }];
    const os = {
        characters: [], userProfile: { name: '用户' },
        apiConfig: { baseUrl: 'https://fixture.invalid/v1', apiKey: 'fixture', model: 'story' },
        memoryPalaceConfig: {}, theme: {}, addToast: vi.fn(),
    } as any;
    await act(async () => root!.render(
        <OSPreviewProvider value={os}><StoryTheaterThemeProvider>
            <StoryArchivePanel entry={entry} masks={[]} onBack={() => {}} onUpdated={() => {}} />
        </StoryTheaterThemeProvider></OSPreviewProvider>,
    ));
    await vi.waitFor(() => {
        expect(host!.textContent).toContain('按剧情楼层排列');
        expect(host!.textContent).toContain('第 1 楼 · 剧情时间：第一天傍晚');
        expect(host!.textContent).toContain('第 2 楼 · 剧情时间：第二天清晨');
        expect(host!.textContent).toContain('第 3 楼 · 剧情时间：第三天深夜');
    });
    expect(host!.textContent).not.toContain('此段旧摘要不应该覆盖结构化时间线');
    expect(host!.textContent!.indexOf('林星曾保管铜钥匙')).toBeLessThan(host!.textContent!.indexOf('铜钥匙现在由小雨保管'));
    const vectorEntry = { ...entry, archives: entry.archives.map(box => ({
        ...box, strategy: 'vector' as const, vectorMemoryIds: [],
    })) };
    await act(async () => root!.render(
        <OSPreviewProvider value={os}><StoryTheaterThemeProvider>
            <StoryArchivePanel strategy='vector' entry={vectorEntry} masks={[]} onBack={() => {}} onUpdated={() => {}} />
        </StoryTheaterThemeProvider></OSPreviewProvider>,
    ));
    expect(host!.textContent).toContain('剧情时间线 · 3 条（点开查看）');
    expect(host!.textContent).toContain('按剧情楼层排列');
});

it('video playback regression: 19 real vector cards label story time, hide long prose and flag repeated profile facts', async () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const entry = { ...createStoryTheaterDraft(), title: '视频里长篇向量记忆', characterIds: ['actor'] };
    const thread = 'story-theater:' + entry.id;
    const floorIds: number[] = [];
    const nodeIds: string[] = [];
    const oldProfile = '{{user}}全名为幸福，现年23岁，大学毕业，是幸芳白的亲妹妹。';
    const longText = '他们在旧城调查了关于铜钥匙的线索。'.repeat(15);
    const oldPlan = '幸福决定忙完水果店事务后前往老房子寻找线索。';
    const oldRumor = '据说老房子还有秘密通道，尚未证实。';
    for (let i = 0; i < 19; i++) {
        const sourceMessageId = await DB.saveMessage({
            charId: thread, role: 'assistant', type: 'text',
            content: i === 0 ? oldProfile : '第' + (i+1) + '段剧情事件。',
            metadata: { source: 'story_theater', theaterId: entry.id, theaterArchived: true },
        });
        floorIds.push(sourceMessageId);
        const nodeId = entry.id + '-node-' + i;
        nodeIds.push(nodeId);
        await MemoryNodeDB.save({
            id: nodeId, charId: thread, room: 'living_room', mood: 'neutral',
            content: i === 0 ? oldProfile : i === 1 ? longText : i === 2 ? oldPlan : i === 3 ? oldRumor : '第' + (i+1) + '楼的事件已发生。',
            tags: ['剧情'], importance: 6, embedded: true,
            createdAt: 1730000000000+i, lastAccessedAt: 1730000000000+i, accessCount: 0,
        });
    }
    entry.archives = [{
        id: entry.id+'-box', strategy: 'vector', createdAt: 1,
        fromMessageId: floorIds[0], toMessageId: floorIds[18],
        messageCount: 19, vectorMemoryIds: nodeIds,
        facts: nodeIds.map((nodeId,i)=>({
            key: i === 0 ? '幸福/基本信息' : '线索/事件'+i,
            kind: 'fact' as const,
            text: i === 0 ? oldProfile : i === 1 ? longText : i === 2 ? oldPlan : i === 3 ? oldRumor : '第'+(i+1)+'楼的事件已发生。',
            sourceMessageId: floorIds[i], vectorNodeId: nodeId, vectorTextState: 'synced' as const,
            terms: ['剧情'], ...(i === 1 ? { storyTime: '第二天早晨' } : {}),
        })),
    }];
    const os = {
        characters: [{ id: 'actor', name: '林星', description: '向导' }],
        worldbooks: [], userProfile: { name: '幸福', bio: '23岁，大学毕业，是幸芳白的亲妹妹。' },
        memoryPalaceConfig: {}, remoteVectorConfig: {},
        apiConfig: { baseUrl: 'https://fixture.invalid/v1', apiKey: 'fixture', model: 'story' },
        theme: {}, addToast: vi.fn(),
    } as any;
    await act(async () => root!.render(<OSPreviewProvider value={os}><StoryTheaterThemeProvider>
        <StoryVectorMemoryPanel entry={entry} onBack={() => {}} onUpdated={() => {}} />
    </StoryTheaterThemeProvider></OSPreviewProvider>));
    await vi.waitFor(() => expect(host!.textContent).toContain('向量记忆 · 18 条'));
    await vi.waitFor(() => expect(host!.textContent).toContain('第二天早晨第 2 楼'));
    expect(host!.textContent).not.toContain(oldProfile);
    expect(host!.textContent).toContain('查看已有人设（1）');
    await act(async () => click('查看已有人设（1）'));
    expect(host!.textContent).toContain(oldProfile);
    await act(async () => click('收起已有人设'));
    expect(host!.textContent).toContain('仅是计划');
    expect(host!.textContent).toContain('尚未证实');
    expect(host!.textContent).not.toContain('归档时间：');
    expect(host!.textContent).toContain('归档记录');
    expect(host!.textContent).toContain('查看完整记忆');
    expect([...host!.querySelectorAll('article')].map(card=>card.textContent).join('\n')).not.toContain(longText);
    const expand = [...host!.querySelectorAll('button')].find(button=>button.textContent?.includes('查看完整记忆'));
    expect(expand).toBeTruthy();
    await act(async()=>expand!.click());
    expect(host!.textContent).toContain(longText);
    expect(host!.querySelector('dialog')?.textContent).toContain(longText);
    expect((host!.querySelector('select[aria-label="跳到记忆页"]') as HTMLSelectElement).options).toHaveLength(2);
    await act(async () => click('查看原楼'));
    expect(host!.querySelector('dialog')?.textContent).toContain('第2段剧情事件。');
    await act(async () => click('返回记忆'));
    expect(host!.querySelector('dialog')?.textContent).toContain(longText);
});

it('剧情离线规则只过滤显示与历史，在线 HTML 模板不越界执行，续写保留原文', async () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const preset = BUILTIN_NIGHT_SCREENING_PRESET;
    const entry = { ...createStoryTheaterDraft(), presetId: preset.id, characterIds: ['actor'], carryCharacterMemory: false };
    const thread = 'story-theater:' + entry.id;
    const original = '<story_text>开头<app-card>收到消息</app-card>结尾<filter-me>隐藏内容</filter-me></story_text>';
    await DB.saveMessage({ charId: thread, role: 'assistant', type: 'text', content: original,
        metadata: { source: 'story_theater', theaterId: entry.id } });
    const filter: StoryRegexRule = { id: 'filter', name: '去掉附注', enabled: true, kind: 'filter',
        presetId: preset.id, pattern: '<filter-me>[\\s\\S]*?</filter-me>', flags: 'g',
        replacement: '', display: true, history: true, instruction: '' };
    const template: StoryRegexRule = { ...filter, id: 'template', name: '手机通知卡', kind: 'template',
        pattern: '<app-card>([\\s\\S]*?)</app-card>', replacement: '<article><p>{{$1}}</p></article>',
        instruction: '出现通知时使用 <app-card>通知内容</app-card>。' };
    const otherPreset: StoryRegexRule = { ...filter, id: 'wrong-preset', presetId: 'elsewhere', pattern: '结尾' };
    const os = {
        characters: [{ id: 'actor', name: '林星', mountedWorldbooks: [] }], worldbooks: [],
        userProfile: { name: '玩家' }, apiConfig: { baseUrl: 'https://fixture.invalid/v1', apiKey: 'fixture', model: 'story' },
        memoryPalaceConfig: {}, remoteVectorConfig: {}, theme: { storyAppearance: { preset: 'novel' } }, addToast: vi.fn(),
    } as any;
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
        Response.json({ choices: [{ finish_reason: 'stop', message: { content: '<story_text>新楼层</story_text>' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    HTMLElement.prototype.scrollTo = vi.fn();
    await act(async () => root!.render(<OSPreviewProvider value={os}><StoryTheaterThemeProvider>
        <StoryTheaterSession entry={entry} preset={preset} regexRules={[filter, template, otherPreset]} masks={[]}
            onBack={() => {}} onEdit={() => {}} onEntryChange={() => {}} onArchiveCommitted={() => {}} />
    </StoryTheaterThemeProvider></OSPreviewProvider>));
    await vi.waitFor(async () => {
        await act(async () => {});
        expect(host!.querySelectorAll('[data-story-floor]')).toHaveLength(1);
        expect(host!.textContent).toContain('结尾');
        expect(host!.textContent).not.toContain('隐藏内容');
    });
    // 美化 HTML 模板属于在线功能，剧情线下只有规则过滤。
    expect(host!.querySelector('iframe[title="手机通知卡"]')).toBeNull();
    expect(host!.textContent).toContain('结尾');
    expect(host!.textContent).not.toContain('隐藏内容');
    await act(async () => click('继续当前剧情'));
    await vi.waitFor(() => expect(host!.textContent).toContain('新楼层'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(payload.messages).toContainEqual(expect.objectContaining({ role: 'assistant',
        content: expect.stringContaining('<app-card>收到消息</app-card>') }));
    expect(JSON.stringify(payload.messages)).not.toContain('隐藏内容');
    expect(JSON.stringify(payload.messages)).not.toContain(template.instruction);
    expect((await DB.getMessagesByCharId(thread, true))[0].content).toBe(original);
});
