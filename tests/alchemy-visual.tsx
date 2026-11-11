import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import AlchemyRuleFolders from '../components/alchemy/AlchemyRuleFolders';
import type { StoryRegexRule } from '../utils/storyRegex';
import {
    alchemyRuleSection, alchemyRuleTargets, removeAlchemyRule,
    removeAlchemyFolderSection, setAlchemyFolderTargets, alchemyFolderTargetSelection, type AlchemyDomain,
} from '../utils/alchemyRegex';

const params = new URLSearchParams(location.search);
const domain: AlchemyDomain = params.get('domain') === 'offline' ? 'offline' : 'online';
const section: 'rules' | 'beauty' = domain === 'offline' || params.get('section') === 'rules' ? 'rules' : 'beauty';
const action = params.get('action') || '';
const templateNames = ['小法庭', '豆包', '弹幕', '刮彩票', '微信红包', '番茄小剧场'];
const filterNames = ['WS8.3-核心指令', 'WS8.3-词汇级禁令', 'WS8.3-句式级禁令',
    'WS8.3-环境描写禁令', 'WS8.3-人物细节禁令', 'WS8.3-言情八股禁令', 'WS8.3-结尾禁令'];
const initial: StoryRegexRule[] = [
    ...templateNames.map((name, i): StoryRegexRule => ({
        id: 'beauty-' + i, name, enabled: true, presetId: '', kind: 'template', domain: 'online',
        pattern: '<tag>(.*?)</tag>', flags: 'g', replacement: '<div>{{$1}}</div>',
        display: true, history: false, instruction: '', importGroup: '糯叽叽 HTML 模板 6 则',
    })),
    ...filterNames.map((name, i): StoryRegexRule => ({
        id: 'rules-' + i, name, enabled: i !== 5, presetId: '', kind: 'filter', domain: 'offline',
        ...(i === 1 ? { targets: ['online', 'offline'] as Array<'online' | 'offline'> } : {}),
        pattern: '坏词', flags: 'g', replacement: '', display: true, history: false,
        instruction: i === 0 ? '角色指令' : '', importGroup: '7.5 八股正则补丁',
        source: { category: '八股净化' },
    })),
];

