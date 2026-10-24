import React, { useState } from 'react';
import PhoneAvatar from './PhoneAvatar';
import { setMomentLike, addMomentComment, deleteCharacterMoment } from '../../utils/characterPhoneMoments';
import type { CharacterMoment } from '../../utils/characterPhoneMoments';
import type { UserProfile } from '../../types';
import type { NpcProfile } from '../../utils/characterPhoneNpcs';

export function MomentsTimeline({
  name, characterId, posts, contacts, charAvatar, userProfile,
}: {
  name: string; characterId: string; posts: CharacterMoment[];
  contacts: NpcProfile[]; charAvatar?: string; userProfile?: UserProfile;
}) {
  const [reply, setReply] = useState<{ postId: string; commentId?: string } | null>(null);
  const [draft, setDraft] = useState('');
  const avatar = (id: string) => id === characterId ? charAvatar
    : id === 'user' ? (userProfile?.perCharAvatars?.[characterId] || userProfile?.avatar)
    : contacts.find(p => p.id === id)?.avatar;
  const label = (id: string) => id === characterId ? name
    : id === 'user' ? '我'
    : contacts.find(p => p.id === id)?.nickname || contacts.find(p => p.id === id)?.name || '微信好友';

  return <section className="bg-white">
    {posts.filter(p => !p.deletedAt).map(p => {
      const activeComments = (p.comments || []).filter(c => !c.deletedAt);
      const replyTarget = reply?.postId === p.id && reply.commentId
        ? activeComments.find(c => c.id === reply.commentId) : null;
      return <article key={p.id} className="flex gap-3 border-b border-gray-100 px-4 py-5">
        <PhoneAvatar key={avatar(p.authorId) || label(p.authorId)} src={avatar(p.authorId)} name={label(p.authorId)} className="h-11 w-11 rounded text-lg"/>
        <div className="min-w-0 flex-1">
          <strong className="text-[#333]">{label(p.authorId)}</strong>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm">{p.text}</p>
          {!!p.imageUrls?.length && <div className="mt-2 grid grid-cols-3 gap-1">
            {p.imageUrls.map((url, i) => <img key={i} src={url} alt="朋友圈图片" className="aspect-square w-full object-cover"/>)}
          </div>}
          <div className="mt-3 flex items-center justify-between text-xs text-gray-400">
            <time>{new Date(p.createdAt).toLocaleString('zh-CN')}</time>
            <span className="flex gap-3">
              <button type="button" onClick={() => setMomentLike(characterId, p.id, 'user', !p.likes?.some(l => l.actorId === 'user'))}>赞</button>
              <button type="button" onClick={() => { setReply({ postId: p.id }); setDraft(''); }}>评论</button>
              {p.authorId === characterId && <button type="button" onClick={() => {
                if (window.confirm('删除这条朋友圈？')) deleteCharacterMoment(characterId, p.id, 'user');
              }}>删除</button>}
            </span>
          </div>
          {(!!p.likes?.length || !!activeComments.length) && <div className="mt-2 space-y-2 rounded bg-gray-100 p-2 text-xs">
            {!!p.likes?.length && <div className="text-[#555]">赞 · {p.likes.map(l => label(l.actorId)).join('、')}</div>}
            {activeComments.map(c => {
              const target = c.replyToId ? activeComments.find(item => item.id === c.replyToId) : null;
              return <div key={c.id} className="flex items-start justify-between gap-2">
                <div className="min-w-0 whitespace-pre-wrap break-words text-[#333]">
                  <span className="font-medium">{label(c.authorId)}</span>
                  {target && <> 回复 <span className="font-medium">{label(target.authorId)}</span></>}：
                  {c.text}
                </div>
                <button type="button" className="shrink-0 text-[#777]" aria-label={'回复' + label(c.authorId)} onClick={() => {
                  setReply({ postId: p.id, commentId: c.id }); setDraft('');
                }}>回复</button>
              </div>;
            })}
          </div>}
          {reply?.postId === p.id && <form className="mt-2 flex gap-2" onSubmit={e => {
            e.preventDefault();
            if (!draft.trim()) return;
            const saved = addMomentComment(characterId, p.id, {
              id: crypto.randomUUID(), authorId: 'user', text: draft.trim(), createdAt: Date.now(),
              ...(reply?.commentId ? { replyToId: reply.commentId } : {}),
            });
            if (saved) { setDraft(''); setReply(null); }
          }}>
            <input aria-label="评论" value={draft} onChange={e => setDraft(e.target.value)}
              placeholder={replyTarget ? '回复' + label(replyTarget.authorId) : '发表评论'}
              className="min-w-0 flex-1 rounded border border-gray-300 p-1 text-sm"/>
            <button type="submit" className="text-sm text-[#333]">发送</button>
          </form>}
        </div>
      </article>;
    })}
  </section>;
}
