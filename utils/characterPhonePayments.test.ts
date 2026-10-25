// @vitest-environment jsdom
import {beforeEach,afterEach,describe,expect,it,vi} from 'vitest';
import {appendSimulatedPhonePayments,readPhonePayReceipts,appendConfirmedPhoneReceipt,clearPhonePayReceipts} from './characterPhonePayments';
import {syncPrivateTransferReceiptsFromMessages} from './characterPhonePaymentSync';
import {syncCharacterPhoneWalletPayments,readCharacterPhoneWallet,type CharacterPhoneWallet} from './characterPhoneWallet';
import type {Message} from '../types';
let sequence=0;
beforeEach(()=>{localStorage.clear();sequence=0;vi.stubGlobal('crypto',{randomUUID:()=>String(++sequence)})});
afterEach(()=>vi.unstubAllGlobals());
const wallet=(charId:string):CharacterPhoneWallet=>({
 version:1,characterId:charId,currency:'CNY',createdAt:1,updatedAt:1,
 accounts:[{id:'cash',kind:'cash',title:'零钱',bankLabel:'微信支付',maskedNumber:'1111',balanceCents:80000,note:''}],
 transactions:[],appliedMemoIds:[],
});
describe('Character WeChat Pay and confirmed transfers',()=>{
 it('records only bounded, fictional Char expenses and skips duplicate or fake User transfers',()=>{
  const entries=appendSimulatedPhonePayments('char',[
   {title:'便利店',kind:'expense',amount:12.5,category:'日常',detail:'买水'},
   {title:'便利店',kind:'expense',amount:12.5,category:'日常',detail:'重复账单'},
   {title:'User 的转账',kind:'transfer',amount:520},
   {title:'没有原支付的退款',kind:'refund',amount:100},
   {title:'天价账单',kind:'expense',amount:999999},
  ]);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({amountCents:-1250,origin:'wechat-simulated'});
  expect(readPhonePayReceipts('other')).toHaveLength(0);
  expect(readPhonePayReceipts('char')).toHaveLength(1);
 });
 it('synchronizes same receipt into wallet balance once, preserving old entries',()=>{
  localStorage.setItem('sully_character_phone_wallet_v1:char',JSON.stringify(wallet('char')));
  const [receipt]=appendSimulatedPhonePayments('char',[{title:'书店',kind:'expense',amount:32}]);
  const first=syncCharacterPhoneWalletPayments('char')!;
  const twice=syncCharacterPhoneWalletPayments('char')!;
  expect(first.accounts[0].balanceCents).toBe(76800);
  expect(first.transactions).toHaveLength(1);
  expect(first.transactions[0].sourceId).toBe(receipt.id);
  expect(twice.accounts[0].balanceCents).toBe(76800);
  expect(twice.transactions).toHaveLength(1);
  expect(readCharacterPhoneWallet('other')).toBeNull();
 });
 it('uses accepted structured private transfer cards, not conversation text or pending sends',()=>{
  const make=(id:number,role:'user'|'assistant',status:string,type:Message['type']='transfer'):Message=>({
    id,role,charId:'char',type,content:'我给你转了钱',timestamp:1760000000000+id,metadata:{amount:'52.5',status},
  });
  const added=syncPrivateTransferReceiptsFromMessages('char',[
    make(1,'user','pending'),
    make(2,'user','returned'),
    make(3,'user','accepted'),
    make(4,'assistant','accepted'),
    make(5,'user','accepted','text'),
    {...make(6,'user','accepted'),groupId:'group-a'},
  ]);
  expect(added.map(x=>x.amountCents)).toEqual([5250,-5250]);
  expect(syncPrivateTransferReceiptsFromMessages('char',[make(3,'user','accepted')])).toHaveLength(0);
  expect(readPhonePayReceipts('other')).toHaveLength(0);
 });
 it('keeps simulated receipt and wallet as separately clearable stores',()=>{
  appendSimulatedPhonePayments('char',[{title:'饮料',kind:'expense',amount:5}]);
  localStorage.setItem('sully_character_phone_wallet_v1:char',JSON.stringify(wallet('char')));
  clearPhonePayReceipts('char');
  expect(readPhonePayReceipts('char')).toHaveLength(0);
  expect(readCharacterPhoneWallet('char')).not.toBeNull();
 });
 it('rejects unproven upstream transfers without stable IDs',()=>{
  expect(appendConfirmedPhoneReceipt({characterId:'char',origin:'private-confirmed',title:'转账',category:'转账',
    detail:'',amountCents:1200,occurredAt:Date.now()})).toBeNull();
 });
});
