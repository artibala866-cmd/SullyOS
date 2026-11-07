import { describe, expect, it } from 'vitest';
import type { CharacterProfile, StoryTheaterEntry, StoryTheaterMask, StoryTheaterPreset } from '../types';
import { DB } from './db';
import { createBlankStoryPreset } from './storyTheater';
import { listCharacterStoryOpenings } from './linkStoryOpenings';

describe('剧情剧场数据与糯米机原生预设备份', () => {
    it('完整备份 round-trip 后条目与自定义预设仍存在', async () => {
        const entry: StoryTheaterEntry = {
            id: 'story-backup-entry',
            title: '雨夜车站',
            premise: '三个人错过末班车。',
            openingMode: 'assistant',
            mask: { type: 'custom', id: 'story-mask' },
            characterIds: ['char-a', 'char-b'],
            writesToCharacterMemory: false,
            characterMemoryDates: {},
            carryCharacterMemory: true,
            characterContextLimits: { 'char-a': 100, 'char-b': 80 },
            archiveAfter: 30,
            archiveKeepRecent: 5,
            archiveStrategy: 'summary',
            archives: [{
                id: 'archive-1',
                strategy: 'summary',
                fromMessageId: 1,
                toMessageId: 2,
                messageCount: 2,
                summary: 'Archived scene summary',
                createdAt: 15,
            }],
            selectedWorldbookIds: ['book-a'],
            presetId: 'story-backup-preset',
            createdAt: 10,
            updatedAt: 20,
        };
        const preset: StoryTheaterPreset = {
            id: 'story-backup-preset',
            name: '备份测试',
            format: 'sullyos-story-preset',
            createdAt: 10,
            updatedAt: 20,
            document: {
                schema: 'sullyos.story-preset',
                version: 1,
                name: '备份测试',
                generation: { temperature: 0.8, topP: 1, frequencyPenalty: 0, presencePenalty: 0, maxTokens: 2048 },
                prompts: [{ id: 'p1', name: '规则', enabled: true, role: 'system', content: '只写故事正文。' }],
            },
        };
        const mask: StoryTheaterMask = { id: 'story-mask', name: '夜航员', description: '来自另一条时间线', coreInstruction: '谨慎行动', worldview: '雨城', createdAt: 10, updatedAt: 20 };

        await DB.saveStoryTheater(entry);
        await DB.saveStoryTheaterPreset(preset);
        await DB.saveStoryTheaterMask(mask);
        const messageId = await DB.saveMessage({
            charId: `story-theater:${entry.id}`,
            role: 'assistant',
            type: 'text',
            content: 'The restored story floor',
            timestamp: 30,
            metadata: {
                source: 'story_theater',
                theaterId: entry.id,
                theaterAffinityInputs: [{ charId: 'char-a', delta: 2, reason: 'noticed change', awareness: 'noticed' }],
            },
        });
        const exported = JSON.parse(JSON.stringify(await DB.exportFullData()));
        expect(exported.storyTheaters).toContainEqual(entry);
        expect(exported.storyTheaterPresets).toContainEqual(preset);
        expect(exported.storyTheaterMasks).toContainEqual(mask);
        expect(exported.messages).toContainEqual(expect.objectContaining({ id: messageId, charId: `story-theater:${entry.id}`, content: 'The restored story floor' }));

        await DB.deleteStoryTheater(entry.id);
        await DB.deleteStoryTheaterPreset(preset.id);
        await DB.deleteStoryTheaterMask(mask.id);
        await DB.deleteMessages([messageId]);
        await DB.importFullData(exported as any);

        expect(await DB.getStoryTheaters()).toContainEqual(entry);
        expect(await DB.getStoryTheaterPresets()).toContainEqual(preset);
        expect(await DB.getStoryTheaterMasks()).toContainEqual(mask);
        const restoredMessages = await DB.getMessagesByCharId(`story-theater:${entry.id}`, true);
        const restoredFloor = restoredMessages.find(message => message.id === messageId);
        expect(restoredFloor?.metadata?.theaterAffinityInputs).toEqual([{ charId: 'char-a', delta: 2, reason: 'noticed change', awareness: 'noticed' }]);
    });
});


describe('剧情导入事务', () => {
    it('并发预设导入只保存一份相同文件，同名不同内容仍独立保存', async () => {
        const initial = { ...createBlankStoryPreset('并发预设'), sourceFileName: 'race.json' };
        const same = { ...initial, id: 'race-duplicate' };
        const different = { ...initial, id: 'race-different',
            document: { ...initial.document, prompts: [{ ...initial.document.prompts[0], content: '不同正文' }] } };
        try {
            const results = await Promise.all([initial, same, different].map(preset => DB.importStoryTheaterPreset(preset)));
            expect(results.map(result => result.duplicate)).toEqual([false, true, false]);
            expect(results[1].preset.id).toBe(initial.id);
            expect(results[2].preset.name).toBe('并发预设（导入 2）');
            expect((await DB.getStoryTheaterPresets()).filter(item => item.sourceFileName === 'race.json')).toHaveLength(2);
        } finally {
            await Promise.all([initial, same, different].map(preset => DB.deleteStoryTheaterPreset(preset.id)));
        }
    });

    it('并发开场导入合并两批，跳过已有酒馆可见正文并保留 TXT 文件名和原文', async () => {
        const actor = { id: 'opening-import-race', name: '原人设', tavernGreetings: [
            { id: 'original', title: '原始标题', content: '<!-- title: 酒馆开场 -->\n原有正文。' },
        ] } as CharacterProfile;
        await DB.saveCharacter(actor);
        try {
            const first = [{ filename: '重复.txt', content: '原有正文。' }, { filename: '开场2.txt', content: '第二幕' }];
            const second = [{ filename: '开场10.txt', content: '<!-- title: 原文注释 -->\n第十幕' }];
            const [a, b] = await Promise.all([DB.importStoryOpeningDocuments(actor.id, first), DB.importStoryOpeningDocuments(actor.id, second)]);
            expect([a.skipped, b.skipped]).toEqual([1, 0]);
            const saved = (await DB.getCharacter(actor.id))!;
            expect(saved.name).toBe(actor.name);
            expect(saved.tavernGreetings?.[0]).toEqual(actor.tavernGreetings?.[0]);
            expect(listCharacterStoryOpenings(saved).map(opening => [opening.title, opening.content])).toEqual([
                ['酒馆开场', '原有正文。'], ['开场2', '第二幕'], ['开场10', '<!-- title: 原文注释 -->\n第十幕'],
            ]);
        } finally {
            await DB.deleteCharacter(actor.id);
        }
        await expect(DB.importStoryOpeningDocuments(actor.id, [{ filename: '孤立.txt', content: '正文' }]))
            .rejects.toThrow('角色已不存在');
        expect(await DB.getCharacter(actor.id)).toBeUndefined();
    });
});
