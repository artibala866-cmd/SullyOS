import React, { useState } from 'react';
import { CaretRight, Trash } from '@phosphor-icons/react';
import type { StoryRegexRule } from '../../utils/storyRegex';
import { alchemySubcategory } from '../../utils/alchemyRegex';

type Pending = { type: 'rule' | 'folder'; key: string } | null;
export default function AlchemyRuleFolders({
    rules, busy = false, onOpen, onToggle, onDelete, onDeleteFolder, scopeName,
}: {
    rules: StoryRegexRule[];
    busy?: boolean;
    onOpen: (rule: StoryRegexRule) => void;
    onToggle: (rule: StoryRegexRule) => void;
    onDelete?: (rule: StoryRegexRule) => void;
    onDeleteFolder?: (name: string, rules: StoryRegexRule[]) => void;
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
        } else {
            setPending({ type, key });
        }
    };
    const cancel = () => setPending(null);
    return <div className="space-y-3" data-alchemy-folders>
        {Array.from(folders, ([folder, categories]) => {
            const groupRules = Array.from(categories.values()).flat();
            const folderPending = pending?.type === 'folder' && pending.key === folder;
            return <details key={folder} className="rounded-xl border border-slate-200 bg-white px-3 py-2" open>
                <summary className="cursor-pointer text-sm font-semibold" data-alchemy-folder={folder}>
                    {folder} · {groupRules.length} 条
                </summary>
                {onDeleteFolder && <div className="mt-2 flex items-center justify-end gap-2">
                    {folderPending && <span className="mr-auto text-[11px] text-rose-700">
                        删除此分组内 {groupRules.length} 条当前分类的正则？
                    </span>}
                    {folderPending && <button type="button" onClick={cancel} disabled={busy}
                        className="rounded-full border px-2.5 py-1 text-[11px]">取消</button>}
                    <button type="button" disabled={busy} aria-label={'删除分组 ' + folder}
                        onClick={() => action('folder', folder, () => onDeleteFolder(folder, groupRules))}
                        className="inline-flex items-center gap-1 rounded-full border border-rose-200 px-2.5 py-1 text-[11px] text-rose-700">
                        <Trash size={12} />{folderPending ? '确认删除分组' : '删除分组'}
                    </button>
                </div>}
                {Array.from(categories, ([category, items]) => <details key={category}
                    className="ml-2 mt-2 border-l-2 border-slate-100 pl-3" open>
                    <summary className="cursor-pointer text-xs font-semibold text-slate-500"
                        data-alchemy-category={category}>{category} · {items.length}</summary>
                    {items.map(rule => {
                        const rulePending = pending?.type === 'rule' && pending.key === rule.id;
                        return <div key={rule.id} className="min-w-0 border-b border-slate-100 py-1 last:border-0"
                            data-alchemy-rule={rule.name}>
                            <div className="flex min-w-0 items-center gap-1">
                                <button type="button" disabled={busy} onClick={() => { cancel(); onOpen(rule); }}
                                    className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left">
                                    <span className={'h-2 w-2 shrink-0 rounded-full ' +
                                        (rule.enabled ? 'bg-violet-500' : 'bg-slate-300')} />
                                    <span className="min-w-0 flex-1">
                                        <span className="block break-words text-xs font-semibold">{rule.name}</span>
                                        <span className="mt-1 block truncate text-[11px] text-slate-500">
                                            {rule.kind === 'template' ? 'HTML 美化' : '文字规则'} · {scopeName(rule.presetId, rule)}
                                        </span>
                                    </span>
                                    <CaretRight size={13} className="shrink-0 text-slate-400" />
                                </button>
                                <button type="button" disabled={busy} aria-pressed={rule.enabled}
                                    aria-label={'启用 ' + rule.name} onClick={() => { cancel(); onToggle(rule); }}
                                    className={'shrink-0 rounded-full border border-slate-200 px-2 py-1.5 text-[11px] font-semibold ' +
                                        (rule.enabled ? 'text-violet-700' : 'text-slate-500')}>
                                    {rule.enabled ? '开' : '关'}
                                </button>
                                {onDelete && <button type="button" disabled={busy}
                                    aria-label={'删除规则 ' + rule.name}
                                    onClick={() => action('rule', rule.id, () => onDelete(rule))}
                                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-rose-100 text-rose-600">
                                    <Trash size={15} />
                                </button>}
                            </div>
                            {rulePending && onDelete && <div className="flex items-center justify-end gap-2 pb-2 text-[11px]">
                                <span className="mr-auto break-words text-rose-700">确定删除「{rule.name}」？</span>
                                <button type="button" disabled={busy} onClick={cancel}
                                    className="rounded-full border px-2.5 py-1">取消</button>
                                <button type="button" disabled={busy}
                                    onClick={() => action('rule', rule.id, () => onDelete(rule))}
                                    className="rounded-full bg-rose-600 px-2.5 py-1 font-semibold text-white">
                                    确认删除
                                </button>
                            </div>}
                        </div>;
                    })}
                </details>)}
            </details>;
        })}
    </div>;
}
