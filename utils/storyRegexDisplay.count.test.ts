// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { countStoryProseCharacters } from './storyRegexDisplay';
import type { StoryRegexResult } from './storyRegex';

const display = (text: string): StoryRegexResult => ({ text, cards: [], matches: 0 });

describe('剧情回复楼层正文字数（无 API）', () => {
    it('只统计原生剧情正文，不含思维链以外的场景与小剧场', () => {
        const source = '<scene_header>时间：夜晚</scene_header>'
            + '<story_text>雨落。 灯亮。\n第二幕。</story_text>'
            + '<mini_theater><mt_ai><name>旁白</name><text>隐藏小剧场</text></mt_ai></mini_theater>';
        expect(countStoryProseCharacters(display(source))).toBe(Array.from('雨落。灯亮。第二幕。').length);
    });

    it('酒馆 Think 和 ECoT 的思考、附录均不计入；正文连续相加', () => {
        const source = '<Think>思维链很长不应该计数</Think>'
            + '<content>第一幕。\n第二幕。</content>'
            + '<sidestory>附录文字不计数</sidestory>'
            + '<ECoT>第二段思考也不要计</ECoT><content>终章。</content>';
        expect(countStoryProseCharacters(display(source), true)).toBe(Array.from('第一幕。第二幕。终章。').length);
    });

    it('缺失思考关闭标签时，仅正文进入计数', () => {
        expect(countStoryProseCharacters(display('<thinking>不可见推理<content>真实正文。</content>'), true))
            .toBe(Array.from('真实正文。').length);
    });

    it('只有思考和附录返回 0，不把内文当正文', () => {
        expect(countStoryProseCharacters(display('<ECoT>纯思考</ECoT><draft>摘要</draft>'), true)).toBe(0);
    });

    it('纯文本去除空白但保留正文标点与 Unicode 字符', () => {
        expect(countStoryProseCharacters(display('你好， 世界！\nHello'))).toBe(Array.from('你好，世界！Hello').length);
    });

    it('纯富文本正文会统计可见文本，而不是 HTML 标签', () => {
        expect(countStoryProseCharacters(display('<div class="novel"><p>雨停了。</p><p>天亮了。</p></div>'), true))
            .toBe(Array.from('雨停了。天亮了。').length);
    });
});
