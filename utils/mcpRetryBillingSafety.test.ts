import { describe, expect, it } from 'vitest';
import { shouldRetryMcpWithoutTools } from './mcpToolBridge';

describe('MCP paid request retry safety', () => {
    it.each([
        'API Error 401: Invalid token',
        'API Error 403: Permission denied',
        'API Error 400: Bad Request',
        'API Error 500: tools failed upstream',
        'API Error 502: Bad Gateway',
        'API Error 422: Invalid parameter',
        'Failed to fetch',
        'NetworkError when attempting to fetch resource',
        'timeout',
    ])('never submits a second billable request for %s', message => {
        expect(shouldRetryMcpWithoutTools(new Error(message))).toBe(false);
    });

    it('only allows a compatibility fallback when the provider explicitly rejects tools in 400/422', () => {
        expect(shouldRetryMcpWithoutTools(new Error('API Error 400: unsupported tools'))).toBe(true);
        expect(shouldRetryMcpWithoutTools(new Error('API Error 422: function_calling 不支持'))).toBe(true);
    });
});
