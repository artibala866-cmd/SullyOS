import React, { useEffect, useState } from 'react';
import type { CharacterProfile, Emoji, UserProfile } from '../../types';
import { buildCharacterStats, countContextCharacters } from '../../utils/characterStats';
import { clampManualContextLimit, loadCharacterContextRange } from '../../utils/chatContextRange';
import { resolveMemoryPalaceWaterline } from '../../utils/memoryPalace/waterline';
import { DB } from '../../utils/db';
import { WORLDBOOK_POSITION_LABELS, WORLDBOOK_ROLE_LABELS } from '../../utils/worldbook';

const EMPTY_EMOJIS: Emoji[] = [];
const number = (n: number) => n.toLocaleString('zh-CN');
const statuses: Record<string, string> = { readable: '当前可读', waiting: '等待关键词', probability: '概率待定', disabled: '已停用', empty: '空正文', zero: '概率为 0' };

function TextRows({ rows }: { rows: { title: string; content: string; note?: string }[] }) {
    const [limit, setLimit] = useState(20);
    return <div className="divide-y divide-slate-100">
        {rows.slice(0, limit).map((row, i) => <details key={`${row.title}-${i}`} className="group py-3">
            <summary className="flex cursor-pointer list-none items-start justify-between gap-3 text-xs hover:text-slate-600">
                <span className="min-w-0 break-words leading-5">{row.title}{row.note && <span className="block text-[10px] text-slate-400">{row.note}</span>}</span>
                <span className="shrink-0 pt-1 font-mono text-slate-500">{number(countContextCharacters(row.content))} 字 <span className="inline-block transition-transform group-open:rotate-90 motion-reduce:transition-none">›</span></span>
            </summary>
            <p className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-xs leading-6 text-slate-600">{row.content || '无正文'}</p>
        </details>)}
        {rows.length > limit && <button className="w-full py-3 text-xs text-slate-600" onClick={() => setLimit(n => n + 50)}>继续显示（剩余 {rows.length - limit} 条）</button>}
        {!rows.length && <p className="py-4 text-xs text-slate-400">当前没有可读条目</p>}
    </div>;
}

