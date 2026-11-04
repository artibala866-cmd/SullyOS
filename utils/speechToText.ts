/**
 * Unified speech-to-text (STT) — used by the Call app for voice input.
 *
 * Supports four user-selectable STT routes:
 *   - 'minimax'    → MiniMax official ASR (`POST /v1/speech_to_text`, model `asr-1.0`)
 *   - 'fishaudio'  → Fish Audio official ASR (`POST /v1/asr`, model `transcribe-1-pro`)
 *   - 'elevenlabs' → ElevenLabs official Scribe (`POST /v1/speech-to-text`, model `scribe_v2`)
 *   - 'browser'    → Browser `SpeechRecognition` / Capacitor native speech recognition (free)
 *
 * Strict policy:
 *   - Paid STT providers are only selectable/usable when the corresponding official platform
 *     API Key is configured.
 *   - Never fall back to unrelated third-party dialogue LLM endpoints or non-MiniMax keys.
 */
import { Capacitor } from '@capacitor/core';
import type { APIConfig, SttProvider } from '../types';
import { normalizeApiKey } from './minimaxApiKey';
import { getMinimaxRegion, normalizeMinimaxRegion } from './minimaxEndpoint';
import { getProxyWorkerUrl } from './proxyWorker';
import { isStaticWebDeployment } from './staticWebDeployment';

export interface SttCallbacks {
  /** Captured WAV bytes from the existing paid-STT microphone stream (no second recording). */
  onAudioCaptured?: (audio: Blob, durationSec: number) => void;
  /** Fired repeatedly with the best-so-far transcript (interim + final, browser mode). */
  onPartial?: (text: string) => void;
  /** Fired once with the final transcript when recognition settles. */
  onFinal?: (text: string) => void;
  /** Fired when an API provider starts/finishes uploading & transcribing recorded audio. */
  onTranscribing?: (transcribing: boolean) => void;
  /** Fired on any recognition error (already turned into a friendly message). */
  onError?: (message: string) => void;
  /** Fired when the session ends for any reason (success, error, or stop). */
  onEnd?: () => void;
}

export interface SttSession {
  /** Stop listening (and trigger transcription for API providers). Safe to call multiple times. */
  stop: () => void;
  /** Discard captured input; unlike stop(), never begin a paid transcription. */
  cancel: () => void;
}

export interface SttProviderOption {
  id: SttProvider;
  label: string;
  shortLabel: string;
  desc: string;
  keyHint: string;
}

export const STT_PROVIDER_OPTIONS: SttProviderOption[] = [
  {
    id: 'minimax',
    label: 'MiniMax ASR',
    shortLabel: 'MiniMax',
    desc: '海螺官方 asr-1.0 · 支持中/粤/英/日等多语种与中英混说',
    keyHint: '需先填写 MiniMax API Key',
  },
  {
    id: 'fishaudio',
    label: '鱼声 Fish ASR',
    shortLabel: '鱼声 Fish',
    desc: '官方 transcribe-1-pro · 口语与多语种转写准确',
    keyHint: '需先填写鱼声 Fish Audio Key',
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs Scribe',
    shortLabel: 'ElevenLabs',
    desc: '官方 Scribe v2 · 90+ 语种高精度语音转写',
    keyHint: '需先填写 ElevenLabs API Key',
  },
  {
    id: 'browser',
    label: '浏览器 / 系统自带（免费）',
    shortLabel: '浏览器自带',
    desc: '不消耗 API 额度，依赖当前浏览器或系统语音服务（部分浏览器不支持）',
    keyHint: '',
  },
];

const isNative = (): boolean => {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
};

const getWebCtor = (): any =>
  (typeof window !== 'undefined' && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) || null;

const useStaticWorker = (): boolean => {
  if (typeof window === 'undefined') return false;
  return isStaticWebDeployment(window.location.protocol, window.location.hostname);
};

/**
 * Check whether a baseUrl explicitly points to an official MiniMax API domain.
 * Prevents accidentally treating a third-party OpenAI/DeepSeek dialogue key as a MiniMax key.
 */
export const isOfficialMiniMaxBaseUrl = (baseUrl?: string | null): boolean => {
  const raw = (baseUrl || '').trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return parsed.protocol === 'https:' &&
      !parsed.username && !parsed.password &&
      ['api.minimaxi.com', 'api.minimax.io', 'api.minimax.cn', 'api.minimax.chat'].includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
};

/**
 * Strictly resolve MiniMax API Key for STT:
 * Only accepts dedicated `minimaxApiKey`, or main `apiKey` when `baseUrl` is an official MiniMax domain.
 */
