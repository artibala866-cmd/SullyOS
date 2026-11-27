import React from 'react';

interface IdentityRelationshipFieldProps {
  value?: string;
  onChange: (value: string) => void;
}

/** Reuses the existing Neural Link label and textarea styling. */
export default function IdentityRelationshipField({ value, onChange }: IdentityRelationshipFieldProps) {
  return (
    <div data-testid="character-identity-relationship">
      <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-1.5 block">
        身份关系 (Relationship)
      </label>
      <textarea
        aria-label="身份关系"
        value={value || ''}
        onChange={event => onChange(event.target.value)}
        className="w-full h-24 bg-white rounded-[20px] p-5 border border-black/[0.06] text-sm shadow-sm resize-none focus:ring-1 focus:ring-[#999999]/30 transition-all vr-reader-scroll"
        placeholder="关系…"
      />
    </div>
  );
}
