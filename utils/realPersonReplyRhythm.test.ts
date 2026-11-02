import { describe, expect, it } from 'vitest';
import { resolveRealPersonAttention } from './realPersonReplyRhythm';

const at = 1_800_000_000_000;
const user = (timestamp:number, meta?:any) => ({role:'user',type:'text',timestamp,metadata:meta});
const char = (timestamp:number, meta?:any) => ({role:'assistant',type:'text',timestamp,metadata:meta});

describe('SullyOS character-specific natural response habits', () => {
  it('requires an actual user-answer-user exchange before claiming live attention', () => {
    expect(resolveRealPersonAttention([user(at-1000)],at,'free')).toBe('normal');
    expect(resolveRealPersonAttention([char(at-3000),user(at)],at,'free')).toBe('normal');
    const exchange=[user(at-40_000),char(at-10_000),user(at)];
    expect(resolveRealPersonAttention(exchange,at,'free')).toBe('waiting');
    expect(resolveRealPersonAttention([user(at-100_000),char(at-50_000),user(at)],at,'free'))
      .toBe('conversation');
    expect(resolveRealPersonAttention([user(at-100_000),char(at-50_000),user(at)],at,'busy'))
      .toBe('conversation');
    expect(resolveRealPersonAttention(exchange,at,'sleep')).toBe('occupied');
    expect(resolveRealPersonAttention([user(at-100_000),char(at-50_000),user(at)],at,'sleep'))
      .toBe('occupied');
  });
  it('never treats AMSG pushes, blocked cards, music actions or imported records as dialogue attention', () => {
    const realUser=user(at-30_000);
    const pushed=char(at-20_000,{activeMsg2:{taskId:'schedule'}});
    expect(resolveRealPersonAttention([realUser,pushed,user(at)],at,'free')).toBe('normal');
    expect(resolveRealPersonAttention([user(at-30_000),{...char(at-10_000),type:'system'},user(at)],at,'free'))
      .toBe('normal');
    expect(resolveRealPersonAttention([user(at-30_000),char(at-10_000),user(at,{musicListenInvite:true})],at,'free'))
      .toBe('normal');
    expect(resolveRealPersonAttention([user(at-30_000),char(at-10_000),user(at,{chatBlockRejected:true})],at,'busy'))
      .toBe('occupied');
    expect(resolveRealPersonAttention([
      user(at-30_000),char(at-10_000,{historyImported:true}),user(at),
    ],at,'free')).toBe('normal');
    expect(resolveRealPersonAttention([
      user(at-30_000),char(at-10_000,{importedFrom:'backup'}),user(at),
    ],at,'busy')).toBe('occupied');
    expect(resolveRealPersonAttention([user(at-30_000,{historyImported:true}),char(at-10_000),user(at)],at,'free'))
      .toBe('normal');
  });
  it('rejected or generated user entries and synthetic busy notices cannot create a live exchange', () => {
    expect(resolveRealPersonAttention([
      user(at-40_000,{deliveryStatus:'failed'}),char(at-10_000),user(at),
    ],at,'free')).toBe('normal');
    expect(resolveRealPersonAttention([
      user(at-40_000,{aiGenerated:true}),char(at-10_000),user(at),
    ],at,'free')).toBe('normal');
    expect(resolveRealPersonAttention([
      user(at-40_000),char(at-10_000,{busyFauxAutoReply:true}),user(at),
    ],at,'free')).toBe('normal');
    expect(resolveRealPersonAttention([
      user(at-40_000),char(at-10_000,{countsAsReply:false}),user(at),
    ],at,'free')).toBe('normal');
  });
  it('expires attention from actual time gaps; an old conversation cannot unlock busy time', () => {
    expect(resolveRealPersonAttention([user(at-900_000),char(at-800_000),user(at)],at,'busy'))
      .toBe('occupied');
    expect(resolveRealPersonAttention([user(at-50_000),char(at-30_000),user(at+900_000)],at+900_000,'free'))
      .toBe('normal');
  });
});
