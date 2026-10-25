import { afterEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import type { ImageApiSettings } from '../components/settings/ImageApiSettingsPanel';
import { generateCharacterImage } from './imageGeneration';

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