export default function CharacterStatsPanel({ character, user, emojis = EMPTY_EMOJIS, onOpenMemory }: { character: CharacterProfile; user: UserProfile; emojis?: Emoji[]; onOpenMemory: () => void }) {
    const [stats, setStats] = useState<ReturnType<typeof buildCharacterStats> | null>(null);
    const [revision, setRevision] = useState(0);
    const [error, setError] = useState(false);
    useEffect(() => {
        let cancelled = false;
        setStats(null); setError(false);
        Promise.all([loadCharacterContextRange(character), emojis.length ? Promise.resolve(emojis) : DB.getEmojis()]).then(([range, availableEmojis]) => {
            if (!cancelled) setStats(buildCharacterStats(character, user, range, availableEmojis));
        }).catch(() => { if (!cancelled) setError(true); });
        return () => { cancelled = true; };
    }, [character, user, emojis, revision]);
    const refresh = () => setRevision(n => n + 1);
    const waterline = resolveMemoryPalaceWaterline(character.memoryPalaceWaterline);
    return <section className="mx-auto max-w-2xl text-slate-700" aria-label="角色统计">
        <header className="flex items-start justify-between gap-4 pb-6">
            <div><p className="text-[10px] font-semibold tracking-[0.2em] text-slate-500">CONTEXT INSIGHT</p><h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">角色统计</h2></div>
            <button onClick={refresh} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs transition-colors hover:border-slate-300 hover:text-slate-600">刷新</button>
        </header>
        {error ? <p role="alert" className="py-8 text-sm">读取失败，请点击刷新重试。</p> : !stats ? <p role="status" className="py-8 text-sm text-slate-400">正在读取当前范围…</p> : <>
            <div className="border-y border-slate-200 py-5">
                <div className="flex items-center justify-between text-xs"><span>记忆宫殿</span><span className={character.memoryPalaceEnabled ? 'text-slate-600' : 'text-slate-400'}>● {character.memoryPalaceEnabled ? '已启动' : '未启动'}</span></div>
                <div className="mt-4 flex items-start justify-between gap-4 text-xs"><span>上下文水位线</span><span className="text-right font-medium">{stats.range.mode === 'adaptive' ? '跟随记忆宫殿' : `用户设定 · 最近 ${clampManualContextLimit(character.contextLimit)} 条`}</span></div>
                <p className="mt-2 text-[11px] text-slate-400">{stats.range.effectiveStartMessageId ? `起点 #${stats.range.effectiveStartMessageId}` : '当前范围为空'}{stats.range.userStartMessageId ? ' · 用户断点' : ''}{stats.range.userBreakpointExpired ? ' · 断点已失效' : ''}</p>
                <p className="mt-1 text-[11px] leading-5 text-slate-400">自动归档{character.autoArchiveEnabled ? '开启' : '关闭'} · 热区 {waterline.hotZoneSize} / 缓冲 {waterline.bufferThreshold}（归档节奏，不是上下文条数上限）</p>
            </div>
            <div className="py-7"><p className="text-xs text-slate-500">已统计正文</p><p className="mt-2 font-mono text-4xl tracking-tight text-slate-900">{number(stats.total)}<span className="ml-2 font-sans text-xs tracking-normal text-slate-400">字符</span></p>
                <div className="mt-5 flex h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">{[stats.historyCharacters, stats.memoryCharacters, stats.worldbookCharacters, stats.otherCharacters].map((v, i) => <div key={i} className={['bg-slate-500', 'bg-slate-500', 'bg-slate-200', 'bg-slate-300'][i]} style={{ width: `${stats.total ? v / stats.total * 100 : 0}%` }} />)}</div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[10px] text-slate-500">{[['消息', stats.historyCharacters], ['记忆', stats.memoryCharacters], ['世界书', stats.worldbookCharacters], ['其他', stats.otherCharacters]].map(([label, n]) => <span key={label}>{label} <b className="font-mono font-medium">{number(Number(n))}</b></span>)}</div>
                
            </div>
            <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                <p className="text-sm font-semibold text-slate-900">≈ {number(stats.estimatedTokens)} Token · 估计值，非真实用量</p>
                
                
            </div>
            <details open className="border-t border-slate-200 py-5"><summary className="cursor-pointer text-sm font-semibold">神经链接记忆 <span className="float-right font-mono text-xs font-normal text-slate-400">{stats.memoryRows.length} 条 / {number(stats.memoryCharacters)} 字</span></summary>
                <div className="my-4 border-l-2 border-slate-300 bg-slate-50/60 px-3 py-3 text-xs leading-6 text-slate-800">
                    {stats.memories.daily.length ? `小眼睛已开启：${stats.memories.daily.map(g => `${g.month}（${g.entries.length} 条）`).join('、')}。这些日度记忆仍可被读取。` : '所有日度记忆的小眼睛均已关闭。'}
                    <span className="block">月度总结 {stats.memories.monthly.length} 条，关闭小眼睛后仍然可读。</span>
                    <button onClick={onOpenMemory} className="mt-1 underline underline-offset-4">前往记忆检查 →</button>
                </div><TextRows rows={stats.memoryRows} />
            </details>
            <details open className="border-t border-slate-200 py-5"><summary className="cursor-pointer text-sm font-semibold">世界书 <span className="float-right font-mono text-xs font-normal text-slate-400">{stats.books.filter(b => b.status === 'readable').length} 条 / {number(stats.worldbookCharacters)} 字</span></summary>
                
                <TextRows rows={stats.books.map(({ book, content, status, probability }) => ({ title: book.title || '未命名世界书', content, note: `${statuses[status]}${status === 'probability' ? ` ${probability}%` : ''} · ${WORLDBOOK_POSITION_LABELS[book.position ?? 1]}${book.position === 4 ? ` · 深度 ${book.depth ?? 4} · ${WORLDBOOK_ROLE_LABELS[book.role ?? 0]}` : ''} · 顺序 ${book.order ?? 100}` }))} />
            </details>
            <details className="border-t border-slate-200 py-5"><summary className="cursor-pointer text-sm font-semibold">其他常驻来源 <span className="float-right font-mono text-xs font-normal text-slate-400">{number(stats.otherCharacters)} 字</span></summary><TextRows rows={stats.otherRows} /></details>
            <details className="border-t border-slate-200 py-5"><summary className="cursor-pointer text-sm font-semibold">宫殿召回快照 <span className="float-right font-mono text-xs font-normal text-slate-400">{number(countContextCharacters(stats.recallSnapshot))} 字</span></summary><p className="my-3 text-[11px] leading-5 text-slate-400">这是上次保存的召回正文，不代表下一次召回，不计入上方总量。实际召回会随问题变化；宫殿关闭时不读取残留内容。</p><TextRows rows={stats.recallSnapshot ? [{ title: '上次召回', content: stats.recallSnapshot }] : []} /></details>
            <details open className="border-t border-slate-200 py-5"><summary className="cursor-pointer text-sm font-semibold">消息来源 <span className="float-right font-mono text-xs font-normal text-slate-400">{stats.sources.reduce((n, s) => n + s.count, 0)} 条</span></summary>
                
                {stats.sources.map(source => <div key={source.name} className="border-b border-slate-100 py-3"><div className="flex justify-between gap-3 text-xs"><span className="break-all">{source.name}</span><span className="shrink-0 font-mono text-slate-500">{number(source.characters)} 字</span></div><div className="mt-2 flex items-center gap-3"><div className="h-1 flex-1 rounded-full bg-slate-100"><div className="h-full rounded-full bg-slate-300" style={{ width: `${stats.historyCharacters ? source.characters / stats.historyCharacters * 100 : 0}%` }} /></div><span className="text-[10px] text-slate-400">{source.count} 条</span></div></div>)}
                {!stats.sources.length && <p className="py-4 text-xs text-slate-400">当前没有可读消息</p>}
            </details>
        </>}
    </section>;
}
