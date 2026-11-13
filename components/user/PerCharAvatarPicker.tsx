import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { processImage } from '../../utils/file';
import { migrateDataUrlToRef } from '../../utils/blobRef';
import TokenImg from '../os/TokenImg';
import { beginUserSaveOperation } from '../../utils/userSaves';

/**
 * 档案 App「分角色聊天头像」：给每个角色的私聊单独设置「你」的头像。
 * 不设置 = 用档案上面的整体头像（宏观默认）；数据存 userProfile.perCharAvatars，
 * 随 user_profile 单例进备份。群聊仍用整体头像。
 *
 * 角色可能很多：搜索过滤 + 每页 8 个的翻页网格（左右箭头 / 横滑 / 圆点直达），
 * 翻页带轻量滑入动效。头像来源支持图床 URL（推荐，轻量）与本地上传。
 */

const PAGE_SIZE = 8;

const isValidHttpImageUrl = (value: string) => {
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
        return false;
    }
};

const PerCharAvatarPicker: React.FC = () => {
    const { characters, userProfile, updateUserProfile, addToast } = useOS();
    const overrides = userProfile.perCharAvatars || {};
    const boundCharacterIds = useMemo(() => new Set(userProfile.boundCharacterIds || []), [userProfile.boundCharacterIds]);
    const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pressOrigin = useRef<{ x: number; y: number } | null>(null);
    const suppressClickUntil = useRef(0);
    useEffect(() => () => { if (pressTimer.current !== null) clearTimeout(pressTimer.current); }, []);
    const clearPress = () => {
        if (pressTimer.current !== null) clearTimeout(pressTimer.current);
        pressTimer.current = null;
        pressOrigin.current = null;
    };
    const toggleBinding = async (charId: string) => {
        let release: (() => void) | undefined;
        try {
            release = beginUserSaveOperation('保存身份绑定');
            await updateUserProfile(prev => {
                const existing = new Set((prev.boundCharacterIds || []).filter(id => characters.some(c => c.id === id)));
                if (existing.has(charId)) existing.delete(charId);
                else existing.add(charId);
                return { boundCharacterIds: characters.filter(c => existing.has(c.id)).map(c => c.id) };
            });
        } catch (error) {
            addToast(error instanceof Error ? error.message : '绑定保存失败', 'error');
        } finally { release?.(); }
    };
    const startPress = (charId: string, event: React.PointerEvent<HTMLButtonElement>) => {
        if (!event.isPrimary || event.button !== 0) return;
        clearPress();
        pressOrigin.current = { x: event.clientX, y: event.clientY };
        pressTimer.current = setTimeout(() => {
            pressTimer.current = null;
            pressOrigin.current = null;
            suppressClickUntil.current = Date.now() + 850;
            void toggleBinding(charId);
        }, 550);
    };
    const movePress = (event: React.PointerEvent<HTMLButtonElement>) => {
        const start = pressOrigin.current;
        if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) clearPress();
    };

    const [query, setQuery] = useState('');
    const [page, setPage] = useState(0);
    const [slideDir, setSlideDir] = useState<'l' | 'r'>('l');
    const swipeStartX = useRef<number | null>(null);

    const [editingId, setEditingId] = useState<string | null>(null);
    const [urlDraft, setUrlDraft] = useState('');
    const uploadRef = useRef<HTMLInputElement>(null);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return q ? characters.filter(c => c.name.toLowerCase().includes(q)) : characters;
    }, [characters, query]);

    const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const safePage = Math.min(page, pageCount - 1);
    const pageChars = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

    const goPage = (next: number) => {
        const clamped = Math.max(0, Math.min(pageCount - 1, next));
        if (clamped === safePage) return;
        setSlideDir(clamped > safePage ? 'l' : 'r');
        setPage(clamped);
    };

    const saveOverride = async (charId: string, load: () => Promise<string | undefined>): Promise<boolean> => {
        let release: (() => void) | undefined;
        try {
            release = beginUserSaveOperation('保存分角色头像');
            const avatar = await load();
            await updateUserProfile(prev => {
                const next = { ...prev.perCharAvatars };
                if (avatar) next[charId] = avatar; else delete next[charId];
                return { perCharAvatars: next };
            });
            return true;
        } catch (error) {
            addToast(error instanceof Error ? error.message : '头像保存失败，请重试', 'error');
            return false;
        } finally { release?.(); }
    };

    const editingChar = editingId ? characters.find(c => c.id === editingId) : null;
    const editingOverride = editingId ? overrides[editingId] : undefined;

    const openEditor = (charId: string) => {
        setEditingId(charId);
        const cur = overrides[charId];
        // 只有 http(s) 直链才回填进外链输入框——上传来的图（内嵌 data: 或 blobref 令牌）
        // 填进去既没法看也没法改，而且这个框本来也只收 http(s)（见下面 applyUrl 的校验）。
        setUrlDraft(cur && isValidHttpImageUrl(cur) ? cur : '');
    };

    const applyUrl = async () => {
        if (!editingId) return;
        const url = urlDraft.trim();
        if (!isValidHttpImageUrl(url)) {
            addToast('URL 无效，请填写 http(s) 图片直链', 'error');
            return;
        }
        if (await saveOverride(editingId, async () => url)) addToast('已设置该角色的聊天头像', 'success');
    };

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file || !editingId) return;
        const saved = await saveOverride(editingId, async () => migrateDataUrlToRef(await processImage(file)));
        if (saved) {
            setUrlDraft('');
            addToast('已设置该角色的聊天头像', 'success');
        }
    };

    if (characters.length === 0) return null;

    return (
        <div className="bg-white rounded-[1.75rem] shadow-[0_10px_30px_-12px_rgba(80,70,120,0.18)] border border-slate-100 p-5">
            {/* 翻页滑入动效（组件私有，不进全局 tailwind 配置） */}
            <style>{`
                @keyframes pcaSlideL { from { opacity: .35; transform: translateX(26px); } to { opacity: 1; transform: none; } }
                @keyframes pcaSlideR { from { opacity: .35; transform: translateX(-26px); } to { opacity: 1; transform: none; } }
                .pca-slide-l { animation: pcaSlideL .28s cubic-bezier(0.25, 1, 0.5, 1); }
                .pca-slide-r { animation: pcaSlideR .28s cubic-bezier(0.25, 1, 0.5, 1); }
            `}</style>

            <div className="flex items-center gap-2 mb-1">
                <span className="w-7 h-7 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-4 h-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17.982 18.725A7.488 7.488 0 0 0 12 15.75a7.488 7.488 0 0 0-5.982 2.975m11.963 0a9 9 0 1 0-11.963 0m11.963 0A8.966 8.966 0 0 1 12 21a8.966 8.966 0 0 1-5.982-2.275M15 9.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                    </svg>
                </span>
                <h2 className="text-sm font-bold text-slate-700">分角色聊天头像</h2>
            </div>
            <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
                和不同角色聊天时，「你」可以顶着不同的头像。这里不设置的角色，用上面的整体头像；群聊始终用整体头像。
            </p>

            {characters.length > PAGE_SIZE && (
                <input
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setPage(0); }}
                    placeholder="搜索角色…"
                    className="w-full mb-3 bg-slate-50 focus:bg-white border border-slate-100 focus:border-primary/30 rounded-2xl px-4 py-2 text-xs text-slate-700 outline-none transition-all placeholder:text-slate-300"
                />
            )}

            {filtered.length === 0 ? (
                <div className="py-8 text-center text-[11px] text-slate-300">没有叫这个名字的角色</div>
            ) : (
                <div
                    onTouchStart={(e) => { swipeStartX.current = e.touches[0]?.clientX ?? null; }}
                    onTouchEnd={(e) => {
                        const startX = swipeStartX.current;
                        swipeStartX.current = null;
                        const endX = e.changedTouches[0]?.clientX;
                        if (startX == null || endX == null) return;
                        const dx = endX - startX;
                        if (Math.abs(dx) > 48) goPage(safePage + (dx < 0 ? 1 : -1));
                    }}
                >
                    <div key={`${safePage}-${query}`} className={`grid grid-cols-4 gap-2 min-[360px]:gap-3 ${slideDir === 'l' ? 'pca-slide-l' : 'pca-slide-r'}`}>
                        {pageChars.map(c => {
                            const override = overrides[c.id];
                            const bound = boundCharacterIds.has(c.id);
                            return (
                                <button key={c.id} type="button" aria-pressed={bound} aria-label={`${c.name}，长按切换身份绑定`}
                                    onPointerDown={event => startPress(c.id, event)}
                                    onPointerMove={movePress}
                                    onPointerUp={clearPress}
                                    onPointerCancel={clearPress}
                                    onPointerLeave={clearPress}
                                    onContextMenu={event => { event.preventDefault(); clearPress(); if (Date.now() >= suppressClickUntil.current) { suppressClickUntil.current = Date.now() + 850; void toggleBinding(c.id); } }}
                                    onClick={() => { if (Date.now() < suppressClickUntil.current) return; openEditor(c.id); }}
                                    className="flex flex-col items-center gap-1.5 group active:scale-95 transition-transform touch-manipulation">
                                    <div className="relative">
                                        <TokenImg value={c.avatar} alt="" className={`w-12 h-12 min-[360px]:w-14 min-[360px]:h-14 rounded-full object-cover bg-slate-100 border border-slate-100 transition-all ${bound ? 'ring-2 ring-primary ring-offset-2 ring-offset-white shadow-[0_2px_12px_rgba(90,90,90,0.16)]' : 'group-hover:border-primary/30'}`} />
                                        {bound && <span aria-hidden="true" className="absolute -top-1.5 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white ring-2 ring-white shadow-sm pointer-events-none">
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3"><path d="m5 12 4 4L19 6" /></svg>
                                        </span>}
                                        {/* 右下小圆 = 这个聊天里「你」的头像；设置过 → 主题色描边，否则灰显整体头像 */}
                                        <TokenImg
                                            value={override || userProfile.avatar}
                                            alt=""
                                            className={`absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-full object-cover bg-white shadow-sm ${override ? 'ring-2 ring-primary' : 'ring-2 ring-white opacity-60'}`}
                                        />
                                    </div>
                                    <span className="w-full text-[10px] text-slate-500 truncate text-center">{c.name}</span>
                                </button>
                            );
                        })}
                        {/* 末页不满 8 人时用隐形占位补齐两行高度，翻页时容器不弹跳 */}
                        {pageCount > 1 && pageChars.length < PAGE_SIZE && Array.from({ length: PAGE_SIZE - pageChars.length }, (_, i) => (
                            <div key={`pad-${i}`} className="flex flex-col items-center gap-1.5 invisible" aria-hidden="true">
                                <div className="w-12 h-12 min-[360px]:w-14 min-[360px]:h-14 rounded-full" />
                                <span className="text-[10px]">&nbsp;</span>
                            </div>
                        ))}
                    </div>

                    {pageCount > 1 && (
                        <div className="mt-3 flex items-center justify-center gap-3">
                            <button onClick={() => goPage(safePage - 1)} disabled={safePage === 0}
                                className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-sm text-slate-500 transition-all active:scale-90 disabled:opacity-30" aria-label="上一页">‹</button>
                            <div className="flex items-center gap-1.5">
                                {Array.from({ length: pageCount }, (_, i) => (
                                    <button key={i} onClick={() => goPage(i)} aria-label={`第 ${i + 1} 页`}
                                        className={`rounded-full transition-all ${i === safePage ? 'w-4 h-1.5 bg-primary' : 'w-1.5 h-1.5 bg-slate-200 hover:bg-slate-300'}`} />
                                ))}
                            </div>
                            <button onClick={() => goPage(safePage + 1)} disabled={safePage === pageCount - 1}
                                className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-sm text-slate-500 transition-all active:scale-90 disabled:opacity-30" aria-label="下一页">›</button>
                        </div>
                    )}
                </div>
            )}

            {/* 编辑弹层：URL 优先（推荐）+ 本地上传 + 恢复整体头像 */}
            {editingChar && (
                <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/30 backdrop-blur-sm animate-fade-in" onClick={() => setEditingId(null)}>
                    <div className="w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 animate-slide-up sm:animate-pop-in"
                        style={{ paddingBottom: 'calc(1.25rem + var(--safe-bottom))' }}
                        onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-start justify-between mb-3">
                            <div>
                                <div className="text-sm font-bold text-slate-800">和 {editingChar.name} 聊天时，你的头像</div>
                                <div className="mt-0.5 text-[10px] text-slate-400">只影响这个角色的私聊；其他聊天不变。</div>
                            </div>
                            <button onClick={() => setEditingId(null)} className="px-2 text-xl leading-none text-slate-400 hover:text-slate-600">×</button>
                        </div>

                        <div className="flex items-center justify-center gap-5 mb-4">
                            <div className="flex flex-col items-center gap-1">
                                <TokenImg value={editingChar.avatar} className="w-16 h-16 rounded-full object-cover bg-slate-100" alt="" />
                                <span className="text-[10px] text-slate-400">{editingChar.name}</span>
                            </div>
                            <span className="text-slate-300 text-lg">×</span>
                            <div className="flex flex-col items-center gap-1">
                                <TokenImg value={editingOverride || userProfile.avatar} className={`w-16 h-16 rounded-full object-cover bg-slate-100 ${editingOverride ? 'ring-2 ring-primary' : 'ring-2 ring-slate-200'}`} alt="" />
                                <span className="text-[10px] text-slate-400">{editingOverride ? '已单独设置' : '整体头像（默认）'}</span>
                            </div>
                        </div>

                        <div className="rounded-2xl bg-slate-50 p-3 mb-2">
                            <div className="text-[11px] font-bold text-slate-600 mb-1.5">图床链接（推荐）</div>
                            <div className="flex gap-2">
                                <input
                                    value={urlDraft}
                                    onChange={(e) => setUrlDraft(e.target.value)}
                                    placeholder="https://… 图片直链"
                                    className="flex-1 min-w-0 bg-white border border-slate-200 focus:border-primary/40 rounded-xl px-3 py-2 text-xs text-slate-700 outline-none transition-all placeholder:text-slate-300"
                                />
                                <button onClick={applyUrl} className="shrink-0 rounded-xl bg-primary px-3 py-2 text-[11px] font-bold text-white active:scale-95 transition-transform">使用</button>
                            </div>
                            <p className="mt-1.5 text-[10px] leading-relaxed text-slate-400">
                                推荐链接：不占本地空间，备份更小更快；「纯文字备份」也只有链接能把图带走（本地上传的图会被剥掉）。
                            </p>
                        </div>

                        <div className="flex gap-2">
                            <button onClick={() => uploadRef.current?.click()}
                                className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-[11px] font-bold text-slate-600 active:scale-[0.98] transition-transform">
                                本地上传（存进本机）
                            </button>
                            {editingOverride && (
                                <button
                                    onClick={async () => { if (await saveOverride(editingChar.id, async () => undefined)) { setUrlDraft(''); addToast('已恢复整体头像', 'success'); } }}
                                    className="flex-1 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-2.5 text-[11px] font-bold text-neutral-500 active:scale-[0.98] transition-transform">
                                    恢复整体头像
                                </button>
                            )}
                        </div>
                        <input type="file" ref={uploadRef} className="hidden" accept="image/*" onChange={handleUpload} />
                    </div>
                </div>
            )}
        </div>
    );
};

export default PerCharAvatarPicker;
