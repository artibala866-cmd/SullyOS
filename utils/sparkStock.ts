import type { XhsStockImage } from '../types';

export type StockDraft = { url: string; tags: string[] };
const validUrl = (value: string) => /^https?:\/\/[^\s<>\])]+$/i.test(value.trim());
const normalize = (value: unknown): StockDraft | null => {
    if (!value || typeof value !== 'object') return null;
    const item = value as Record<string, unknown>;
    const url = String(item.url || item.src || '').trim();
    if (!validUrl(url)) return null;
    const tags = (Array.isArray(item.tags) ? item.tags : [item.name || item.label || item.description || '素材'])
        .map(v => String(v).trim()).filter(Boolean);
    return { url, tags: tags.length ? tags : ['素材'] };
};
export function parseSparkStock(text: string): StockDraft[] {
    const input = text.trim();
    let drafts: StockDraft[] = [];
    try {
        const parsed = JSON.parse(input);
        const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.images) ? parsed.images : Array.isArray(parsed?.items) ? parsed.items : [parsed];
        drafts = items.map(normalize).filter((v): v is StockDraft => !!v);
    } catch {
        for (const line of input.split(/\r?\n/)) {
            // 表情包式: 名称：[https://example.com/pic.jpg] or 名称：[说明](https://...)
            const match = line.trim().match(/^(.+?)\s*[:：]\s*(?:\[[^\]]*\]\((https?:\/\/[^\s)]+)\)|\[?(https?:\/\/[^\s\]]+)\]?)\s*$/i);
            if (match) {
                const url = match[2] || match[3];
                if (validUrl(url)) drafts.push({ url, tags: [match[1].trim()] });
            }
        }
    }
    const unique = new Map<string, StockDraft>();
    for (const d of drafts) if (!unique.has(d.url)) unique.set(d.url, d);
    return [...unique.values()];
}
export function exportSparkStock(items: XhsStockImage[]): string {
    return JSON.stringify({ format: 'sullyos-spark-stock', version: 1, images: items.map(({ url, tags }) => ({ url, tags })) }, null, 2);
}
export function chooseSparkStock(items: XhsStockImage[], title: string, content: string): XhsStockImage | undefined {
    if (!items.length) return undefined;
    const text = (title + ' ' + content).toLowerCase();
    const ranked = items.map(item => ({
        item,
        score: item.tags.reduce((sum, tag) => sum + (tag && text.includes(tag.toLowerCase()) ? 10 + tag.length : 0), 0),
    })).sort((a, b) => b.score - a.score || a.item.usedCount - b.item.usedCount || a.item.addedAt - b.item.addedAt);
    return ranked[0]?.item;
}
