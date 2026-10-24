import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('retired 彼方 isolation', () => {
  it('never injects the old VR game in normal AI prompts or returns legacy VR cards', () => {
    const code = source('utils/chatPrompts.ts');
    expect(code).not.toContain('### 关于《彼方》');
    expect(code).not.toContain('kanataPublicContext');
    expect(code).not.toContain("else if ((m.type as string) === 'vr_card')");
    expect(code).toContain(".filter(m => m.type !== 'vr_card')");
  });

  it('does not require the retired module for chat, TTS, meeting or 3D resident rendering', () => {
    for (const path of ['hooks/useChatAI.ts', 'apps/Chat.tsx', 'apps/DateApp.tsx',
      'apps/RoomApp.tsx', 'apps/room3d/Home3DSetupEntry.tsx', 'components/character/HomeFigureStudio.tsx',
      'components/character/ChibiStudio.tsx', 'components/os/MobileGameHome.tsx']) {
      expect(source(path), path).not.toMatch(/(?:from|import\s*\()\s*['"`][^'"`]*vrWorld\//);
    }
    expect(source('components/os/MobileGameHome.tsx')).not.toContain('AppID.VRWorld');
    expect(source('components/character/ChibiStudio.tsx')).not.toContain("id: 'vr'");
    expect(source('apps/RoomApp.tsx')).not.toContain('userProfile.vrState');
  });

  it('never submits or reactivates legacy worker module effects', () => {
    expect(source('utils/activeMsgClient.ts')).not.toContain('...(params.sarModule ?');
    expect(source('utils/vrWorld/sarEnvelopeCore.ts')).toContain('void snapshot;');
    expect(source('utils/vrWorld/sarModuleRuntime.ts')).toContain('hasActiveEffect: false');
  });
});
