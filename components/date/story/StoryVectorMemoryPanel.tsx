import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CaretLeft, CaretRight, Check, DotsThree, PencilSimple, SpinnerGap, Trash, X } from '@phosphor-icons/react';
import type { StoryTheaterEntry, StoryTheaterMask } from '../../../types';
import type { MemoryNode } from '../../../utils/memoryPalace/types';
import { useOS } from '../../../context/OSContext';
import { deleteStoryVectorMemory, listStoryVectorMemories, updateStoryVectorMemory } from '../../../utils/storyTheaterVectorMemory';
import StoryArchivePanel, { ArchiveIcon } from './StoryArchivePanel';
import { runStoryArchiveOperation } from '../../../utils/storyTheaterBackground';
import { DB } from '../../../utils/db';
import { filterStoryArchiveBaselineRepeats, storyArchiveModality, storyArchiveSourceTimes } from '../../../utils/storyArchiveFacts';
import { storyArchiveFloors } from '../../../utils/storyTheaterArchive';
import { resolveStoryTheaterMask, resolveStoryTheaterWorldbooks, storyTheaterThreadId } from '../../../utils/storyTheater';

interface Props {
    entry: StoryTheaterEntry;
    masks?: StoryTheaterMask[];
    onBack: () => void;
    onUpdated: (entry: StoryTheaterEntry) => void;
}

const PAGE_SIZE = 10;

