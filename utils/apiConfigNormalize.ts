import type { APIConfig, ApiPreset } from '../types';

// Clipboard contents can carry zero-width characters that String.trim() does not
// remove. They are never valid at the edges of an API URL, token, or model id.
const EDGE_INVISIBLE_CHARS = /^[\s\u200B-\u200D\u2060\uFEFF]+|[\s\u200B-\u200D\u2060\uFEFF]+$/g;

const cleanEdgeCharacters = (value: unknown): string =>
  String(value ?? '').replace(EDGE_INVISIBLE_CHARS, '');

export const normalizeApiBaseUrl = (value: unknown): string =>
  cleanEdgeCharacters(value).replace(/\/+$/, '');

export const normalizeApiCredential = (value: unknown): string =>
  cleanEdgeCharacters(value);

export const normalizeApiModel = (value: unknown): string =>
  cleanEdgeCharacters(value);

export function normalizeApiConfig(config: APIConfig): APIConfig {
  const visionApi = config.visionApi;
  return {
    ...config,
    baseUrl: normalizeApiBaseUrl(config.baseUrl),
    apiKey: normalizeApiCredential(config.apiKey),
    model: normalizeApiModel(config.model),
    ...(visionApi ? {
      visionApi: {
        enabled: visionApi.enabled === true,
        baseUrl: normalizeApiBaseUrl(visionApi.baseUrl),
        apiKey: normalizeApiCredential(visionApi.apiKey),
        model: normalizeApiModel(visionApi.model),
      },
    } : {}),
  };
}

export function normalizeApiPreset(preset: ApiPreset): ApiPreset {
  return {
    ...preset,
    name: String(preset.name ?? '').trim(),
    config: normalizeApiConfig(preset.config),
  };
}

/**
 * Imported backups may contain v1 presets, incomplete drafts, duplicates, or
 * malformed entries from third-party exports. Keep usable records in order;
 * never let one bad item abort the entire restore or crash the floating menu.
 * Incomplete endpoints remain visible but cannot be activated until repaired.
 */
export function normalizeApiPresets(value: unknown): ApiPreset[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: ApiPreset[] = [];
  for (let index = 0; index < value.length; index++) {
    const raw = value[index];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    if (!item.config || typeof item.config !== 'object' || Array.isArray(item.config)) continue;
    const source = item.config as Record<string, unknown>;
    // Malformed value types should not become bogus "[object Object]" URLs/keys.
    const config = {
      ...source,
      baseUrl: typeof source.baseUrl === 'string' ? source.baseUrl : '',
      apiKey: typeof source.apiKey === 'string' ? source.apiKey : '',
      model: typeof source.model === 'string' ? source.model : '',
    } as APIConfig;
    const originalId = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : 'imported-preset-' + (index + 1);
    let id = originalId;
    if (seen.has(id)) {
      id = originalId + '-import-' + (index + 1);
      while (seen.has(id)) id += '-copy';
    }
    seen.add(id);
    const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : '未命名预设 ' + (index + 1);
    result.push(normalizeApiPreset({
      id, name, config,
      ...(typeof item.group === 'string' ? { group: item.group.trim() } : {}),
    }));
  }
  return result;
}