export const resolveMiniMaxSttApiKey = (apiConfig?: Partial<APIConfig> | null): string => {
  if (!apiConfig) return '';
  const dedicated = normalizeApiKey(apiConfig.minimaxApiKey || '');
  if (dedicated) return dedicated;
  if (isOfficialMiniMaxBaseUrl(apiConfig.baseUrl)) {
    return normalizeApiKey(apiConfig.apiKey || '');
  }
  return '';
};

export const resolveFishAudioSttApiKey = (apiConfig?: Partial<APIConfig> | null): string =>
  normalizeApiKey(apiConfig?.fishAudioApiKey || '');

export const resolveElevenLabsSttApiKey = (apiConfig?: Partial<APIConfig> | null): string =>
  normalizeApiKey(apiConfig?.elevenLabsApiKey || '');

export const isSttProviderConfigured = (
  provider: SttProvider,
  apiConfig?: Partial<APIConfig> | null,
): boolean => {
  if (provider === 'browser') return true;
  if (provider === 'minimax') return Boolean(resolveMiniMaxSttApiKey(apiConfig));
  if (provider === 'fishaudio') return Boolean(resolveFishAudioSttApiKey(apiConfig));
  if (provider === 'elevenlabs') return Boolean(resolveElevenLabsSttApiKey(apiConfig));
  return false;
};

export const getConfiguredApiSttProviders = (
  apiConfig?: Partial<APIConfig> | null,
): Array<'minimax' | 'fishaudio' | 'elevenlabs'> => {
  const providers: Array<'minimax' | 'fishaudio' | 'elevenlabs'> = ['elevenlabs', 'fishaudio', 'minimax'];
  return providers.filter((p) => isSttProviderConfigured(p, apiConfig));
};

export const hasAnyApiSttConfigured = (apiConfig?: Partial<APIConfig> | null): boolean =>
  getConfiguredApiSttProviders(apiConfig).length > 0;

/** Free browser/native recognition is the default; paid APIs require explicit selection. */
export const resolveSttProvider = (apiConfig?: Partial<APIConfig> | null): SttProvider => {
  const selected = apiConfig?.sttProvider;
  return selected && isSttProviderConfigured(selected, apiConfig) ? selected : 'browser';
};

export const getSttProviderLabel = (provider: SttProvider): string =>
  STT_PROVIDER_OPTIONS.find((o) => o.id === provider)?.shortLabel || provider;

/** Whether browser/system native SpeechRecognition is available. */
export const isBrowserSttSupported = (): boolean => {
  if (isNative()) return true;
  return !!getWebCtor();
};

/** Whether microphone audio capture (`getUserMedia`) is available for API STT. */
export const isAudioRecordingSupported = (): boolean =>
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices &&
  typeof navigator.mediaDevices.getUserMedia === 'function';

/** Whether voice input is usable in the current environment. */
export const isSttSupported = (apiConfig?: Partial<APIConfig> | null): boolean => {
  return isBrowserSttSupported() || (hasAnyApiSttConfigured(apiConfig) && isAudioRecordingSupported());
};

const friendlyBrowserError = (raw: string, hasPaidConfigured: boolean): string => {
  const suffix = hasPaidConfigured
    ? '可在「通话偏好」或「设置 → 其他 API」切换为已配置的付费语音识别'
    : '可在「设置 → 其他 API」配置 ElevenLabs、鱼声 Fish 或 MiniMax Key 开启高精度语音转文字';
  if (/not-allowed|notallowed|permission|denied|securityerror/i.test(raw)) return '麦克风权限被拒绝，请在浏览器或系统设置里放行';
  if (/no-speech/i.test(raw)) return '没听清，再试一次？';
  if (/audio-capture/i.test(raw)) return '找不到可用麦克风';
  if (/network|service-not-allowed/i.test(raw)) return `当前浏览器语音服务不可用，${suffix}`;
  return `语音识别不可用（${raw || 'unknown'}），${suffix}`;
};

/**
 * Downsample mono Float32 PCM samples to targetSampleRate (default 16kHz)
 * and encode as a 16-bit PCM WAV Blob (`audio/wav`).
 */
