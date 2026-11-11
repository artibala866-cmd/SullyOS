import React, { useState } from 'react';
import StoryRegexPanel from '../date/story/StoryRegexPanel';
import { useAlchemyRules } from '../../hooks/useAlchemyRegex';
import type { AlchemyDomain } from '../../utils/alchemyRegex';

type Section = 'beauty' | 'rules';

export default function AlchemyManagerScreen({
    domain, onClose, initialSection = domain === 'online' ? 'beauty' : 'rules',
}: { domain: AlchemyDomain; onClose: () => void; initialSection?: Section }) {
    const { all, loaded, error, save } = useAlchemyRules(domain);
    const [section, setSection] = useState<Section>(domain === 'offline' ? 'rules' : initialSection);
    return <div className="absolute inset-0 z-[200] flex min-h-0 flex-col bg-stone-100" data-alchemy-domain={domain}>
        {domain === 'online' && <nav className="flex shrink-0 gap-2 border-b border-slate-200 bg-white px-4 py-2"
            aria-label="正则分类">
            {([['beauty', '美化类'], ['rules', '规则类']] as const).map(([value, label]) =>
                <button key={value} type="button" aria-pressed={section === value}
                    className={'flex-1 rounded-full px-4 py-2 text-xs font-semibold ' +
                        (section === value ? 'bg-slate-900 text-white' : 'bg-stone-100 text-slate-600')}
                    onClick={() => setSection(value)}>{label}</button>)}
        </nav>}
        {!loaded ? <div className="m-auto text-sm text-slate-600">读取正则…</div>
            : error ? <div role="alert" className="m-auto p-6 text-sm text-rose-700">{error}</div>
            : <div className="min-h-0 flex-1">
                <StoryRegexPanel key={section} domain={domain} section={section} rules={all} presets={[]}
                    onSave={save} onBack={onClose} />
            </div>}
    </div>;
}
