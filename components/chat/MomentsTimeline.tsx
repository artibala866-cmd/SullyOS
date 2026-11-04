import TokenImg from '../os/TokenImg';
import React, { useEffect, useRef, useState } from 'react';
import { ChatCircle, DotsThree, Heart, Trash } from '@phosphor-icons/react';
import PhoneAvatar from './PhoneAvatar';
import { setMomentLike, addMomentComment, deleteCharacterMoment } from '../../utils/characterPhoneMoments';
import type { CharacterMoment } from '../../utils/characterPhoneMoments';
import type { UserProfile } from '../../types';
import type { NpcProfile } from '../../utils/characterPhoneNpcs';

/** WeChat-like compact feed time; the complete timestamp remains in title. */
function formatMomentsTime(timestamp: number): string {
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60_000) return '刚刚';
  if (elapsed < 3_600_000) return Math.floor(elapsed / 60_000) + '分钟前';
  if (elapsed < 86_400_000) return Math.floor(elapsed / 3_600_000) + '小时前';
  const days = Math.floor(elapsed / 86_400_000);
  if (days === 1) return '昨天';
  if (days < 7) return days + '天前';
  const date = new Date(timestamp);
  const today = new Date();
  return (date.getFullYear() === today.getFullYear() ? '' : date.getFullYear() + '年') +
    (date.getMonth() + 1) + '月' + date.getDate() + '日';
}