export const encodeWavFromFloat32 = (
  samples: Float32Array,
  sourceSampleRate: number,
  targetSampleRate = 16000,
): Blob => {
  const srcRate = Math.max(1, Math.floor(sourceSampleRate || targetSampleRate));
  const dstRate = Math.max(1, Math.floor(targetSampleRate));

  let resampled: Float32Array;
  if (srcRate === dstRate || samples.length === 0) {
    resampled = samples;
  } else {
    const ratio = srcRate / dstRate;
    const newLength = Math.max(1, Math.round(samples.length / ratio));
    resampled = new Float32Array(newLength);
    for (let i = 0; i < newLength; i += 1) {
      const start = Math.floor(i * ratio);
      const end = Math.min(samples.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
      let sum = 0;
      for (let j = start; j < end; j += 1) {
        sum += samples[j];
      }
      resampled[i] = sum / (end - start);
    }
  }

  const numSamples = resampled.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i += 1) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true);  // PCM format = 1
  view.setUint16(22, 1, true);  // Mono = 1 channel
  view.setUint32(24, dstRate, true);
  view.setUint32(28, dstRate * 2, true); // byte rate (sampleRate * blockAlign)
  view.setUint16(32, 2, true);  // block align (1 channel * 2 bytes)
  view.setUint16(34, 16, true); // bits per sample = 16
  writeString(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i += 1) {
    const clamped = Math.max(-1, Math.min(1, resampled[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
};

const shouldRetryWithWorker = (res: Response): boolean => {
  if (res.status === 404 || res.status === 405) return true;
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  return contentType.includes('text/html') || contentType.includes('application/xhtml+xml');
};

const postSttMultipart = async (
  localProxyPath: string,
  workerPath: string,
  buildFormData: () => FormData,
  headers: Record<string, string>,
): Promise<Response> => {
  const workerUrl = `${getProxyWorkerUrl()}${workerPath}`;
  if (isNative() || useStaticWorker()) {
    return fetch(workerUrl, {
      method: 'POST',
      headers,
      body: buildFormData(),
    });
  }

  try {
    const res = await fetch(localProxyPath, {
      method: 'POST',
      headers,
      body: buildFormData(),
    });
    if (shouldRetryWithWorker(res)) {
      return fetch(workerUrl, {
        method: 'POST',
        headers,
        body: buildFormData(),
      });
    }
    return res;
  } catch {
    return fetch(workerUrl, {
      method: 'POST',
      headers,
      body: buildFormData(),
    });
  }
};

const extractApiErrorDetail = (rawText: string): string => {
  const trimmed = (rawText || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = JSON.parse(trimmed);
    const msg =
      parsed?.error?.message ||
      parsed?.base_resp?.status_msg ||
      parsed?.detail?.message ||
      (typeof parsed?.detail === 'string' ? parsed.detail : '') ||
      parsed?.message ||
      parsed?.error;
    if (typeof msg === 'string' && msg.trim()) return msg.trim();
  } catch {
    // plain text
  }
  return trimmed.slice(0, 180);
};

const formatSttHttpError = (providerLabel: string, status: number, rawText: string): string => {
  const detail = extractApiErrorDetail(rawText);
  const lower = detail.toLowerCase();
  if (status === 401 || lower.includes('invalid api key') || lower.includes('unauthorized') || lower.includes('authorized_error')) {
    return `${providerLabel} API Key 无效或未开通语音识别权限，请前往「设置 → 其他 API」检查`;
  }
  if (status === 402 || lower.includes('insufficient_balance') || lower.includes('quota') || lower.includes('credits') || lower.includes('payment')) {
    return `${providerLabel} 账户余额或配额不足`;
  }
  if (status === 403) {
    return `${providerLabel} 拒绝访问，请检查 Key 权限`;
  }
  if (status === 429 || lower.includes('rate_limit') || lower.includes('too many requests')) {
    return `${providerLabel} 请求过于频繁，请稍后再试`;
  }
  return `${providerLabel} 语音转写失败 (HTTP ${status})${detail ? `：${detail}` : ''}`;
};

/**
 * Strip Fish Audio `transcribe-1-pro` speaker turn prefixes such as `<|speaker:0|>`.
 */
export const cleanFishAsrText = (raw: string): string =>
  (raw || '').replace(/<\|speaker:\d+\|>/gi, '').replace(/\s+/g, ' ').trim();

/**
 * Send a recorded WAV blob to the specified paid STT provider and return the transcript.
 */
export async function transcribeAudioWithProvider(
  wavBlob: Blob,
  provider: 'minimax' | 'fishaudio' | 'elevenlabs',
  lang: string,
  apiConfig?: Partial<APIConfig> | null,
): Promise<string> {
  const normalizedLang = (lang || '').trim().toLowerCase();

  if (provider === 'minimax') {
    const apiKey = resolveMiniMaxSttApiKey(apiConfig);
    if (!apiKey) {
      throw new Error('未配置官方 MiniMax API Key，请在「设置 → 其他 API」填写，或切换至 ElevenLabs / 鱼声 Fish');
    }
    const region = normalizeMinimaxRegion(apiConfig?.minimaxRegion || getMinimaxRegion());
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      'X-MiniMax-Region': region,
    };
    if (normalizedLang === 'yue') {
      headers['language'] = 'yue';
    }

    const res = await postSttMultipart(
      '/api/minimax/stt',
      `/minimax/stt?region=${encodeURIComponent(region)}`,
      () => {
        const form = new FormData();
        form.append('model', 'asr-1.0');
        form.append('response_format', 'json');
        form.append('file', wavBlob, 'speech.wav');
        return form;
      },
      headers,
    );

    const rawText = await res.text();
    if (!res.ok) {
      throw new Error(formatSttHttpError('MiniMax ASR', res.status, rawText));
    }

    let data: any;
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error('MiniMax ASR 返回格式异常');
    }
    if (data?.type === 'error' || data?.error) {
      throw new Error(formatSttHttpError('MiniMax ASR', Number(data?.error?.http_code) || 400, rawText));
    }
    if (data?.base_resp?.status_code && data.base_resp.status_code !== 0) {
      throw new Error(formatSttHttpError('MiniMax ASR', 400, rawText));
    }
    return String(data?.text || '').trim();
  }

  if (provider === 'fishaudio') {
    const apiKey = resolveFishAudioSttApiKey(apiConfig);
    if (!apiKey) {
      throw new Error('未配置鱼声 Fish Audio API Key，请在「设置 → 其他 API」填写');
    }
    const model = 'transcribe-1-pro';
    const res = await postSttMultipart(
      '/api/fishaudio/stt',
      `/fishaudio/stt?model=${encodeURIComponent(model)}`,
      () => {
        const form = new FormData();
        form.append('audio', wavBlob, 'speech.wav');
        form.append('ignore_timestamps', 'true');
        form.append('tag_audio_events', 'false');
        if (normalizedLang === 'yue') {
          form.append('language', 'yue');
        }
        return form;
      },
      {
        Authorization: `Bearer ${apiKey}`,
        model,
      },
    );

    const rawText = await res.text();
    if (!res.ok) {
      throw new Error(formatSttHttpError('鱼声 Fish ASR', res.status, rawText));
    }

    let data: any;
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error('鱼声 Fish ASR 返回格式异常');
    }
    return cleanFishAsrText(String(data?.text || ''));
  }

  // provider === 'elevenlabs'
  const apiKey = resolveElevenLabsSttApiKey(apiConfig);
  if (!apiKey) {
    throw new Error('未配置 ElevenLabs API Key，请在「设置 → 其他 API」填写');
  }

  const res = await postSttMultipart(
    '/api/elevenlabs/stt',
    '/elevenlabs/stt',
    () => {
      const form = new FormData();
      form.append('model_id', 'scribe_v2');
      form.append('tag_audio_events', 'false');
      if (normalizedLang === 'yue') {
        form.append('language_code', 'yue');
      }
      form.append('file', wavBlob, 'speech.wav');
      return form;
    },
    {
      'xi-api-key': apiKey,
    },
  );

  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(formatSttHttpError('ElevenLabs Scribe', res.status, rawText));
  }

  let data: any;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error('ElevenLabs Scribe 返回格式异常');
  }
  return String(data?.text || '').trim();
}

