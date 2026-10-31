import { afterEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import type { ImageApiSettings } from '../components/settings/ImageApiSettingsPanel';
import { generateCharacterImage, imageApiModelsEndpoint, normalizeImageApiBaseUrl } from './imageGeneration';

const config: ImageApiSettings = {
  provider: 'openai', baseUrl: 'https://relay.example/v1', apiKey: 'local-test-key',
  model: 'gpt-image-1.5', positive: 'soft lighting', negative: 'blur',
  width: 832, height: 1216, steps: 28, scale: 5,
  sampler: 'k_euler_ancestral', referenceStrength: 0.45,
};
const profile = { appearance: 'black hair, blue eyes', reference: '' };
const png = 'aGVsbG8='; // Small fake image payload is sufficient to test API transport.

afterEach(() => vi.unstubAllGlobals());

describe('existing character image generation adapter', () => {
  it('uses an OpenAI-compatible generations endpoint without deprecated response_format', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: png }] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const image = await generateCharacterImage(config, profile);
    expect(image.type).toBe('image/png');
    expect(image.size).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://relay.example/v1/images/generations');
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.response_format).toBeUndefined();
    expect(sent.size).toBe('1024x1536'); // gpt-image-1.x preset sizing
  });

  it('uses an edit request with the existing lock-face reference and never retries as text-to-image', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'edits unavailable' } }), {
      status: 400, headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(generateCharacterImage(
      { ...config, baseUrl: 'https://relay.example/v1/images/generations' },
      { ...profile, reference: 'data:image/png;base64,' + png },
    )).rejects.toThrow('edits unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://relay.example/v1/images/edits');
    expect(options.body).toBeInstanceOf(FormData);
    expect(options.body.get('image')).toBeInstanceOf(Blob);
  });

  it('decodes NovelAI 4.5 ZIP responses and sends V4 prompts with custom sampling values', async () => {
    const zip = new JSZip();
    zip.file('image_0.png', new Uint8Array([137, 80, 78, 71, 1]));
    const resultZip = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', streamFiles: true });
    const fetchMock = vi.fn().mockResolvedValue(new Response(resultZip, {
      status: 200, headers: { 'content-type': 'application/zip' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const blob = await generateCharacterImage({
      ...config, provider: 'nai', baseUrl: 'https://image.novelai.net',
      model: 'nai-diffusion-4-5-full', steps: 32, scale: 6, sampler: 'k_euler',
    }, profile);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(5);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.action).toBe('generate');
    expect(sent.parameters.steps).toBe(32);
    expect(sent.parameters.scale).toBe(6);
    expect(sent.parameters.sampler).toBe('k_euler');
    expect(sent.parameters.v4_prompt.caption.base_caption).toContain('black hair');
    expect(sent.parameters.v4_negative_prompt.caption.base_caption).toBe('blur');
  });
});

describe('OpenAI relay URL and reference compatibility', () => {
  it('normalizes common relay URLs without duplicating version or endpoint', () => {
    expect(normalizeImageApiBaseUrl('https://relay.example')).toBe('https://relay.example/v1');
    expect(normalizeImageApiBaseUrl('https://relay.example/v1/')).toBe('https://relay.example/v1');
    expect(normalizeImageApiBaseUrl('https://relay.example/v1/images/generations')).toBe('https://relay.example/v1');
    expect(normalizeImageApiBaseUrl('https://relay.example/v1/images/edits')).toBe('https://relay.example/v1');
    expect(normalizeImageApiBaseUrl('https://relay.example/proxy/openai/v1')).toBe('https://relay.example/proxy/openai/v1');
    expect(normalizeImageApiBaseUrl('https://relay.example/v1/chat/completions')).toBe('https://relay.example/v1');
    expect(imageApiModelsEndpoint('https://relay.example/v1/images/generations')).toBe('https://relay.example/v1/models');
    expect(() => normalizeImageApiBaseUrl('http://relay.example/v1')).toThrow('HTTPS');
  });

  it('includes an identity-preservation prompt and high fidelity only for GPT Image 1.5 edits', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: png }] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await generateCharacterImage({ ...config, baseUrl: 'https://relay.example', negative: 'wrong identity' }, {
      appearance: 'black hair, blue eyes', reference: 'data:image/png;base64,' + png,
    });
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://relay.example/v1/images/edits');
    expect(request.body).toBeInstanceOf(FormData);
    expect(request.body.get('input_fidelity')).toBe('high');
    expect(request.body.get('image')).toBeInstanceOf(Blob);
    expect(request.body.get('prompt')).toContain('Preserve stable facial identity');
    expect(request.body.get('prompt')).toContain('Avoid: wrong identity');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not send 1.5-only input_fidelity with newer GPT Image models', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: png }] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await generateCharacterImage({ ...config, model: 'gpt-image-2' }, {
      ...profile, reference: 'data:image/png;base64,' + png,
    });
    expect(fetchMock.mock.calls[0][1].body.has('input_fidelity')).toBe(false);
  });

  it('retries identical reference edit once only when the relay rejects input_fidelity', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'unsupported input_fidelity' } }), {
        status: 400, headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ b64_json: png }] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);
    await generateCharacterImage(config, { ...profile, reference: 'data:image/png;base64,' + png });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('https://relay.example/v1/images/edits');
    expect(fetchMock.mock.calls[1][0]).toBe('https://relay.example/v1/images/edits');
    expect(fetchMock.mock.calls[1][1].body.get('image')).toBeInstanceOf(Blob);
    expect(fetchMock.mock.calls[1][1].body.has('input_fidelity')).toBe(false);
  });

  it('parses relay HTTPS URL image results without forwarding cookies or referrer', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ url: 'https://image-cdn.example/a.png' }] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), {
        status: 200, headers: { 'content-type': 'image/png' },
      }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await generateCharacterImage(config, profile);
    expect(result.type).toBe('image/png');
    expect(fetchMock.mock.calls[1][0]).toBe('https://image-cdn.example/a.png');
    expect(fetchMock.mock.calls[1][1].credentials).toBe('omit');
    expect(fetchMock.mock.calls[1][1].referrerPolicy).toBe('no-referrer');
  });
});

