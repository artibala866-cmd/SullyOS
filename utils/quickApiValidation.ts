import type { APIConfig } from '../types';
import { normalizeApiBaseUrl, normalizeApiCredential, normalizeApiModel } from './apiConfigNormalize';

export type QuickApiFields = Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>;

/**
 * Check complete endpoint configurations before making a one-tap switch.
 * Keyless compatible proxies are valid; no request is sent and no provider is silently substituted.
 */
export function quickApiConfigurationIssue(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '预设配置已损坏，请重新保存';
  const config = value as Partial<QuickApiFields>;
  const baseUrl = normalizeApiBaseUrl(config.baseUrl);
  const model = normalizeApiModel(config.model);
  if (!baseUrl) return '缺少 API 地址';
  let parsed: URL;
  try { parsed = new URL(baseUrl); } catch { return 'API 地址无效'; }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
    return 'API 地址必须是有效的 HTTP(S) 地址（不能包含账号密码）';
  }
  if (!model) return '缺少模型名称';
  return null;
}

export function normalizedQuickApiFields(value: QuickApiFields): QuickApiFields {
  return {
    baseUrl: normalizeApiBaseUrl(value.baseUrl),
    apiKey: normalizeApiCredential(value.apiKey),
    model: normalizeApiModel(value.model),
  };
}
