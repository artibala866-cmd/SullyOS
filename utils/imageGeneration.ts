import type { ImageApiSettings } from '../components/settings/ImageApiSettingsPanel';
import type { CharacterImageProfile } from './characterImageProfile';
import { dataUrlToBlob, getBlobForRef, isBlobRef } from './blobRef';

/**
 * The existing Settings and Character panels are the only UI owners. This module
 * translates their settings to provider requests and ALWAYS returns image bytes,
 * never a temporary object URL or expiring remote link.
 */
const stripSlash = (value: string) => value.trim().replace(/\/+$/, '');
const imageTypes = /^(image\/(png|jpeg|webp|gif|avif)|application\/octet-stream)$/i;

const readError = async (response: Response): Promise<string> => {
  const body = (await response.text()).slice(0, 800);
  try {
    const parsed = JSON.parse(body);
    return String(parsed.error?.message || parsed.message || response.statusText).slice(0, 300);
  } catch {
    return body.slice(0, 300) || response.statusText || '未知错误';
  }
};

const asImageBlob = (blob: Blob): Blob => {
  if (!blob.size || blob.size > 40 * 1024 * 1024) {
    throw new Error('生图结果为空或超过 40 MB，未保存');
  }
  if (!imageTypes.test(blob.type)) throw new Error('生图接口返回了非图片内容');
  return blob;
};

const readImageResult = async (response: Response, signal?: AbortSignal): Promise<Blob> => {
  const type = response.headers.get('content-type') || '';
  if (type.startsWith('image/')) return asImageBlob(await response.blob());
  const data = await response.json().catch(() => {
    throw new Error('生图接口返回了非 JSON 数据，请检查生图端点');
  });
  const first = (Array.isArray(data?.data) ? data.data[0] : data?.data)
    ?? data?.images?.[0] ?? data?.output?.[0] ?? data?.image;
  const value = typeof first === 'string'
    ? first
    : first?.b64_json || first?.base64 || first?.url || first?.image_url || first?.image;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(String(data?.error?.message || data?.message || '接口没有返回图片，请检查模型和中转站生图协议'));
  }
  if (/^data:image\//i.test(value)) return asImageBlob(dataUrlToBlob(value));
  if (/^https?:\/\//i.test(value)) {
    // A relay may return a short-lived image URL rather than base64. Do not
    // forward the relay API key, cookies, or referrer to a third-party CDN.
    let downloaded: Response;
    try {
      downloaded = await fetch(value, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    } catch {
      throw new Error('图片已生成，但图片下载被浏览器拦截（CORS、混合内容或网络错误）。请让中转站返回 Base64 或开放图片跨域访问');
    }
    if (!downloaded.ok) throw new Error('图片链接下载失败：HTTP ' + downloaded.status);
    return asImageBlob(await downloaded.blob());
  }
  if (/^[A-Za-z0-9+/\s]+=*$/.test(value)) {
    return asImageBlob(dataUrlToBlob('data:image/png;base64,' + value.replace(/\s/g, '')));
  }
  throw new Error('接口返回的图片地址或 Base64 无法识别');
};

const readReference = async (value: string): Promise<Blob> => {
  if (isBlobRef(value)) {
    const blob = await getBlobForRef(value);
    if (!blob) throw new Error('锁脸参考图已丢失，请在神经链接中重新上传');
    return blob;
  }
  if (/^data:image\//i.test(value)) return dataUrlToBlob(value); // legacy profile
  throw new Error('锁脸参考图格式无效，请重新上传');
};

const blobBase64 = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const pieces: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192) {
    pieces.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  }
  return btoa(pieces.join(''));
};

const readNovelImage = async (blob: Blob): Promise<Blob> => {
  if (blob.type.startsWith('image/')) return asImageBlob(blob);
  // ZIP parsing with JSZip handles deflate, data descriptors and UTF-8 file names;
  // the old local-file-header parser rejected valid NovelAI responses.
  const signature = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  if (signature[0] !== 0x50 || signature[1] !== 0x4b) {
    throw new Error('NAI 没有返回图片 ZIP，请检查服务商地址与模型');
  }
  const { default: JSZip } = await import('jszip');
  let archive: InstanceType<typeof JSZip>;
  try {
    // JSZip accepts Uint8Array consistently across browsers and Node; some
    // Blob implementations are not recognized, even when the ZIP is valid.
    archive = await JSZip.loadAsync(new Uint8Array(await blob.arrayBuffer()));
  } catch {
    throw new Error('NAI 返回的 ZIP 已损坏或无法解压');
  }
  const item = Object.values(archive.files).find(file => !file.dir && /\.(png|jpe?g|webp)$/i.test(file.name));
  if (!item) throw new Error('NAI ZIP 中没有可用图片');
  const mime = /\.webp$/i.test(item.name) ? 'image/webp' : /\.jpe?g$/i.test(item.name) ? 'image/jpeg' : 'image/png';
  const bytes = await item.async('uint8array');
  return asImageBlob(new Blob([bytes], { type: mime }));
};

