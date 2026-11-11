import { describe, expect, it } from 'vitest';
import { renderAlchemyTemplatePreview } from './alchemyTemplatePreview';

describe('HTML beauty displays an automatic, live example without a test button or model call', () => {
    it('renders original imported JSON capture fields while keeping HTML, CSS, and checkbox controls', () => {
        const source = '<style>.gift{background:#ea8a45}</style><input type="checkbox" id="open">'
            + '<label for="open">打开红包</label><section>{{1.sender}}：{{1.msg}} ￥{{1.amount}}</section>';
        const html = renderAlchemyTemplatePreview({ replacement: source, parseMode: 'json' });
        expect(html).toContain('<style>.gift{background:#ea8a45}</style>');
        expect(html).toContain('打开红包');
        expect(html).toContain('小糯：送你一份小惊喜 ￥52.00');
        expect(html).not.toContain('{{1.sender}}');
    });

    it('automatically fills theater panels, barrage lines and original plain-text captures', () => {
        const theatrical = '<h2>{{1.title}}</h2>{{#each:1.items}}<p>{{sender}}：{{message}}</p>{{/each}}';
        const output = renderAlchemyTemplatePreview({ replacement: theatrical, parseMode: 'json' });
        expect(output).toContain('今天的小剧场');
        expect(output).toContain('小糯：我来啦！');
        expect((output.match(/<p>/g) || []).length).toBe(2);
        const barrage = renderAlchemyTemplatePreview({
            replacement: '<b>{{1.n1}}</b>：<i>{{1.d1}}</i>', parseMode: 'json',
        });
        expect(barrage).toContain('观众');
        expect(barrage).toContain('前排围观');
        expect(renderAlchemyTemplatePreview({ replacement: '<div>{{$1}}</div>', parseMode: 'text' }))
            .toBe('<div>示例内容</div>');
    });

    it('handles empty drafts without needing user input', () => {
        expect(renderAlchemyTemplatePreview({ replacement: '', parseMode: 'json' })).toBe('');
    });
});
