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
    it('keeps real gossip as the final subject after home-phone life context, without re-opening greetings',async()=>{
        const data=input();
        data.historyMsgs=[
            {id:11,charId:'focus-char',role:'user',type:'text',content:'我同学又跟前任复合了',timestamp:Date.now()-75_000},
            {id:12,charId:'focus-char',role:'assistant',type:'text',content:'她上次不是说彻底分了吗',timestamp:Date.now()-45_000},
            {id:13,charId:'focus-char',role:'user',type:'text',content:'对啊，她居然又去找他了',timestamp:Date.now()-1000},
            {id:14,charId:'focus-char',role:'assistant',type:'text',content:'刚才在看手机',timestamp:Date.now(),
                metadata:{activeMsg2:{taskId:'autowake:day'}}},
        ] as any;
        const phone='【家园手机聊天】角色现在在家里刷手机。';
        for(const timelyByWorker of [false,true]){
            const result=await buildChatRequestPayload({...data,homePhoneContext:phone,
                automaticUserReply:true,expectedAutoReplyUserId:13,timelyByWorker});
            const tail=String(result.fullMessages[result.volatileTailIndex].content);
            expect(tail).toContain(phone);
            expect(tail).toContain('topicMove=continue');
            expect(tail).toContain('刚发了一条新消息');
            expect(tail.lastIndexOf('【本轮是真实用户消息触发的接话'))
                .toBeGreaterThan(tail.lastIndexOf(phone));
            expect(tail).toContain('不能拿它们当作另起话题的任务');
        }
    });

    it('user topic closure stays closed even if optional phone context is present',async()=>{
        const data=input();
        data.historyMsgs=[
            {id:21,charId:'focus-char',role:'user',type:'text',content:'她又跟前任吵架了',timestamp:Date.now()-75_000},
            {id:22,charId:'focus-char',role:'assistant',type:'text',content:'她怎么说的',timestamp:Date.now()-50_000},
            {id:23,charId:'focus-char',role:'user',type:'text',content:'算了先不聊这个了',timestamp:Date.now()},
        ] as any;
        const payload=await buildChatRequestPayload({...data,
            automaticUserReply:true,expectedAutoReplyUserId:23,
            homePhoneContext:'【查手机】今天有新动态，但与当前话题无关。'});
        const tail=String(payload.fullMessages[payload.volatileTailIndex].content);
        expect(tail).toContain('topicMove=close');
        expect(tail).toContain('Do not append a question');
        expect(tail.lastIndexOf('topicMove=close'))
            .toBeGreaterThan(tail.lastIndexOf('【查手机】'));
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