const normalizedSize = (config: ImageApiSettings): string => {
  const width = Number(config.width);
  const height = Number(config.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 64 || height < 64 || width > 2048 || height > 2048) {
    throw new Error('生图宽高必须是 64～2048 的整数');
  }
  // Older GPT image models accept only these three preset sizes, while newer
  // GPT image 2.x models and third-party relays can accept flexible dimensions.
  const model = config.model.trim();
  if (/(?:^|[/])(?:gpt-image-[12](?:\.|-|$)|chatgpt-image-latest$)/i.test(model)) {
    return width === height ? '1024x1024' : width > height ? '1536x1024' : '1024x1536';
  }
  if (/(?:^|[/])dall-e-3$/i.test(model)) {
    return width === height ? '1024x1024' : width > height ? '1792x1024' : '1024x1792';
  }
  if (/(?:^|[/])dall-e-2$/i.test(model)) return '1024x1024';
  return width + 'x' + height;
};

/**
 * Respect user-supplied intermediary paths instead of assuming every relay is
 * hosted at /v1. Host-only URLs follow Echoes and the OpenAI standard (/v1).
 * Full generations/edits, models, and chat-completions URLs are also accepted.
 * NEVER guess alternative routes after a failed POST: that can double-charge.
 */
export const normalizeImageApiBaseUrl = (raw: string): string => {
  const input = stripSlash(raw);
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('请填写有效的 HTTPS 生图 API 地址'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
    throw new Error('生图中转地址必须为 HTTPS URL，且不能在地址里包含用户名或密码');
  }
  if (url.search || url.hash) throw new Error('生图中转 URL 请只填写 API 地址，不要带查询参数或锚点');
  let path = url.pathname.replace(/\/+$/, '');
  path = path.replace(/\/images\/(?:generations|edits)$/i, '')
             .replace(/\/(?:chat\/completions|responses|models)$/i, '');
  if (path === '/images') path = '';
  if (!path || path === '/') path = '/v1';
  return url.origin + path;
};

export const imageApiModelsEndpoint = (base: string): string =>
  normalizeImageApiBaseUrl(base) + '/models';

const endpointFor = (base: string, hasReference: boolean): string =>
  normalizeImageApiBaseUrl(base) + '/images/' + (hasReference ? 'edits' : 'generations');

const gpt15Family = (model: string): boolean => /(?:^|[/])gpt-image-1\.5(?:$|[-_])/i.test(model);

/** Reference image is an identity guide, not a request to copy the photograph. */
const identityReferencePrompt = (prompt: string): string => [
  'Generate a new image of the SAME person or character depicted in the uploaded identity reference.',
  'Preserve stable facial identity: face shape, facial features, age range, eye and hair color, and distinctive marks.',
  'Treat the uploaded photograph as an identity sheet, NOT as a composition to recreate.',
  'Do not copy the reference pose, gaze, expression, framing, lighting, background or clothing unless the scene prompt asks for them.',
  'Follow the requested scene, outfit and camera view. Do not swap, blend, or redesign the identity.',
  prompt,
].join(' ');


