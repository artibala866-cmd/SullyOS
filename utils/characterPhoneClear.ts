/** Explicit, narrow, per-Char check-phone data cleanup. Never touches real private chat,
 * global avatars, Memory Palace, music persona, other installed apps or other characters.
 */
import {updateCharacterPhoneChats,readCharacterPhoneChats,erasePhoneWechatRelationshipNotes} from './characterPhoneChats';
import {clearCharacterPhoneWallet} from './characterPhoneWallet';
import {clearPhonePayReceipts} from './characterPhonePayments';
import {clearPhoneBrowserHistory} from './characterPhoneBrowser';
import {CHARACTER_PHONE_CONTACT_CHANGED} from './characterPhoneNpcs';
import {CHARACTER_MOMENTS_CHANGED} from './characterPhoneMoments';
import {CHARACTER_MEMOS_CHANGED} from './characterPhoneMemos';
import {CHARACTER_PHONE_INSTALL_CHANGED} from './characterPhoneAppInstall';
import {PHONE_APPEARANCE_CHANGED} from './characterPhoneAppearance';
import {SOCIAL_SNAPSHOT_CHANGED} from './characterPhoneSocialContent';
import {CHARACTER_PHONE_SELF_CHANGED} from './characterPhoneSelfProfile';
import {PENDING_PHONE_CONTACTS_CHANGED} from './characterPhoneRequests';
import {pruneCharacterPhoneLifeEvents,CHARACTER_LIFE_EVENTS_CHANGED,type CharacterLifeEventKind} from './characterLifeEvents';
import {advancePhoneContentClearRevision} from './characterPhoneContentClearRevision';
export const PHONE_CLEAR_GROUPS=[
  {id:'service',label:'仅公众号／服务号会话',description:'删除微信官方通知，不删除普通 NPC 聊天'},
  {id:'chats',label:'微信 NPC 与群聊记录',description:'不删除 User 的真实私聊数据库'},
  {id:'contacts',label:'手机联系人及待添加请求',description:'清除 Char 查手机内独立的 NPC 通讯录'},
  {id:'moments',label:'朋友圈内容',description:'清除 Char 本地朋友圈快照'},
  {id:'memos',label:'备忘录',description:'清除独立手机备忘录，不清空记忆宫殿'},
  {id:'browser',label:'浏览器访问记录',description:'清除查手机本地浏览历史'},
  {id:'payments',label:'微信支付模拟账单',description:'只删除模拟账单来源；已合并到资产的流水需另外选择钱包'},
  {id:'wallet',label:'钱包账户及资产流水',description:'清空资产快照；不影响原先保留的支付模拟账单'},
  {id:'social',label:'微博及 Instagram 内容',description:'清空生成的内容快照，不卸载软件'},
  {id:'appearance',label:'查手机桌面美化',description:'恢复本地壁纸、拍立得和文案组件'},
  {id:'install',label:'可选软件安装清单',description:'保留应用内容存档，下次解锁会重新分析安装'},
  {id:'self',label:'Char 戳一戳自改资料',description:'不删除已保存的头像图片'},
] as const;
export type PhoneClearGroup=typeof PHONE_CLEAR_GROUPS[number]['id'];
const emit=(name:string,id:string)=>window.dispatchEvent(new CustomEvent(name,{detail:{characterId:id}}));
export function clearSelectedPhoneData(charId:string,ids:readonly PhoneClearGroup[]):PhoneClearGroup[]{
  if(!charId||!ids.length)return [];
  const selected=[...new Set(ids)].filter(id=>PHONE_CLEAR_GROUPS.some(p=>p.id===id));
  for(const kind of selected){
    switch(kind){
      case 'service':
        // A late full-suite inbox response must not recreate cleared service
        // conversations while preserving the user's NPC chats.
        if(!selected.includes('chats'))advancePhoneContentClearRevision(charId, 'chats');
        if(!selected.includes('chats'))updateCharacterPhoneChats(charId,rows=>rows.filter(
          r=>!(r.kind==='service'||r.contactId?.startsWith('service:'))));
        break;
      case 'chats':
        advancePhoneContentClearRevision(charId, 'chats');
        localStorage.removeItem('sully_character_phone_wechat_v1:'+charId);
        localStorage.removeItem('sully_phone_inbox_auto_at:'+charId);
        erasePhoneWechatRelationshipNotes(charId);
        // Don't touch DB private messages. Force refresh of local NPC conversation list.
        emit('sully:character-phone-chats-changed',charId);
        break;
      case 'contacts':
        advancePhoneContentClearRevision(charId, 'contacts');
        localStorage.removeItem('sully_character_phone_npcs_v1:'+charId);
        localStorage.removeItem('sully_phone_pending_contacts_v1:'+charId);
        emit(CHARACTER_PHONE_CONTACT_CHANGED,charId);
        emit(PENDING_PHONE_CONTACTS_CHANGED,charId);
        break;
      case 'moments':
        advancePhoneContentClearRevision(charId, 'moments');
        localStorage.removeItem('sully_character_moments_v1:'+charId);
        emit(CHARACTER_MOMENTS_CHANGED,charId);
        break;
      case 'memos':
        advancePhoneContentClearRevision(charId, 'memos');
        localStorage.removeItem('sully_character_memo_entries_v1:'+charId);
        emit(CHARACTER_MEMOS_CHANGED,charId);
        break;
      case 'browser':
        clearPhoneBrowserHistory(charId);
        break;
      case 'wallet':
        clearCharacterPhoneWallet(charId);
        break;
      case 'payments':
        advancePhoneContentClearRevision(charId, 'payments');
        clearPhonePayReceipts(charId);
        break;
      case 'social':
        for(const app of ['weibo','instagram'] as const){
          localStorage.removeItem('sully_character_phone_social_snapshot_v1:'+charId+':'+app);
          window.dispatchEvent(new CustomEvent(SOCIAL_SNAPSHOT_CHANGED,{detail:{characterId:charId,appId:app}}));
        }
        break;
      case 'appearance':
        localStorage.removeItem('sully_character_phone_appearance_v1:'+charId);
        emit(PHONE_APPEARANCE_CHANGED,charId);
        break;
      case 'install':
        localStorage.removeItem('sully_character_phone_install_plan_v1:'+charId);
        emit(CHARACTER_PHONE_INSTALL_CHANGED,charId);
        break;
      case 'self':
        localStorage.removeItem('sully_character_phone_self_v1:'+charId);
        emit(CHARACTER_PHONE_SELF_CHANGED,charId);
        break;
    }
  }
  // A cleared phone source must no longer be recited as an active short-term
  // fact in chats/AMSG or retried by the Palace ingester. Existing Palace
  // memories remain intact and are not implicitly deleted.
  const eventKinds=new Set<CharacterLifeEventKind>();
  if(selected.includes('chats'))eventKinds.add('npc-chat');
  if(selected.includes('contacts'))eventKinds.add('contact-added');
  if(selected.includes('moments')){
    eventKinds.add('moment-post');
    eventKinds.add('moment-comment');
  }
  if(selected.includes('browser'))eventKinds.add('browser-search');
  const pruned=eventKinds.size?pruneCharacterPhoneLifeEvents(charId,[...eventKinds]):0;
  if(selected.includes('chats')&&!pruned&&typeof window!=='undefined'){
    // Deleted WeChat excerpts may exist only in NPC relationshipNotes,
    // already projected to cloud even without a recorded life event.
    window.dispatchEvent(new CustomEvent(CHARACTER_LIFE_EVENTS_CHANGED,
      {detail:{characterId:charId,pruned:true}}));
  }
  return selected;
}
