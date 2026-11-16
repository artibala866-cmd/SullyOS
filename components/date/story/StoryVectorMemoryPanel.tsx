import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CaretLeft, CaretRight, DotsThree, MagnifyingGlass, SpinnerGap, X, Eye, EyeSlash, ArrowClockwise, ArrowLeft, PencilSimple, Trash, FileText } from '@phosphor-icons/react';
import type { Message, StoryArchiveFact, StoryTheaterEntry, StoryTheaterMask } from '../../../types';
import type { MemoryNode } from '../../../utils/memoryPalace/types';
import { MemoryVectorDB } from '../../../utils/memoryPalace/db';
import { useLocalBackHandler } from '../../../hooks/useLocalBackHandler';
import { useOS } from '../../../context/OSContext';
import { deleteStoryVectorMemory, listStoryVectorMemories, loadStoryVectorRecall, readStoredStoryTheater, StoryVectorMemoryConflictError, updateStoryVectorMemory } from '../../../utils/storyTheaterVectorMemory';
import StoryArchivePanel, { ArchiveIcon } from './StoryArchivePanel';
import { runStoryArchiveOperation } from '../../../utils/storyTheaterBackground';
import { collectStoryArchiveFacts, filterStoryArchiveBaselineRepeats, readStoryRecallArchives, storyArchiveFactIdentity, storyArchiveFactTime, storyArchiveModality, storyArchiveSearchTerms, storyArchiveSourceTimes } from '../../../utils/storyArchiveFacts';
import { resolveStoryTheaterMask, resolveStoryTheaterWorldbooks } from '../../../utils/storyTheater';
import { StoryOutput } from './StoryTheaterSession';

interface Props {
    entry: StoryTheaterEntry;
    masks?: StoryTheaterMask[];
    onBack: () => void;
    onUpdated: (entry: StoryTheaterEntry) => void;
}

interface MemoryRecord {
    id: string;
    text: string;
    node?: MemoryNode;
    fact?: StoryArchiveFact;
    fallback?: boolean;
}

const PAGE_SIZE = 10;
const EMPTY_MASKS: StoryTheaterMask[] = [];
const entityTypeNames = { person:'人物', place:'地点', object:'物品', organization:'组织', event:'事件', code:'编号' };
const searchText = (text: string) => text.normalize('NFKC').toLowerCase();
const actionClass = 'story-memory-action story-memory-action-icon inline-grid h-11 w-11 shrink-0 place-items-center rounded-full disabled:opacity-40';

