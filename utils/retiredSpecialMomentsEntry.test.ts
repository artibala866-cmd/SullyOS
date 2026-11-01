import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const source = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
describe('退役节日活动与手办系统解耦', () => {
    const studio = source('components/character/ChibiStudio.tsx');
    const home = source('components/character/HomeFigureStudio.tsx');
    const shell = source('components/PhoneShell.tsx');
    const creator = source('components/character/CreatorIframe.tsx');
    const apps = source('constants.tsx');
    it('仅保留小小窝展台，不再读取或写入旧 520 活动槽位', () => {
        expect(studio).toMatch(/id: 'room', label: '小小窝'/);
        expect(studio).not.toMatch(/like520|LIKE520_RECORD_KEY|specialMomentRecords|特别时光|同步到全部/);
        expect(home).not.toMatch(/like520|LIKE520_RECORD_KEY|特别时光/);
    });
    it('保留捏人器状态、家园编辑与自定义素材', () => {
        expect(studio).toContain('putImageBlob(dataUrlToBlob(result.transparentDataUrl))');
        expect(studio).toContain('CreatorPartsUploader');
        expect(studio).toContain('HomeFigureStudio');
        expect(creator).toContain('savedState');
        expect(creator).toContain('loadCreatorPartsForRender');
        expect(creator).toContain('like520_init'); // 保留 iframe 历史消息协议
        expect(home).toContain('HomeFigureEditor');
    });
    it('不再自动弹出指向已退役 App 的旧节日页面', () => {
        expect(shell).not.toMatch(/Like520Controller|QixiLaunchPopup|showLike520Popup/);
        expect(apps).not.toMatch(/SpecialMoments:/);
        expect(apps).not.toMatch(/id: AppID.SpecialMoments/);
    });
});
