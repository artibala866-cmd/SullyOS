import React from 'react';

export default function CharacterSettingsSection({ title, summary, children }: {
  title: string; summary?: string; children: React.ReactNode;
}) {
  return <details className="group/section overflow-hidden bg-white rounded-[20px] border border-black/[0.06] shadow-[0_2px_12px_rgba(0,0,0,0.03)] [&_textarea]:shadow-none">
    <summary className="list-none cursor-pointer flex items-center gap-3 px-5 py-[18px] [&::-webkit-details-marker]:hidden">
      <span className="flex-1 min-w-0">
        <span className="block text-[14px] font-semibold tracking-[-0.02em] text-[#242424]">{title}</span>
        {summary && <span className="block text-[11px] text-[#929292] mt-1.5 truncate">{summary}</span>}
      </span>
      <span aria-hidden="true" className="text-[#a0a0a0] text-xl leading-none transition-transform group-open/section:rotate-90">›</span>
    </summary>
    <div className="border-t border-black/[0.06] [&>div]:border-0 [&>div]:shadow-none">{children}</div>
  </details>;
}
