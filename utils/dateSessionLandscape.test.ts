import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../components/date/date-session-landscape.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../components/date/DateSession.tsx', import.meta.url), 'utf8');
describe('Meet landscape layout regression', () => {
  it('protects both rotations, viewport keyboard and configured sprite transforms', () => {
    expect(css).toContain('(orientation: landscape) and (max-height: 760px)');
    expect(css).toContain('.date-session-sprite-stage');
    expect(css).toContain('.date-session-dialogue-card');
    expect(css).toContain('.date-session-input-box');
    expect(css).toContain('.date-session-controls');
    expect(css).toContain('overflow-y: auto');
    expect(app).toContain('date-session-input-open');
    expect(app).toContain('date-session-reading-page');
    expect(app).toContain('date-session-observe');
    expect(app).toContain('date-session-typing-indicator');
    expect(app).toContain('spriteConfig.scale');
    expect(app).toContain("'--date-landscape-fit-scale'");
    expect(css).toContain('scale: var(--date-landscape-fit-scale, 1)');
    expect(css).toContain('.date-session-dialogue-card > div:first-child');
    expect(css).toContain('(orientation: portrait) and (max-width: 800px)');
    expect(css).toContain('date-session-sprite-zoomed');
    expect(css).toContain('.date-settings-sprite-preview');
    expect(css).toContain('aspect-ratio: 9 / 19.5');
    expect(app).toContain('window.visualViewport');
    expect(app).toContain('ref={sessionRootRef}');
  });
});
