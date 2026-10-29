import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The checked-in SW JS is the deployed PWA runtime; edits in the TS source
// alone cannot protect browser delivery. Preserve metadata-only chunk fields
// in BOTH files, so the inbox's multi-part ordering guard can read them.
describe('Web Push multipart metadata source-to-published parity', () => {
  const source = readFileSync(resolve(process.cwd(), 'worker/sw-keep-alive.ts'), 'utf8');
  const published = readFileSync(resolve(process.cwd(), 'public/sw-keep-alive.js'), 'utf8');

  it('never overwrites the original metadata with absent top-level aliases', () => {
    for (const [key, runtime] of [['source', source], ['published', published]] as const) {
      for (const field of ['sessionId', 'messageIndex', 'totalMessages']) {
        const absent = key === 'source' ? 'undefined' : 'void 0';
        const expected = '...(payload?.' + field + ' !== ' + absent
          + ' ? { ' + field + ': payload.' + field + ' } : {})';
        expect(runtime, 'Missing ' + field + ' fallback in ' + key + ' worker')
          .toContain(expected);
      }
    }
  });
});
