/**
 * Resilient anonymous-source behavior. These endpoints are third-party and can
 * intermittently return HTTP 200 with an API-expired/error payload.
 * Do not treat a provider outage as a copyright/account verdict.
 */
export const GD_BITRATE: Record<string, string> = {
  standard: '128', higher: '192', exhigh: '320', lossless: '740', hires: '999',
};
export const gdMusicBitrate = (quality: string): string => GD_BITRATE[quality] || '128';

export const guestMusicErrorText = (value: unknown): string => {
  if (!value || typeof value !== 'object') return '';
  const obj = value as Record<string, any>;
  return [obj.message, obj.msg, obj.error, obj.errmsg, obj.reason, obj.data?.message, obj.data?.msg]
    .filter(v => typeof v === 'string').join(' ').slice(0, 240);
};

export const guestMusicIsTransient = (error: unknown): boolean => {
  const record = error && typeof error === 'object' && !(error instanceof Error)
    ? error as Record<string, any> : null;
  const status = Number(record?.code ?? record?.status ?? record?.data?.code);
  // The provider often reports HTTP 200 with an inner 401/403/404. Retrying
  // forbidden/missing resources just burns the rate limit and hides the cause.
  if (Number.isInteger(status) && status >= 400 && status < 500 &&
      status !== 408 && status !== 429) return false;
  if (Number.isInteger(status) && (status === 429 || status >= 500 && status < 600)) return true;
  const str = typeof error === 'string' ? error : error instanceof Error ? error.message : guestMusicErrorText(error);
  const httpStatus = /\bHTTP\s*(4\d\d)\b/i.exec(str);
  if (httpStatus && ![408, 429].includes(Number(httpStatus[1]))) return false;
  return /(?:\b429\b|\b5(?:00|01|02|03|04)\b|timeout|temporar|network|fetch|abort|频繁|限流|超时|网络|暂时|稍后|失效|过期|重试|维护|接口(?:维护|故障|超时)|api\s*(?:fail|expired|error))/i.test(str);
};

/** Retry only *fast* transient errors: do not double a 6-second timeout. */
export const retryGuestMusicOnce = async <T>(
  request: () => Promise<T>, isGood: (v: T) => boolean,
  getError: (v: T) => unknown = value => value,
): Promise<T> => {
  let first: T;
  try { first = await request(); }
  catch (err) {
    if (!guestMusicIsTransient(err) || /(?:timeout|超时|abort)/i.test(String(err))) throw err;
    return request();
  }
  if (isGood(first)) return first;
  if (!guestMusicIsTransient(getError(first))) return first;
  return request();
};

export const actualMusicQualityLabel = (
  source: 'netease' | 'tencent' | 'local',
  bitrate: unknown,
  provider?: string,
): string => {
  if (source === 'local') return '本地文件 · 未检测音质';
  const br = Number(bitrate);
  if (!Number.isFinite(br) || br <= 0) return source === 'tencent'
    ? 'QQ 音源 · 实际音质未知' : '音源已获取 · 实际音质未知';
  // GD Studio reports 740/999 as quality tiers, not an actual kbps reading.
  if (provider === 'gdstudio' && br === 740) return '来源返回：无损档位（未验证）';
  if (provider === 'gdstudio' && br === 999) return '来源返回：高解析档位（未验证）';
  if (br >= 10000) return `来源返回：${Math.round(br / 1000)} kbps`;
  return `来源返回：${br} kbps`;
};
