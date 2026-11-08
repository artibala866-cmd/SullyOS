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
    { failSave: false, delayedHeaders: false },
    { failSave: true, delayedHeaders: false },
    { failSave: false, delayedHeaders: true },
])('离开剧情后原请求仍交付（存储不足 $failSave，响应头超过 5 分钟 $delayedHeaders）', async ({ failSave, delayedHeaders }) => {
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
    const entry = { ...createStoryTheaterDraft(), characterIds: ['a'], archiveAfter: 40 };
    const preset = createBlankStoryPreset('剧情');
    const os = {
        characters: [{ id: 'a', name: '角色A', mountedWorldbooks: [] }],
        worldbooks: [],
        userProfile: { name: '用户' },
        apiConfig: { baseUrl: 'https://fixture.invalid/v1', apiKey: 'fixture', model: 'story' },
        memoryPalaceConfig: {},
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
        expect(messages.find(message => message.role === 'assistant')).toMatchObject({
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
});
