// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {
  appendCharacterPhoneMessages,deleteCharacterPhoneChat,readCharacterPhoneChats,
  updateCharacterPhoneChats,phoneChatStorageKey,matchesPhoneWechatSearch,isRepeatedPhoneGeneratedBatch,
} from './characterPhoneChats';
import {
  beginCharacterPhoneRefresh,finishCharacterPhoneRefresh,isCharacterPhoneRefreshing,
} from './characterPhoneRefreshTracker';
import {
  publishCharacterMoment,readCharacterMoments,setMomentLike,addMomentComment,deleteCharacterMoment,
} from './characterPhoneMoments';
import {appendSimulatedPhonePayments,appendConfirmedPhoneReceipt,readPhonePayReceipts} from './characterPhonePayments';
import {calculatePhoneNetAssets,readCharacterPhoneWallet,syncCharacterPhoneWalletPayments} from './characterPhoneWallet';
import {
  readPhoneApiBudget,readPhoneAutonomyPreferences,reservePhoneApiBudget,writePhoneAutonomyPreferences,
} from './characterPhoneApiBudget';
import {
  addCharacterAvatar,chooseCharacterAvatar,readCharacterAvatarLibrary,removeCharacterAvatar,
} from './characterAvatarLibrary';
import {clearSelectedPhoneData} from './characterPhoneClear';

let sequence=0;
beforeEach(()=>{
  localStorage.clear();
  sequence=0;
  vi.stubGlobal('crypto',{randomUUID:()=> 'chaos-'+(++sequence)});
});
afterEach(()=>vi.unstubAllGlobals());
const contact=(id:string)=>({role:'contact' as const,contactId:id});
const wallet=(id:string,balanceCents=1_000_000)=>({
  version:1,characterId:id,currency:'CNY',createdAt:100,updatedAt:100,
  accounts:[{id:'cash',kind:'cash',title:'零钱',bankLabel:'微信支付',maskedNumber:'1234',balanceCents,note:'虚构测试'}],
  transactions:[],appliedMemoIds:[],appliedPaymentIds:[],
});

