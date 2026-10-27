// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeepAlive } from './keepAlive';
import {
  canRunAutomaticPhoneAi, CHARACTER_PHONE_AI_TIMEOUT_MS,
  fetchCharacterPhoneJson,
} from './characterPhoneAiRequest';

vi.mock('./keepAlive', () => ({
  KeepAlive: { start: vi.fn(async () => {}), stop: vi.fn() },
}));

const URL = 'https://example.invalid/v1/chat/completions';
const options = { method: 'POST', body: JSON.stringify({ model: 'm', stream: false, messages: [] }) };
const meta = { charId: 'char-one', purpose: '微信生成', automatic: true };

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe('character phone AI request lifecycle', () => {
  it('keeps update protection through response-body consumption, preserving original JSON', async () => {
    let completeBody!: (text: string) => void;
    const body = new Promise<string>(resolve => { completeBody = resolve; });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: { get: () => 'application/json' },
      text: () => body,
    });
    vi.stubGlobal('fetch', fetchMock);
    const pending = fetchCharacterPhoneJson(URL, options, meta);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(KeepAlive.start).toHaveBeenCalledTimes(1);
    expect(KeepAlive.stop).not.toHaveBeenCalled();
    const config = fetchMock.mock.calls[0][1];
    expect(config.__sullyMeta).toMatchObject({
      appName: '查手机', charId: meta.charId, purpose: meta.purpose,
    });
    expect(config.signal).toBeInstanceOf(AbortSignal);
    expect(CHARACTER_PHONE_AI_TIMEOUT_MS).toBe(150_000);
    completeBody(JSON.stringify({ choices: [{ message: { content: 'hello' } }] }));
    expect((await pending).json.choices[0].message.content).toBe('hello');
    expect(KeepAlive.stop).toHaveBeenCalledTimes(1);
  });

  it('does not auto-retry when a timeout may already have been billed, and pauses only automatic calls', async () => {
    const timeout = new Error('signal timed out');
    timeout.name = 'TimeoutError';
    const fetchMock = vi.fn().mockRejectedValueOnce(timeout).mockResolvedValue({
      ok: true, status: 200, headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ choices: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchCharacterPhoneJson(URL, options, meta)).rejects.toThrow('signal timed out');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(canRunAutomaticPhoneAi(meta.charId, URL)).toBe(false);
    await expect(fetchCharacterPhoneJson(URL, options, meta)).rejects.toThrow('冷却');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(fetchCharacterPhoneJson(URL, options, { ...meta, automatic: false })).resolves.toMatchObject({
      json: { choices: [] },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(canRunAutomaticPhoneAi(meta.charId, URL)).toBe(true);
    expect(KeepAlive.stop).toHaveBeenCalledTimes(2);
  });

  it('distinguishes explicit cancellation without blocking later intentional actions', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockImplementation((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    const pending = fetchCharacterPhoneJson(URL, { ...options, signal: controller.signal }, meta);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'PhoneRequestFailure', kind: 'cancelled' });
    expect(canRunAutomaticPhoneAi(meta.charId, URL)).toBe(true);
    expect(KeepAlive.stop).toHaveBeenCalledTimes(1);
  });

  it('identifies a network break, keeps its upstream status uncertain and never retries', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchCharacterPhoneJson(URL, options, meta)).rejects.toMatchObject({
      name: 'PhoneRequestFailure', kind: 'network',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(canRunAutomaticPhoneAi(meta.charId, URL)).toBe(false);
  });

  it('pauses on an upstream 503 without retrying, and never pauses a different character', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false, status: 503, headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ error: { message: 'provider unavailable' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchCharacterPhoneJson(URL, options, meta);
    expect(result.response.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(canRunAutomaticPhoneAi(meta.charId, URL)).toBe(false);
    expect(canRunAutomaticPhoneAi('another-char', URL)).toBe(true);
  });
});