export async function generateCharacterImage(
  config: ImageApiSettings,
  profile: CharacterImageProfile,
  signal?: AbortSignal,
): Promise<Blob> {
  if (!config.apiKey?.trim() || !config.model?.trim()) throw new Error('请先在设置中保存生图 API Key 和模型');
  // The character-owned profile is shared by manual edits and BabyLink imports.
  // Never use a disabled reference, but retain it in storage for later re-enabling.
  const hasReference = !!profile.reference?.trim() && profile.referenceEnabled !== false;
  const wardrobe = profile.wardrobe;
  const promptParts = [
    config.positive?.trim(), profile.appearance?.trim(), profile.facePrompt?.trim(),
    wardrobe?.guidance?.trim(), wardrobe?.inventory?.trim(),
  ].filter(Boolean);
  // A valid identity reference is enough to request a new portrait even when
  // BabyLink's appearancePrompt and facePrompt are both empty.
  if (!promptParts.length && hasReference) promptParts.push('A new natural portrait of the referenced character');
  if (!promptParts.length) throw new Error('请先填写角色外貌描述或全局正面提示词');
  const negative = [config.negative?.trim(), wardrobe?.avoid?.trim()].filter(Boolean).join(', ');
  const prompt = (config.provider === 'nai' && hasReference && profile.referenceMode !== 'composition'
    ? ['Preserve the referenced character identity and facial features', ...promptParts].join(', ')
    : promptParts.join(', ')) + (config.provider === 'openai' && negative
    ? '\n\nAvoid: ' + negative
    : '');
  const base = stripSlash(config.baseUrl || (config.provider === 'nai' ? 'https://image.novelai.net' : ''));
  if (!/^https:\/\/[^/]+/i.test(base)) throw new Error('请填写有效的 HTTPS 生图 API 地址');
  const auth = { Authorization: 'Bearer ' + config.apiKey.trim() };
  const size = normalizedSize(config);
  if (config.provider === 'nai') {
    const steps = Number(config.steps ?? 28);
    const scale = Number(config.scale ?? 5);
    const strength = Number(config.referenceStrength ?? 0.45);
    if (!Number.isInteger(steps) || steps < 1 || steps > 50) throw new Error('NAI 步数应为 1～50');
    if (!Number.isFinite(scale) || scale < 1 || scale > 20) throw new Error('NAI 引导系数应为 1～20');
    if (!Number.isFinite(strength) || strength < 0.1 || strength > 0.95) throw new Error('参考图强度应为 0.1～0.95');
    const parameters: Record<string, unknown> = {
      width: config.width, height: config.height, steps, scale,
      sampler: config.sampler?.trim() || 'k_euler_ancestral',
      n_samples: 1, uc: negative, qualityToggle: true,
    };
    // NovelAI V4/4.5 models require V4 caption envelopes in addition to the
    // top-level prompt. Do not send the V4 fields to legacy NAI V3 models.
    if (/^nai-diffusion-4/i.test(config.model.trim())) {
      Object.assign(parameters, {
        params_version: 3,
        qualityToggle: false,
        ucPreset: /nai-diffusion-4-5-full|nai-diffusion-4\.5-full/i.test(config.model) ? 3 : 0,
        negative_prompt: negative,
        autoSmea: false,
        dynamic_thresholding: false,
        cfg_rescale: 0,
        characterPrompts: [],
        use_coords: false,
        legacy_uc: false,
        v4_prompt: {
          caption: { base_caption: prompt, char_captions: [] },
          use_coords: false,
          use_order: true,
        },
        v4_negative_prompt: {
          caption: { base_caption: negative, char_captions: [] },
          legacy_uc: false,
        },
      });
    }
    if (profile.seedLockEnabled && profile.seed?.trim()) {
      const rawSeed = profile.seed.trim();
      if (!/^\d{1,10}$/.test(rawSeed) || Number(rawSeed) > 0xffffffff) {
        throw new Error('角色固定随机种子必须是 0～4294967295 的整数');
      }
      parameters.seed = Number(rawSeed);
    }
    if (hasReference) {
      const reference = await readReference(profile.reference);
      if (!reference.type.startsWith('image/')) throw new Error('锁脸参考图不是有效图片');
      parameters.image = await blobBase64(reference);
      parameters.strength = strength;
      parameters.noise = 0;
    }
    const response = await fetch(base.replace(/\/ai\/generate-image$/i, '') + '/ai/generate-image', {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: prompt, model: config.model.trim(),
        action: hasReference ? 'img2img' : 'generate', parameters,
      }), signal,
    });
    if (!response.ok) throw new Error('NAI HTTP ' + response.status + '：' + await readError(response));
    return readNovelImage(await response.blob());
  }

  const url = endpointFor(base, hasReference);
  let response: Response;
  if (hasReference) {
    const reference = await readReference(profile.reference);
    if (!reference.type.startsWith('image/')) throw new Error('锁脸参考图不是有效图片');
    const format = reference.type === 'image/jpeg' ? 'jpg' : reference.type === 'image/webp' ? 'webp' : 'png';
    const body = new FormData();
    body.append('image', reference, 'reference.' + format);
    body.append('prompt', profile.referenceMode === 'composition' ? prompt : identityReferencePrompt(prompt));
    body.append('model', config.model.trim());
    body.append('size', size);
    body.append('n', '1');
    // GPT Image 1.5 supports this OpenAI API parameter specifically for facial
    // resemblance. Newer GPT Image models do not accept it, so omit for them.
    const fidelitySent = gpt15Family(config.model.trim());
    if (fidelitySent) body.append('input_fidelity', 'high');
    response = await fetch(url, { method: 'POST', headers: auth, body, signal });
    if (!response.ok && fidelitySent && [400, 422].includes(response.status)) {
      const error = await readError(response);
      // Only retry when the relay explicitly rejects this optional field.
      // Never retry image editing as text-only generations.
      if (/input_fidelity/i.test(error) && /(unknown|unsupported|unrecognized|invalid|not support|不支持|未知|无效)/i.test(error)) {
        body.delete('input_fidelity');
        response = await fetch(url, { method: 'POST', headers: auth, body, signal });
      } else {
        throw new Error('生图锁脸请求失败（HTTP ' + response.status + '）：' + error);
      }
    }
  } else {
    // response_format=b64_json is unsupported on current GPT Image models.
    // Accept b64_json and URL results from compatible third-party relays.
    response = await fetch(url, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model.trim(), prompt, size, n: 1,
        // Legacy DALL-E-compatible relays can return image URLs by default.
        // Explicit b64_json avoids downstream CDN CORS for these known models;
        // modern GPT Image models reject response_format, so omit for them.
        ...(/(?:^|[/])dall-e-[23]$/i.test(config.model.trim()) ? { response_format: 'b64_json' } : {}),
      }), signal,
    });
  }
  if (!response.ok) {
    const error = await readError(response);
    if (hasReference && [404, 405, 415, 422, 501].includes(response.status)) {
      throw new Error('中转站的 /images/edits 参考图接口不可用（HTTP ' + response.status + '）：' + error + '。未改用普通文生图，避免丢失锁脸');
    }
    throw new Error('生图接口 HTTP ' + response.status + '：' + error);
  }
  return readImageResult(response, signal);
}
