import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compileCatalog } from '../src/compiler/compile.js';
import { Diagnostics } from '../src/compiler/diagnostics.js';
import { compileIcu } from '../src/compiler/icu.js';
import { canonicalStringify } from '../src/compiler/schema.js';
import { evaluateMessage } from '../src/runtime/evaluate.js';
import { Linguini } from '../src/runtime/linguini.js';
import { basicCatalog, writeCatalog } from './helpers.js';

/** Text free of ICU syntax characters ({ } # ' <), so it must survive compile + evaluate verbatim. */
const SAFE_CHARS = [
    ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:;!?-—éüñ日本語',
];
const safeText = fc
    .array(fc.constantFrom(...SAFE_CHARS), { maxLength: 40 })
    .map(chars => chars.join(''));

const identifier = fc
    .tuple(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'),
        fc.array(
            fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'),
            { maxLength: 10 }
        )
    )
    .map(([first, rest]) => first + rest.join(''));

function compileOne(text: string, locale = 'en-US') {
    const diagnostics = new Diagnostics();
    const compiled = compileIcu(text, locale, diagnostics, {});
    expect(diagnostics.hasErrors).toBe(false);
    expect(compiled).toBeDefined();
    return compiled!;
}

describe('property-based', () => {
    it('plain text round-trips through compile + evaluate verbatim', () => {
        fc.assert(
            fc.property(safeText, text => {
                const compiled = compileOne(text);
                expect(evaluateMessage(compiled.nodes, 'en-US', 'k')).toBe(text);
            })
        );
    });

    it('a single argument interpolates exactly once, anywhere in the text', () => {
        fc.assert(
            fc.property(
                safeText,
                safeText,
                identifier,
                fc.oneof(
                    safeText,
                    fc.integer(),
                    fc.double({ noNaN: true, noDefaultInfinity: true })
                ),
                (pre, post, name, value) => {
                    const compiled = compileOne(`${pre}{${name}}${post}`);
                    expect(evaluateMessage(compiled.nodes, 'en-US', 'k', { [name]: value })).toBe(
                        `${pre}${String(value)}${post}`
                    );
                }
            )
        );
    });

    it('plural selection matches Intl.PluralRules for any count in any locale', () => {
        const locales = ['en-US', 'de', 'pl', 'ru', 'ar', 'ja'];
        fc.assert(
            fc.property(
                fc.constantFrom(...locales),
                fc.integer({ min: 0, max: 1_000_000 }),
                (locale, count) => {
                    const categories = new Intl.PluralRules(locale).resolvedOptions()
                        .pluralCategories;
                    const icu = `{n, plural, ${categories
                        .map(category => `${category} {${category}}`)
                        .join(' ')}}`;
                    const compiled = compileOne(icu, locale);
                    expect(evaluateMessage(compiled.nodes, locale, 'k', { n: count })).toBe(
                        new Intl.PluralRules(locale).select(count)
                    );
                }
            )
        );
    });

    it('exact plural matches always win over CLDR categories', () => {
        fc.assert(
            fc.property(fc.integer({ min: 0, max: 50 }), n => {
                const compiled = compileOne(`{n, plural, =${n} {exact} one {one} other {other}}`);
                expect(evaluateMessage(compiled.nodes, 'en-US', 'k', { n })).toBe('exact');
            })
        );
    });

    it('canonicalStringify is invariant under key insertion order', () => {
        const value = fc.oneof(
            safeText,
            fc.integer(),
            fc.boolean(),
            fc.dictionary(identifier, fc.integer(), { maxKeys: 3 })
        );
        const entries = fc.uniqueArray(fc.tuple(identifier, value), {
            selector: ([key]) => key,
            minLength: 1,
            maxLength: 8,
        });
        fc.assert(
            fc.property(entries, list => {
                const forward = Object.fromEntries(list);
                const reversed = Object.fromEntries([...list].reverse());
                expect(canonicalStringify(forward)).toBe(canonicalStringify(reversed));
            })
        );
    });

    it('variant selection stays in bounds for any RNG output in [0, 1]', async () => {
        const artifact = compileCatalog(writeCatalog(basicCatalog())).artifact!;
        const variants = ['Hi Ada!', 'Hey Ada!', 'Yo Ada!'];
        await fc.assert(
            fc.asyncProperty(fc.double({ min: 0, max: 1, noNaN: true }), async r => {
                const lx = new Linguini({ random: () => r });
                await lx.load(artifact);
                const result = lx.format('info.randomGreeting', 'en-US', { name: 'Ada' });
                expect(variants).toContain(result);
            })
        );
    });
});
