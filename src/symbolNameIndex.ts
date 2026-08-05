import { GPLSymbol } from './gplParser';

export function buildSymbolNameIndex(symbols: Iterable<GPLSymbol>): Map<string, GPLSymbol[]> {
    const index = new Map<string, GPLSymbol[]>();
    for (const sym of symbols) {
        const key = sym.name.toLowerCase();
        const bucket = index.get(key);
        if (bucket) {
            bucket.push(sym);
        } else {
            index.set(key, [sym]);
        }
    }
    return index;
}
