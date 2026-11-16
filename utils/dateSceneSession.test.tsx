// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi } from 'vitest';
import DateSession from '../components/date/DateSession';
import { synthesizeSpeech } from './ttsRouter';

vi.mock('./ttsRouter', async importOriginal => ({
    ...await importOriginal<typeof import('./ttsRouter')>(),
    canSynthesizeSpeech: () => true,
    synthesizeSpeech: vi.fn(),
}));

vi.mock('../context/OSContext', () => ({
    useOS: () => ({
        addToast: vi.fn(),
        registerBackHandler: () => () => {},
        apiConfig: {},
        updateCharacter: vi.fn(),
    }),
}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('date scene playback', () => {
    it('direct Meet with no opening stays silent and uses the old default background', async () => {
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        try {
            await act(async () => root.render(React.createElement(DateSession, {
                char: { id: 'direct-visit', name: '角色', dateBackground: 'https://example.com/default.jpg', sprites: { normal: 'https://example.com/normal.png' } },
                userProfile: { name: '用户' }, messages: [], peekStatus: '',
                onSendMessage: async () => '', onReroll: async () => '',
                onExit: vi.fn(), onEditMessage: vi.fn(), onDeleteMessage: vi.fn(),
                onDeleteMessages: async () => {}, onSettings: vi.fn(),
            } as any)));
            expect(host.textContent).not.toContain('Waiting for connection');
            expect((host.querySelector('.bg-cover.bg-center') as HTMLElement)?.style.backgroundImage).toContain('default.jpg');
        } finally {
            await act(async () => root.unmount());
            host.remove();
        }
    });
    it('switches background on opening and advancing lines, but ignores an unconfigured scene', async () => {
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        const char = {
            id: 'scene-test',
            name: '角色',
            avatar: '',
            dateBackground: 'https://example.com/default.jpg',
            dateSceneBackgrounds: {
                bedroom: 'https://example.com/bedroom.jpg',
                kitchen: 'https://example.com/kitchen.jpg',
            },
            sprites: { normal: 'https://example.com/normal.png', happy: 'https://example.com/happy.png' },
        };
        const getLayer = () => host.querySelector('.bg-cover.bg-center') as HTMLElement;
        const advance = async () => {
            await act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); });
            await act(async () => { getLayer().click(); });
        };
        try {
            await act(async () => root.render(React.createElement(DateSession, {
                char, userProfile: { name: '用户' }, messages: [],
                peekStatus: '[scene:bedroom]\n[normal] A\n[scene:bathroom]\n[normal] B\n[scene:kitchen]\n[happy] C',
                onSendMessage: async () => '', onReroll: async () => '', onExit: vi.fn(),
                onEditMessage: vi.fn(), onDeleteMessage: vi.fn(),
                onDeleteMessages: async () => {}, onSettings: vi.fn(),
            } as any)));
            expect(getLayer().style.backgroundImage).toContain('bedroom.jpg');
            await advance();
            expect(getLayer().style.backgroundImage).toContain('bedroom.jpg');
            await advance();
            expect(getLayer().style.backgroundImage).toContain('kitchen.jpg');
        } finally {
            await act(async () => root.unmount());
            host.remove();
        }
    });
});


it('leaving Meet while voice is being synthesized prevents late playback', async () => {
    let finish!: (url: string) => void;
    vi.mocked(synthesizeSpeech).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    let mounted = true;
    try {
        await act(async () => root.render(<DateSession
            char={{ id: 'voice-exit', name: '角色', dateVoiceEnabled: true } as any}
            userProfile={{ name: '玩家', avatar: '', bio: '' }}
            messages={[]}
            peekStatus=""
            onSendMessage={async () => '[normal]「这是需要合成的一句台词。」'}
            onReroll={async () => ''}
            onExit={vi.fn()} onSettings={vi.fn()} onEditMessage={vi.fn()} onDeleteMessage={vi.fn()}
            onDeleteMessages={async () => {}}
        />));
        const input = host.querySelector('textarea')!;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '你好');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await act(async () => host.querySelector<HTMLButtonElement>('.date-session-send-button')!.click());
        expect(synthesizeSpeech).toHaveBeenCalledOnce();
        await act(async () => root.unmount());
        mounted = false;
        await act(async () => finish('https://example.invalid/late.mp3'));
        expect(play).not.toHaveBeenCalled();
    } finally {
        if (mounted) await act(async () => root.unmount());
        host.remove();
        play.mockRestore();
        pause.mockRestore();
    }
});
