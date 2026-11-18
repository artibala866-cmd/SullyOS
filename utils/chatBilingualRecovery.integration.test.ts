import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyAssistantPostProcessing, type PostProcessCtx } from './applyAssistantPostProcessing';
import { DB } from './db';
import * as SafeApi from './safeApi';

const mode = { enabled: true, sourceLang: '한국어', targetLang: '中文' };
const makeCtx = (id: string): PostProcessCtx => ({
    char: { id, name: '狐狸' } as any,
    userProfile: { name: '我' } as any,
    emojis: [],
    categories: [],
    contextMsgs: [],
    fullMessages: [],
    initialData: {},
    historyMsgCount: 0,
    translationMode: mode,
    xhsCaches: {
        xsecTokenCache: new Map(), noteTitleCache: new Map(),
        commentUserIdCache: new Map(), commentAuthorNameCache: new Map(),
        commentParentIdCache: new Map(),
    },
    api: {
        baseUrl: 'https://translation-test.invalid/v1',
        headers: { 'Content-Type': 'application/json' },
        effectiveApi: { baseUrl: 'https://translation-test.invalid/v1', apiKey: '', model: 'new-model' },
    },
    hooks: { setMessages: vi.fn(), addToast: vi.fn() },
});
const textsFor = async (id: string) => (await DB.getRecentMessagesByCharId(id, 40))
    .filter(m => m.role === 'assistant' && m.type === 'text').map(m => m.content);

afterEach(() => vi.restoreAllMocks());

describe('private chat translation repair with the real storage pipeline', () => {
    it('preserves already-correct bilingual output with zero extra API calls', async () => {
        const id = 'bi-xml-' + Date.now();
        const apiSpy = vi.spyOn(SafeApi, 'safeFetchJson');
        await applyAssistantPostProcessing(
            '<翻译><原文>안녕 ㅎㅎ</原文><译文>你好（笑）</译文></翻译>', makeCtx(id));
        expect(await textsFor(id)).toEqual(['안녕 ㅎㅎ\n%%BILINGUAL%%\n你好（笑）']);
        expect(apiSpy).not.toHaveBeenCalled();
    }, 15000);

    it('recovers plain source-only responses with one translation request for multiple bubbles', async () => {
        const id = 'bi-plain-' + Date.now();
        const apiSpy = vi.spyOn(SafeApi, 'safeFetchJson').mockResolvedValue({
            choices: [{ message: { content: '["你好（笑）","晚安"]' } }],
        });
        const ctx = makeCtx(id);
        await applyAssistantPostProcessing('안녕 ㅎㅎ\n잘자', ctx);
        expect(await textsFor(id)).toEqual([
            '안녕 ㅎㅎ\n%%BILINGUAL%%\n你好（笑）',
            '잘자\n%%BILINGUAL%%\n晚安',
        ]);
        expect(apiSpy).toHaveBeenCalledTimes(1);
        const body = JSON.parse((apiSpy.mock.calls[0][1] as any).body);
        expect(body.model).toBe('new-model');
        expect(body.messages[1].content).toBe('["안녕 ㅎㅎ","잘자"]');
        expect(body.stream).toBe(false);
    }, 15000);

    it('fills a blank XML translation slot without replacing the existing original', async () => {
        const id = 'bi-blank-' + Date.now();
        const apiSpy = vi.spyOn(SafeApi, 'safeFetchJson').mockResolvedValue({
            choices: [{ message: { content: '你好' } }],
        });
        await applyAssistantPostProcessing('<翻译><原文>안녕</原文><译文></译文></翻译>', makeCtx(id));
        expect(await textsFor(id)).toEqual(['안녕\\n%%BILINGUAL%%\\n你好']);
        expect(apiSpy).toHaveBeenCalledTimes(1);
    }, 15000);

    it('recovers labeled text before name-prefix stripping and does not call an API', async () => {
        const id = 'bi-label-' + Date.now();
        const apiSpy = vi.spyOn(SafeApi, 'safeFetchJson');
        await applyAssistantPostProcessing('원문: 안녕\n번역: 你好', makeCtx(id));
        expect(await textsFor(id)).toEqual(['안녕\n%%BILINGUAL%%\n你好']);
        expect(apiSpy).not.toHaveBeenCalled();
    }, 15000);

    it('does not call translation when user has switched the feature off', async () => {
        const id = 'bi-off-' + Date.now();
        const apiSpy = vi.spyOn(SafeApi, 'safeFetchJson');
        await applyAssistantPostProcessing('안녕', { ...makeCtx(id), translationMode: { ...mode, enabled: false } });
        expect(await textsFor(id)).toEqual(['안녕']);
        expect(apiSpy).not.toHaveBeenCalled();
    }, 15000);

    it('does not invent missing translations after API failure', async () => {
        const id = 'bi-fail-' + Date.now();
        vi.spyOn(SafeApi, 'safeFetchJson').mockRejectedValue(new Error('provider unavailable'));
        const ctx = makeCtx(id);
        await applyAssistantPostProcessing('안녕', ctx);
        expect(await textsFor(id)).toEqual(['안녕']);
        expect(ctx.hooks.addToast).toHaveBeenCalledWith(
            '译文补全失败，已保留角色原文', 'info');
    }, 15000);
});
