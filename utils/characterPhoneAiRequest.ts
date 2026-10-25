import { KeepAlive } from './keepAlive';
import { safeResponseJson } from './safeApi';

/**
 * Shared transport for the character-owned phone. Keep prompts, models, JSON
 * contracts and persistence in their existing callers; this only handles the
 * network lifecycle. A generation is never automatically retried because its
 * upstream may still charge after a timeout.
 */
export const CHARACTER_PHONE_AI_TIMEOUT_MS = 150_000;
export const PHONE_AUTO_FAILURE_COOLDOWN_MS = 20 * 60_000;
const STORAGE_PREFIX = 'sully_phone_ai_auto_failure_until_v1:';
const fallbackCooldowns = new Map<string, number>();

type PhoneRequestOptions = {
  charId: string;
  purpose: string;
  automatic?: boolean;
};
type RequestWithMeta = RequestInit & {
  __sullyMeta?: { appName: string; charId: string; purpose: string };
};

function cooldownKey(charId: string, url: string): string {
  let origin = url;
  try { origin = new URL(url).origin; } catch { /* use original URL */ }
  return STORAGE_PREFIX + charId + ':' + origin;
}

function cooldownUntil(key: string): number {
  try {
    const value = sessionStorage.getItem(key);
    if (value !== null) return Number(value) || 0;
  } catch { /* no session storage */ }
  return fallbackCooldowns.get(key) || 0;
}

function setCooldown(key: string, until: number): void {
  fallbackCooldowns.set(key, until);
  try {
    if (until > 0) sessionStorage.setItem(key, String(until));
    else sessionStorage.removeItem(key);
  } catch { /* retain in-memory value */ }
}

/** Background-only outage guard: manual generation remains available. */
export function canRunAutomaticPhoneAi(charId: string, url: string, now = Date.now()): boolean {
  return now >= cooldownUntil(cooldownKey(charId, url));
}

function isTransientFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { name?: string; message?: string };
  return value.name === 'TimeoutError' || value.name === 'TypeError'
    || /timed?\s?out|failed to fetch|networkerror|load failed/i.test(value.message || '');
}

function shouldPauseForStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/**
 * Fetch + read the full response while the SW/update protection is active.
 * The 150s deadline covers both headers and the response body. Do not retry
 * or silently switch provider/model. Existing callers validate their JSON.
 */
export async function fetchCharacterPhoneJson(
  url: string,
  init: RequestInit,
  options: PhoneRequestOptions,
): Promise<{ response: Response; json: any }> {
  const key = cooldownKey(options.charId, url);
  if (options.automatic && !canRunAutomaticPhoneAi(options.charId, url)) {
    throw new Error('查手机后台 API 暂时冷却中');
  }
  const deadline = AbortSignal.timeout(CHARACTER_PHONE_AI_TIMEOUT_MS);
  const signal = init.signal
    ? (typeof AbortSignal.any === 'function' ? AbortSignal.any([init.signal, deadline]) : deadline)
    : deadline;
  const requestOptions: RequestWithMeta = {
    ...init,
    signal,
    __sullyMeta: { appName: '查手机', charId: options.charId, purpose: options.purpose },
  };
  await KeepAlive.start();
  try {
    const response = await fetch(url, requestOptions);
    if (options.automatic && shouldPauseForStatus(response.status)) {
      setCooldown(key, Date.now() + PHONE_AUTO_FAILURE_COOLDOWN_MS);
    }
    const json = await safeResponseJson(response);
    if (response.ok) setCooldown(key, 0);
    return { response, json };
  } catch (error) {
    if (options.automatic && isTransientFailure(error)) {
      setCooldown(key, Date.now() + PHONE_AUTO_FAILURE_COOLDOWN_MS);
    }
    throw error;
  } finally {
    KeepAlive.stop();
  }
}
