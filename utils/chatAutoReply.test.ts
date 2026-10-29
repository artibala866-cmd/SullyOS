// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatAutoReply } from '../hooks/useChatAutoReply';
import { resolveRealPersonReplyPlan } from './realPersonReplyTiming';

let root: Root;
let container: HTMLDivElement;
let options: Parameters<typeof useChatAutoReply>[0];
let controls: ReturnType<typeof useChatAutoReply>;
function Harness() {
    controls = useChatAutoReply(options);
    return React.createElement('span', null, 'chat');
}
const render = (patch: Partial<typeof options> = {}) => {
    options = { ...options, ...patch };
    act(() => root.render(React.createElement(Harness)));
};
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const send = (success = true) => act(() => controls.beginSend(options.conversationId)(success));

beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    localStorage.clear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    options = { enabled: true, conversationId: 'a', active: true, blocked: false, generating: false, onGenerate: vi.fn() };
    render();
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('two-second automatic reply', () => {
    it('only generates after a successful new send and exactly two ready seconds', () => {
        advance(5000);
        expect(options.onGenerate).not.toHaveBeenCalled();
        send(false);
        advance(5000);
        expect(options.onGenerate).not.toHaveBeenCalled();
        send();
        advance(1000);
        advance(999);
        expect(options.onGenerate).not.toHaveBeenCalled();
        advance(1);
        expect(options.onGenerate).toHaveBeenCalledTimes(1);
        advance(5000);
        expect(options.onGenerate).toHaveBeenCalledTimes(1);
    });

    it('waits through editing, drafts and any open panel, then starts a fresh two seconds', () => {
        render({ blocked: true });
        send();
        advance(5000);
        render({ blocked: false });
        advance(1500);
        render({ blocked: true });
        advance(5000);
        render({ blocked: false });
        advance(1999);
        expect(options.onGenerate).not.toHaveBeenCalled();
        advance(1);
        expect(options.onGenerate).toHaveBeenCalledTimes(1);
    });

    it('waits for every overlapping text, image or emoji save and resets on the latest completion', () => {
        send();
        advance(1500);
        let finishImage!: (sent: boolean) => void;
        let finishEmoji!: (sent: boolean) => void;
        act(() => { finishImage = controls.beginSend('a'); finishEmoji = controls.beginSend('a'); });
        advance(5000);
        act(() => finishEmoji(true));
        advance(5000);
        expect(options.onGenerate).not.toHaveBeenCalled();
        act(() => finishImage(true));
        advance(1999);
        expect(options.onGenerate).not.toHaveBeenCalled();
        advance(1);
        expect(options.onGenerate).toHaveBeenCalledTimes(1);
    });

    it('cancel stays cancelled through a late save and input changes, but a new send can re-arm', () => {
        send();
        let finish!: (sent: boolean) => void;
        act(() => { finish = controls.beginSend('a'); controls.cancel(); });
        act(() => finish(true));
        render({ blocked: true });
        render({ blocked: false });
        advance(5000);
        expect(options.onGenerate).not.toHaveBeenCalled();
        send();
        advance(2000);
        expect(options.onGenerate).toHaveBeenCalledTimes(1);
    });

    it.each([{ conversationId: 'b' }, { active: false }])('preserves an existing reply intent while %o, ignoring late saves', patch => {
        send();
        let finish!: (sent: boolean) => void;
        act(() => { finish = controls.beginSend('a'); });
        render(patch);
        act(() => finish(true));
        render({ conversationId: 'a', active: true, enabled: true });
        advance(2000);
        expect(options.onGenerate).toHaveBeenCalledTimes(1);
    });

    it('removes the saved reply intent when automatic replies are switched off', () => {
        send();
        expect(localStorage.getItem('sully_chat_auto_reply_intent_v1:a')).toBeTruthy();
        render({ enabled: false });
        expect(localStorage.getItem('sully_chat_auto_reply_intent_v1:a')).toBeNull();
        render({ enabled: true });
        advance(5000);
        expect(options.onGenerate).not.toHaveBeenCalled();
    });

    it('ignores a send callback captured by a different character', () => {
        render({ conversationId: 'b' });
        act(() => controls.beginSend('a')(true));
        advance(5000);
        expect(options.onGenerate).not.toHaveBeenCalled();
    });

    it('manual or external generation consumes the wait; fresh sends during generation can queue', () => {
        send();
        advance(1000);
        render({ generating: true });
        render({ generating: false });
        advance(5000);
        expect(options.onGenerate).not.toHaveBeenCalled();
        render({ generating: true });
        send();
        advance(5000);
        render({ generating: false });
        advance(2000);
        expect(options.onGenerate).toHaveBeenCalledTimes(1);
    });

    it('retains a saved user turn when backgrounded and responds once after returning', () => {
        send();
        advance(1000);
        vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
        act(() => document.dispatchEvent(new Event('visibilitychange')));
        advance(5000);
        expect(options.onGenerate).not.toHaveBeenCalled();
        expect(localStorage.getItem('sully_chat_auto_reply_intent_v1:a')).toBeTruthy();
        vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
        act(() => document.dispatchEvent(new Event('visibilitychange')));
        advance(1999);
        expect(options.onGenerate).not.toHaveBeenCalled();
        advance(1);
        expect(options.onGenerate).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem('sully_chat_auto_reply_intent_v1:a')).toBeNull();
        advance(5000);
        expect(options.onGenerate).toHaveBeenCalledTimes(1);
    });

    it('restores the original unanswered intent after unmount and ignores other characters', () => {
        send();
        const saved = localStorage.getItem('sully_chat_auto_reply_intent_v1:a');
        act(() => root.unmount());
        root = createRoot(container);
        render({ conversationId: 'b' });
        advance(5000);
        expect(options.onGenerate).not.toHaveBeenCalled();
        render({ conversationId: 'a' });
        expect(localStorage.getItem('sully_chat_auto_reply_intent_v1:a')).toBe(saved);
        advance(2000);
        expect(options.onGenerate).toHaveBeenCalledTimes(1);
    });

    it('does not replay a restored wait already answered by another channel', () => {
        send();
        act(() => root.unmount());
        root = createRoot(container);
        render({ lastCharacterReplyAt: Date.now() + 1 });
        advance(5000);
        expect(options.onGenerate).not.toHaveBeenCalled();
        expect(localStorage.getItem('sully_chat_auto_reply_intent_v1:a')).toBeNull();
    });

    it('keeps the durable intent when a prerequisite disappears during async DB verification', async () => {
        let resolveCheck!: (value: 'retry') => void;
        render({ onGenerate: vi.fn(() => new Promise<'retry'>(resolve => { resolveCheck = resolve; })) });
        send();
        advance(2000);
        expect(options.onGenerate).toHaveBeenCalledTimes(1);
        vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
        act(() => document.dispatchEvent(new Event('visibilitychange')));
        await act(async () => { resolveCheck('retry'); });
        expect(localStorage.getItem('sully_chat_auto_reply_intent_v1:a')).toBeTruthy();
        advance(20_000);
        expect(options.onGenerate).toHaveBeenCalledTimes(1);
        vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
        act(() => document.dispatchEvent(new Event('visibilitychange')));
        advance(2000);
        expect(options.onGenerate).toHaveBeenCalledTimes(2);
    });

    it('typing invalidates pending and in-flight candidates', () => {
        send();
        act(() => controls.cancelIfPending());
        advance(10000);
        expect(options.onGenerate).not.toHaveBeenCalled();
        let finish!: (sent: boolean) => void;
        act(() => { finish = controls.beginSend('a'); controls.cancelIfPending(); });
        act(() => finish(true));
        advance(10000);
        expect(options.onGenerate).not.toHaveBeenCalled();
    });
});