const MAX_RECORDING_MS = 60_000;
const MIN_RECORDING_SAMPLES_AT_16K = 3200; // ~0.2s

const startApiStt = async (
  provider: 'minimax' | 'fishaudio' | 'elevenlabs' | null,
  lang: string,
  apiConfig: Partial<APIConfig> | null | undefined,
  cb: SttCallbacks,
): Promise<SttSession> => {
  if (!isAudioRecordingSupported()) {
    cb.onError?.('当前环境不支持麦克风录音，请检查浏览器权限或改用 HTTPS 访问');
    cb.onEnd?.();
    return { stop: () => {}, cancel: () => {} };
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (e: any) {
    cb.onError?.(friendlyBrowserError(e?.name || e?.message || 'permission-denied', true));
    cb.onEnd?.();
    return { stop: () => {}, cancel: () => {} };
  }

  const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) {
    stream.getTracks().forEach((t) => t.stop());
    cb.onError?.('当前浏览器不支持 WebAudio 录音');
    cb.onEnd?.();
    return { stop: () => {}, cancel: () => {} };
  }

  let contextToCleanup: AudioContext | null = null;
  try {
  const audioCtx: AudioContext = new AudioCtx();
  contextToCleanup = audioCtx;
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume().catch(() => {});
  }

  const source = audioCtx.createMediaStreamSource(stream);
  const processor = audioCtx.createScriptProcessor(4096, 1, 1);
  const recordedChunks: Float32Array[] = [];
  let totalSamples = 0;
  let stopped = false;
  let cancelled = false;

  processor.onaudioprocess = (event: AudioProcessingEvent) => {
    if (stopped) return;
    const input = event.inputBuffer.getChannelData(0);
    const copy = new Float32Array(input.length);
    copy.set(input);
    recordedChunks.push(copy);
    totalSamples += copy.length;
  };

  source.connect(processor);
  processor.connect(audioCtx.destination);

  const stopRecordingAndTranscribe = async () => {
    if (stopped) return;
    stopped = true;
    window.clearTimeout(autoStopTimer);

    try {
      processor.disconnect();
      source.disconnect();
    } catch { /* ignore */ }
    stream.getTracks().forEach((t) => t.stop());
    const sampleRate = audioCtx.sampleRate || 48000;
    audioCtx.close().catch(() => {});

    const merged = new Float32Array(totalSamples);
    let offset = 0;
    for (const chunk of recordedChunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    const estimated16kSamples = Math.round((totalSamples / sampleRate) * 16000);
    if (estimated16kSamples < MIN_RECORDING_SAMPLES_AT_16K) {
      cb.onError?.('录音时间太短啦，点一下麦克风开始说话，说完再点一下结束识别');
      cb.onEnd?.();
      return;
    }

    cb.onTranscribing?.(true);
    try {
      const wavBlob = encodeWavFromFloat32(merged, sampleRate, 16000);
      // One capture stream serves STT and (opt-in) the durable user message.
      // Do not publish bytes for cancelled sessions or upload an empty recording.
      if (!cancelled) cb.onAudioCaptured?.(wavBlob, totalSamples / sampleRate);
      if (cancelled) return;
      // Browser STT generates its transcript separately; this internal PCM
      // fallback only supplies the audio draft and never charges an API.
      if (provider === null) return;
      const transcript = await transcribeAudioWithProvider(wavBlob, provider, lang, apiConfig);
      if (cancelled) return;
      if (transcript) {
        cb.onFinal?.(transcript);
      } else {
        cb.onError?.('没听清刚才那句话，请靠近麦克风再试一次');
      }
    } catch (err: any) {
      if (!cancelled) cb.onError?.(err?.message || '语音转写失败');
    } finally {
      if (!cancelled) {
        cb.onTranscribing?.(false);
        cb.onEnd?.();
      }
    }
  };

  const autoStopTimer = window.setTimeout(() => {
    void stopRecordingAndTranscribe();
  }, MAX_RECORDING_MS);

  return {
    stop: () => {
      void stopRecordingAndTranscribe();
    },
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      window.clearTimeout(autoStopTimer);
      if (!stopped) {
        stopped = true;
        try { processor.disconnect(); source.disconnect(); } catch { /* ignore */ }
        stream.getTracks().forEach(track => track.stop());
        void audioCtx.close().catch(() => {});
        cb.onEnd?.();
      }
      // An already submitted provider request cannot be unbilled; ignore late results.
    },
  };
  } catch (error: any) {
    // getUserMedia may succeed even when AudioContext/ScriptProcessor fails.
    // Close every acquired resource, and always release the UI listening state.
    stream.getTracks().forEach(track => track.stop());
    if (contextToCleanup) await contextToCleanup.close().catch(() => {});
    cb.onError?.('麦克风音频初始化失败：' + (error?.message || error));
    cb.onEnd?.();
    return { stop: () => {}, cancel: () => {} };
  }
};

