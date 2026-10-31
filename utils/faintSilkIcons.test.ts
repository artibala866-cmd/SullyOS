import {describe, expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import React from 'react';
import {
  FaintSilkIcons,
  FAINT_SILK_ICON_IMAGES,
  faintSilkLoadedIconCss,
} from '../components/chat/FaintSilkIcons';

describe('Faint Silk original image icons - exact native buttons', () => {
  it('retains original author links for matching operations, not random header functions', () => {
    expect(FAINT_SILK_ICON_IMAGES.actions).toBe('https://i.postimg.cc/qMGWdjyD/image.png');
    expect(FAINT_SILK_ICON_IMAGES.emoji).toBe('https://i.postimg.cc/rwnbDsnc/image.png');
    expect(FAINT_SILK_ICON_IMAGES.send).toContain('bb1d139e620cc60c93f39405314e1a77.png');
    expect(FAINT_SILK_ICON_IMAGES.generate).toContain('VkGTJv7j');
    expect(faintSilkLoadedIconCss([])).toBe('');
    // The original "more/info" star is NOT a valid AI-generation or phone icon.
    expect(faintSilkLoadedIconCss(['generate'])).not.toContain('0y2F5DCz');
  });

  it('activates artwork only for successfully loaded images, hiding just its original svg', () => {
    const css=faintSilkLoadedIconCss(['actions','emoji']);
    expect(css).toContain('.sully-chat-actions-button');
    expect(css).toContain('qMGWdjyD/image.png');
    expect(css).toContain('[aria-label="表情面板"]');
    expect(css).toContain('rwnbDsnc/image.png');
    expect(css).toContain('> svg { visibility:hidden!important;opacity:0!important; }');
    expect(css).not.toContain('.sully-chat-back');
    expect(css).not.toContain('.sully-chat-send-button');
    expect(css).not.toContain('display:none!important');
    expect(css).not.toContain('pointer-events:none!important');
    expect(css).not.toContain('position:absolute');
  });

  it('keeps AI stop, phone, microphone and missing images native and clickable', () => {
    const all=faintSilkLoadedIconCss(['back','actions','emoji','send','generate']);
    expect(all).toContain('.sully-chat-trigger[title="触发 AI"]');
    expect(all).not.toContain('[title="停止生成"]');
    expect(all).not.toContain('[aria-label="电话"]');
    expect(all).not.toContain('sully-chat-voice-trigger');
    // During SSR / before network image load, absolutely no icon is hidden.
    expect(renderToStaticMarkup(React.createElement(FaintSilkIcons))).toBe('');
  });
});
