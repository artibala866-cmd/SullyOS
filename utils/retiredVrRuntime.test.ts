import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('retired 彼方 isolation', () => {
  it('does not forward removed Animal Crossing appearance props to group chat', () => {
    const code = source('apps/GroupChat.tsx');
    expect(code).not.toContain('acnhChatSync');
    expect(code).not.toContain("skin === 'animalcrossing'");
    expect(code).not.toContain('acnh={');
  });
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
      'components/character/ChibiStudio.tsx']) {
      expect(source(path), path).not.toMatch(/(?:from|import\s*\()\s*['"`][^'"`]*vrWorld\//);
    }
    expect(source('components/character/ChibiStudio.tsx')).not.toContain("id: 'vr'");
    expect(source('apps/RoomApp.tsx')).not.toContain('userProfile.vrState');
    expect(source('components/chat/MessageItem.tsx')).not.toContain('SARSpeechSwitch');
    expect(source('components/date/DateSession.tsx')).not.toContain('SARSpeechSwitch');
    expect(source('components/chat/MessageItem.tsx')).toContain("if (m.type === 'vr_card') return null;");
  });

  it('keeps every desktop theme free of the removed VRWorld icon and launcher entry', () => {
    for (const path of [
      'apps/Launcher.tsx',
      'components/os/HomelyHome.tsx',
      'components/os/CompanionHome.tsx',
    ]) {
      expect(source(path), path).not.toMatch(/\b(?:Icons|AppID)\.VRWorld\b/);
    }
  });

  it('keeps removed desktop themes unavailable while preserving 3D Dream', () => {
    expect(existsSync(resolve(process.cwd(), 'components/os/TamagotchiHome.tsx'))).toBe(false);
    expect(existsSync(resolve(process.cwd(), 'components/os/acnhIcons.tsx'))).toBe(false);
    expect(existsSync(resolve(process.cwd(), 'components/os/MobileGameHome.tsx'))).toBe(false);
    expect(existsSync(resolve(process.cwd(), 'components/os/mobilegameArt.tsx'))).toBe(false);
    expect(source('apps/Launcher.tsx')).not.toContain("theme.skin === 'mobilegame'");
    for (const path of ['apps/Launcher.tsx', 'apps/Appearance.tsx', 'apps/Chat.tsx',
      'components/PhoneShell.tsx', 'components/chat/ChatInputArea.tsx', 'components/os/AppIcon.tsx']) {
      const code = source(path);
      expect(code, path).not.toContain('AcnhActionTile');
      expect(code, path).not.toContain('TamagotchiHome');
    }
    expect(source('apps/Appearance.tsx')).not.toContain("id: 'animalcrossing'");
    expect(source('apps/Appearance.tsx')).not.toContain("id: 'tamagotchi'");
    expect(source('apps/RoomApp.tsx')).toContain('homeReadyCharId===char.id');
    expect(source('apps/room3d/Home3DView.tsx')).toContain('onReadyChange?.(!!editor&&mainReady&&!suspended)');
  });

  it('never submits or reactivates legacy worker module effects', () => {
    expect(source('utils/activeMsgClient.ts')).not.toContain('...(params.sarModule ?');
    for (const retired of [
      'utils/vrWorld',
      'components/sar',
      'assets/sar',
      'worker/amsg/src/sarEnvelope.ts',
      'worker/amsg/src/sarEnvelope.test.ts',
    ]) expect(existsSync(resolve(process.cwd(), retired)), retired).toBe(false);
    expect(source('worker/amsg/src/agentic.ts')).not.toContain('planFromSARModuleSnapshot');
    expect(source('worker/amsg/src/index.ts')).not.toContain('readSarSnapshot');
    expect(source('worker/amsg/src/index.ts')).not.toContain("field: 'amsgSar'");
  });
});