/**
 * Private-chat STT's internal audio companion. The transcript always comes
 * from speech recognition; this helper only keeps the matching recording.
 * MediaRecorder is preferred, with WebAudio PCM/WAV as a WebView fallback.
 * This is NOT a standalone audio-only message entry point.
 */
const capturePrivateChatSttAudio = async (cb: SttCallbacks): Promise<SttSession> => {
  if (!isAudioRecordingSupported()) {
    cb.onError?.('当前浏览器无法访问麦克风。请使用 HTTPS 页面、允许浏览器麦克风权限，或改用文字模拟语音');
    cb.onEnd?.();
    return { stop: () => {}, cancel: () => {} };
  }
  if (typeof MediaRecorder === 'undefined') {
    return startApiStt(null, 'zh-CN', null, cb);
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (error: any) {
    cb.onError?.(friendlyBrowserError(error?.name || error?.message || 'permission-denied', false));
    cb.onEnd?.();
    return { stop: () => {}, cancel: () => {} };
  }

  let recorder: MediaRecorder;
  try {
    const preferred = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
    const mimeType = preferred.find(type => {
      try { return MediaRecorder.isTypeSupported(type); } catch { return false; }
    });
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  } catch (error: any) {
    stream.getTracks().forEach(track => track.stop());
    cb.onError?.('当前设备录音初始化失败：' + (error?.message || '不支持音频编码'));
    cb.onEnd?.();
    return { stop: () => {}, cancel: () => {} };
  }

  let stopped = false;
  let cancelled = false;
  let ended = false;
  const chunks: Blob[] = [];
  const startedAt = Date.now();
  const cleanup = () => {
    window.clearTimeout(autoStopTimer);
    stream.getTracks().forEach(track => track.stop());
  };
  const finish = () => {
    if (ended) return;
    ended = true;
    cleanup();
    cb.onEnd?.();
  };
  recorder.ondataavailable = event => {
    if (!cancelled && event.data?.size) chunks.push(event.data);
  };
  recorder.onerror = () => {
    if (!cancelled) cb.onError?.('录音设备中断，请重新尝试');
    finish();
  };
  recorder.onstop = () => {
    if (!cancelled) {
      const blob = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || 'audio/webm' });
      const durationSec = Math.max(0, (Date.now() - startedAt) / 1000);
      if (blob.size && durationSec >= 0.2) cb.onAudioCaptured?.(blob, durationSec);
      else cb.onError?.('录音太短了，请说完再按停止');
    }
    finish();
  };
  const stopRecorder = () => {
    if (stopped) return;
    stopped = true;
    window.clearTimeout(autoStopTimer);
    if (recorder.state === 'inactive') finish();
    else {
      try { recorder.stop(); }
      catch (error: any) {
        if (!cancelled) cb.onError?.('录音结束失败：' + (error?.message || error));
        finish();
      }
    }
  };
  const autoStopTimer = window.setTimeout(stopRecorder, MAX_RECORDING_MS);
  try {
    recorder.start(250);
  } catch (error: any) {
    cb.onError?.('无法开始录音：' + (error?.message || error));
    finish();
    return { stop: () => {}, cancel: () => {} };
  }

  return {
    stop: stopRecorder,
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      chunks.length = 0;
      stopRecorder();
      // Revoke captured permission immediately; discard onstop results.
      cleanup();
      finish();
    },
  };
};

