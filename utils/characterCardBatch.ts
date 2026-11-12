import { readCharacterCardFile, type PreparedCardImport, type PreparedCharacterCard } from './sillyTavernCard';

/** Multiple local files are only a selection container; each card retains its own parsed data. */
export interface PreparedLocalCardBatch {
    source: 'local-batch';
    cards: PreparedCharacterCard[];
    fileNames: string[];
    warnings: string[];
}

export const MAX_LOCAL_CARD_FILES = 100;

/** Fully parse and validate every selected file before exposing any cards for saving. */
export async function readLocalCharacterCards(files: readonly File[]): Promise<PreparedCardImport | PreparedLocalCardBatch> {
    if (!files.length) throw new Error('未选择角色卡');
    if (files.length > MAX_LOCAL_CARD_FILES) throw new Error('一次最多选择 100 个文件，请分批导入');
    if (files.length === 1) return readCharacterCardFile(files[0]);

    const cards: PreparedCharacterCard[] = [];
    const fileNames: string[] = [];
    const warnings: string[] = [];
    for (const file of files) {
        let parsed: PreparedCardImport;
        try {
            parsed = await readCharacterCardFile(file);
        } catch (error) {
            const reason = error instanceof Error ? error.message : '角色卡无法解析';
            throw new Error(`「${file.name}」：${reason}；本批次未导入任何角色`);
        }
        const fromFile = parsed.source === 'babylink' ? parsed.cards : [parsed];
        if (!fromFile.length) throw new Error(`「${file.name}」未包含角色；本批次未导入任何角色`);
        cards.push(...fromFile);
        fileNames.push(...fromFile.map(() => file.name));
        if (parsed.source === 'babylink') warnings.push(...parsed.warnings.map(w => `「${file.name}」：${w}`));
    }
    return { source: 'local-batch', cards, fileNames, warnings };
}
