import React from 'react';
import { CaretRight } from '@phosphor-icons/react';
import type { StoryRegexRule } from '../../utils/storyRegex';
import { alchemySubcategory } from '../../utils/alchemyRegex';

export default function AlchemyRuleFolders({
    rules, busy = false, onOpen, onToggle, scopeName,
}: {
    rules: StoryRegexRule[];
    busy?: boolean;
    onOpen: (rule: StoryRegexRule) => void;
    onToggle: (rule: StoryRegexRule) => void;
    scopeName: (presetId: string) => string;
}) {
    const folders = new Map<string, Map<string, StoryRegexRule[]>>();
    for (const rule of rules) {
        const folder = rule.importGroup || '旧版规则';
        const category = alchemySubcategory(rule);
        if (!folders.has(folder)) folders.set(folder, new Map());
        const groups = folders.get(folder)!;
        if (!groups.has(category)) groups.set(category, []);
        groups.get(category)!.push(rule);
    }
    return <div className="space-y-3" data-alchemy-folders>
        {Array.from(folders, ([folder, categories]) => <details key={folder}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2" open>
            <summary className="cursor-pointer text-sm font-semibold" data-alchemy-folder={folder}>
                {folder} · {Array.from(categories.values()).reduce((sum, items) => sum + items.length, 0)} 条
            </summary>
            {Array.from(categories, ([category, items]) => <details key={category}
                className="ml-2 mt-2 border-l-2 border-slate-100 pl-3" open>
                <summary className="cursor-pointer text-xs font-semibold text-slate-500"
                    data-alchemy-category={category}>{category} · {items.length}</summary>
                {items.map(rule => <div key={rule.id} className="flex items-center gap-3 py-2" data-alchemy-rule={rule.name}>
                    <button type="button" disabled={busy} onClick={() => onOpen(rule)}
                        className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left">
                        <span className={'h-2 w-2 shrink-0 rounded-full ' +
                            (rule.enabled ? 'bg-violet-500' : 'bg-slate-300')} />
                        <span className="min-w-0 flex-1">
                            <span className="block break-words text-xs font-semibold">{rule.name}</span>
                            <span className="mt-1 block truncate text-[11px] text-slate-500">
                                {rule.kind === 'template' ? 'HTML 美化' : '文字过滤'} · {scopeName(rule.presetId)}
                            </span>
                        </span>
                        <CaretRight size={13} className="shrink-0 text-slate-400" />
                    </button>
                    <button type="button" disabled={busy} aria-pressed={rule.enabled}
                        aria-label={'启用 ' + rule.name} onClick={() => onToggle(rule)}
                        className={'inline-flex min-h-9 shrink-0 items-center justify-center rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold disabled:opacity-40 ' +
                            (rule.enabled ? 'text-violet-700' : 'text-slate-500')}>
                        {rule.enabled ? '已启用' : '已停用'}
                    </button>
                </div>)}
            </details>)}
        </details>)}
    </div>;
}