// No-response watchdog: domestic Android browsers (Via / Quark / UC / Baidu / WeChat X5)
// expose `webkitSpeechRecognition` on window, but the underlying Google speech service is
// unreachable or stripped from the WebView — `start()` silently hangs with zero events.
const SILENT_HANG_WATCHDOG_MS = 7000;

// A real microphone signal does not prove that a browser's remote recognition
// backend is responding. Keep a separate transcript watchdog and an upper bound.
const BROWSER_NO_TRANSCRIPT_TIMEOUT_MS = 15_000;
const BROWSER_MAX_SESSION_MS = 60_000;

const startWeb = (lang: string, cb: SttCallbacks, hasPaidConfigured: boolean): SttSession => {
  const Ctor = getWebCtor();
  if (!Ctor) {
    const hint = hasPaidConfigured
      ? '当前浏览器不支持自带语音识别，请在「通话偏好」或「设置 → 其他 API」切换为已配置的付费语音转文字'
      : '当前浏览器不支持自带语音识别，请使用手机输入法自带的麦克风，或配置语音识别 API';
    cb.onError?.(hint);
    cb.onEnd?.();
    return { stop: () => {}, cancel: () => {} };
  }

  let rec: any;
  try { rec = new Ctor(); }
  catch (cause: any) {
    cb.onError?.(friendlyBrowserError(cause?.message || 'start-failed', hasPaidConfigured));
    cb.onEnd?.();
    return { stop: () => {}, cancel: () => {} };
  }
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;

  let finalBuf = '';
  let lastEmitted = '';
  let gotAudioSignal = false;
  let gotAnyResult = false;
  let cancelled = false;
  let ended = false;
  let failureReported = false;
  let initialWatchdog: number | null = null;
  let transcriptWatchdog: number | null = null;
  let maxTimer: number | null = null;

  const clearTimers = () => {
    if (initialWatchdog !== null) window.clearTimeout(initialWatchdog);
    if (transcriptWatchdog !== null) window.clearTimeout(transcriptWatchdog);
    if (maxTimer !== null) window.clearTimeout(maxTimer);
    initialWatchdog = transcriptWatchdog = maxTimer = null;
  };
  const finish = () => {
    if (ended) return;
    ended = true;
    clearTimers();
    if (!cancelled && lastEmitted) cb.onFinal?.(lastEmitted);
    cb.onEnd?.();
  };
  const stopRecognizer = () => {
    if (ended) return;
    try { rec.stop(); } catch { finish(); }
  };
  const reportFailure = (message: string) => {
    if (cancelled || ended || failureReported) return;
    failureReported = true;
    cb.onError?.(message);
    stopRecognizer();
    // Some Android browser/WebViews never emit onend after stop().
    // Finish synchronously so the input cannot be stuck in transcribing.
    finish();
  };
  const startTranscriptWatchdog = () => {
    if (transcriptWatchdog !== null) window.clearTimeout(transcriptWatchdog);
    transcriptWatchdog = window.setTimeout(() => {
      if (!gotAnyResult) reportFailure(
        '麦克风已启动，但语音识别服务没有返回文字。请改用输入法麦克风，或在设置中选择已配置的语音识别服务',
      );
    }, BROWSER_NO_TRANSCRIPT_TIMEOUT_MS);
  };

  rec.onaudiostart = () => {
    if (cancelled || ended) return;
    gotAudioSignal = true;
    if (initialWatchdog !== null) { window.clearTimeout(initialWatchdog); initialWatchdog = null; }
    if (!gotAnyResult) startTranscriptWatchdog();
  };
  rec.onspeechstart = () => {
    if (cancelled || ended) return;
    gotAudioSignal = true;
    if (initialWatchdog !== null) { window.clearTimeout(initialWatchdog); initialWatchdog = null; }
    if (!gotAnyResult) startTranscriptWatchdog();
  };
  rec.onresult = (e: any) => {
    if (cancelled || ended) return;
    gotAnyResult = true;
    if (initialWatchdog !== null) { window.clearTimeout(initialWatchdog); initialWatchdog = null; }
    if (transcriptWatchdog !== null) { window.clearTimeout(transcriptWatchdog); transcriptWatchdog = null; }
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i];
      const part = result?.[0]?.transcript || '';
      if (result.isFinal) finalBuf += part;
      else interim += part;
    }
    const combined = (finalBuf + interim).trim();
    if (combined) {
      lastEmitted = combined;
      cb.onPartial?.(combined);
    }
  };
  rec.onerror = (event: any) => {
    if (cancelled || ended) return;
    if (event?.error === 'aborted') { finish(); return; }
    reportFailure(friendlyBrowserError(event?.error || event?.message || 'unknown', hasPaidConfigured));
  };
  rec.onend = finish;

  try { rec.start(); }
  catch (cause: any) {
    reportFailure(friendlyBrowserError(cause?.message || 'start-failed', hasPaidConfigured));
    return { stop: () => {}, cancel: () => {} };
  }
  // Recognizers can finish synchronously (e.g. a WebView refusing permission).
  if (!ended) {
    initialWatchdog = window.setTimeout(() => {
      if (!gotAudioSignal && !gotAnyResult) reportFailure(
        '浏览器语音识别没有响应。请改用手机输入法麦克风，或在设置中配置语音识别服务',
      );
    }, SILENT_HANG_WATCHDOG_MS);
    maxTimer = window.setTimeout(() => {
      if (!ended) stopRecognizer();
      // Real browsers can fail to fire onend even after an explicit stop.
      finish();
    }, BROWSER_MAX_SESSION_MS);
  }
  return {
    stop: () => {
      if (ended) return;
      stopRecognizer();
      // On Android the onend event is asynchronous; do not finalize before a
      // legitimate last speech result can arrive. Timeout protects stuck APIs.
      if (!ended) {
        if (initialWatchdog !== null) window.clearTimeout(initialWatchdog);
        if (transcriptWatchdog !== null) window.clearTimeout(transcriptWatchdog);
        if (maxTimer !== null) window.clearTimeout(maxTimer);
        initialWatchdog = transcriptWatchdog = null;
        maxTimer = window.setTimeout(finish, 1500);
      }
    },
    cancel: () => {
      if (ended) return;
      cancelled = true;
      try { rec.abort(); } catch { /* ignore */ }
      finish();
    },
  };
};
const startNative = async (lang: string, cb: SttCallbacks, hasPaidConfigured: boolean): Promise<SttSession> => {
  const { SpeechRecognition } = await import('@capacitor-community/speech-recognition');

  const perm = await SpeechRecognition.checkPermissions().catch(() => ({ speechRecognition: 'prompt' as const }));
  if (perm.speechRecognition !== 'granted') {
    const req = await SpeechRecognition.requestPermissions();
    if (req.speechRecognition !== 'granted') throw new Error('麦克风权限被拒绝');
  }

  let lastPartial = '';
  let ended = false;
  const handle = await SpeechRecognition.addListener('partialResults', (data: any) => {
    const m = data?.matches?.[0];
    if (m) { lastPartial = m; cb.onPartial?.(m); }
  });

  const finish = (finalText: string, errMsg?: string) => {
    if (ended) return;
    ended = true;
    handle.remove();
    if (errMsg) cb.onError?.(friendlyBrowserError(errMsg, hasPaidConfigured));
    else if (finalText) cb.onFinal?.(finalText);
    cb.onEnd?.();
  };

  SpeechRecognition.start({ language: lang, partialResults: true, popup: false, maxResults: 1 })
    .then((res: any) => finish((res?.matches?.[0] || lastPartial || '').trim()))
    .catch((e: any) => finish('', e?.message || 'native-error'));

  return {
    stop: () => { SpeechRecognition.stop().catch(() => { /* ignore */ }); },
    cancel: () => {
      if (ended) return;
      ended = true;
      void handle.remove();
      void SpeechRecognition.stop().catch(() => {});
      cb.onEnd?.();
    },
  };
};

