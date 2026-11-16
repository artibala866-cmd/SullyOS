// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    toast: vi.fn(), updateCharacter: vi.fn(), fetch: vi.fn(), dirty: vi.fn(),
    responseText: '测试开场正文', responseBody: {} as Record<string, unknown>,
    session: null as any, rows: [] as any[],
    characters: [{ id: 'c', name: '测试角色', avatar: '', savedDateState: { currentText: '旧快照' } }],
}));
vi.mock('../context/OSContext', async () => {
    const React = await import('react');
    return { useOS: () => {
        const [activeCharacterId, setActiveCharacterId] = React.useState('c');
        return {
            activeCharacterId, setActiveCharacterId,
            characters: mocks.characters,
            closeApp: vi.fn(), openApp: vi.fn(), addToast: mocks.toast, updateCharacter: mocks.updateCharacter,
            updateUserProfile: vi.fn(), userProfile: { name: '用户' }, groups: [], characterGroups: [],
            virtualTime: { hours: 12, minutes: 0, day: 'Thu' }, apiConfig: { baseUrl: 'https://example.invalid' }, consumeDateAutoStart: vi.fn(),
        };
    } };
});
vi.mock('../components/date/DateSession', () => ({ default: (props: any) => {
    mocks.session = props;
    return React.createElement('button', { onClick: props.onExit }, '退出见面');
} }));
vi.mock('../context/MusicContext', () => ({ useMusic: () => ({ library: [], playSong: vi.fn(), stopDateBgmIfCurrent: vi.fn() }) }));
vi.mock('../components/date/DateSettings', () => ({ default: () => null }));
vi.mock('../components/date/story/StoryTheater', () => ({ default: () => null }));
vi.mock('./analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('./amsgStateSync', () => ({ markAmsgStateDirty: mocks.dirty }));
vi.mock('./chatContextRange', async importOriginal => ({
    ...await importOriginal<typeof import('./chatContextRange')>(),
    loadCharacterContextMessages: vi.fn(async () => [...mocks.rows]),
}));
vi.mock('./visionApi', () => ({ materializeVisionDescriptions: vi.fn(async messages => messages) }));
vi.mock('./safeApi', () => ({ safeResponseJson: vi.fn(async () => mocks.responseBody), extractContent: vi.fn(() => mocks.responseText) }));
vi.mock('./db', () => ({ DB: {
    getAsset: vi.fn(async () => undefined),
    getRecentMessagesByCharIdAndSource: vi.fn(async (_id, _source, limit, beforeId = Infinity) => mocks.rows.filter(row => row.id < beforeId).slice(-limit)),
    getEmojis: vi.fn(async () => []),
    saveMessage: vi.fn(async (message, signal) => { signal?.throwIfAborted(); mocks.rows.push({ ...message, id: mocks.rows.length + 1, timestamp: 1 }); return mocks.rows.length; }),
    updateMessage: vi.fn(async (id, content, options) => {
        options.signal.throwIfAborted();
        const previous = mocks.rows.find(row => row.id === id);
        if (previous?.content !== options.expectedContent) throw new Error('原回复已修改或删除');
        previous.content = content;
    }),
} }));
import DateApp from '../apps/DateApp';
import { DB } from './db';
import { materializeVisionDescriptions } from './visionApi';
import { dateLaunch } from './dateLaunch';
import { MEETING_CONTINUE_DISPLAY_TEXT } from './meetingContinue';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
    vi.clearAllMocks();
    mocks.rows = [];
    mocks.session = null;
    mocks.responseText = '测试开场正文';
    mocks.responseBody = {};
    mocks.fetch.mockResolvedValue({ ok: true, headers: new Headers() });
    vi.stubGlobal('fetch', mocks.fetch);
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

it.each(['靠近他', '让他靠近'])('%s 生成对应开场并保存场次和开场方式', async label => {
    await act(async () => root.render(React.createElement(DateApp)));
    await clickText('测试角色');
    await clickText(label);
    expect(mocks.fetch, JSON.stringify(mocks.toast.mock.calls)).toHaveBeenCalledTimes(1);
    const request = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(JSON.stringify(request.messages)).toContain(label === '靠近他' ? '用户正在悄悄靠近' : '由你主动以合理的方式');
    await clickText(label === '靠近他' ? '走过去' : '见到他');
    expect(mocks.rows).toHaveLength(1);
    expect(mocks.rows[0].metadata).toMatchObject({
        isOpening: true, dateEncounterId: mocks.session.encounterId,
        dateOpeningMode: label === '靠近他' ? 'approach' : 'invite',
    });
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
});
const clickText = async (text: string) => {
    const element = Array.from(container.querySelectorAll('button, span')).find(el => el.textContent === text);
    expect(element, text).toBeTruthy();
    await act(async () => { element!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};

it('有旧快照仍显示三个入口；直接见面不请求开场，退出无弹窗，再进入是独立场次', async () => {
    await act(async () => root.render(React.createElement(DateApp)));
    await clickText('测试角色');
    expect(container.textContent).toContain('靠近他');
    expect(container.textContent).toContain('让他靠近');
    expect(container.textContent).toContain('直接见面');
    expect(container.textContent).not.toContain('继续上次');
    await clickText('直接见面');
    const firstId = mocks.session.encounterId;
    expect(firstId).toBeTruthy();
    expect(mocks.session.peekStatus).toBe('');
    expect(mocks.session.initialState).toBeUndefined();
    expect(mocks.fetch).not.toHaveBeenCalled();
    await clickText('退出见面');
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('保存并退出');
    mocks.rows = [{ id: 1, role: 'assistant', content: '上一场', timestamp: 1,
        metadata: { source: 'date', dateEncounterId: firstId } }];
    await clickText('测试角色');
    await clickText('直接见面');
    expect(mocks.session.encounterId).not.toBe(firstId);
    expect(mocks.session.messages.map((message: any) => message.content)).toEqual(['上一场']);
});


const enterDirect = async () => {
    await act(async () => root.render(React.createElement(DateApp)));
    await clickText('测试角色');
    await clickText('直接见面');
};

const lastRequest = () => JSON.parse(mocks.fetch.mock.calls.at(-1)![1].body).messages;

it('重试复用已保存的输入，继续及其重掷使用同一段调度，不改原楼 ID 或时间', async () => {
    await enterDirect();
    mocks.fetch.mockRejectedValueOnce(new Error('测试断网'));
    await act(async () => {
        await expect(mocks.session.onSendMessage(MEETING_CONTINUE_DISPLAY_TEXT, 'continue')).rejects.toThrow('测试断网');
    });
    expect(mocks.rows.map(row => row.content)).toEqual([MEETING_CONTINUE_DISPLAY_TEXT]);

    await act(async () => {
        await mocks.session.onSendMessage(MEETING_CONTINUE_DISPLAY_TEXT, 'retry-continue');
    });
    expect(mocks.rows).toHaveLength(2);
    const original = { ...mocks.rows[1] };
    const originalPrompt = JSON.stringify(lastRequest());
    expect(originalPrompt).toContain('[继续当前见面]');
    expect(originalPrompt).not.toContain(MEETING_CONTINUE_DISPLAY_TEXT);

    mocks.responseText = '重掷后的正文';
    await act(async () => { await mocks.session.onReroll(); });
    expect(JSON.stringify(lastRequest())).toContain('[继续当前见面]');
    expect(mocks.rows[1]).toEqual({ ...original, content: '重掷后的正文' });
    expect(mocks.dirty).toHaveBeenCalledTimes(3);
});

it('开场重掷保留原场次、邀请方式与正文，直到新正文成功写入', async () => {
    await act(async () => root.render(React.createElement(DateApp)));
    await clickText('测试角色');
    await clickText('让他靠近');
    await clickText('见到他');
    const original = { ...mocks.rows[0] };

    mocks.responseBody = { __sullyRawStreamTerminal: false };
    await act(async () => { await expect(mocks.session.onReroll()).rejects.toThrow('模型回复中断'); });
    expect(mocks.rows[0]).toEqual(original);

    mocks.responseBody = {};
    mocks.responseText = '另一段开场';
    vi.mocked(DB.updateMessage).mockRejectedValueOnce(new Error('测试存储空间不足'));
    await act(async () => { await expect(mocks.session.onReroll()).rejects.toThrow('测试存储空间不足'); });
    expect(mocks.rows).toEqual([original]);
    expect(mocks.session.peekStatus).toBe(original.content);

    await act(async () => { await mocks.session.onReroll(); });
    expect(mocks.rows).toEqual([{ ...original, content: '另一段开场' }]);
    expect(JSON.stringify(lastRequest())).toContain('由你主动以合理的方式');
    expect(mocks.session.peekStatus).toBe('另一段开场');
});

it('待回复时重复提交只生成一次，退出后隔离仍到达的旧结果', async () => {
    await enterDirect();
    let release!: (value: unknown) => void;
    mocks.fetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    let request!: Promise<string>;
    let outcome!: Promise<unknown>;
    await act(async () => {
        request = mocks.session.onSendMessage('本场输入');
        outcome = request.catch(error => error);
        await expect(mocks.session.onSendMessage('重复输入')).rejects.toThrow('正在等待本轮回复');
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const signal = mocks.fetch.mock.calls[0][1].signal;
    await clickText('退出见面');
    expect(signal.aborted).toBe(true);
    await clickText('测试角色');
    await clickText('直接见面');
    await act(async () => {
        release({ ok: true, headers: new Headers() });
        expect(await outcome).toMatchObject({ name: 'AbortError' });
    });
    expect(mocks.rows.map(row => row.content)).toEqual(['本场输入']);
    expect(mocks.toast).not.toHaveBeenCalled();
});

it('离开未生成完的感知页也会取消请求，仍可进入另一种开场', async () => {
    await act(async () => root.render(React.createElement(DateApp)));
    await clickText('测试角色');
    let release!: (value: unknown) => void;
    mocks.fetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    await clickText('靠近他');
    const signal = mocks.fetch.mock.calls[0][1].signal;
    await act(async () => dateLaunch.request({ surface: 'companion' }));
    expect(signal.aborted).toBe(true);
    await clickText('测试角色');
    await clickText('让他靠近');
    await act(async () => release({ ok: true, headers: new Headers() }));
    await clickText('见到他');
    expect(mocks.rows).toHaveLength(1);
    expect(mocks.rows[0].metadata.dateOpeningMode).toBe('invite');
});


it('leaving while preparing images aborts the vision stage and never starts text generation', async () => {
    await enterDirect();
    let preparationSignal: AbortSignal | undefined;
    let resolveVision!: (rows: typeof mocks.rows) => void;
    vi.mocked(materializeVisionDescriptions).mockImplementationOnce((_messages, _config, signal) => {
        preparationSignal = signal;
        return new Promise(resolve => { resolveVision = resolve; });
    });
    let outcome!: Promise<unknown>;
    await act(async () => { outcome = mocks.session.onSendMessage('本轮包含图片').catch((error: unknown) => error); });
    expect(preparationSignal?.aborted).toBe(false);
    await clickText('退出见面');
    expect(preparationSignal?.aborted).toBe(true);
    await act(async () => {
        resolveVision([]);
        expect(await outcome).toMatchObject({ name: 'AbortError' });
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
});
