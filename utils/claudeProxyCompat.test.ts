import { describe, expect, it } from 'vitest';
import {
  buildClaudeProxyCompatibilityBody,
  shouldRetryClaudeProxyCompatibility,
} from './claudeProxyCompat';

const body = {
  model: '[千岛-AWS]claude-opus-4-6',
  messages: [
    { role: 'system', content: 'stable' },
    { role: 'user', content: 'hello' },
    { role: 'system', content: 'timely' },
  ],
  tools: [{ type: 'function', function: { name: 'schedule_active_message' } }],
  thinking: { type: 'enabled', budget_tokens: 4000 },
  reasoning_effort: 'medium',
  extra_body: { thinking: { type: 'enabled', budget_tokens: 4000 } },
};

describe('Claude relay compatibility retry', () => {
  it('does not automatically repay ambiguous 502, network, 401/403 or generic 400', () => {
    expect(shouldRetryClaudeProxyCompatibility(new Error('API Error 502: bad_response_status_code'), body)).toBe(false);
    expect(shouldRetryClaudeProxyCompatibility(new TypeError('Failed to fetch'), body)).toBe(false);
    expect(shouldRetryClaudeProxyCompatibility(new Error('API Error 401: bad key'), body)).toBe(false);
    expect(shouldRetryClaudeProxyCompatibility(new Error('API Error 403: forbidden'), body)).toBe(false);
    expect(shouldRetryClaudeProxyCompatibility(new Error('API Error 400: bad request'), body)).toBe(false);
  });

  it('only permits one compatibility fallback for an explicit unbilled validation error', () => {
    expect(shouldRetryClaudeProxyCompatibility(
      new Error('API Error 400: unsupported thinking with tools'), body,
    )).toBe(true);
    expect(shouldRetryClaudeProxyCompatibility(
      new Error('API Error 422: invalid reasoning_effort'), body,
    )).toBe(true);
    expect(shouldRetryClaudeProxyCompatibility(
      new Error('API Error 400: unsupported thinking with tools'), { ...body, tools: [] },
    )).toBe(false);
  });

  it('merges system messages and strips thinking dialects without dropping tools', () => {
    const fallback = buildClaudeProxyCompatibilityBody(body);
    expect(fallback.messages).toEqual([
      { role: 'system', content: 'stable\n\ntimely' },
      { role: 'user', content: 'hello' },
    ]);
    expect(fallback.tools).toEqual(body.tools);
    expect(fallback).not.toHaveProperty('thinking');
    expect(fallback).not.toHaveProperty('reasoning_effort');
    expect(fallback).not.toHaveProperty('extra_body');
  });
});
