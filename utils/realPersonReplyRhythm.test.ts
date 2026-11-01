import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REAL_PERSON_REPLY_RHYTHM, normalizeRealPersonReplyRhythm,
  resolveRealPersonAttention, sampleRealPersonRhythmMs,
} from './realPersonReplyRhythm';
import { resolveRealPersonReplyPlan } from './realPersonReplyTiming';

const at = 1_800_000_000_000;
const user = (timestamp:number, meta?:any) => ({role:'user',type:'text',timestamp,metadata:meta});
const char = (timestamp:number, meta?:any) => ({role:'assistant',type:'text',timestamp,metadata:meta});

describe('SullyOS character-specific natural response habits', () => {
  it('uses the old character profile defaults for missing ranges, without writing new storage', () => {
    expect(normalizeRealPersonReplyRhythm(null)).toEqual(DEFAULT_REAL_PERSON_REPLY_RHYTHM);
    const saved = normalizeRealPersonReplyRhythm({normal:{minSeconds:240,maxSeconds:360}});
    expect(saved.normal).toEqual({minSeconds:240,maxSeconds:360});
    expect(saved.waiting).toEqual(DEFAULT_REAL_PERSON_REPLY_RHYTHM.waiting);
    expect(normalizeRealPersonReplyRhythm({conversation:{minSeconds:200,maxSeconds:50}}).conversation)
      .toEqual({minSeconds:50,maxSeconds:200});
    expect(normalizeRealPersonReplyRhythm({normal:{minSeconds:-1,maxSeconds:999999}}).normal)
      .toEqual(DEFAULT_REAL_PERSON_REPLY_RHYTHM.normal);
  });
  it('samples once for a saved batch instead of sampling anew per sent message', () => {
    const sample = sampleRealPersonRhythmMs('conversation','char-1',at);
    expect(sampleRealPersonRhythmMs('conversation','char-1',at)).toBe(sample);
    expect(sample).toBeGreaterThanOrEqual(2000);
    expect(sample).toBeLessThanOrEqual(5000);
    expect(sampleRealPersonRhythmMs('normal','char-1',at)).toBeGreaterThanOrEqual(4000);
    expect(sampleRealPersonRhythmMs('occupied','char-1',at)).toBeGreaterThanOrEqual(35000);
  });
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
  it('expires attention from actual time gaps; an old conversation cannot unlock busy time', () => {
    expect(resolveRealPersonAttention([user(at-900_000),char(at-800_000),user(at)],at,'busy'))
      .toBe('occupied');
    expect(resolveRealPersonAttention([user(at-50_000),char(at-30_000),user(at+900_000)],at+900_000,'free'))
      .toBe('normal');
  });
  it('honors character habits, stable batch state, and the actual sleep gate', () => {
    const custom={normal:{minSeconds:300,maxSeconds:310},conversation:{minSeconds:3,maxSeconds:4},
      occupied:{minSeconds:90,maxSeconds:100},waiting:{minSeconds:2,maxSeconds:3}};
    const first=resolveRealPersonReplyPlan({
      activity:'free',firstUnansweredAt:at,now:at,fallbackDelayMs:90000,
      replyAttention:'normal',replyRhythm:custom,characterId:'char-1',
    });
    expect(first.delayMs).toBeGreaterThanOrEqual(300_000);
    expect(first.delayMs).toBeLessThanOrEqual(310_000);
    const later=resolveRealPersonReplyPlan({
      activity:'free',firstUnansweredAt:at,now:at+280_000,lastUserSendAt:at+279_000,
      fallbackDelayMs:90000, replyAttention:'normal',replyRhythm:custom,characterId:'char-1',
    });
    expect(later.delayMs).toBeGreaterThanOrEqual(20_000);
    expect(later.delayMs).toBeLessThanOrEqual(30_000);
    const night=resolveRealPersonReplyPlan({
      activity:'sleep',firstUnansweredAt:at,now:at,fallbackDelayMs:1000,
      replyAttention:'waiting',replyRhythm:custom,characterId:'char-1',
    });
    expect(night.delayMs).toBeNull();
  });
});
