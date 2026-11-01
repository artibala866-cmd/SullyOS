import { describe, it, expect } from 'vitest';
import { deriveRecentTrackSwitchForChar } from './chatRequestPayload';
import type { RecentTrackChange } from '../context/MusicContext';

const record = (overrides: Partial<RecentTrackChange> = {}): RecentTrackChange => ({
    previousSong: { id: 1, name: '起风了', artists: '买辣椒也用券' },
    charIds: ['char-1'],
    at: Date.now(),
    ...overrides,
});

describe('deriveRecentTrackSwitchForChar 换歌察觉判定', () => {
    it('换歌那刻在一起听名单里、未重新加入、刚发生 → 命中，返回上一首信息', () => {
        expect(deriveRecentTrackSwitchForChar(record(), 'char-1', false)).toEqual({
            songName: '起风了',
            artists: '买辣椒也用券',
        });
    });

    it('没有换歌记录 → null', () => {
        expect(deriveRecentTrackSwitchForChar(null, 'char-1', false)).toBeNull();
        expect(deriveRecentTrackSwitchForChar(undefined, 'char-1', false)).toBeNull();
    });

    it('char 已重新加入一起听 → 不再提示', () => {
        expect(deriveRecentTrackSwitchForChar(record(), 'char-1', true)).toBeNull();
    });

    it('换歌那刻 char 不在一起听名单里 → 与它无关，不提示', () => {
        expect(deriveRecentTrackSwitchForChar(record(), 'char-2', false)).toBeNull();
    });

    it('换歌已过去太久（超过新鲜窗口）→ 不再提示', () => {
        const stale = record({ at: Date.now() - 11 * 60 * 1000 });
        expect(deriveRecentTrackSwitchForChar(stale, 'char-1', false)).toBeNull();
    });
});


describe('一起听会话与实际播放器状态解耦', () => {
    it('暂停、空曲目与尚未播放不让角色误以为退出会话', async () => {
        const { deriveListeningFromSnapshot } = await import('./chatRequestPayload');
        const snapshot = { current: null, playing: false, lyric: [], activeLyricIdx: -1,
            listeningTogetherWith: ['char-1'], cfg: {} } as any;
        expect(deriveListeningFromSnapshot(snapshot, 'char-1').isListeningTogether).toBe(true);
        expect(deriveListeningFromSnapshot(snapshot, 'char-2').isListeningTogether).toBe(false);
        const selected = { ...snapshot, current: { id: 8, name: '歌曲', artists: '歌手' } };
        expect(deriveListeningFromSnapshot(selected, 'char-1').isListeningTogether).toBe(true);
        expect(deriveListeningFromSnapshot(selected, 'char-1').userListeningContext).toBeNull();
    });
});
