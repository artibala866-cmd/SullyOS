import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAUNCHER_WIDGET_SLOTS } from './launcherWidgetSlots';

const launcher = readFileSync(path.resolve(__dirname, '../apps/Launcher.tsx'), 'utf8');
const appearance = readFileSync(path.resolve(__dirname, '../apps/Appearance.tsx'), 'utf8');
const osContext = readFileSync(path.resolve(__dirname, '../context/OSContext.tsx'), 'utf8');

describe('desktop image slot isolation and blobref persistence', () => {
    it('film renders film1–4 only, and no base image is reused as fallback', () => {
        expect(launcher).toContain('LAUNCHER_FILM_SLOTS.map((slot, index) => (');
        expect(launcher).toContain('<TokenImg value={theme.launcherWidgets[slot]}');
        expect(launcher).not.toContain('theme.launcherWidgets?.[`film${index + 1}`] ||');
        expect(appearance).toContain('const img = custom;');
        expect(appearance).not.toContain('custom || theme.launcherWidgets?.[fallback]');
    });

    it('native picker captures the slot, uses BlobRef, and ignores older in-flight uploads', () => {
        expect(appearance).toContain('const slot = selectedWidgetSlotRef.current;');
        expect(appearance).toContain('const blob = await processImageToBlob(file, { maxWidth: maxW, quality: 0.9 });');
        expect(appearance).toContain('const ref = await putImageBlob(blob);');
        expect(appearance).toContain('widgetUploadRevisionRef.current[slot] !== revision');
        expect(appearance).toContain('await updateLauncherWidget(slot, ref);');
        expect(appearance).not.toContain('[activeWidgetSlot]: ref');
    });

    it('all 8 slots persist separately and explicit clear deletes final rows', () => {
        expect(LAUNCHER_WIDGET_SLOTS).toEqual(['tl', 'tr', 'wide', 'dsq', 'film1', 'film2', 'film3', 'film4']);
        expect(osContext).toContain('DB.saveAsset(`widget_${slot}`, val)');
        expect(osContext).toContain('DB.deleteAsset(`widget_${slot}`)');
        expect(osContext).toContain("Object.prototype.hasOwnProperty.call(updates, 'launcherWidgets')");
        expect(osContext).toContain('widgetPersistTailRef.current.catch(() => {}).then');
        expect(osContext).toContain('await DB.saveAsset(`widget_${slot}`, stored)');
    });

    it('uses TokenImg for all photo previews, never bare <img> with BlobRef', () => {
        expect(launcher).toContain('<TokenImg value={theme.launcherWidgets[slot]}');
        expect(appearance).toContain('<TokenImg value={img} className="w-full h-full object-cover" />');
        expect(appearance).not.toContain('桌面装饰 DIY');
    });
});