describe('real-person pacing without mechanical nudges', () => {
    const delayFor = (activity: 'free' | 'busy' | 'sleep' | null, at = Date.now()) =>
        resolveRealPersonReplyPlan({ activity, firstUnansweredAt: at, now: at, fallbackDelayMs: 5_000 }).delayMs;

    it('one successful send is enough for a delayed busy reply', () => {
        render({ naturalPacing: true, lifeActivity: 'busy' });
        const delay = delayFor('busy')!;
        send();
        advance(delay - 1);
        expect(options.onGenerate).not.toHaveBeenCalled();
        advance(1);
        expect(options.onGenerate).toHaveBeenCalledTimes(1);
        advance(100_000);
        expect(options.onGenerate).toHaveBeenCalledTimes(1);
    });
    it('many messages do not unlock an immediate fixed reply', () => {
        render({ naturalPacing: true, lifeActivity: 'busy' });
        const delay = delayFor('busy')!;
        send();
        for (let i = 0; i < 6; i++) send();
        advance(4_500);
        expect(options.onGenerate).not.toHaveBeenCalled();
        advance(delay - 4_500);
        expect(options.onGenerate).toHaveBeenCalledTimes(1);
    });
    it('sleep stays quiet regardless of nudges until the actual schedule changes', () => {
        render({ naturalPacing: true, lifeActivity: 'sleep' });
        const originalSendAt = Date.now();
        for (let i = 0; i < 12; i++) send();
        advance(180_000);
        expect(options.onGenerate).not.toHaveBeenCalled();
        render({ lifeActivity: 'free' });
        advance(delayFor('free', originalSendAt)!);
        expect(options.onGenerate).toHaveBeenCalledTimes(1);
    });
    it('retains a sleeping user turn overnight, but expires an abandoned 48-hour intent', () => {
        render({ naturalPacing: true, lifeActivity: 'sleep' });
        send();
        vi.setSystemTime(Date.now() + 12 * 60 * 60_000);
        render({ lifeActivity: 'free' });
        advance(delayFor('free')!);
        expect(options.onGenerate).toHaveBeenCalledTimes(1);
        render({ lifeActivity: 'sleep' });
        send();
        vi.setSystemTime(Date.now() + 49 * 60 * 60_000);
        render({ lifeActivity: 'free' });
        advance(10_000);
        expect(options.onGenerate).toHaveBeenCalledTimes(1);
    });
    it('recent genuine conversation outranks a busy schedule', () => {
        render({ naturalPacing: true, lifeActivity: 'busy', lastCharacterReplyAt: Date.now() - 60_000 });
        send();
        advance(delayFor('free')!);
        expect(options.onGenerate).toHaveBeenCalledTimes(1);
    });
    it('a persisted assistant or AMSG reply consumes the old pending candidate', () => {
        render({ naturalPacing: true, lifeActivity: 'busy' });
        send();
        render({ lastCharacterReplyAt: Date.now() + 1 });
        advance(180_000);
        expect(options.onGenerate).not.toHaveBeenCalled();
    });
    it('existing two-second plain auto reply still works when真人感 is off', () => {
        render({ naturalPacing: false, lifeActivity: 'busy' });
        send();
        advance(2000);
        expect(options.onGenerate).toHaveBeenCalledTimes(1);
    });
    it('natural pacing cannot turn on a disabled auto reply', () => {
        render({ enabled: false, naturalPacing: true, lifeActivity: 'free' });
        send();
        advance(180_000);
        expect(options.onGenerate).not.toHaveBeenCalled();
    });
    it('failed sends and a different character never arm this conversation', () => {
        render({ naturalPacing: true, lifeActivity: 'busy' });
        send(false);
        act(() => controls.beginSend('other')(true));
        advance(180_000);
        expect(options.onGenerate).not.toHaveBeenCalled();
    });
});
