/** Local-only focus chat history is isolated by character.
 * Legacy notes without a charId stay readable on-device but are never placed
 * into any future model request, because their original recipient is unknown.
 */
export interface FocusChatNote {
  id:string;
  role:'user'|'assistant';
  content:string;
  charId?:string;
}
export function notesForStudyChar(notes:readonly FocusChatNote[],charId:string):FocusChatNote[] {
  if (!charId) return [];
  return notes.filter(n=>n?.charId===charId
    && (n.role==='user'||n.role==='assistant') && typeof n.content==='string');
}
export function legacyUnattributedStudyNotes(notes:readonly FocusChatNote[]):FocusChatNote[] {
  return notes.filter(n=>n && !n.charId && typeof n.content==='string');
}
