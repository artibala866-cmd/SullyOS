import { describe, it, expect } from 'vitest';
import {
    eligibleTranslationSource,
    normalizeLabeledBilingualOutput,
    parseFallbackTranslations,
    type BilingualMode,
} from './bilingualRecovery';

const korean: BilingualMode = { enabled: true, sourceLang: '한국어', targetLang: '中文' };

describe('translation recovery across models', () => {
    it('does not alter canonical XML or disabled messages', () => {
        const xml = '<翻译><原文>안녕</原文><译文>你好</译文></翻译>';
        expect(normalizeLabeledBilingualOutput(xml, korean)).toBe(xml);
        expect(normalizeLabeledBilingualOutput('原文：안녕\n译文：你好', { ...korean, enabled: false }))
            .toBe('原文：안녕\n译文：你好');
    });

    it('accepts Chinese labels without touching either side', () => {
        expect(normalizeLabeledBilingualOutput('原文：안녕 ㅎㅎ\n译文：你好（笑）', korean))
            .toBe('<翻译><原文>안녕 ㅎㅎ</原文><译文>你好（笑）</译文></翻译>');
    });

    it('accepts English labels and user-selected native language labels', () => {
        expect(normalizeLabeledBilingualOutput('Original: 사랑해\nTranslation: 我爱你', korean))
            .toBe('<翻译><原文>사랑해</原文><译文>我爱你</译文></翻译>');
        expect(normalizeLabeledBilingualOutput('한국어: 뭐해?\n中文: 干嘛呢？', korean))
            .toBe('<翻译><原文>뭐해?</原文><译文>干嘛呢？</译文></翻译>');
    });

    it('accepts JSON formatted pairs instead of exposing JSON to users', () => {
        expect(normalizeLabeledBilingualOutput('{"original":"안녕","translation":"你好"}', korean))
            .toBe('<翻译><原文>안녕</原文><译文>你好</译文></翻译>');
    });

    it('preserves emoji directives in their original position and never guesses from prose', () => {
        const raw = '原文：안녕\n译文：你好\n[[SEND_EMOJI: 狐狸]]\n原文：잘자\n译文：晚安';
        const normalized = normalizeLabeledBilingualOutput(raw, korean);
        expect(normalized).toBe('<翻译><原文>안녕</原文><译文>你好</译文></翻译>\n[[SEND_EMOJI: 狐狸]]\n<翻译><原文>잘자</原文><译文>晚安</译文></翻译>');
        expect(normalizeLabeledBilingualOutput('我只是说原文很好看，不是在求翻译。', korean))
            .toBe('我只是说原文很好看，不是在求翻译。');
    });

    it('removes quote commands from material sent to the translation-only fallback', () => {
        expect(eligibleTranslationSource('[[QUOTE: 你怎么回事]]안녕')).toBe('안녕');
        expect(eligibleTranslationSource('[[SEND_EMOJI: fox]]')).toBe('');
        expect(eligibleTranslationSource('<语音>안녕</语音>')).toBe('');
        expect(eligibleTranslationSource('안녕\n%%BILINGUAL%%\n你好')).toBe('');
    });

    it('accepts only a correctly aligned JSON translation array', () => {
        expect(parseFallbackTranslations('["你好","晚安"]', 2)).toEqual(['你好', '晚安']);
        expect(parseFallbackTranslations('{"translations":["你好","晚安"]}', 2)).toEqual(['你好', '晚安']);
        expect(parseFallbackTranslations('["你好"]', 2)).toBeNull();
        expect(parseFallbackTranslations('{"translations":["你好",""]}', 2)).toBeNull();
    });

    it('accepts numbered translations when a new model refuses JSON format', () => {
        expect(parseFallbackTranslations('1. 你好\n2. 晚安', 2)).toEqual(['你好', '晚安']);
        expect(parseFallbackTranslations('译文：你好（笑）', 1)).toEqual(['你好（笑）']);
        expect(parseFallbackTranslations('无法翻译', 1)).toBeNull();
    });
});