describe('Chaotic but plausible WeChat journeys / saved-state invariants',()=>{
  it('imports broken older bubbles and still accepts new delivery without losing valid history',()=>{
    const now=Date.now();
    localStorage.setItem(phoneChatStorageKey('a'),JSON.stringify([{
      id:'old',contactId:'npc',name:'同学',preview:'嗯',time:now,
      messages:[null,{text:'缺少身份',speaker:null},{speaker:contact('npc'),text:'嗯',createdAt:now+60_000}],
    }]));
    const rows=readCharacterPhoneChats('a');
    expect(rows).toHaveLength(1);
    expect(rows[0].messages).toHaveLength(1);
    const received=appendCharacterPhoneMessages({
      characterId:'a',contactId:'npc',contactName:'同学',at:now,
      messages:[{speaker:contact('npc'),text:'嗯',createdAt:now}],
    });
    // A device clock correction must not classify tomorrow's bubble as
    // a duplicate received ten minutes ago.
    expect(received?.added).toHaveLength(1);
    expect(readCharacterPhoneChats('a')[0].messages.map(m=>m.text)).toEqual(['嗯','嗯']);
  });

  it('supports a mixed batch with corrupt incoming entries without crashing the thread',()=>{
    const result=appendCharacterPhoneMessages({
      characterId:'a',contactId:'npc',contactName:'同学',
      messages:[null as any,{speaker:null,text:'无身份'} as any,
        {speaker:contact('npc'),text:'今天见面吗？'}],
    });
    expect(result?.added.map(m=>m.text)).toEqual(['今天见面吗？']);
  });

  it('keeps manual private chat and NPC search consistent, including empty queries',()=>{
    expect(matchesPhoneWechatSearch('  妹妹 ', '妹妹', '昨天去画画了')).toBe(true);
    expect(matchesPhoneWechatSearch('单主','小林','单主催稿')).toBe(true);
    expect(matchesPhoneWechatSearch('山竹','妹妹','昨天去画画了')).toBe(false);
    expect(matchesPhoneWechatSearch('','妈妈','对话')).toBe(true);
    expect(matchesPhoneWechatSearch('银行','微信支付','扣款通知')).toBe(false);
  });

  it('blocks an identical 8-bubble manual generation replay but permits hours-later natural repetition',()=>{
    const messages=Array.from({length:8},(_,i)=>({
      speaker:i%2===0?contact('npc'):{role:'owner' as const},
      text:i%2===0?'等一下'+i:'好'+i,
    }));
    const now=Date.now();
    expect(isRepeatedPhoneGeneratedBatch(messages,messages,now+10_000,now)).toBe(true);
    expect(isRepeatedPhoneGeneratedBatch(messages,messages,now+11*60_000,now)).toBe(false);
    expect(isRepeatedPhoneGeneratedBatch(messages,messages.slice(1),now+1000,now)).toBe(false);
    expect(isRepeatedPhoneGeneratedBatch(messages,[...messages.slice(0,7),
      {speaker:contact('npc'),text:'新消息'}],now+1000,now)).toBe(false);
  });

  it('rejects duplicate cloud delivery and a late reply after the exact thread was deleted',()=>{
    const now=Date.now();
    const first=appendCharacterPhoneMessages({
      characterId:'a',contactId:'friend',contactName:'朋友',at:now,
      messages:[{speaker:contact('friend'),text:'到楼下了',cloudSourceId:'cloud-1',createdAt:now}],
    });
    expect(first?.added).toHaveLength(1);
    expect(appendCharacterPhoneMessages({
      characterId:'a',contactId:'friend',contactName:'朋友',at:now+1000,
      messages:[{speaker:contact('friend'),text:'重新投递但内容不同',cloudSourceId:'cloud-1'}],
    })).toBeNull();
    const expectedLatest={
      threadId:first!.thread.id,messageCount:1,lastAt:now,lastText:'到楼下了',
    };
    expect(deleteCharacterPhoneChat('a',first!.thread.id)).toBe(true);
    expect(appendCharacterPhoneMessages({
      characterId:'a',contactId:'friend',contactName:'朋友',expectedLatest,
      messages:[{speaker:{role:'owner'},text:'我来了'}],
    })).toBeNull();
    expect(readCharacterPhoneChats('a')).toHaveLength(0);
  });

  it('rapidly switches two characters while generating/clearing 72 conversations',()=>{
    const at=Date.now();
    localStorage.setItem('sully_real_chat_sentinel','important-user-chat');
    for(let n=0;n<36;n++){
      for(const id of ['a','b']){
        appendCharacterPhoneMessages({
          characterId:id,contactId:'same-id',contactName:'同名朋友',
          at:at+n*11*60_000,
          messages:[{speaker:contact('same-id'),text:'第'+n+'次：嗯',createdAt:at+n*11*60_000}],
        });
      }
    }
    expect(readCharacterPhoneChats('a')[0].messages).toHaveLength(36);
    expect(readCharacterPhoneChats('b')[0].messages).toHaveLength(36);
    clearSelectedPhoneData('a',['chats','moments']);
    expect(readCharacterPhoneChats('a')).toEqual([]);
    expect(readCharacterPhoneChats('b')[0].messages).toHaveLength(36);
    expect(localStorage.getItem('sully_real_chat_sentinel')).toBe('important-user-chat');
  });

  it('serializes multiple foreground refreshes per character and feature',()=>{
    expect(beginCharacterPhoneRefresh('a')).toBe(true);
    expect(beginCharacterPhoneRefresh('a')).toBe(false);
    expect(beginCharacterPhoneRefresh('a','moments')).toBe(true);
    expect(beginCharacterPhoneRefresh('b')).toBe(true);
    expect(isCharacterPhoneRefreshing('a')).toBe(true);
    finishCharacterPhoneRefresh('a');
    expect(isCharacterPhoneRefreshing('a')).toBe(false);
    expect(isCharacterPhoneRefreshing('a','moments')).toBe(true);
    finishCharacterPhoneRefresh('a','moments');
    finishCharacterPhoneRefresh('b');
    expect(beginCharacterPhoneRefresh('a')).toBe(true);
    finishCharacterPhoneRefresh('a');
  });

  it('withstands 80 like toggles, 50 replies, deletion and late interactions',()=>{
    const a=publishCharacterMoment({characterId:'a',origin:'char',text:'今天下雨了',visibility:'all',imageUrls:[]})!;
    const b=publishCharacterMoment({characterId:'b',origin:'char',text:'今天也下雨了',visibility:'all',imageUrls:[]})!;
    for(let i=0;i<80;i++)expect(setMomentLike('a',a.id,'user',i%2===0)).toBe(true);
    for(let i=0;i<50;i++){
      expect(addMomentComment('a',a.id,{id:'comment-'+i,authorId:'user',text:'聊聊第'+i+'次',createdAt:i+1})).toBe(true);
    }
    expect(readCharacterMoments('a')[0].likes).toHaveLength(0);
    expect(readCharacterMoments('a')[0].comments).toHaveLength(50);
    expect(deleteCharacterMoment('a',a.id,'user')).toBe(true);
    expect(addMomentComment('a',a.id,{id:'late',authorId:'user',text:'迟到回复',createdAt:999})).toBe(false);
    expect(setMomentLike('a',a.id,'user',true)).toBe(false);
    expect(readCharacterMoments('b')[0].id).toBe(b.id);
  });

  it('merges 120 fictional payment receipts once, even across repeated wallet opens',()=>{
    localStorage.setItem('sully_character_phone_wallet_v1:a',JSON.stringify(wallet('a')));
    for(let i=0;i<120;i++){
      const receipt=appendConfirmedPhoneReceipt({
        characterId:'a',sourceId:'paid-'+i,origin:'private-confirmed',
        title:'便利店'+i,category:'生活',detail:'虚构角色购物',amountCents:-100,occurredAt:Date.now()+i,
      });
      expect(receipt).not.toBeNull();
      expect(appendConfirmedPhoneReceipt({
        characterId:'a',sourceId:'paid-'+i,origin:'private-confirmed',
        title:'重复送达'+i,category:'生活',detail:'重复',amountCents:-100,occurredAt:Date.now()+i,
      })).toBeNull();
      if(i%15===14) {
        const once=syncCharacterPhoneWalletPayments('a')!;
        const twice=syncCharacterPhoneWalletPayments('a')!;
        expect(twice.transactions).toHaveLength(once.transactions.length);
        expect(calculatePhoneNetAssets(twice)).toBe(calculatePhoneNetAssets(once));
      }
    }
    expect(readPhonePayReceipts('a')).toHaveLength(120);
    expect(readCharacterPhoneWallet('a')!.transactions).toHaveLength(120);
    expect(calculatePhoneNetAssets(readCharacterPhoneWallet('a')!)).toBe(988000);
    expect(readCharacterPhoneWallet('b')).toBeNull();
  });

  it('deduplicates the same fictional merchant once per day, but accepts another purchase',()=>{
    const when=Date.now();
    expect(appendSimulatedPhonePayments('a',[{kind:'expense',title:'咖啡',amount:12.5}],when)).toHaveLength(1);
    expect(appendSimulatedPhonePayments('a',[{kind:'expense',title:'咖啡',amount:12.5}],when+2000)).toHaveLength(0);
    expect(appendSimulatedPhonePayments('a',[{kind:'expense',title:'咖啡',amount:18.5}],when+4000)).toHaveLength(1);
    expect(readPhonePayReceipts('a')).toHaveLength(2);
  });

  it('keeps 40 avatar switches independent and does not wipe albums during phone reset',()=>{
    for(const id of ['a','b']){
      for(let i=0;i<20;i++)addCharacterAvatar(id,'https://images.invalid/'+id+'/'+i+'.png');
    }
    for(let i=0;i<40;i++){
      const entry=readCharacterAvatarLibrary('a').entries[i%20];
      expect(chooseCharacterAvatar('a',entry.id)).toBe(entry.image);
    }
    expect(chooseCharacterAvatar('a','a-deleted-avatar')).toBeNull();
    const activeId=readCharacterAvatarLibrary('a').activeId!;
    clearSelectedPhoneData('a',['appearance','chats','moments']);
    expect(readCharacterAvatarLibrary('a').activeId).toBe(activeId);
    expect(readCharacterAvatarLibrary('b').entries).toHaveLength(20);
    removeCharacterAvatar('a',activeId);
    expect(readCharacterAvatarLibrary('a').activeId).toBeUndefined();
  });

  it('flicks phone permission and budget switches 60 times without leaking to another Char',()=>{
    const at=new Date(2026,9,25,9).getTime();
    for(let i=0;i<60;i++){
      writePhoneAutonomyPreferences('a',{
        backgroundApiEnabled:i%2===0,pace:i%3===0?'economy':'balanced',
        browserAutoEnabled:i%5===0,chatPiggybackEnabled:i%7===0,
      });
      expect(readPhoneAutonomyPreferences('b').pace).toBe('economy');
    }
    expect(readPhoneAutonomyPreferences('a').backgroundApiEnabled).toBe(false);
    expect(reservePhoneApiBudget('a',at)).toBe(false);
    expect(reservePhoneApiBudget('b',at)).toBe(true);
    expect(readPhoneApiBudget('b',at).requests).toBe(1);
    expect(readPhoneApiBudget('a',at).requests).toBe(0);
  });

  it('preserves independent Char states after a mid-session refresh and delete burst',()=>{
    for(let i=0;i<24;i++){
      updateCharacterPhoneChats('a',rows=>[
        {id:'row-'+i,contactId:'npc-'+i,name:'熟人'+i,preview:'在吗',time:Date.now(),
          messages:[{speaker:contact('npc-'+i),text:'在吗'}]},
        ...rows,
      ]);
    }
    const current=readCharacterPhoneChats('a');
    expect(current).toHaveLength(24);
    for(const row of current.filter((_,i)=>i%2===0))expect(deleteCharacterPhoneChat('a',row.id)).toBe(true);
    expect(readCharacterPhoneChats('a')).toHaveLength(12);
    expect(new Set(readCharacterPhoneChats('a').map(r=>r.id)).size).toBe(12);
  });
});
