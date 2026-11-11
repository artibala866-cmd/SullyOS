import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

describe('Alchemy real app integration wiring — no new model requests', () => {
    it('keeps beauty in private and group chat only, without changing stored message source', () => {
        const chat = read('apps/Chat.tsx');
        const group = read('apps/GroupChat.tsx');
        const ai = read('hooks/useChatAI.ts');
        expect(chat).toContain("useAlchemyRules('online')");
        expect(chat).toContain("domain='online'");
        expect(chat).toContain('alchemyResult={alchemyResults.get(m.id)}');
        expect(group).toContain("useAlchemyRules('online')");
        expect(group).toContain("domain='online'");
        expect(group).toContain('alchemyResult={alchemyResults.get(m.id)}');
        expect(group).toContain("loadAlchemyInstructions('online'");
        expect((group.match(/loadAlchemyInstructions\('online'/g) || []).length).toBe(2);
        expect(ai).toContain("loadAlchemyInstructions('online'");
        expect(read('components/chat/MessageItem.tsx')).toContain('AlchemyMessageBody');
        expect(read('hooks/useAlchemyRegex.ts')).toContain('runStoryRegex(');
    });

    it('keeps offline rules in story and meeting; sprite/novel display is local and original speech remains', () => {
        const story = read('components/date/story/StoryTheaterSession.tsx');
        const date = read('apps/DateApp.tsx');
        const screen = read('components/date/DateSession.tsx');
        expect(story).toContain("alchemyDomain(rule) === 'offline'");
        expect(date).toContain('applyMeetingAlchemyRequest(messages, modelText');
        expect(date).toContain('applyMeetingAlchemyRequest(messages, lastUserMsg.content');
        expect(date).toContain("applyMeetingAlchemyRequest(messages, ''");
        expect(screen).toContain("useAlchemyRules('offline')");
        expect(screen).toContain("domain='offline'");
        expect(screen).toContain('alchemyDisplay.get(msg.id)?.text');
        expect(screen).toContain('spriteAlchemy.get(-987654321)?.text');
        expect(screen).toContain('const galShownText = currentText');
    });

    it('only uses local DB and regex worker, never a second LLM request for regex classification', () => {
        const helper = read('utils/alchemyRegex.ts');
        const meeting = read('utils/alchemyMeeting.ts');
        const results = read('hooks/useAlchemyRegex.ts');
        for (const source of [helper, meeting, results]) {
            expect(source).not.toMatch(/\b(?:fetch|callLLM|callCompletion|completeGroupChatWithMcp|axios)\s*\(/);
        }
        expect(meeting).toContain("runStoryRegex(");
        expect(helper).toContain("const FORMAT_CUES:");
        expect(results).not.toMatch(/(?:DB\.updateMessage|DB\.saveMessage)/);
    });
});
