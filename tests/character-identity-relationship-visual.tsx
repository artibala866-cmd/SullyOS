import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import IdentityRelationshipField from '../components/character/IdentityRelationshipField';

function VisualFixture() {
    const [relationship, setRelationship] = useState('');
    useEffect(() => {
        const field = document.querySelector('textarea[aria-label="身份关系"]');
        document.body.dataset.identityRelationshipReady = field ? 'true' : 'false';
        document.body.dataset.identityRelationshipValue = relationship;
    }, [relationship]);
    return (
        <main className="min-h-screen bg-[#f2f2f2] px-5 py-8">
            <div className="mx-auto max-w-[620px] space-y-7" id="relationship-root">
                <section>
                    <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-1.5 block">分组</label>
                    <div className="flex items-center gap-2">
                        <select className="flex-1 bg-white rounded-[15px] border border-black/[0.06] px-4 py-2.5 text-sm text-neutral-700 shadow-sm appearance-none">
                            <option>暗恋</option>
                        </select>
                        <button className="px-3 py-2.5 rounded-2xl bg-white text-xs text-neutral-500 shadow-sm">＋新建</button>
                    </div>
                </section>
                <IdentityRelationshipField value={relationship} onChange={setRelationship} />
                <section>
                    <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-1.5 block">核心指令 (System Prompt)</label>
                    <textarea className="w-full h-40 bg-white rounded-[20px] p-5 border border-black/[0.06] text-sm shadow-sm resize-none" placeholder="设定..." />
                </section>
            </div>
        </main>
    );
}
createRoot(document.getElementById('root')!).render(<VisualFixture />);