const StoryVectorMemoryPanel: React.FC<Props> = ({ entry, masks = [], onBack, onUpdated }) => {
    const { memoryPalaceConfig, remoteVectorConfig, addToast, userProfile, characters, worldbooks } = useOS();
    const [nodes, setNodes] = useState<MemoryNode[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [page, setPage] = useState(0);
    const [showRepeatedSetup, setShowRepeatedSetup] = useState(false);
    const [menuNode, setMenuNode] = useState<MemoryNode | null>(null);
    const [editing, setEditing] = useState<MemoryNode | null>(null);
    const [deleting, setDeleting] = useState<MemoryNode | null>(null);
    const [draft, setDraft] = useState('');
    const [floorNumbers, setFloorNumbers] = useState<Map<number, number>>(new Map());
    const [sourceTimes, setSourceTimes] = useState<Map<number, string>>(new Map());
    const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(new Set());
    const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const addToastRef = useRef(addToast);

    useEffect(() => { addToastRef.current = addToast; }, [addToast]);
    useEffect(() => {
        let active = true;
        setLoading(true);
        void listStoryVectorMemories(entry.id).then(rows => {
            if (active) setNodes(rows);
        }).catch((error: any) => {
            if (active) addToastRef.current(error?.message || '读取剧情向量记忆失败', 'error');
        }).finally(() => {
            if (active) setLoading(false);
        });
        return () => { active = false; };
    }, [entry.id, entry.updatedAt]);
    useEffect(() => {
        let active = true;
        void DB.getMessagesByCharId(storyTheaterThreadId(entry.id), true).then(rows => {
            if (!active) return;
            const floors = storyArchiveFloors(rows, entry.id);
            setFloorNumbers(new Map(floors.map((row, index) => [row.id, index + 1])));
            setSourceTimes(storyArchiveSourceTimes(floors));
        }).catch(error => console.warn('[StoryTheater] vector archive floor labels unavailable', error));
        return () => { active = false; };
    }, [entry.id, entry.updatedAt]);
    const factByNodeId = useMemo(() => new Map(entry.archives.flatMap(box =>
        (box.facts ?? []).flatMap(fact => fact.vectorNodeId
            ? [[fact.vectorNodeId, fact] as const] : []))), [entry.archives]);
    const staticSetup = useMemo(() => {
        const mask = resolveStoryTheaterMask(entry.mask, userProfile, characters, masks);
        const books = resolveStoryTheaterWorldbooks(worldbooks ?? [], characters)
            .filter(book => entry.selectedWorldbookIds?.includes(book.id) && book.disable !== true);
        return [entry.premise, mask.name, mask.description, mask.coreInstruction, mask.worldview,
            ...characters.filter(char => entry.characterIds.includes(char.id))
                .flatMap(char => [char.description, char.systemPrompt, char.worldview]),
            ...books.map(book => book.content),
        ].filter(Boolean).join('\n');
    }, [entry, userProfile, characters, worldbooks, masks]);
    const repeatedSetupIds = useMemo(() => {
        const facts = nodes.flatMap(node => {
            const fact = factByNodeId.get(node.id);
            return fact ? [{ ...fact, text: node.content }] : [];
        });
        const visible = new Set(filterStoryArchiveBaselineRepeats(facts, entry.archives, staticSetup).map(fact => fact.vectorNodeId));
        return new Set(facts.flatMap(fact => fact.vectorNodeId && !visible.has(fact.vectorNodeId) ? [fact.vectorNodeId] : []));
    }, [nodes, factByNodeId, entry.archives, staticSetup]);
    const currentByKey = useMemo(() => {
        const current = new Map<string, number>();
        for (const box of entry.archives) for (const fact of box.facts ?? []) {
            current.set(fact.key, Math.max(current.get(fact.key) ?? -Infinity, fact.sourceMessageId));
        }
        return current;
    }, [entry.archives]);
    const filteredNodes = useMemo(() => nodes.filter(node => showRepeatedSetup || !repeatedSetupIds.has(node.id)),
        [nodes, showRepeatedSetup, repeatedSetupIds]);
    const pageCount = Math.max(1, Math.ceil(filteredNodes.length / PAGE_SIZE));
    useEffect(() => { if (page >= pageCount) setPage(pageCount - 1); }, [pageCount, page]);
    useEffect(() => () => {
        if (pressTimer.current) clearTimeout(pressTimer.current);
    }, []);

    const visibleNodes = useMemo(() => [...filteredNodes].sort((a, b) =>
        (factByNodeId.get(a.id)?.sourceMessageId ?? Infinity) - (factByNodeId.get(b.id)?.sourceMessageId ?? Infinity)
        || a.createdAt - b.createdAt).slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
        [filteredNodes, page, factByNodeId]);

    const cancelLongPress = () => {
        if (pressTimer.current) clearTimeout(pressTimer.current);
        pressTimer.current = null;
    };

    const beginLongPress = (node: MemoryNode) => {
        cancelLongPress();
        pressTimer.current = setTimeout(() => {
            setMenuNode(node);
            pressTimer.current = null;
            if ('vibrate' in navigator) navigator.vibrate?.(12);
        }, 520);
    };

    const openEdit = (node: MemoryNode) => {
        setMenuNode(null);
        setEditing(node);
        setDraft(node.content);
    };

    const refreshArchive = async () => {
        try {
            const saved = (await DB.getStoryTheaters()).find(story => story.id === entry.id);
            if (saved) onUpdated(saved);
        } catch (error) {
            console.warn('[StoryTheater] could not refresh edited archive', error);
        }
    };

    const saveEdit = async () => {
        if (!editing || !draft.trim() || saving) return;
        setSaving(true);
        try {
            const updated = await updateStoryVectorMemory(entry.id, editing.id, draft, memoryPalaceConfig.embedding, remoteVectorConfig);
            setNodes(current => current.map(node => node.id === updated.id ? updated : node));
            setEditing(null);
            await refreshArchive();
            addToast('剧情记忆与向量已同步更新', 'success');
        } catch (error: any) {
            addToast(error?.message || '剧情记忆修改失败', 'error');
        } finally {
            setSaving(false);
        }
    };

    const confirmDelete = async () => {
        if (!deleting || saving) return;
        setSaving(true);
        try {
            const result = await runStoryArchiveOperation(entry.id, () => deleteStoryVectorMemory(entry.id, deleting.id, remoteVectorConfig));
            setNodes(current => current.filter(node => node.id !== deleting.id));
            setDeleting(null);
            await refreshArchive();
            addToast(result.remoteDeleted === false ? '本地已删除；远端暂未同步，请检查网络' : '已从本剧情向量分区删除', result.remoteDeleted === false ? 'info' : 'success');
        } catch (error: any) {
            addToast(error?.message || '剧情记忆删除失败', 'error');
        } finally {
            setSaving(false);
        }
    };

    return <StoryArchivePanel entry={entry} masks={masks} onBack={onBack} onUpdated={onUpdated} strategy='vector' locked={saving}>
            <section aria-label='向量节点'>
                <div className='flex flex-wrap items-baseline justify-between gap-2 pb-3'>
                    <h2 className='text-sm font-semibold'>向量记忆 · {filteredNodes.length} 条</h2>
                    {!!repeatedSetupIds.size && <button type='button' className='text-xs text-slate-600 underline'
                        aria-pressed={showRepeatedSetup} onClick={() => { setPage(0); setShowRepeatedSetup(value => !value); }}>
                        {showRepeatedSetup ? '收起已有人设' : `查看已有人设（${repeatedSetupIds.size}）`}
                    </button>}
                </div>
                {loading ? <div className='py-6 grid place-items-center text-slate-400'><SpinnerGap size={24} className='animate-spin' /></div> : !filteredNodes.length ? <p className='py-3 text-xs text-slate-500'>暂无剧情向量记忆</p> : <>
                    <div className='space-y-2.5'>{visibleNodes.map(node => {
                        const fact = factByNodeId.get(node.id);
                        const floor = fact && floorNumbers.get(fact.sourceMessageId);
                        const time = fact && (fact.storyTime || sourceTimes.get(fact.sourceMessageId));
                        const modality = fact && storyArchiveModality(fact);
                        const label = repeatedSetupIds.has(node.id) ? '已有人设'
                            : fact && (currentByKey.get(fact.key) ?? 0) > fact.sourceMessageId ? '过去的状态'
                            : modality === 'planned' ? '仅是计划' : modality === 'unverified' ? '尚未证实'
                            : fact?.kind === 'author' ? '写作要求' : '';
                        const expanded = expandedNodeIds.has(node.id);
                        const firstSentence = node.content.match(/^[^。！？\n]+[。！？]/u)?.[0];
                        const preview = firstSentence && firstSentence.length <= 84 ? firstSentence : node.content.slice(0, 84);
                        const canExpand = node.content.length > 84;
                        return <article key={node.id}
                            onPointerDown={() => beginLongPress(node)} onPointerUp={cancelLongPress}
                            onPointerCancel={cancelLongPress} onPointerLeave={cancelLongPress}
                            onContextMenu={event => { event.preventDefault(); cancelLongPress(); setMenuNode(node); }}
                            className='relative rounded-xl border border-slate-200 bg-white py-3 pl-3.5 pr-11'>
                            <div className='flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[12px] leading-5'>
                                <strong className='font-semibold'>{time || (floor ? '第 ' + floor + ' 楼' : '旧记忆')}</strong>
                                {time && floor && <span className='text-slate-600'>第 {floor} 楼</span>}
                                {!time && <span className='text-slate-600'>时间未明确</span>}
                                {label && <span className='rounded bg-stone-100 px-1.5 text-[11px] text-slate-700'>{label}</span>}
                            </div>
                            <p className='mt-1.5 whitespace-pre-wrap break-words text-sm leading-6'>
                                {!canExpand || expanded ? node.content : preview + '…'}
                            </p>
                            {canExpand && <button type='button' className='mt-1.5 text-xs text-slate-600 underline'
                                aria-expanded={expanded} onPointerDown={event => event.stopPropagation()} onClick={() => setExpandedNodeIds(current => {
                                    const next = new Set(current);
                                    if (next.has(node.id)) next.delete(node.id);
                                    else next.add(node.id);
                                    return next;
                                })}>{expanded ? '收起全文' : '查看完整记忆'}</button>}
                            <button onClick={() => setMenuNode(node)} onPointerDown={event => event.stopPropagation()}
                                className='absolute right-1 top-1 grid size-10 place-items-center rounded-full text-slate-600'
                                aria-label='记忆操作'><DotsThree size={18} weight='bold' /></button>
                        </article>;
                    })}</div>
                    {pageCount > 1 && <nav className='pt-6 border-t border-slate-200 flex items-center justify-between'><button disabled={page === 0} onClick={() => setPage(current => Math.max(0, current - 1))} className='w-10 h-10 rounded-full bg-white border border-slate-200 grid place-items-center disabled:opacity-25'><CaretLeft size={15} /></button><span className='text-[10px] text-slate-500'>第 {page + 1} / {pageCount} 页</span><button disabled={page + 1 >= pageCount} onClick={() => setPage(current => Math.min(pageCount - 1, current + 1))} className='w-10 h-10 rounded-full bg-white border border-slate-200 grid place-items-center disabled:opacity-25'><CaretRight size={15} /></button></nav>}
                </>}
            </section>

        {menuNode && <div className='fixed inset-0 z-[80] bg-slate-950/35 flex items-end justify-center' onClick={() => setMenuNode(null)}><div className='story-safe-sheet w-full sm:max-w-sm rounded-t-[28px] bg-stone-100 px-5 pt-5 shadow-2xl' onClick={event => event.stopPropagation()}><div className='flex items-center justify-between'><div><div className='text-[9px] uppercase tracking-[.2em] text-neutral-500 font-bold'>Memory action</div><h3 className='mt-1 font-semibold'>这条剧情记忆</h3></div><button onClick={() => setMenuNode(null)} className='w-9 h-9 rounded-full bg-white border border-slate-200 grid place-items-center'><X size={15} /></button></div><div className='mt-5 border-t border-slate-200'><button onClick={() => openEdit(menuNode)} className='w-full py-4 flex items-center gap-3 text-sm font-semibold'><PencilSimple size={18} className='text-neutral-500' />编辑文字并重建向量</button><button onClick={() => { setDeleting(menuNode); setMenuNode(null); }} className='w-full py-4 border-t border-slate-200 flex items-center gap-3 text-sm font-semibold text-neutral-600'><Trash size={18} />删除这条记忆</button></div></div></div>}

        {editing && <div className='fixed inset-0 z-[80] bg-slate-950/35 flex items-end justify-center' onClick={() => !saving && setEditing(null)}><div className='story-safe-sheet story-keyboard-sheet w-full sm:max-w-lg rounded-t-[28px] bg-stone-100 px-5 pt-5 shadow-2xl' onClick={event => event.stopPropagation()}><div className='flex items-start justify-between gap-3'><div><div className='text-[9px] uppercase tracking-[.2em] text-neutral-500 font-bold'>Re-embed</div><h3 className='mt-1 font-semibold'>编辑剧情记忆</h3><p className='mt-1 text-[10px] text-slate-500'>正文变化后会沿用原 ID 重建向量，不会产生重复记忆。</p></div><button disabled={saving} onClick={() => setEditing(null)} className='w-9 h-9 rounded-full bg-white border border-slate-200 grid place-items-center'><X size={15} /></button></div><textarea autoFocus value={draft} onChange={event => setDraft(event.target.value)} className='mt-5 w-full min-h-40 resize-none rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 outline-none focus:border-neutral-400' /><div className='mt-2 flex justify-end'><ArchiveIcon label='保存并同步向量' disabled={saving || !draft.trim()} onClick={() => void saveEdit()}>{saving ? <SpinnerGap size={18} className='animate-spin' /> : <Check size={19} />}</ArchiveIcon></div></div></div>}

        {deleting && <div className='fixed inset-0 z-[80] bg-slate-950/35 flex items-end justify-center' onClick={() => !saving && setDeleting(null)}><div className='story-safe-sheet w-full sm:max-w-sm rounded-t-[28px] bg-stone-100 px-5 pt-5 shadow-2xl' onClick={event => event.stopPropagation()}><div className='text-[9px] uppercase tracking-[.2em] text-neutral-500 font-bold'>Delete memory</div><h3 className='mt-1 text-lg font-semibold'>删除后无法恢复</h3><p className='mt-2 text-[11px] leading-5 text-slate-500'>只会删除当前剧情分区内的这一条节点、向量和关联边。</p><div className='mt-5 grid grid-cols-2 gap-3'><button disabled={saving} onClick={() => setDeleting(null)} className='h-11 rounded-2xl bg-white border border-slate-200 text-xs font-bold'>取消</button><button disabled={saving} onClick={() => void confirmDelete()} className='h-11 rounded-2xl bg-neutral-600 text-white text-xs font-bold'>{saving ? '删除中…' : '确认删除'}</button></div></div></div>}
    </StoryArchivePanel>;
};

export default StoryVectorMemoryPanel;
