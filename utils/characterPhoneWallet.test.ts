// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  calculatePhoneNetAssets, clearCharacterPhoneWallet, initializeCharacterPhoneWallet,
  readCharacterPhoneWallet, syncCharacterPhoneWalletMemos,
  type CharacterPhoneWallet,
} from './characterPhoneWallet';
import { appendCharacterMemo } from './characterPhoneMemos';
import type { CharacterProfile, UserProfile } from '../types';

vi.mock('./characterPhoneContext', () => ({
  buildCharacterPhoneContext: vi.fn(async () => ({systemPrompt:'角色在书店打工，经济普通。',privateMessages:[]})),
}));
const CHAR = {id:'char-wallet',name:'阿树',systemPrompt:'书店店员'} as CharacterProfile;
const USER = {name:'真正的User'} as UserProfile;
const API = {baseUrl:'https://example.invalid/v1',apiKey:'fake',model:'fake'};
let seq = 0;
const testWallet = (): CharacterPhoneWallet => ({
  version:1,characterId:CHAR.id,currency:'CNY',createdAt:100,updatedAt:100,
  accounts:[
    {id:'cash',kind:'cash',title:'零钱',bankLabel:'微信支付',maskedNumber:'1234',balanceCents:123450,note:'日常'},
    {id:'credit',kind:'credit',title:'信用账单',bankLabel:'虚构银行',maskedNumber:'5678',balanceCents:20000,note:'欠款'},
  ],
  transactions:[],appliedMemoIds:[],
});
beforeEach(()=>{localStorage.clear();seq=0;vi.stubGlobal('crypto',{randomUUID:()=>String(++seq)})});
afterEach(()=>vi.unstubAllGlobals());

describe('Character-owned wallet',()=>{
  it('keeps one wallet per Char and subtracts liabilities from total assets',()=>{
    localStorage.setItem('sully_character_phone_wallet_v1:'+CHAR.id,JSON.stringify(testWallet()));
    const wallet=readCharacterPhoneWallet(CHAR.id);
    expect(wallet).not.toBeNull();
    expect(calculatePhoneNetAssets(wallet!)).toBe(103450);
    expect(readCharacterPhoneWallet('another-char')).toBeNull();
  });

  it('applies explicitly-amounted RMB expense memo only once, preserving account identity',()=>{
    localStorage.setItem('sully_character_phone_wallet_v1:'+CHAR.id,JSON.stringify(testWallet()));
    const expense=appendCharacterMemo({
      characterId:CHAR.id,category:'expense',body:'中午买了咖啡，22.5元',
      expense:{amount:22.5,currency:'CNY',label:'咖啡'},
    });
    expect(expense).not.toBeNull();
    const first=syncCharacterPhoneWalletMemos(CHAR.id)!;
    expect(first.accounts[0].balanceCents).toBe(121200);
    expect(first.transactions[0]).toMatchObject({
      amountCents:-2250,origin:'memo',sourceId:expense?.id,title:'咖啡',
    });
    const again=syncCharacterPhoneWalletMemos(CHAR.id)!;
    expect(again.transactions).toHaveLength(1);
    expect(again.accounts[0].balanceCents).toBe(121200);
  });

  it('never interprets unsupported currencies or unstructured text as CNY spending',()=>{
    localStorage.setItem('sully_character_phone_wallet_v1:'+CHAR.id,JSON.stringify(testWallet()));
    appendCharacterMemo({characterId:CHAR.id,category:'expense',body:'外币花费',
      expense:{amount:15,currency:'USD',label:'外币'}});
    appendCharacterMemo({characterId:CHAR.id,category:'thought',body:'明天准备花200元'});
    const after=syncCharacterPhoneWalletMemos(CHAR.id)!;
    expect(after.transactions).toHaveLength(0);
    expect(after.accounts[0].balanceCents).toBe(123450);
  });

  it('creates a one-time fictional opening snapshot using Char context, not real User wallet',async()=>{
    const fetchMock=vi.fn().mockResolvedValue({
      ok:true,status:200,headers:{get:()=> 'application/json'},
      text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify({
        accounts:[{id:'cash',kind:'cash',title:'零钱',bankLabel:'微信支付',balance:158.8,maskedNumber:'3212'}],
        activities:[{accountId:'cash',title:'便利店',category:'日常',amount:-16.5,createdAt:Date.now()-10000,detail:'买水'}],
      })}}]}),
    });
    vi.stubGlobal('fetch',fetchMock);
    const params={char:CHAR,user:USER,groups:[],api:API};
    const wallet=await initializeCharacterPhoneWallet(params);
    expect(wallet.accounts[0].balanceCents).toBe(15880);
    expect(wallet.transactions[0].amountCents).toBe(-1650);
    expect(wallet.transactions[0].origin).toBe('opening-snapshot');
    expect((fetchMock.mock.calls[0][1].body as string)).toContain('不是真实银行数据');
    await initializeCharacterPhoneWallet(params);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    clearCharacterPhoneWallet(CHAR.id);
    expect(readCharacterPhoneWallet(CHAR.id)).toBeNull();
  });
});
