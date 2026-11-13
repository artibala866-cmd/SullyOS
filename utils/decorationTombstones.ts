/** Shared across identity-local databases. Never copy history, only explicit
 * deletion identifiers, so removed chat outfits cannot reappear on A/B/A. */
export const DECORATION_DELETED_STORE = 'chat_decoration_deleted_ids_v1';

export function parseDecorationDeletedIds(raw: unknown): string[] {
    if (raw == null) return [];
    let values: unknown;
    try { values = typeof raw === 'string' ? JSON.parse(raw) : raw; }
    catch { throw new Error('聊天装扮删除记录损坏，已停止切换以保护收藏'); }
    if (!Array.isArray(values) || values.some(id => typeof id !== 'string' || !id || id.length > 256))
        throw new Error('聊天装扮删除记录格式异常，已停止切换以保护收藏');
    return [...new Set(values as string[])];
}
