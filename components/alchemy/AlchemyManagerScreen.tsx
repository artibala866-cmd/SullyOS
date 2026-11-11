import React from 'react';
import StoryRegexPanel from '../date/story/StoryRegexPanel';
import { useAlchemyRules } from '../../hooks/useAlchemyRegex';
import type { AlchemyDomain } from '../../utils/alchemyRegex';

export default function AlchemyManagerScreen({ domain, onClose }: { domain: AlchemyDomain; onClose: () => void }) {
    const { all, loaded, error, save } = useAlchemyRules(domain);
    return <div className="absolute inset-0 z-[200] flex flex-col bg-stone-100" data-alchemy-domain={domain}>
        {!loaded ? <div className="m-auto text-sm text-slate-600">读取正则…</div>
            : error ? <div role="alert" className="m-auto p-6 text-sm text-rose-700">{error}</div>
            : <StoryRegexPanel domain={domain} rules={all} presets={[]} onSave={save} onBack={onClose} />}
    </div>;
}
