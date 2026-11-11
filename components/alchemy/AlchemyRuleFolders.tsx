import React, { useState } from 'react';
import { CaretDown, Check, Code, Trash } from '@phosphor-icons/react';
import type { StoryRegexRule } from '../../utils/storyRegex';
import { alchemyFolderTargetSelection, alchemyRuleTargets, alchemySubcategory, type AlchemyDomain } from '../../utils/alchemyRegex';

type Pending = { type: 'rule' | 'folder'; key: string } | null;

export default function AlchemyRuleFolders({
    rules, busy = false, onOpen, onToggle, onDelete, onDeleteFolder, onSetFolderTargets, scopeName,
}: {
    rules: StoryRegexRule[];
    busy?: boolean;
    onOpen: (rule: StoryRegexRule) => void;
    onToggle: (rule: StoryRegexRule) => void;
    onDelete?: (rule: StoryRegexRule) => void;
    onDeleteFolder?: (name: string, rules: StoryRegexRule[]) => void;
    onSetFolderTargets?: (name: string, rules: StoryRegexRule[], targets: AlchemyDomain[]) => void;
    scopeName: (presetId: string, rule?: StoryRegexRule) => string;
}) {
    const [pending, setPending] = useState<Pending>(null);
    const folders = new Map<string, Map<string, StoryRegexRule[]>>();
    for (const rule of rules) {
        const folder = rule.importGroup || '旧版规则';
        const category = alchemySubcategory(rule);
        if (!folders.has(folder)) folders.set(folder, new Map());
        const groups = folders.get(folder)!;
        if (!groups.has(category)) groups.set(category, []);
        groups.get(category)!.push(rule);
    }
    const action = (type: 'rule' | 'folder', key: string, commit: () => void) => {
        if (busy) return;
        if (pending?.type === type && pending.key === key) {
            setPending(null);
            commit();
        } else setPending({ type, key });
    };
    const cancel = () => setPending(null);
    return <div className="space-y-2" data-alchemy-folders>
        {Array.from(folders, ([folder, categories]) => {
            const groupRules = Array.from(categories.values()).flat();
            const folderPending = pending?.type === 'folder' && pending.key === folder;
            const selection = alchemyFolderTargetSelection(groupRules);
            const canSetScope = !!onSetFolderTargets && groupRules.some(rule => rule.kind === 'filter');
            return <div key={folder} className="relative overflow-hidden rounded-xl border border-neutral-200/90 bg-white">
                <details className="group">
                    <summary className={'flex h-12 cursor-pointer list-none items-center gap-2 px-3 text-[13px] font-semibold ' +
                        (canSetScope ? 'pr-[116px]' : 'pr-10')} title={folder} data-alchemy-folder={folder}>
                        <CaretDown size={14} className="shrink-0 -rotate-90 text-neutral-400 transition-transform group-open:rotate-0"/>
                        <span className="min-w-0 flex-1 truncate">{folder}</span>
                        <span className="shrink-0 text-[11px] font-normal text-neutral-400">{groupRules.length}</span>
                    </summary>
                    <div className="border-t border-neutral-100 px-2 pb-1">
                        {Array.from(categories, ([category, items]) =>
                            <details key={category} className="group/sub">
                                <summary className="flex h-9 cursor-pointer list-none items-center gap-1.5 px-2 text-xs text-neutral-500"
                                    data-alchemy-category={category}>
                                    <CaretDown size={12} className="shrink-0 -rotate-90 transition-transform group-open/sub:rotate-0"/>
                                    <span className="min-w-0 flex-1 truncate">{category}</span>
                                    <span className="text-[10px] text-neutral-400">{items.length}</span>
                                </summary>
                                <div className="pb-1">
                                    {items.map(rule => {
                                        const rulePending = pending?.type === 'rule' && pending.key === rule.id;
                                        const targets = alchemyRuleTargets(rule);
                                        const showScope = selection === 'mixed' && rule.kind === 'filter';
                                        return <div key={rule.id} className="border-t border-neutral-100" data-alchemy-rule={rule.name}>
                                            <div className="flex min-h-10 items-center gap-1 pl-3 pr-1">
                                                <span className={'h-1.5 w-1.5 shrink-0 rounded-full ' +
                                                    (rule.enabled ? 'bg-neutral-700' : 'bg-neutral-300')}/>
                                                <button type="button" disabled={busy} title={rule.name}
                                                    onClick={() => { cancel(); onOpen(rule); }}
                                                    className="min-w-0 flex-1 truncate py-2 text-left text-[12px] text-neutral-700">
                                                    {rule.name}
                                                </button>
                                                {rule.kind === 'template' && <Code size={13} className="shrink-0 text-neutral-400"/>}
                                                {showScope && <span className="shrink-0 text-[10px] text-neutral-400">
                                                    {targets.length === 2 ? '双' : targets[0] === 'online' ? '上' : '下'}
                                                </span>}
                                                <button type="button" disabled={busy} aria-pressed={rule.enabled}
                                                    aria-label={'启用 ' + rule.name}
                                                    onClick={() => { cancel(); onToggle(rule); }}
                                                    className={'grid h-7 w-7 shrink-0 place-items-center rounded-md ' +
                                                        (rule.enabled ? 'text-neutral-800' : 'text-neutral-300')}>
                                                    <Check size={16} weight={rule.enabled ? 'bold' : 'regular'}/>
                                                </button>
                                                {onDelete && <button type="button" disabled={busy} title="删除"
                                                    aria-label={'删除规则 ' + rule.name}
                                                    onClick={() => action('rule', rule.id, () => onDelete(rule))}
                                                    className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-neutral-400">
                                                    <Trash size={15}/>
                                                </button>}
                                            </div>
                                            {rulePending && onDelete && <div className="flex items-center gap-2 px-3 pb-2 text-[11px]">
                                                <span className="min-w-0 flex-1 truncate text-rose-600">删除这条规则？</span>
                                                <button type="button" onClick={cancel} disabled={busy} className="px-2 py-1">取消</button>
                                                <button type="button" disabled={busy} onClick={() => action('rule', rule.id, () => onDelete(rule))}
                                                    className="rounded-full bg-neutral-900 px-2.5 py-1 font-medium text-white">确认删除</button>
                                            </div>}
                                        </div>;
                                    })}
                                </div>
                            </details>)}
                    </div>
                </details>
                <div className="absolute right-2 top-2 flex h-8 items-center gap-1">
                    {canSetScope && <select aria-label={'分组 ' + folder + ' 生效范围'} title="整组线上 / 线下"
                        disabled={busy} value={selection}
                        onChange={event => {
                            cancel();
                            const chosen = event.target.value;
                            if (chosen === 'mixed') return;
                            onSetFolderTargets(folder, groupRules, chosen === 'both'
                                ? ['online', 'offline'] : [chosen as AlchemyDomain]);
                        }}
                        className="h-7 w-[61px] shrink-0 rounded-md border border-neutral-200 bg-[#fafafa] px-1 text-[11px] text-neutral-700">
                        {selection === 'mixed' && <option value="mixed" disabled>混合</option>}
                        <option value="online">线上</option>
                        <option value="offline">线下</option>
                        <option value="both">两边</option>
                    </select>}
                    {onDeleteFolder && <button type="button" disabled={busy} title="删除分组"
                        aria-label={'删除分组 ' + folder}
                        onClick={() => action('folder', folder, () => onDeleteFolder(folder, groupRules))}
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-neutral-400">
                        <Trash size={16}/>
                    </button>}
                </div>
                {folderPending && onDeleteFolder && <div className="flex items-center gap-2 border-t border-neutral-100 px-3 py-2 text-[11px]">
                    <span className="min-w-0 flex-1 text-rose-600">删除整组 {groupRules.length} 条？</span>
                    <button type="button" onClick={cancel} disabled={busy} className="px-2 py-1">取消</button>
                    <button type="button" disabled={busy}
                        onClick={() => action('folder', folder, () => onDeleteFolder(folder, groupRules))}
                        className="shrink-0 rounded-full bg-neutral-900 px-2.5 py-1 font-medium text-white">确认删除分组</button>
                </div>}
            </div>;
        })}
    </div>;
}
