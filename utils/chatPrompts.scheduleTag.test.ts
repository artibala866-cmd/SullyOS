import { describe, it, expect } from 'vitest';
import { ChatPrompts } from './chatPrompts';

const char = { id: 'char-sched', name: '阿一' } as any;
// 开着主动消息 2.0 的角色。判据与 worker 侧 fire_pack 的 selfScheduleEnabled 同源
// （isAmsg2EnabledForChar：activeMsg2Config.enabled === true 才算开）。
const charWithAmsg2 = { id: 'char-sched-amsg2', name: '阿一', activeMsg2Config: { enabled: true } } as any;
const userProfile = { name: '小明' } as any;

const buildStable = async (
    promptOptions?: { forFirePack?: boolean; timelyByWorker?: boolean },
    targetChar: any = char,
) => {
    const parts = await ChatPrompts.buildSystemPromptParts(
        targetChar, userProfile, [], [], [], [],
        undefined, undefined, undefined, undefined, undefined, undefined,
        promptOptions,
    );
    return parts.stable;
};

describe('retired local schedule tags', () => {
    for (const [label, options, target] of [
        ['local', undefined, char],
        ['local with AMSG2', undefined, charWithAmsg2],
        ['fire pack', {forFirePack: true}, charWithAmsg2],
        ['instant with AMSG2', {timelyByWorker: true}, charWithAmsg2],
        ['instant without scheduling', {timelyByWorker: true}, char],
    ] as const) {
        it(`never teaches 1.0 in ${label}, preserving normal actions`, async () => {
            const stable = await buildStable(options, target);
            expect(stable).not.toContain('schedule_message');
            expect(stable).toContain('[[ACTION:POKE]]');
            expect(stable).toContain('[[ACTION:ADD_EVENT');
        });
    }
});