describe('BabyLink native image profile API parity', () => {
  it('sends the imported identity reference to edits and includes face + wardrobe constraints', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: png }] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await generateCharacterImage(config, {
      appearance: '白金发', facePrompt: '浅色虹膜、眉骨清晰',
      reference: 'data:image/jpeg;base64,/9j/AA==',
      referenceEnabled: true, referenceMode: 'identity',
      wardrobe: { guidance: '穿轻便街头服装', inventory: '黑帽子、灰色连帽衫', avoid: '校服' },
    });
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://relay.example/v1/images/edits');
    expect(request.body.get('image')).toBeInstanceOf(Blob);
    const prompt = String(request.body.get('prompt'));
    expect(prompt).toContain('Preserve stable facial identity');
    expect(prompt).toContain('浅色虹膜');
    expect(prompt).toContain('黑帽子');
    expect(prompt).toContain('Avoid: blur, 校服');
  });

  it('retains a disabled reference but generates text-only without sending face bytes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: png }] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await generateCharacterImage(config, {
      appearance: '', facePrompt: '鼻梁清晰',
      reference: 'data:image/jpeg;base64,/9j/AA==',
      referenceEnabled: false, referenceMode: 'identity',
    });
    expect(fetchMock.mock.calls[0][0]).toBe('https://relay.example/v1/images/generations');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.prompt).toContain('鼻梁清晰');
    expect(JSON.stringify(body)).not.toContain('/9j/');
  });

  it('supports an image-only BabyLink identity profile with no appearance prompt', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: png }] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await generateCharacterImage({ ...config, positive: '', negative: '' }, {
      appearance: '', reference: 'data:image/jpeg;base64,/9j/AA==', referenceEnabled: true,
    });
    expect(fetchMock.mock.calls[0][0]).toBe('https://relay.example/v1/images/edits');
    expect(fetchMock.mock.calls[0][1].body.get('prompt')).toContain('A new natural portrait');
  });

  it('respects BabyLink composition mode without forcing face identity instructions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: png }] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await generateCharacterImage(config, {
      appearance: '灰色大衣', reference: 'data:image/jpeg;base64,/9j/AA==',
      referenceEnabled: true, referenceMode: 'composition',
    });
    expect(fetchMock.mock.calls[0][1].body.get('prompt')).toContain('灰色大衣');
    expect(fetchMock.mock.calls[0][1].body.get('prompt')).not.toContain('Preserve stable facial identity');
  });

  it('passes locked seeds and wardrobe exclusions through supported NovelAI request', async () => {
    const zip = new JSZip();
    zip.file('img.png', new Uint8Array([137, 80, 78, 71, 1]));
    const resultZip = await zip.generateAsync({ type: 'blob' });
    const fetchMock = vi.fn().mockResolvedValue(new Response(resultZip, {
      status: 200, headers: { 'content-type': 'application/zip' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await generateCharacterImage({
      ...config, provider: 'nai', baseUrl: 'https://image.novelai.net',
      model: 'nai-diffusion-4-5-full',
    }, {
      appearance: '灰发', reference: 'data:image/jpeg;base64,/9j/AA==',
      referenceEnabled: true, referenceMode: 'identity',
      seed: '98765', seedLockEnabled: true,
      wardrobe: { guidance: '日常休闲', inventory: '运动外套', avoid: '军装' },
    });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.action).toBe('img2img');
    expect(sent.parameters.seed).toBe(98765);
    expect(sent.parameters.v4_prompt.caption.base_caption).toContain('Preserve the referenced character identity');
    expect(sent.parameters.v4_negative_prompt.caption.base_caption).toContain('军装');
  });
});

describe('legacy relay response compatibility', () => {
  it('requests base64 from DALL-E relays while respecting DALL-E output dimensions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: png }] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await generateCharacterImage({ ...config, model: 'dall-e-3' }, profile);
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.size).toBe('1024x1792');
    expect(payload.response_format).toBe('b64_json');
  });

  it('supports relay-prefixed GPT 1.5 aliases for size and fidelity', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: png }] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await generateCharacterImage({ ...config, model: 'vendor/gpt-image-1.5' }, {
      ...profile, reference: 'data:image/png;base64,' + png,
    });
    expect(fetchMock.mock.calls[0][1].body.get('size')).toBe('1024x1536');
    expect(fetchMock.mock.calls[0][1].body.get('input_fidelity')).toBe('high');
  });
});

describe('FoxAPI GPT Image 2 photo sending compatibility', () => {
  it('converts the original 832x1216 defaults to a FoxAPI-supported GPT Image 2 output size', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: png }] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const image = await generateCharacterImage({
      ...config, provider: 'openai', baseUrl: 'https://foxapi.chat',
      model: 'gpt-image-2', width: 832, height: 1216,
    }, { appearance: 'street photo on a rainy evening', reference: '' });
    expect(image.size).toBe(5);
    expect(fetchMock.mock.calls[0][0]).toBe('https://foxapi.chat/v1/images/generations');
    const params = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(params.size).toBe('1024x1536');
    expect(params.model).toBe('gpt-image-2');
    expect(params.prompt).toContain('street photo');
  });
});
