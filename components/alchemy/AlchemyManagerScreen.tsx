import React from 'react';
import StoryRegexPanel from '../date/story/StoryRegexPanel';
import { useAlchemyRules } from '../../hooks/useAlchemyRegex';
import type { AlchemyDomain } from '../../utils/alchemyRegex';

type Section = 'beauty' | 'rules';

export default function AlchemyManagerScreen({
    domain, onClose, initialSection = domain === 'online' ? 'beauty' : 'rules',
}: { domain: AlchemyDomain; onClose: () => void; initialSection?: Section }) {
    const { all, loaded, error, save } = useAlchemyRules(domain);
    return <div className="absolute inset-0 z-[200] flex min-h-0 flex-col bg-[#f7f7f7]" data-alchemy-domain={domain}>
        {!loaded ? <div className="m-auto text-sm text-slate-500">正在读取…</div>
            : error ? <div role="alert" className="m-auto p-6 text-sm text-rose-700">{error}</div>
            : <StoryRegexPanel domain={domain} section={initialSection} rules={all} presets={[]}
                onSave={save} onBack={onClose} />}
    </div>;
}