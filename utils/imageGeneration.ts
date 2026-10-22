import type { ImageApiSettings } from '../components/settings/ImageApiSettingsPanel';
import type { CharacterImageProfile } from '../components/character/CharacterImagePanel';

const trim = (s: string) => s.replace(/\/+$/, '');
const base64FromData = (data: string) => data.includes(',') ? data.split(',')[1] : data;
const readError = async (response: Response) => {
  const body = await response.text();
  try { const json = JSON.parse(body); return json.error?.message || json.message || body.slice(0, 300); }
  catch { return body.slice(0, 300) || response.statusText; }
};
const decodeNovelZip = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    if (blob.type.startsWith('image/')) return URL.createObjectURL(blob);
    throw new Error('NAI 返回了无法识别的文件格式');
  }
  // ZIP local file header; NovelAI returns image_0.png in a ZIP.
  let p = 0;
  while (p + 30 < bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + p);
    if (view.getUint32(0, true) !== 0x04034b50) break;
    const method = view.getUint16(8, true);
    const flags = view.getUint16(6, true);
    const size = view.getUint32(18, true);
    const nameLength = view.getUint16(26, true);
    const extraLength = view.getUint16(28, true);
    const name = new TextDecoder().decode(bytes.slice(p + 30, p + 30 + nameLength));
    const start = p + 30 + nameLength + extraLength;
    if (flags & 8) throw new Error('NAI ZIP 使用了不支持的数据描述符');
    if (start + size > bytes.length) throw new Error('NAI ZIP 内容不完整');
    if (/\.(png|jpg|jpeg|webp)$/i.test(name)) {
      const chunk = bytes.slice(start, start + size);
      let output: Blob;
      if (method === 0) output = new Blob([chunk], { type: 'image/png' });
      else if (method === 8) {
        if (typeof DecompressionStream === 'undefined') throw new Error('浏览器不支持解压 NAI 图片');
        output = await new Response(new Blob([chunk]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
      } else throw new Error('NAI ZIP 压缩格式不受支持');
      return URL.createObjectURL(new Blob([output], { type: 'image/png' }));
    }
    p = start + size;
  }
  throw new Error('NAI 返回的 ZIP 中没有图片');
};
export const generateCharacterImage = async (config: ImageApiSettings, profile: CharacterImageProfile): Promise<string> => {
  if (!config.apiKey.trim() || !config.model.trim()) throw new Error('请先在设置中保存生图 API Key 和模型');
  const prompt = [config.positive, profile.appearance].filter(Boolean).join(', ');
  if (!prompt.trim()) throw new Error('请先填写角色外貌或正面提示词');
  const base = trim(config.baseUrl || (config.provider === 'nai' ? 'https://image.novelai.net' : ''));
  if (!base || !/^https:\/\//i.test(base)) throw new Error('请填写 HTTPS API 地址');
  const headers = { Authorization: 'Bearer ' + config.apiKey };
  if (config.provider === 'nai') {
    const parameters: Record<string, unknown> = {
      width: config.width, height: config.height, scale: 5, sampler: 'k_euler_ancestral',
      steps: 28, n_samples: 1, uc: config.negative, qualityToggle: true,
    };
    let action = 'generate';
    if (profile.reference) {
      action = 'img2img';
      parameters.image = base64FromData(profile.reference);
      parameters.strength = 0.45;
      parameters.noise = 0;
    }
    const response = await fetch(base + '/ai/generate-image', {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: prompt, model: config.model, action, parameters }),
    });
    if (!response.ok) throw new Error('NAI ' + response.status + ': ' + await readError(response));
    return decodeNovelZip(await response.blob());
  }
  const url = base.endsWith('/images/generations') || base.endsWith('/images/edits') ? base : base + '/images/' + (profile.reference ? 'edits' : 'generations');
  let response: Response;
  if (profile.reference) {
    const raw = await fetch(profile.reference).then(r => r.blob());
    const form = new FormData();
    form.append('image', raw, 'reference.png');
    form.append('prompt', prompt);
    form.append('model', config.model);
    form.append('size', config.width + 'x' + config.height);
    response = await fetch(url, { method: 'POST', headers, body: form });
  } else {
    response = await fetch(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.model, prompt, size: config.width + 'x' + config.height, n: 1, response_format: 'b64_json' }) });
  }
  if (!response.ok) throw new Error('生图接口 ' + response.status + ': ' + await readError(response));
  const data = await response.json();
  const image = data?.data?.[0]?.b64_json || data?.data?.[0]?.url || data?.images?.[0]?.url;
  if (!image) throw new Error('接口未返回可识别的图片，请检查中转站协议');
  return image.startsWith('http') || image.startsWith('data:') ? image : 'data:image/png;base64,' + image;
};
