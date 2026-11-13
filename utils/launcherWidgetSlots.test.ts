import { describe, expect, it } from 'vitest';
import { LAUNCHER_WIDGET_SLOTS, LAUNCHER_FILM_SLOTS, withLauncherWidgetChange } from './launcherWidgetSlots';

describe('launcher photo slot independence', () => {
    it('has eight distinct storage slots, including four exclusive film slots', () => {
        expect(new Set(LAUNCHER_WIDGET_SLOTS).size).toBe(8);
        for (const slot of LAUNCHER_FILM_SLOTS) expect(['tl', 'tr', 'wide', 'dsq']).not.toContain(slot);
    });
    it('changing a film cannot alter unrelated film, header or polaroid', () => {
        const old = { film1: 'film-a', film2: 'film-b', wide: 'header', dsq: 'polaroid' };
        const next = withLauncherWidgetChange(old, 'film1', 'new-photo');
        expect(next).toEqual({ ...old, film1: 'new-photo' });
        expect(old.film1).toBe('film-a');
    });
    it('clearing one film never migrates another slot into that vacancy', () => {
        expect(withLauncherWidgetChange({ film1: 'a', film2: 'b', tr: 'c' }, 'film1')).toEqual({ film2: 'b', tr: 'c' });
    });
    it('clearing the last photo yields an explicit undefined for database deletion', () => {
        expect(withLauncherWidgetChange({ dsq: 'only' }, 'dsq')).toBeUndefined();
    });
    it('can save a film independently when no images were stored before', () => {
        expect(withLauncherWidgetChange(undefined, 'film4', 'blobref:picture')).toEqual({ film4: 'blobref:picture' });
    });
});