export function MomentsTimeline({
  name, characterId, posts, contacts, charAvatar, userProfile,
}: {
  name: string; characterId: string; posts: CharacterMoment[];
  contacts: NpcProfile[]; charAvatar?: string; userProfile?: UserProfile;
}) {
  const [reply, setReply] = useState<{ postId: string; commentId?: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const commentInput = useRef<HTMLInputElement>(null);

  const avatar = (id: string) => id === characterId ? charAvatar
    : id === 'user' ? (userProfile?.perCharAvatars?.[characterId] || userProfile?.avatar)
    : contacts.find(p => p.id === id)?.avatar;
  const label = (id: string) => id === characterId ? name
    : id === 'user' ? '我'
    : contacts.find(p => p.id === id)?.nickname || contacts.find(p => p.id === id)?.name || '微信好友';

  useEffect(() => {
    if (!actionsFor) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('[data-moments-actions-area]')) setActionsFor(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActionsFor(null);
    };
    const onScroll = () => setActionsFor(null);
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    // The menu should not remain floating over a different post after scrolling.
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [actionsFor]);

  useEffect(() => {
    if (reply) {
      const frame = requestAnimationFrame(() => commentInput.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
  }, [reply]);

  const startComment = (postId: string, commentId?: string) => {
    setActionsFor(null);
    setDraft('');
    setReply({postId, ...(commentId ? {commentId} : {})});
  };

  return <section className="bg-white" data-testid="moments-timeline">
    {posts.filter(p => !p.deletedAt).map(p => {
      const activeComments = (p.comments || []).filter(c => !c.deletedAt);
      const liked = !!p.likes?.some(l => l.actorId === 'user');
      const replyTarget = reply?.postId === p.id && reply.commentId
        ? activeComments.find(c => c.id === reply.commentId) : null;
      return <article key={p.id} data-testid={'moment-post-' + p.id}
        className={'relative flex gap-3 border-b border-[#eeeeee] px-4 py-5 '+(actionsFor === p.id ? 'z-20' : '')}>
        <PhoneAvatar key={avatar(p.authorId) || label(p.authorId)} src={avatar(p.authorId)} name={label(p.authorId)}
          className="h-11 w-11 rounded-md text-lg"/>
        <div className="min-w-0 flex-1">
          <strong className="text-[15px] font-semibold text-[#576b95]">{label(p.authorId)}</strong>
          <p className="mt-1.5 whitespace-pre-wrap break-words text-[15px] leading-[1.55] text-[#222]">{p.text}</p>
          {!!p.imageUrls?.length && <div className="mt-2 grid grid-cols-3 gap-1">
            {p.imageUrls.map((url, i) => <TokenImg key={i} value={url}
              alt={p.media?.find(media => media.url === url)?.prompt || '朋友圈图片'}
              className="aspect-square w-full object-cover"/>)}
          </div>}
          {p.provenance?.imageIsIllustrative && <p className="mt-1 text-xs text-gray-400">AI 生成配图</p>}

          <div className="relative mt-2.5 flex min-h-[30px] items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5 text-xs text-[#a6a6a6]">
              <time className="truncate" dateTime={new Date(p.createdAt).toISOString()}
                title={new Date(p.createdAt).toLocaleString('zh-CN')}>
                {formatMomentsTime(p.createdAt)}
              </time>
              {p.authorId === characterId && <button type="button"
                data-testid={'moment-delete-' + p.id}
                aria-label="删除这条朋友圈"
                title="删除这条朋友圈"
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-[#607294] active:opacity-60"
                onClick={() => {
                  setActionsFor(null);
                  if (window.confirm('删除这条朋友圈？')) deleteCharacterMoment(characterId, p.id, 'user');
                }}>
                <Trash size={15} weight="fill" aria-hidden="true"/>
              </button>}
            </div>
            <div className="relative shrink-0" data-moments-actions-area>
              <button type="button" data-testid={'moment-more-' + p.id}
                aria-label="朋友圈点赞评论操作" aria-expanded={actionsFor === p.id}
                aria-haspopup="true"
                onClick={() => setActionsFor(current => current === p.id ? null : p.id)}
                className="flex h-[30px] w-[36px] items-center justify-center rounded-[5px] bg-[#f5f6f8] text-[#52688d] active:bg-[#eceef2]">
                <DotsThree size={24} weight="bold" aria-hidden="true"/>
              </button>
              {actionsFor === p.id && <div data-testid={'moment-actions-' + p.id}
                role="group" aria-label="朋友圈操作"
                className="absolute right-[calc(100%+11px)] top-1/2 z-30 flex h-[45px] w-[184px] -translate-y-1/2 items-center rounded-[5px] bg-[#4b4b4b] text-white shadow-[0_2px_10px_rgba(0,0,0,.18)]">
                <span aria-hidden="true" className="absolute -right-[5px] top-1/2 h-[10px] w-[10px] -translate-y-1/2 rotate-45 rounded-[1px] bg-[#4b4b4b]"/>
                <button type="button" data-testid={'moment-like-action-' + p.id}
                  onClick={() => { setMomentLike(characterId, p.id, 'user', !liked); setActionsFor(null); }}
                  className="relative z-10 flex h-full min-w-0 flex-1 items-center justify-center gap-1.5 text-[14px] active:bg-[#626262]">
                  <Heart size={19} weight={liked ? 'fill' : 'regular'}
                    className={liked ? 'text-[#f05a60]' : 'text-white'} aria-hidden="true"/>
                  <span>{liked ? '取消' : '赞'}</span>
                </button>
                <span aria-hidden="true" className="h-[24px] w-px bg-[#757575]"/>
                <button type="button" data-testid={'moment-comment-action-' + p.id}
                  onClick={() => startComment(p.id)}
                  className="relative z-10 flex h-full min-w-0 flex-1 items-center justify-center gap-1.5 text-[14px] active:bg-[#626262]">
                  <ChatCircle size={19} weight="regular" aria-hidden="true"/>
                  <span>评论</span>
                </button>
              </div>}
            </div>
          </div>

          {(!!p.likes?.length || !!activeComments.length) && <div
            data-testid={'moment-reactions-' + p.id}
            className="mt-2 overflow-hidden rounded-[6px] bg-[#f5f5f5] text-[14px] leading-[1.5]">
            {!!p.likes?.length && <div data-testid={'moment-likes-' + p.id}
              className="flex items-start gap-1.5 px-2.5 py-2 text-[#576b95]">
              <Heart size={17} weight="regular" className="mt-0.5 shrink-0" aria-hidden="true"/>
              <span className="min-w-0 break-words font-medium">{p.likes.map(l => label(l.actorId)).join('、')}</span>
            </div>}
            {!!activeComments.length && <div
              className={(p.likes?.length ? 'border-t border-[#e4e4e4] ' : '') + 'space-y-1 px-2.5 py-2'}>
              {activeComments.map(c => {
                const target = c.replyToId ? activeComments.find(item => item.id === c.replyToId) : null;
                return <button type="button" key={c.id}
                  aria-label={'回复' + label(c.authorId)}
                  className="block w-full break-words text-left text-[14px] leading-[1.5] text-[#252525] active:opacity-70"
                  onClick={() => startComment(p.id, c.id)}>
                  <span className="font-semibold text-[#576b95]">{label(c.authorId)}</span>
                  {target && <>回复<span className="font-semibold text-[#576b95]">{label(target.authorId)}</span></>}：
                  {c.text}
                </button>;
              })}
            </div>}
          </div>}

          {reply?.postId === p.id && <form className="mt-2.5 flex items-center gap-2 rounded-md bg-[#f6f6f6] p-2"
            onSubmit={e => {
              e.preventDefault();
              if (!draft.trim()) return;
              const saved = addMomentComment(characterId, p.id, {
                id: crypto.randomUUID(), authorId: 'user', text: draft.trim(), createdAt: Date.now(),
                ...(reply?.commentId ? { replyToId: reply.commentId } : {}),
              });
              if (saved) { setDraft(''); setReply(null); }
            }}>
            <input ref={commentInput} aria-label="评论" value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder={replyTarget ? '回复' + label(replyTarget.authorId) : '发表评论'}
              className="h-9 min-w-0 flex-1 rounded border border-[#dfdfdf] bg-white px-2.5 text-[14px] outline-none focus:border-[#8db7a5]"/>
            <button type="submit" disabled={!draft.trim()}
              className="shrink-0 rounded bg-[#07b75d] px-3 py-2 text-[13px] font-medium text-white disabled:opacity-40">发送</button>
            <button type="button" aria-label="取消评论" onClick={() => {setReply(null);setDraft('');}}
              className="shrink-0 text-xs text-[#888]">取消</button>
          </form>}
        </div>
      </article>;
    })}
  </section>;
}