/**
 * Private-chat real voice: retain the actual microphone recording AND a separate
 * SpeechRecognition transcript. The Call app's existing startStt is unchanged.
 *
 * Official ASR providers already save their *same* captured WAV via startApiStt.
 * Browser/native recognizers normally supply only text. On web browsers with
 * getUserMedia, this private-chat adapter captures the real audio alongside STT;
 * browser implementations may internally open a second microphone stream, which
 * cannot be avoided because Web Speech API does not accept MediaStream.
 *
 * One onEnd fires only after BOTH sources have stopped; sending earlier would
 * produce a text-only voice bar while a recording was still flushing.
 */
export const startPrivateChatStt = async (
  lang: string,
  cb: SttCallbacks,
  config?: Partial<APIConfig> | null,
): Promise<SttSession> => {
  if (resolveSttProvider(config) !== 'browser' ||
      !isBrowserSttSupported() || !isAudioRecordingSupported()) {
    return startStt(lang, cb, config);
  }

  let cancelled = false;
  let finished = false;
  let recognitionEnded = false;
  let recordingEnded = false;
  let recordingFailed = false;
  let stopCaptureWhenReady = false;
  let stopRecognitionWhenReady = false;
  let recognizer: SttSession | null = null;
  let recorder: SttSession | null = null;
  const finish = () => {
    if (finished || !recognitionEnded || !recordingEnded) return;
    finished = true;
    if (!cancelled) cb.onEnd?.();
  };
  const stopRecorder = () => {
    if (recorder) recorder.stop();
    else stopCaptureWhenReady = true;
  };
  const stopRecognizer = () => {
    if (recognizer) recognizer.stop();
    else stopRecognitionWhenReady = true;
  };

  // Both initializers start within the direct microphone-button action.
  // Neither reads or writes the other's transcript or audio.
  const recognizePromise = startStt(lang, {
    ...cb,
    onEnd: () => {
      recognitionEnded = true;
      stopRecorder();
      finish();
    },
  }, config);
  const recordingPromise = capturePrivateChatSttAudio({
    onAudioCaptured: (blob, durationSec) => {
      if (!cancelled) cb.onAudioCaptured?.(blob, durationSec);
    },
    onError: message => {
      recordingFailed = true;
      if (!cancelled) cb.onError?.(`原声保存不可用（仍可转写文字）：${message}`);
    },
    onEnd: () => {
      recordingEnded = true;
      // The 60s recording limit should also stop the recognizer.
      // An unavailable recorder must NOT cancel a perfectly valid transcript.
      if (!recordingFailed && !recognitionEnded) stopRecognizer();
      finish();
    },
  });
  try {
    [recognizer, recorder] = await Promise.all([recognizePromise, recordingPromise]);
    if (cancelled) {
      recognizer.cancel();
      recorder.cancel();
    } else {
      if (stopCaptureWhenReady) recorder.stop();
      if (stopRecognitionWhenReady) recognizer.stop();
    }
  } catch (error) {
    cancelled = true;
    recognizer?.cancel();
    recorder?.cancel();
    throw error;
  }
  return {
    stop: () => {
      if (cancelled || finished) return;
      stopRecognizer();
      stopRecorder();
    },
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      recognizer?.cancel();
      recorder?.cancel();
      // An in-flight getUserMedia permission dialog can resolve later.
      // The completion branch above will cancel that session immediately.
      finished = true;
    },
  };
};

/**
 * Start a speech-to-text session using the resolved provider (`minimax`, `fishaudio`, `elevenlabs`, or `browser`).
 */
export const startStt = async (
  lang: string,
  cb: SttCallbacks,
  apiConfig?: Partial<APIConfig> | null,
): Promise<SttSession> => {
  const language = lang || 'zh-CN';
  const provider = resolveSttProvider(apiConfig);
  if (provider === 'minimax' || provider === 'fishaudio' || provider === 'elevenlabs') {
    return startApiStt(provider, language, apiConfig, cb);
  }
  const hasPaid = hasAnyApiSttConfigured(apiConfig);
  if (isNative()) return startNative(language, cb, hasPaid);
  return startWeb(language, cb, hasPaid);
};