const StoryVectorMemoryPanel: React.FC<Props> = ({ entry, masks = EMPTY_MASKS, onBack, onUpdated }) => {
    const { memoryPalaceConfig, remoteVectorConfig, addToast, userProfile, characters, worldbooks } = useOS();
    const archives = useMemo(() => readStoryRecallArchives(entry.archives), [entry.archives]);
    const [nodes, setNodes] = useState<MemoryNode[]>([]);
    const [fallbackText, setFallbackText] = useState<ReadonlyMap<string, string>>(new Map());
    const [loading, setLoading] = useState(true);
    const [listError, setListError] = useState('');
    const [reload, setReload] = useState(0);
    const [saving, setSaving] = useState(false);
    const [page, setPage] = useState(0);
    const [query, setQuery] = useState('');
    const [showRepeatedSetup, setShowRepeatedSetup] = useState(false);
    const [floors, setFloors] = useState<Message[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [detailView, setDetailView] = useState<'memory' | 'source' | 'edit' | 'delete'>('memory');
    const [draft, setDraft] = useState('');
    const [baseContent, setBaseContent] = useState('');
    const [editError, setEditError] = useState('');
    const [indexState, setIndexState] = useState('');
    const dialogRef = useRef<HTMLDialogElement>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLElement>(null);
    const press = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);

    useEffect(() => {
        let active = true;
        void listStoryVectorMemories(entry.id).then(async rows => {
            const recall = await loadStoryVectorRecall({ ...entry, archives }, Infinity, rows);
            if (active) {
                setNodes(rows.filter(node => !node.archived));
                setFallbackText(recall.factTextById);
                setListError('');
            }
        }).catch(error => {
            if (active) setListError(error?.message || '读取剧情向量记忆失败');
        }).finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [entry, archives, reload]);

    const floorNumbers = useMemo(() => new Map(floors.map((row, index) => [row.id, index + 1])), [floors]);
    const floorById = useMemo(() => new Map(floors.map(row => [row.id, row])), [floors]);
    const sourceTimes = useMemo(() => storyArchiveSourceTimes(floors), [floors]);
    const vectorArchives = useMemo(() => archives.filter(box => box.strategy === 'vector'), [archives]);
    const factByNodeId = useMemo(() => new Map(vectorArchives.flatMap(box =>
        (box.facts ?? []).flatMap(fact => fact.vectorNodeId ? [[fact.vectorNodeId, fact] as const] : []))), [vectorArchives]);
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
    const records = useMemo<MemoryRecord[]>(() => {
        const liveIds = new Set(nodes.map(node => node.id));
        return [
            ...nodes.flatMap<MemoryRecord>(node => {
                const fact = factByNodeId.get(node.id);
                return fact?.vectorTextState === 'deleted' ? [] : [{ id:node.id, node, text:node.content, fact }];
            }),
            ...[...factByNodeId].flatMap<MemoryRecord>(([id, fact]) => {
                const text = fallbackText.get(id);
                return liveIds.has(id) || !text || fact.vectorTextState === 'deleted' ? [] : [{ id, text, fact, fallback:true }];
            }),
            ...vectorArchives.flatMap(box =>
                [...(box.historyFacts ?? []), ...(box.facts ?? []).filter(fact => !fact.vectorNodeId)]
                    .flatMap<MemoryRecord>((fact, index) => {
                        const text = fact.vectorNodeId ? fallbackText.get(fact.vectorNodeId) : fact.text;
                        return fact.vectorTextState === 'deleted' || !text?.trim() ? []
                            : [{ id:'archive-' + box.id + '-' + index, text, fact }];
                    })),
        ].sort((a, b) => (a.fact?.sourceMessageId ?? Infinity) - (b.fact?.sourceMessageId ?? Infinity)
            || (a.node?.createdAt ?? 0) - (b.node?.createdAt ?? 0));
    }, [nodes, factByNodeId, vectorArchives, fallbackText]);
    const currentIdentities = useMemo(() => new Set(collectStoryArchiveFacts(vectorArchives, Infinity, fallbackText, true)
        .map(storyArchiveFactIdentity)), [vectorArchives, fallbackText]);
    const repeatedSetupIds = useMemo(() => {
        const facts = records.flatMap(({ id, fact, text }) => fact && (fact.vectorNodeId === id) ? [{ ...fact, text }] : []);
        const visible = new Set(filterStoryArchiveBaselineRepeats(facts, vectorArchives, staticSetup).map(fact => fact.vectorNodeId));
        return new Set(facts.flatMap(fact => fact.vectorNodeId && !visible.has(fact.vectorNodeId) ? [fact.vectorNodeId] : []));
    }, [records, vectorArchives, staticSetup]);

    const normalizedQuery = searchText(query.trim());
    const filtered = useMemo(() => {
        if (!normalizedQuery) return records.filter(({ node, fallback, fact, id, text }) =>
            (node || fallback || (fact && currentIdentities.has(storyArchiveFactIdentity({ ...fact, text }))))
            && (showRepeatedSetup || !repeatedSetupIds.has(id)));
        const floorQuery = normalizedQuery.match(/^(?:第\s*)?(\d+)\s*楼?$/u);
        const words = normalizedQuery.split(/\s+/u);
        return records.filter(record => {
            const fact = record.fact;
            const floor = fact && floorNumbers.get(fact.sourceMessageId);
            if (floorQuery && floor === Number(floorQuery[1])) return true;
            if (floorQuery && normalizedQuery.includes('楼')) return false;
            const time = fact && storyArchiveFactTime({ ...fact, text:record.text }, sourceTimes);
            const body = searchText([record.text, time, ...(record.node?.tags ?? []), ...(fact ? storyArchiveSearchTerms({ ...fact, text: record.text }) : [])].filter(Boolean).join(' '));
            return words.every(word => body.includes(word));
        });
    }, [normalizedQuery, records, showRepeatedSetup, repeatedSetupIds, floorNumbers, sourceTimes, currentIdentities]);
    const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const visiblePage = Math.min(page, pageCount - 1);
    const visibleRecords = filtered.slice(visiblePage * PAGE_SIZE, (visiblePage + 1) * PAGE_SIZE);
    useEffect(() => { if (page !== visiblePage) setPage(visiblePage); }, [page, visiblePage]);
    const record = records.find(item => item.id === selectedId);
    const detailTags = [...new Set([...(record?.fact?.terms ?? record?.node?.tags ?? []), ...(record?.fact?.aliases ?? [])])]
        .filter(tag => tag !== '剧情');
    const activeNode = record?.node;
    const original = record?.fact && floorById.get(record.fact.sourceMessageId);
    const floor = record?.fact && floorNumbers.get(record.fact.sourceMessageId);

    useEffect(() => {
        if (!selectedId) return;
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
    }, [selectedId]);
    useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [detailView]);
    useEffect(() => {
        setIndexState('');
        if (!activeNode) return;
        let active = true;
        void MemoryVectorDB.getByMemoryId(activeNode.id).then(vector => {
            if (active) setIndexState(vector?.vector.length ? '本地向量已保存' : '本地向量缺失');
        }).catch(() => { if (active) setIndexState('向量状态暂不可读'); });
        return () => { active = false; };
    }, [activeNode]);

    const cancelLongPress = () => {
        if (press.current) clearTimeout(press.current.timer);
        press.current = null;
    };
    useEffect(() => cancelLongPress, []);

    const openDetail = (id: string) => {
        setDetailView('memory');
        setEditError('');
        setSelectedId(id);
    };
    const closeDetail = () => {
        if (saving) return;
        dialogRef.current?.close?.();
        setSelectedId(null);
    };
    const backFromDetail = () => {
        if (saving) return;
        if (detailView === 'memory') closeDetail();
        else { setEditError(''); setDetailView('memory'); }
    };
    useLocalBackHandler(() => { backFromDetail(); return true; }, 60, !!record);

    const changePage = (next: number) => {
        setPage(next);
        const scroller = listRef.current?.closest('main');
        if (scroller) scroller.scrollTop = 0;
    };
    const refreshArchive = async () => {
        try {
            const saved = await readStoredStoryTheater(entry.id);
            if (saved) onUpdated(saved);
        } catch (error) {
            console.warn('[StoryTheater] could not refresh edited archive', error);
        }
    };
    const saveEdit = async () => {
        if (!activeNode || !draft.trim() || saving) return;
        setSaving(true);
        setEditError('');
        try {
            const updated = await updateStoryVectorMemory(entry.id, activeNode.id, draft, memoryPalaceConfig.embedding, remoteVectorConfig, baseContent);
            setNodes(current => current.map(node => node.id === updated.id ? updated : node));
            await refreshArchive();
            setDetailView('memory');
            addToast('剧情记忆已更新', 'success');
        } catch (error: any) {
            setEditError(error?.message || '剧情记忆修改失败');
            if (error instanceof StoryVectorMemoryConflictError) {
                await refreshArchive();
                setReload(value => value + 1);
            }
        } finally {
            setSaving(false);
        }
    };
    const confirmDelete = async () => {
        if (!activeNode || saving) return;
        setSaving(true);
        setEditError('');
        try {
            const result = await runStoryArchiveOperation(entry.id, () => deleteStoryVectorMemory(entry.id, activeNode.id, remoteVectorConfig, baseContent));
            dialogRef.current?.close?.();
            setSelectedId(null);
            setNodes(current => current.filter(node => node.id !== activeNode.id));
            await refreshArchive();
            addToast(result.remoteDeleted === false ? '本地已删除，远端暂未同步' : '剧情记忆已删除', result.remoteDeleted === false ? 'info' : 'success');
        } catch (error: any) {
            setEditError(error?.message || '剧情记忆删除失败');
            if (error instanceof StoryVectorMemoryConflictError) {
                await refreshArchive();
                setReload(value => value + 1);
            }
        } finally {
            setSaving(false);
        }
    };

    return <StoryArchivePanel entry={entry} masks={masks} onBack={onBack} onUpdated={onUpdated} strategy='vector' locked={saving} onFloorsLoaded={setFloors}
        vectorSearch={<div className='relative story-memory-search-field'>
            <MagnifyingGlass size={18} aria-hidden className='pointer-events-none absolute left-3 top-3.5 text-slate-500' />
            <input type='search' aria-label='搜索记忆' placeholder='搜索内容、标签、时间或楼层'
                value={query} onChange={event => { setQuery(event.target.value); changePage(0); }}
                className='story-memory-search-input min-h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-base' />
        </div>}>
        <section ref={listRef} aria-label='向量节点' className='story-memory-nodes'>
            <div className='story-memory-count mb-3 flex flex-wrap items-center justify-between gap-2'>
                <h2 className='text-sm font-semibold'>{normalizedQuery ? '搜索结果' : '向量记忆'} · {filtered.length} 条</h2>
                {!normalizedQuery && !!repeatedSetupIds.size && <button type='button'
                    className='story-memory-repeated-toggle inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-xs text-slate-600'
                    title={showRepeatedSetup ? '收起已有人设' : '查看已有人设'}
                    aria-label={showRepeatedSetup ? '收起已有人设' : '查看已有人设'}
                    aria-pressed={showRepeatedSetup} onClick={() => { setPage(0); setShowRepeatedSetup(value => !value); }}>
                    {showRepeatedSetup ? <EyeSlash size={18}/> : <Eye size={18}/>}
                    <span aria-hidden='true'>{repeatedSetupIds.size}</span>
                </button>}
            </div>
            {listError && <div role='alert' className='mb-2 flex items-center gap-2 text-sm text-rose-700'>
                <span className='min-w-0 flex-1 break-words'>{listError}</span>
                <button className={actionClass} aria-label='重试读取记忆' title='重试' onClick={() => setReload(value => value + 1)}><ArrowClockwise size={19}/></button>
            </div>}
            {pageCount > 1 && <nav aria-label='记忆分页' className='story-memory-pager mb-3 flex items-center justify-between gap-2 px-1 py-1'>
                <ArchiveIcon label='上一页' disabled={visiblePage === 0} onClick={() => changePage(visiblePage - 1)}><CaretLeft size={16} /></ArchiveIcon>
                <label className='story-memory-page-number flex items-center gap-2 text-sm'>
                    <select aria-label='跳到记忆页' value={visiblePage} onChange={event => changePage(Number(event.target.value))} className='min-h-10 rounded-md border border-slate-200 bg-white px-2 text-base'>
                        {Array.from({ length:pageCount }, (_, index) => <option key={index} value={index}>{index + 1}</option>)}
                    </select>
                    <span aria-hidden='true'>/ {pageCount}</span>
                </label>
                <ArchiveIcon label='下一页' disabled={visiblePage + 1 >= pageCount} onClick={() => changePage(visiblePage + 1)}><CaretRight size={16} /></ArchiveIcon>
            </nav>}
            {loading ? <div role='status' aria-label='正在读取记忆' className='grid place-items-center py-6 text-slate-500'><SpinnerGap size={24} className='animate-spin' /></div>
                : !filtered.length && !listError ? <p className='py-3 text-sm text-slate-600'>{normalizedQuery ? '没有匹配的记忆' : '暂无剧情向量记忆'}</p>
                : <div className='story-memory-record-list'>{visibleRecords.map(item => {
                    const fact = item.fact;
                    const number = fact && floorNumbers.get(fact.sourceMessageId);
                    const time = fact && storyArchiveFactTime({ ...fact, text:item.text }, sourceTimes);
                    const modality = fact && storyArchiveModality(fact);
                    const past = fact && !currentIdentities.has(storyArchiveFactIdentity({ ...fact, text:item.text }));
                    const label = repeatedSetupIds.has(item.id) ? '已有人设'
                        : modality === 'planned' ? '仅是计划' : modality === 'unverified' ? '尚未证实'
                        : fact?.kind === 'author' ? '写作要求' : '';
                    const firstSentence = item.text.match(/^[^。！？\n]+[。！？]/u)?.[0];
                    const preview = firstSentence && firstSentence.length <= 84 ? firstSentence : item.text.slice(0,84);
                    return <article key={item.id}
                        onPointerDown={event => {
                            cancelLongPress();
                            if (!event.isPrimary || event.button !== 0) return;
                            press.current = { x:event.clientX, y:event.clientY, timer:setTimeout(() => {
                                press.current = null;
                                openDetail(item.id);
                            }, 520) };
                        }}
                        onPointerMove={event => {
                            if (press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 8) cancelLongPress();
                        }}
                        onPointerUp={cancelLongPress} onPointerCancel={cancelLongPress} onPointerLeave={cancelLongPress}
                        onContextMenu={event => { event.preventDefault(); cancelLongPress(); openDetail(item.id); }}
                        className='story-memory-node relative'>
                        <button type='button' onClick={() => openDetail(item.id)} className='story-memory-node-open block w-full py-3 pl-1 pr-12 text-left focus-visible:outline focus-visible:outline-violet-500'>
                            <span className='flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs leading-5'>
                                <strong>{time || (number ? '第 ' + number + ' 楼' : '旧记忆')}</strong>
                                {time && number && <span className='text-slate-600'>第 {number} 楼</span>}
                                {past && <span className='rounded bg-stone-100 px-1.5 text-slate-700'>过去的状态</span>}
                                {label && <span className='rounded bg-stone-100 px-1.5 text-slate-700'>{label}</span>}
                            </span>
                            <span className='mt-1.5 block whitespace-pre-wrap break-words text-sm leading-6'>
                                {item.text.length <= 84 ? item.text : preview + '…'}
                            </span>
                            
                        </button>
                        <button type='button' onClick={() => openDetail(item.id)} onPointerDown={event => event.stopPropagation()}
                            className='story-memory-node-more absolute right-1 top-1 grid size-11 place-items-center rounded-full text-slate-600'
                            aria-label='记忆操作'><DotsThree size={18} weight='bold' /></button>
                    </article>;
                })}</div>}
            {pageCount > 1 && <nav aria-label='继续翻页' className='story-memory-bottom-page mt-3 flex items-center justify-between gap-2'>
                <ArchiveIcon label='上一页记忆' disabled={visiblePage === 0} onClick={() => changePage(visiblePage - 1)}><CaretLeft size={18} /></ArchiveIcon>
                <span className='story-memory-page-progress' aria-live='polite'>{visiblePage + 1} / {pageCount}</span>
                <ArchiveIcon label='下一页记忆' disabled={visiblePage + 1 >= pageCount} onClick={() => changePage(visiblePage + 1)}><CaretRight size={18} /></ArchiveIcon>
            </nav>}
        </section>
        {record && <dialog ref={dialogRef} aria-labelledby='story-vector-detail-title'
            onCancel={event => { event.preventDefault(); backFromDetail(); }}
            onClick={event => {
                if (event.target !== event.currentTarget) return;
                const { left, right, top, bottom } = event.currentTarget.getBoundingClientRect();
                if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) backFromDetail();
            }}
            style={{ paddingBottom: 'calc(var(--safe-bottom, 0px) + 18px)' }}
            className='story-memory-dialog story-safe-sheet story-keyboard-sheet fixed inset-x-0 bottom-0 top-auto m-0 mx-auto max-h-[85dvh] w-full max-w-lg overflow-hidden rounded-t-3xl border-0 bg-white p-4 text-slate-800 backdrop:bg-slate-950/40'>
            <div className='flex max-h-[calc(85dvh-3rem)] flex-col overflow-hidden'>
                <header className='flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 pb-2'>
                    <h3 id='story-vector-detail-title' className='text-base font-semibold'>
                        {detailView === 'edit' ? '编辑剧情记忆' : detailView === 'delete' ? '删除这条记忆'
                            : detailView === 'source' ? '第 ' + floor + ' 楼原文' : '记忆详情'}
                    </h3>
                    <ArchiveIcon label='关闭记忆详情' disabled={saving} onClick={closeDetail}><X size={18} /></ArchiveIcon>
                </header>
                <div ref={bodyRef} className='story-page-scroll min-h-0 overflow-y-auto overscroll-contain py-3'>
                    {detailView === 'memory' && <>
                        <div className='mb-2 flex flex-wrap gap-x-3 text-xs text-slate-600'>
                            {floor && <span>第 {floor} 楼</span>}
                            {(record.fallback || indexState) && <span>{record.fallback ? '仅有文字备份' : indexState}</span>}
                        </div>
                        <p className='whitespace-pre-wrap break-words text-base leading-7'>{record.text}</p>
                        {record.fact?.entities?.length ? <ul aria-label='记忆实体' className='mt-3 flex flex-wrap gap-2 text-xs'>
                            {record.fact.entities.map(entity => <li key={entity.name} className='max-w-full break-words rounded bg-stone-100 px-2 py-1'>
                                {entityTypeNames[entity.type]} · {entity.name}{entity.aliases?.length ? '（' + entity.aliases.join('、') + '）' : ''}
                            </li>)}
                        </ul> : null}
                        {!!detailTags.length && <p className='mt-2 break-words text-xs text-slate-600'>
                            {detailTags.join(' · ')}
                        </p>}
                    </>}
                    {detailView === 'source' && original && (original.role === 'assistant'
                        ? <StoryOutput content={original.content} affinityInputs={[]} />
                        : <p className='whitespace-pre-wrap break-words text-base leading-7'>{original.content}</p>)}
                    {detailView === 'edit' && <textarea autoFocus aria-label='记忆正文' value={draft} disabled={saving}
                        onChange={event => setDraft(event.target.value)} className='min-h-36 w-full resize-y rounded-xl border border-slate-200 bg-white p-3 text-base leading-7' />}
                    {detailView === 'delete' && <p className='text-sm leading-6'>此条记忆及其向量将永久删除。</p>}
                    {editError && <p role='alert' className='mt-2 break-words text-sm text-rose-700'>{editError}</p>}
                </div>
                <footer className='story-memory-detail-actions flex shrink-0 flex-wrap gap-2 border-t border-slate-200 pt-3'>
                    {detailView === 'memory' ? <>
                        {original && <button className={actionClass} aria-label='查看原楼' title='查看原楼' onClick={() => setDetailView('source')}><FileText size={20}/></button>}
                        {activeNode && <button className={actionClass} aria-label='编辑记忆' title='编辑记忆' onClick={() => {
                            setBaseContent(activeNode.content); setDraft(activeNode.content); setEditError(''); setDetailView('edit');
                        }}><PencilSimple size={20}/></button>}
                        {activeNode && <button className={actionClass + ' story-memory-delete-trigger ml-auto'} aria-label='删除记忆' title='删除记忆' onClick={() => {
                            setBaseContent(activeNode.content); setEditError(''); setDetailView('delete');
                        }}><Trash size={20}/></button>}
                    </> : <>
                        <button className={actionClass} aria-label='返回记忆' title='返回记忆' disabled={saving} onClick={backFromDetail}><ArrowLeft size={20}/></button>
                        {detailView === 'edit' && <button className='min-h-11 flex-1 rounded-lg bg-violet-700 px-3 text-sm font-semibold text-white disabled:opacity-40'
                            disabled={saving || !draft.trim() || draft.trim() === baseContent} onClick={() => void saveEdit()}>
                            {saving ? '保存中…' : '保存并更新向量'}
                        </button>}
                        {detailView === 'delete' && <button className='min-h-11 flex-1 rounded-lg bg-rose-700 px-3 text-sm font-semibold text-white disabled:opacity-40'
                            disabled={saving} onClick={() => void confirmDelete()}>{saving ? '删除中…' : '确认删除'}</button>}
                    </>}
                </footer>
            </div>
        </dialog>}
    </StoryArchivePanel>;
};

export default StoryVectorMemoryPanel;
