// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vitest';
import 'fake-indexeddb/auto';
import { OSPreviewProvider } from '../context/OSContext';
import { StoryTheaterThemeProvider } from '../components/date/story/StoryTheaterTheme';
import StoryTheaterSession from '../components/date/story/StoryTheaterSession';
import { DB } from './db';
import StoryTheaterEditor from '../components/date/story/StoryTheaterEditor';
import StoryArchivePanel from '../components/date/story/StoryArchivePanel';
import {createStoryTheaterDraft, createBlankStoryPreset} from './storyTheater';

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
    const button=[...host!.querySelectorAll('button')].find(el=>el.textContent?.trim()===text);
    expect(button).toBeTruthy();button!.click();
}
describe('原作者见面剧情记忆模式移植',()=>{
    it('真实陪伴只按真实收发时间说明，无独立虚构日期输入框',async()=>{
        const node=await openEditor();
        expect(node.textContent).toContain('你的输入和角色回复会按各自实际发送的时间记录');
        expect(node.querySelector('input[type="datetime-local"]')).toBeNull();
        expect(node.querySelector('[aria-label="启用自动记忆 API"]')?.getAttribute('aria-pressed')).toBe('false');
        expect(node.textContent).toContain('内置真实性保护');
    });
    it('虚构剧场保留原版事件盒手动转记忆，不把它误写成永久不可转存',async()=>{
        const node=await openEditor();
        await act(async()=>click('虚构剧场'));
        expect(node.textContent).toContain('手动转为带剧情来源的记忆');
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
    await act(async () => root!.render(null));
    if (delayedHeaders) {
        await vi.advanceTimersByTimeAsync(360000);
        expect(fetchMock.mock.calls[0][1]?.signal?.aborted).not.toBe(true);
        vi.useRealTimers();
    }
    const content = delayedHeaders ? '他刚推开门，就听见熟悉的脚步声。' : '他刚推开门，就听见';
    await act(async () => finish(Response.json({
        choices: [{ finish_reason: delayedHeaders ? 'stop' : 'length', message: { content } }],
    })));
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
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({
        choices: [{ message: { content: '两人交还钥匙后解开误会。' }, finish_reason: 'stop' }],
    }));
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
        const button = Array.from(host!.querySelectorAll('button')).find(node => node.textContent === '手动归档楼层');
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
    expect(host!.textContent).toContain('第 2 至 3 楼，共 2 条');
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
