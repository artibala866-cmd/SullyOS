import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import { attachUserVoiceAudio, describeUserVoice, makeUserVoiceMetadata } from './userVoiceMessage';
import { collectBlobRefs, readBlobsIndex, restoreBlobsFromZip, writeBlobsToZip } from './backupBlobs';
import { normalizeMessageContent } from './messageFormat';
import { buildReplySnapshotContent } from './applyAssistantPostProcessing';

const ref = 'blobref:b_voice_saved_123';
const msg = (content: string, metadata: any): Message => ({
  id: 12, role: 'user', charId: 'alice', type: 'voice', timestamp: 1000, content, metadata,
});

describe('durable user-recorded audio', () => {
  it('only a real persisted BlobRef makes a user voice playable', () => {
    const base = makeUserVoiceMetadata('你好', 'recorded');
    expect(base.hasAudio).toBe(false);
    const recorded = attachUserVoiceAudio(base, ref, 2.3);
    expect(recorded).toMatchObject({ hasAudio: true, audioRef: ref, durationSec: 3 });
    expect(describeUserVoice(msg('你好', recorded)).audioRef).toBe(ref);
    expect(() => attachUserVoiceAudio(base, 'blob:temporary', 2)).toThrow();
    expect(() => attachUserVoiceAudio(makeUserVoiceMetadata('打字', 'typed'), ref, 3)).toThrow();
    expect(() => attachUserVoiceAudio(base, ref, 0)).toThrow();
  });

  it('keeps text searchable and safe to quote without exposing storage tokens', () => {
    const metadata = attachUserVoiceAudio(makeUserVoiceMetadata('刚画完一张稿', 'recorded'), ref, 3);
    const voice = msg('刚画完一张稿', metadata);
    expect(normalizeMessageContent(voice, 'Char', 'User')).toContain('刚画完一张稿');
    expect(normalizeMessageContent(voice, 'Char', 'User')).not.toContain(ref);
    expect(buildReplySnapshotContent(voice)).toBe('[语音] 刚画完一张稿');
    expect(JSON.stringify(voice)).toContain(ref); // GC and ZIP export discover audio reference from messages
  });

  it('v3 full backup contains and restores real WAV audio with identical reference', async () => {
    const original = new Blob([new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4])], { type: 'audio/wav' });
    const voice = msg('早上好', attachUserVoiceAudio(makeUserVoiceMetadata('早上好', 'recorded'), ref, 1.5));
    const tokens = new Set<string>();
    collectBlobRefs(JSON.stringify({ messages: [voice] }), tokens);
    expect([...tokens]).toContain(ref);

    const files = new Map<string, string | Uint8Array>();
    const zip = {
      file(path: string, contents?: string | Uint8Array) {
        if (contents !== undefined) { files.set(path, contents); return this; }
        if (!files.has(path)) return null;
        return {
          async: async (kind: string) => {
            const entry = files.get(path)!;
            if (kind === 'string') return String(entry);
            return entry instanceof Uint8Array ? entry : new TextEncoder().encode(entry);
          },
        };
      },
    } as any;
    expect(await writeBlobsToZip(zip, tokens, async token => token === ref ? original : null))
      .toMatchObject({ written: 1, missing: [] });
    const index = await readBlobsIndex(zip);
    expect(index).toEqual([{ id: 'b_voice_saved_123', type: 'audio/wav', size: original.size }]);
    const restored = new Map<string, Blob>();
    expect(await restoreBlobsFromZip(zip, index, async (token, blob) => { restored.set(token, blob); })).toBe(1);
    expect(restored.get(ref)?.type).toBe('audio/wav');
    expect(Array.from(new Uint8Array(await restored.get(ref)!.arrayBuffer())))
      .toEqual(Array.from(new Uint8Array(await original.arrayBuffer())));
    expect(describeUserVoice(voice).audioRef).toBe(ref);
  });
});
