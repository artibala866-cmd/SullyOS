import type { Worldbook } from '../types';
import { cardContentFingerprint } from './cardImportMerge';

/**
 * Safely plan standalone worldbook imports against the currently stored library.
 * This is used inside the IndexedDB write transaction, not against stale React
 * state. Exact duplicates skip; source-ID updates preserve the local ID and
 * createdAt. Local edits and ambiguous same-body/different-rule rows conflict
 * instead of being silently overwritten or multiplied.
 */
const fields = [
    'title','content','category','key','keysecondary','constant','selective',
    'selectiveLogic','order','position','disable','probability','useProbability',
    'depth','role','scanDepth','caseSensitive','matchWholeWords',
] as const;
const canonical = (book: Worldbook): string =>
    JSON.stringify(fields.map(k => book[k] ?? null));
export const importedWorldbookSnapshot = (book:Worldbook):string =>
    cardContentFingerprint(canonical(book));

export interface WorldbookImportPlan {
    library:Worldbook[];
    added:Worldbook[];
    updated:Worldbook[];
    skipped:number;
    conflicts:number;
}
export const planWorldbookImport = (existing:Worldbook[], incoming:Worldbook[]):WorldbookImportPlan=>{
    const library=existing.map(book=>({...book}));
    const added:Worldbook[]=[],updated:Worldbook[]=[];
    let skipped=0,conflicts=0;
    const seenIncoming=new Set<string>();
    for(const raw of incoming){
        if(!raw || !raw.id || !raw.title?.trim() || typeof raw.content!=='string')
            throw new Error('世界书导入条目缺少 ID、标题或正文');
        const key=raw.cardImportKey?.trim();
        const signature=canonical(raw);
        const batchKey=key ? 'source:'+key : 'entry:'+signature;
        if(seenIncoming.has(batchKey)){
            if(key && incoming.some(other=>other!==raw && other.cardImportKey===key &&
                canonical(other)!==signature))
                throw new Error('同批世界书包含冲突的来源条目 ID，已撤销导入');
            skipped++;continue;
        }
        seenIncoming.add(batchKey);
        if(key){
            const matches=library.filter(book=>book.cardImportKey===key);
            if(matches.length>1)throw new Error('现有世界书包含重复来源 ID，不能安全覆盖');
            if(matches.length===1){
                const old=matches[0];
                if(canonical(old)===signature){skipped++;continue;}
                if(old.cardImportSnapshot && old.cardImportSnapshot!==importedWorldbookSnapshot(old)){
                    conflicts++;continue;
                }
                // Old imported entries without a snapshot cannot prove whether
                // they have been hand-edited. Never replace them automatically.
                if(!old.cardImportSnapshot){conflicts++;continue;}
                const next={...raw,id:old.id,createdAt:old.createdAt,
                    updatedAt:Date.now(),cardImportSnapshot:importedWorldbookSnapshot(raw)};
                library[library.findIndex(b=>b.id===old.id)]=next;
                updated.push(next);continue;
            }
        }
        // Before adding, check both name/body identity AND activation settings.
        // Skipping a config edit as if it were identical would lose important
        // enabled/trigger/depth changes.
        const sameBody=library.filter(book=>
            book.title.trim()===raw.title.trim() &&
            book.category.trim()===raw.category.trim() &&
            book.content===raw.content);
        if(sameBody.some(book=>canonical(book)===signature)){skipped++;continue;}
        // Two different Link source IDs may intentionally reuse the same
        // prose under different trigger rules. Do not collapse distinct
        // source-owned entries merely because their body is the same.
        if(sameBody.length && !(key && sameBody.every(book =>
            book.cardImportKey && book.cardImportKey!==key))){conflicts++;continue;}
        if(library.some(book=>book.id===raw.id))throw new Error('世界书条目 ID 与现有数据冲突');
        const next={...raw,...(key?{cardImportSnapshot:importedWorldbookSnapshot(raw)}:{})};
        library.push(next);added.push(next);
    }
    return {library,added,updated,skipped,conflicts};
};
