// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { buildChatRequestPayload, type BuildChatPayloadInput } from './chatRequestPayload';

const input = (): BuildChatPayloadInput => ({
    char: { id: 'focus-char', name: '阿一', timeAwarenessEnabled: false } as any,
    userProfile: { name: '用户' } as any,
    groups: [], emojis: [], categories: [],
    historyMsgs: [
        { id:1, charId:'focus-char', role:'user', type:'text',
            content:'我刚说的画稿还没改完', timestamp:Date.now()-2000 },
        { id:2, charId:'focus-char', role:'user', type:'text',
            content:'还卡在线稿这里', timestamp:Date.now() },
    ] as any,
    contextLimit: 20,
    realtimeConfig: {weatherEnabled:false,newsEnabled:false} as any,
});
const textOf=(result:Awaited<ReturnType<typeof buildChatRequestPayload>>):string =>
    result.fullMessages.map(m=>String(m.content)).join('\n');

describe('real-person auto response focus uses the existing payload, not a separate generator',()=>{
    it('replies to an actual consecutive user turn in both local and cloud instant chat',async()=>{
        const base=input();
        for (const timelyByWorker of [false,true]){
            const result=await buildChatRequestPayload({
                ...base,automaticUserReply:true,expectedAutoReplyUserId:2,timelyByWorker,
            });
            const content=textOf(result);
            expect(content).toContain('连续发送了 2 条消息');
            expect(content).toContain('先回应对方正在讨论');
            expect(content).toContain('Existing M3 conversation state');
            expect(content).toContain('topicMove=continue');
            expect(content).toContain('No output length, bubble count');
            expect(content).toContain('自己的生活与观察可以有，但必须自然关联');
            expect(content).not.toContain('2. **行为模式**: 不要总是围绕用户转');
        }
    });
    it('does not change manual chat or provide a fake focus for an unverified turn',async()=>{
        const base=input();
        const manual=textOf(await buildChatRequestPayload(base));
        expect(manual).not.toContain('【本轮是真实用户消息触发的接话');
        expect(manual).not.toContain('Existing M3 conversation state');
        expect(manual).toContain('2. **行为模式**: 不要总是围绕用户转');
        const mismatched=textOf(await buildChatRequestPayload({
            ...base,automaticUserReply:true,expectedAutoReplyUserId:999,
        }));
        expect(mismatched).not.toContain('【本轮是真实用户消息触发的接话');
        expect(mismatched).not.toContain('Existing M3 conversation state');
    });
});
