/** Study-room conversations are isolated by recipient AND explicit purpose.
 * Unscoped historic content remains visible on-device but is never reused
 * as AI context: it could contain unrelated commissions, coursework or notes.
 */
export type StudyDialogueScope='focus'|'study'|'commission'|'plan'|'overview';
export interface FocusChatNote {
  id:string;
  role:'user'|'assistant';
  content:string;
  charId?:string;
  scope?:StudyDialogueScope;
  topicId?:string;
  /** Genuine AI speaking via separately authorized local supervision, not a user message. */
  origin?:'auto_coach';
  /** Only newly returned messages have a trustworthy creation time. */
  createdAt?:number;
}
export function notesForStudyChar(notes:readonly FocusChatNote[],charId:string):FocusChatNote[]{
  if(!charId)return [];
  return notes.filter(n=>n?.charId===charId
    && (n.role==='user'||n.role==='assistant') && typeof n.content==='string');
}
export function notesForStudyContext(
  notes:readonly FocusChatNote[],charId:string,scope:StudyDialogueScope,topicId='',
):FocusChatNote[]{
  return notesForStudyChar(notes,charId).filter(n=>n.scope===scope
    && (n.topicId||'')===topicId);
}
export function legacyUnattributedStudyNotes(notes:readonly FocusChatNote[]):FocusChatNote[]{
  return notes.filter(n=>n && !n.charId && typeof n.content==='string');
}
export function legacyUnscopedStudyNotes(notes:readonly FocusChatNote[],charId:string):FocusChatNote[]{
  return notesForStudyChar(notes,charId).filter(n=>!n.scope);
}
