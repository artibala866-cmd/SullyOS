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
        expect(group).toContain("applyAlchemyRequestHistory('online', alchemyDirectorMessages)");
        expect(group).toContain("applyAlchemyRequestHistory('online', alchemyMemberMessages)");
        expect(ai).toContain("applyAlchemyRequestHistory('online', fullMessages)");
        expect((group.match(/loadAlchemyInstructions\('online'/g) || []).length).toBe(2);
        expect(ai).toContain("loadAlchemyInstructions('online'");
        expect(read('components/chat/MessageItem.tsx')).toContain('AlchemyMessageBody');
        expect(read('components/alchemy/AlchemyMessageBody.tsx')).toContain('AlchemyHtmlFrame');
        expect(read('components/alchemy/AlchemyHtmlFrame.tsx')).toContain('sandbox="allow-scripts"');
        expect(read('components/alchemy/AlchemyHtmlFrame.tsx')).toContain('buildAlchemySandboxDocument');
        expect(read('hooks/useAlchemyRegex.ts')).toContain('runStoryRegex(');
        expect(read('hooks/useAlchemyRegex.ts')).toContain("message.role === 'user'");
        expect(read('hooks/useAlchemyRegex.ts')).toContain("role: message.role as 'assistant' | 'user'");
        expect(group).toContain('{alchemyResult ? <AlchemyMessageBody result={alchemyResult} /> : msg.content}');
        expect(read('components/chat/MessageItem.tsx')).toContain("if (m.type === 'text' && alchemyResult");
    });

    it('keeps offline rules in story and meeting; sprite/novel display is local and original speech remains', () => {
        const story = read('components/date/story/StoryTheaterSession.tsx');
        const date = read('apps/DateApp.tsx');
        const screen = read('components/date/DateSession.tsx');
        expect(story).toContain("alchemyRuleAppliesTo(rule, 'offline')");
        expect(date).toContain('applyMeetingAlchemyRequest(messages, modelText');
        expect(date).toContain('applyMeetingAlchemyRequest(messages, lastUserMsg.content');
        expect(date).toContain("applyMeetingAlchemyRequest(messages, ''");
        expect(screen).toContain("useAlchemyRules('offline')");
        expect(screen).toContain("domain='offline'");
        expect(screen).toContain('alchemyDisplay.get(msg.id)?.text');
        expect(screen).toContain('spriteAlchemy.get(-987654321)?.text');
        expect(screen).toContain("useAlchemyMessageResults(messages, meetingRules, 'offline', 'meeting')");
        expect(read('utils/alchemyMeeting.ts')).toContain('loadMeetingAlchemyRules()');
        expect(read('utils/alchemyRegex.ts')).toContain('alchemyRulesForMeeting');
        expect(screen).toContain('const galShownText = currentText');
    });

    it('exposes rule manager online and offline with confirmed list-level deletion', () => {
        const privateChat = read('apps/Chat.tsx');
        const group = read('apps/GroupChat.tsx');
        const menu = read('components/chat/ChatInputArea.tsx');
        const manager = read('components/alchemy/AlchemyManagerScreen.tsx');
        const panel = read('components/date/story/StoryRegexPanel.tsx');
        const folders = read('components/alchemy/AlchemyRuleFolders.tsx');
        expect(menu).toContain("onPanelAction('alchemy-beauty')");
        expect(menu).toContain('正则</span>');
        expect(menu).not.toContain('key="alchemy-rules"');
        expect(privateChat).toContain("case 'alchemy-beauty'");
        expect(privateChat).not.toContain("case 'alchemy-rules'");
        expect(group).toContain("initialSection='beauty'");
        expect(group).toContain("setShowAlchemy(true)");

        expect(group).not.toContain('规则正则</span>');
        expect(manager).toContain('StoryRegexPanel');
        expect(panel).toContain("['beauty', 'HTML 美化']");
        expect(panel).toContain("['rules', '规则']");
        expect(panel).toContain("accept='.json,.txt,.html,.htm,application/json,text/html'");
        expect(panel).toContain("setActiveSection(imported.rules.some(rule => rule.kind === 'template') ? 'beauty' : 'rules')");
        expect(panel).toContain("isTemplate ? 'HTML 代码' : '替换内容'");
        expect(panel).toContain("id='alchemy-source'");
        expect(panel).toContain("!isTemplate && <details");
        expect(panel).toContain("aria-label='规则生效范围'");
        expect(panel).toContain("onDeleteFolder={(folder, selected)");
        expect(panel).toContain("onDelete={rule");
        expect(folders).toContain("aria-label={'删除规则 ' + rule.name}");
        expect(folders).toContain("aria-label={'删除分组 ' + folder}");
        expect(folders).toContain('确认删除');
        expect(folders).toContain('取消');
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