function Visual() {
    const [rules, setRules] = useState(initial);
    const [opened, setOpened] = useState('');
    const filtered = useMemo(() => rules.filter(rule => alchemyRuleSection(rule) === section), [rules]);
    const expected = section === 'beauty' ? 6 : 7;
    const active = filtered.filter(rule => rule.enabled).length;
    const toggle = (rule: StoryRegexRule) =>
        setRules(old => old.map(item => item.id === rule.id ? { ...item, enabled: !item.enabled } : item));
    const setFolderTargets = (folder: string, selected: StoryRegexRule[], targets: AlchemyDomain[]) =>
        setRules(old => setAlchemyFolderTargets(old, folder, new Set(selected.map(rule => rule.id)), targets));
    const deleteRule = (rule: StoryRegexRule) => setRules(old => removeAlchemyRule(old, rule.id));
    const deleteFolder = (folder: string, selected: StoryRegexRule[]) => {
        const ids = new Set(selected.map(rule => rule.id));
        setRules(old => removeAlchemyFolderSection(old, folder, section, ids));
    };
    React.useEffect(() => {
        if (params.get('expanded') === '1') {
            document.querySelectorAll<HTMLDetailsElement>('[data-alchemy-folders] > div > details')
                .forEach(detail => { detail.open = true; });
        }
    }, []);
    React.useEffect(() => {
        const found = document.querySelectorAll('[data-alchemy-rule]').length;
        const folders = document.querySelectorAll('[data-alchemy-folder]').length;
        const categories = document.querySelectorAll('[data-alchemy-category]').length;
        const hasDelete = document.querySelectorAll('button[aria-label^="删除规则"]').length === found &&
            document.querySelectorAll('button[aria-label^="删除分组"]').length === folders;
        const groupScope = document.querySelector<HTMLSelectElement>('select[aria-label^="分组"]');
        const scopeVisible = !groupScope || groupScope.getBoundingClientRect().width > 0;
        const hasScope = section === 'beauty' ? !groupScope : !!groupScope && scopeVisible;
        document.body.dataset.alchemyScreenshotReady =
            String(found === expected && folders === 1 && categories >= 2 && hasDelete &&
                hasScope && rules.length === 13);
        const out = document.getElementById('alchemy-report');
        if (out) out.textContent = JSON.stringify({
            domain, section, count: found, folders, categories, active, totalRecords: rules.length,
            bothTargets: rules.filter(rule => alchemyRuleTargets(rule).length === 2).length,
            hasDelete, hasScope, groupScope: groupScope?.value, opened,
        });
    }, [rules, opened, active]);

    // Exercise the actual collapsed-header scope selector without opening the folder.
    React.useEffect(() => {
        if (!action.startsWith('scope-') || section !== 'rules') return;
        const chosen = action.slice('scope-'.length) as 'online' | 'offline' | 'both';
        const target = document.querySelector<HTMLSelectElement>('select[aria-label^="分组"]');
        const before = target?.value;
        const shown = !!target && target.getBoundingClientRect().width > 0;
        if (!target || !['online', 'offline', 'both'].includes(chosen)) return;
        target.value = chosen;
        target.dispatchEvent(new Event('change', { bubbles: true }));
        window.setTimeout(() => {
            const current = document.body.dataset.alchemySelectedTargets || '';
            const allMatch = current.split(',').every(value => value === chosen) && current.length > 0;
            const elsewhereIntact = document.body.dataset.alchemyOtherTargets === 'online' &&
                document.body.dataset.alchemyTotalRecords === '13';
            const success = shown && before === 'mixed' && allMatch && elsewhereIntact;
            document.body.dataset.alchemyScopeReady = String(success);
            const out = document.getElementById('alchemy-scope-report');
            if (out) out.textContent = JSON.stringify({ chosen, before, shown, current, elsewhereIntact, success });
        }, 150);
    }, []);

    // Browser-only interaction QA. This clicks the *actual* delete buttons:
    // the first click must not mutate any rule; second confirmation must
    // remove only the intended category while keeping the other category.
    React.useEffect(() => {
        if (action !== 'rule-delete' && action !== 'folder-delete') return;
        document.querySelectorAll<HTMLDetailsElement>('details').forEach(detail => { detail.open = true; });
        const isFolder = action === 'folder-delete';
        const selector = isFolder ? 'button[aria-label^="删除分组"]' : 'button[aria-label^="删除规则"]';
        const target = document.querySelector<HTMLButtonElement>(selector);
        if (!target) return;
        target.click();
        window.setTimeout(() => {
            const before = document.querySelectorAll('[data-alchemy-rule]').length;
            const unchanged = before === expected &&
                document.querySelectorAll('[data-alchemy-rule]').length === expected;
            const confirmText = isFolder ? '确认删除分组' : '确认删除';
            const confirmation = [...document.querySelectorAll<HTMLButtonElement>('button')]
                .find(button => button.textContent?.trim() === confirmText);
            const wasConfirmed = !!confirmation;
            confirmation?.click();
            window.setTimeout(() => {
                const after = document.querySelectorAll('[data-alchemy-rule]').length;
                const success = unchanged && wasConfirmed && after === (isFolder ? 0 : expected - 1) &&
                    rulesRemainingAfterDelete() === (isFolder ? 13 - expected : 12);
                document.body.dataset.alchemyDeleteReady = String(success);
                const out = document.getElementById('alchemy-delete-report');
                if (out) out.textContent = JSON.stringify({ action, section, unchanged, wasConfirmed, after, success });
            }, 120);
        }, 120);
        // Explicit DOM count used only in the browser harness.
        function rulesRemainingAfterDelete() {
            return Number(document.body.dataset.alchemyTotalRecords || 'NaN');
        }
    }, []);

    React.useEffect(() => {
        document.body.dataset.alchemyTotalRecords = String(rules.length);
        document.body.dataset.alchemySelectedTargets = rules.filter(rule => rule.kind === 'filter' &&
            rule.importGroup === '7.5 八股正则补丁').map(rule => {
            const targets = alchemyRuleTargets(rule);
            return targets.length === 2 ? 'both' : targets[0];
        }).join(',');
        document.body.dataset.alchemyOtherTargets = alchemyRuleTargets(rules[0])[0];
    }, [rules]);

    return <main className="mx-auto min-h-screen max-w-md bg-stone-100">
        <header className="border-b border-slate-200 bg-white px-5 py-5">
            <div className="text-[11px] tracking-wide text-slate-400">糯米机 · 正则管理</div>
            <h1 className="mt-1 text-[19px] font-bold">{section === 'beauty'
                ? '美化类 · 私聊 / 群聊' : domain === 'online'
                    ? '规则类 · 私聊 / 群聊' : '规则类 · 剧情 / 见面'}</h1>
            <div className="mt-2 text-xs text-slate-500">导入文件 → 小分类 → 单条规则</div>
        </header>
        <section className="space-y-3 p-4">
            <p className="px-1 text-[12px] text-slate-500">{filtered.length} 条规则 · {active} 条开启</p>
            <AlchemyRuleFolders rules={filtered} scopeName={(_, rule) => rule?.kind === 'template'
                ? '私聊 / 群聊' : alchemyRuleTargets(rule!).map(target => target === 'online'
                    ? '私聊 / 群聊' : '剧情 / 见面').join(' + ')}
                onOpen={rule => setOpened(rule.name)} onToggle={toggle}
                onDelete={deleteRule} onDeleteFolder={deleteFolder}
                onSetFolderTargets={section === 'rules' ? setFolderTargets : undefined} />
            {opened && <p className="rounded-xl bg-white px-4 py-3 text-xs text-slate-600">已打开：{opened}</p>}
        </section>
        <output id="alchemy-report" hidden />
        <output id="alchemy-delete-report" hidden />
        <output id="alchemy-scope-report" hidden />
    </main>;
}
createRoot(document.getElementById('visual')!).render(<Visual />);
