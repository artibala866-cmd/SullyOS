import { describe, expect, it } from 'vitest';
import { findPendingRealPersonUserTurn, buildRealPersonTurnFocusHint } from './realPersonReplyTurn';
import { findPendingUserTurn } from './chatContinuation';
const say=(id:number)=>({id,role:'user',type:'text'});
const proactive=(id:number)=>({id,role:'assistant',type:'text',metadata:{activeMsg2:{taskId:'scheduled'}}});
describe('only an actual user statement triggers real-person replies',()=>{
  it('ignores system cards and scheduled messages while preserving the latest unanswered user turn',()=>{
    const history=[say(1),proactive(2),{id:3,role:'user',type:'system',metadata:{musicListenInvite:true}}];
    expect(findPendingRealPersonUserTurn(history)?.id).toBe(1);
    // Music invitation immediate responder still sees its own system message;
    // do not modify the shared helper or change music semantics.
    expect(findPendingUserTurn(history)?.id).toBe(3);
  });
  it('does not reply to character blocked sends or unrelated app events',()=>{
    expect(findPendingRealPersonUserTurn([{...say(1),metadata:{chatBlockRejected:true}}])).toBeNull();
    expect(findPendingRealPersonUserTurn([{id:2,role:'user',type:'system'}])).toBeNull();
    expect(findPendingRealPersonUserTurn([{...say(1)}, {id:2,role:'assistant',type:'system'}])?.id).toBe(1);
  });
  it('imported history cannot silently generate new paid replies',()=>{
    expect(findPendingRealPersonUserTurn([{...say(1),metadata:{historyImported:true}}])).toBeNull();
    expect(findPendingRealPersonUserTurn([{...say(1),metadata:{importedFrom:'backup'}}])).toBeNull();
    expect(findPendingRealPersonUserTurn([{...say(1),metadata:{historyImported:true}},say(2)])?.id).toBe(2);
  });
  it('focuses on the complete actual user batch instead of a new greeting or life report',()=>{
    const focus=buildRealPersonTurnFocusHint([
      say(1), say(2), proactive(3),
    ],2);
    expect(focus).toContain('连续发送了 2 条消息');
    expect(focus).toContain('不要突然改成问候');
    expect(focus).toContain('不能拿它们当作另起话题的任务');
    expect(focus).toContain('\n');
    expect(focus).not.toContain('\\\\n');
    expect(buildRealPersonTurnFocusHint([say(1),say(2)],1)).toBe('');
  });
  it('separates a later user topic from an earlier message across AMSG or a long gap',()=>{
    expect(buildRealPersonTurnFocusHint([say(1),proactive(2),say(3)],3))
      .toContain('刚发了一条新消息');
    expect(buildRealPersonTurnFocusHint([
      {...say(1),timestamp:1000},{...say(2),timestamp:1000+120_000},
    ],2)).toContain('刚发了一条新消息');
    expect(buildRealPersonTurnFocusHint([
      {...say(1),timestamp:1000},{...say(2),timestamp:1000+20_000},
    ],2)).toContain('连续发送了 2 条消息');
  });
  it('refuses to focus on already answered, imported, music or app-origin turns',()=>{
    expect(buildRealPersonTurnFocusHint([say(1),{id:2,role:'assistant',type:'text'}],1)).toBe('');
    expect(buildRealPersonTurnFocusHint([{...say(1),metadata:{historyImported:true}}],1)).toBe('');
    expect(buildRealPersonTurnFocusHint([{id:1,role:'user',type:'system',metadata:{musicListenInvite:true}}],1)).toBe('');
    expect(buildRealPersonTurnFocusHint([say(1)],1)).toContain('刚发了一条新消息');
  });
  it('resolves once the character actually replies; proactive pushes do not count',()=>{
    expect(findPendingRealPersonUserTurn([say(1),proactive(2)])?.id).toBe(1);
    expect(findPendingRealPersonUserTurn([say(1),proactive(2),{id:3,role:'assistant',type:'text'}])).toBeNull();
    expect(findPendingRealPersonUserTurn([say(1),proactive(2),say(4)])?.id).toBe(4);
  });
});
