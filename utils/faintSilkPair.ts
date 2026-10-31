/** Identify only the original Faint Silk whitebox; works for older saved CSS too.
 * Never treat another theme's generic paired-avatar styles as Faint Silk. */
export function isFaintSilkPairCss(css?: string | null): boolean {
    return !!css?.includes('Faint Silk 浅丝 by 落吟')
        && css.includes('--faint-glass');
}
