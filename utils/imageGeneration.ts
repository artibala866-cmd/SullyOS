import type { ImageApiSettings } from '../components/settings/ImageApiSettingsPanel';
import type { CharacterImageProfile } from '../components/character/CharacterImagePanel';
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
  const first = data?.data?.[0] ?? data?.images?.[0] ?? data?.output?.[0] ?? data?.image;
  const value = typeof first === 'string'
    ? first
    : first?.b64_json || first?.base64 || first?.url || first?.image_url || first?.image;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(String(data?.error?.message || data?.message || '接口没有返回图片，请检查模型和中转站生图协议'));
  }
  if (/^data:image\//i.test(value)) return asImageBlob(dataUrlToBlob(value));
  if (/^https:\/\//i.test(value)) {
    // Some relays return short-lived URLs. Fetch the actual bytes before they expire.
    let downloaded: Response;
    try {
      downloaded = await fetch(value, { signal });
    } catch {
      throw new Error('图片已生成，但返回链接不允许浏览器下载（CORS/网络错误）；请检查中转站图片链接');
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
    archive = await JSZip.loadAsync(blob);
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
  if (/^(gpt-image-1(?:\.|-|$)|chatgpt-image-latest$)/i.test(config.model.trim())) {
    return width === height ? '1024x1024' : width > height ? '1536x1024' : '1024x1536';
  }
  return width + 'x' + height;
};

const endpointFor = (base: string, hasReference: boolean): string => {
  const normalized = base.replace(/\/images\/(generations|edits)$/i, '');
  return normalized + '/images/' + (hasReference ? 'edits' : 'generations');
};

export async function generateCharacterImage(
  config: ImageApiSettings,
  profile: CharacterImageProfile,
  signal?: AbortSignal,
): Promise<Blob> {
  if (!config.apiKey?.trim() || !config.model?.trim()) throw new Error('请先在设置中保存生图 API Key 和模型');
  const prompt = [config.positive?.trim(), profile.appearance?.trim()].filter(Boolean).join(', ');
  if (!prompt) throw new Error('请先填写角色外貌描述或全局正面提示词');
  const base = stripSlash(config.baseUrl || (config.provider === 'nai' ? 'https://image.novelai.net' : ''));
  if (!/^https:\/\/[^/]+/i.test(base)) throw new Error('请填写有效的 HTTPS 生图 API 地址');
  const auth = { Authorization: 'Bearer ' + config.apiKey.trim() };
  const size = normalizedSize(config);
  const hasReference = !!profile.reference?.trim();

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
      n_samples: 1, uc: config.negative || '', qualityToggle: true,
    };
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
    body.append('prompt', prompt);
    body.append('model', config.model.trim());
    body.append('size', size);
    response = await fetch(url, { method: 'POST', headers: auth, body, signal });
  } else {
    // response_format=b64_json is unsupported on current GPT Image models.
    // Accept b64_json and URL results from compatible third-party relays.
    response = await fetch(url, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.model.trim(), prompt, size, n: 1 }), signal,
    });
  }
  if (!response.ok) throw new Error('生图接口 HTTP ' + response.status + '：' + await readError(response));
  return readImageResult(response, signal);
}
