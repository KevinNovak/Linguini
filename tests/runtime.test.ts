import { describe, expect, it } from 'vitest';
import type { Artifact } from '../src/artifact.js';
import { compileCatalog } from '../src/compiler/compile.js';
import { bindLocale } from '../src/runtime/bind-locale.js';
import { Linguini, MissingKeyPolicy } from '../src/runtime/linguini.js';
import { basicCatalog, writeCatalog } from './helpers.js';

function compiled(): Artifact {
    const result = compileCatalog(writeCatalog(basicCatalog()));
    expect(result.diagnostics.errors).toEqual([]);
    return result.artifact!;
}

describe('Linguini runtime', () => {
    it('formats plain, plural, and no-param messages', async () => {
        const lx = new Linguini();
        await lx.load(compiled());
        expect(lx.format('info.greeting', 'en-US', { name: 'Ada' })).toBe('Hello, Ada!');
        expect(lx.format('info.birthdayCount', 'en-US', { count: 1 })).toBe('1 birthday');
        expect(lx.format('info.birthdayCount', 'de', { count: 3 })).toBe('3 Geburtstage');
        expect(lx.format('info.noParams', 'en-US')).toBe('Just text.');
        expect(lx.format('info.multiline', 'en-US')).toBe(
            'Line one\nDocs: https://example.com/docs'
        );
    });

    it('falls back through the locale chain and reports misses', async () => {
        const missing: string[] = [];
        const lx = new Linguini({ onMissing: (key, locale) => missing.push(`${key}@${locale}`) });
        await lx.load(compiled());

        // de-AT truncates to de.
        expect(lx.format('info.greeting', 'de-AT', { name: 'Ada' })).toBe('Hallo, Ada!');
        // de lacks this key → base locale content, plus an onMissing signal.
        expect(lx.format('info.noParams', 'de')).toBe('Just text.');
        expect(missing).toContain('info.noParams@de');
    });

    it('applies the missingKeys policy for absent keys', async () => {
        const lx = new Linguini({ missingKeys: MissingKeyPolicy.FALLBACK });
        await lx.load(compiled());
        expect(lx.format('info.doesNotExist', 'en-US')).toBe('info.doesNotExist');

        const strict = new Linguini();
        await strict.load(compiled());
        expect(() => strict.format('info.doesNotExist', 'en-US')).toThrow(/Missing message/);
    });

    it('selects variants with the injected RNG', async () => {
        const first = new Linguini({ random: () => 0 });
        await first.load(compiled());
        expect(first.format('info.randomGreeting', 'en-US', { name: 'Ada' })).toBe('Hi Ada!');

        const last = new Linguini({ random: () => 0.999 });
        await last.load(compiled());
        expect(last.format('info.randomGreeting', 'en-US', { name: 'Ada' })).toBe('Yo Ada!');

        // Without an injected RNG, Math.random is used — result must still be a valid variant.
        const defaulted = new Linguini();
        await defaulted.load(compiled());
        expect(['Hi Ada!', 'Hey Ada!', 'Yo Ada!']).toContain(
            defaulted.format('info.randomGreeting', 'en-US', { name: 'Ada' })
        );
    });

    it('builds structured messages through registered type handlers', async () => {
        const lx = new Linguini({
            types: {
                embed: (value: any, ctx) => ({
                    ...value,
                    color: ctx.com('colors.success'),
                    locale: ctx.locale,
                }),
            },
        });
        await lx.load(compiled());
        const embed = lx.format('info.embed', 'en-US', { name: 'Ada', count: 3 }) as any;
        expect(embed.title).toBe('About TestBot');
        expect(embed.description).toBe('Ada says hello\nSecond line');
        expect(embed.fields).toEqual([{ name: 'Count', value: '3', inline: true }]);
        expect(embed.color).toBe('#00ff00');
        expect(embed.locale).toBe('en-US');
    });

    it('throws for structured messages without a registered handler', async () => {
        const lx = new Linguini();
        await lx.load(compiled());
        expect(() => lx.format('info.embed', 'en-US', { name: 'a', count: 1 })).toThrow(
            /No handler registered/
        );
    });

    it('formats a key across all locales that contain it', async () => {
        const lx = new Linguini();
        await lx.load(compiled());
        expect(lx.formatAll('info.greeting', { name: 'Ada' })).toEqual({
            'en-US': 'Hello, Ada!',
            de: 'Hallo, Ada!',
        });
        // Keys missing from a locale are simply absent — no fallback.
        expect(Object.keys(lx.formatAll('info.noParams'))).toEqual(['en-US']);
    });

    it('rejects artifacts whose schemaHash does not match and keeps serving', async () => {
        const artifact = compiled();
        const rejected: Error[] = [];
        let reloaded = 0;
        const lx = new Linguini({
            schemaHash: artifact.manifest.schemaHash,
            onRejected: error => rejected.push(error),
            onReloaded: () => reloaded++,
        });
        await lx.load(artifact);

        const tampered: Artifact = {
            ...artifact,
            manifest: { ...artifact.manifest, schemaHash: 'sha256:not-the-same' },
        };
        await expect(lx.load(tampered)).rejects.toThrow(/schemaHash/);
        expect(rejected).toHaveLength(1);
        expect(reloaded).toBe(0);
        // Old catalog still serving.
        expect(lx.format('info.greeting', 'en-US', { name: 'Ada' })).toBe('Hello, Ada!');
    });

    it('hot-swaps compatible artifacts on reload', async () => {
        const files = basicCatalog();
        const before = compileCatalog(writeCatalog(files)).artifact!;

        (files['info/info.en-US.json'] as any).data.greeting = 'Greetings, {name}!';
        const after = compileCatalog(writeCatalog(files)).artifact!;
        expect(after.manifest.schemaHash).toBe(before.manifest.schemaHash);

        let reloaded = 0;
        const lx = new Linguini({
            schemaHash: before.manifest.schemaHash,
            onReloaded: () => reloaded++,
        });
        await lx.load(before);
        expect(lx.format('info.greeting', 'en-US', { name: 'Ada' })).toBe('Hello, Ada!');
        await lx.load(after);
        expect(reloaded).toBe(1);
        expect(lx.format('info.greeting', 'en-US', { name: 'Ada' })).toBe('Greetings, Ada!');
    });

    it('requires load() before formatting', () => {
        expect(() => new Linguini().format('x', 'en-US')).toThrow(/No catalog artifact loaded/);
    });

    it('formats list, tag-markup, escaped, and ref-argument messages end to end', async () => {
        const lx = new Linguini();
        await lx.load(compiled());
        expect(lx.format('info.friends', 'en-US', { names: ['Ada', 'Grace'] })).toBe(
            `With ${new Intl.ListFormat('en-US').format(['Ada', 'Grace'])}`
        );
        expect(lx.format('info.mention', 'en-US', { userId: '123' })).toBe(
            'Happy birthday <@123>!'
        );
        expect(lx.format('info.literalBraces', 'en-US')).toBe('Use {name} as a placeholder');
        expect(lx.format('info.signed', 'en-US', { user: 'Ada' })).toBe('Sent for Ada');
        expect(lx.format('info.tagline', 'en-US')).toBe('TestBot — see https://example.com/docs');

        const when = new Date(2026, 7, 4, 15, 30);
        expect(lx.format('info.atTime', 'en-US', { when })).toBe(
            `At ${new Intl.DateTimeFormat('en-US', { timeStyle: 'short' }).format(when)}`
        );
    });

    it('exposes manifest, locales, and common lookups', async () => {
        const lx = new Linguini();
        await lx.load(compiled());
        expect(lx.locales()).toEqual(['de', 'en-US']);
        expect(lx.manifest.baseLocale).toBe('en-US');
        expect(lx.com('links.docs')).toBe('https://example.com/docs');
        expect(() => lx.com('nope.nothing')).toThrow(/Unknown common path/);
    });

    it('bindLocale pre-applies the locale across arbitrarily nested trees', async () => {
        const lx = new Linguini();
        await lx.load(compiled());
        const t = {
            info: {
                greeting: (locale: string, params: { name: string }) =>
                    lx.format('info.greeting', locale, params) as string,
                deep: {
                    noParams: (locale: string) => lx.format('info.noParams', locale) as string,
                },
            },
        };
        const tl = bindLocale(t, 'de');
        expect(tl.info.greeting({ name: 'Ada' })).toBe('Hallo, Ada!');
        expect(tl.info.deep.noParams()).toBe('Just text.');

        // The bound view is a view — the original tree still takes locales.
        expect(t.info.greeting('en-US', { name: 'Ada' })).toBe('Hello, Ada!');
    });

    it('honors custom fallbackLocales', async () => {
        const lx = new Linguini({ fallbackLocales: ['de'] });
        await lx.load(compiled());
        // fr resolves through the custom chain to de, not the base locale.
        expect(lx.format('info.greeting', 'fr', { name: 'Ada' })).toBe('Hallo, Ada!');
    });

    describe('artifact validation', () => {
        it('rejects unsupported format versions', async () => {
            const artifact = compiled();
            const tampered = {
                ...artifact,
                manifest: { ...artifact.manifest, formatVersion: 99 },
            };
            await expect(new Linguini().load(tampered)).rejects.toThrow(/format version/);
        });

        it('rejects manifests listing locales absent from the catalog', async () => {
            const artifact = compiled();
            const tampered = {
                ...artifact,
                manifest: { ...artifact.manifest, locales: [...artifact.manifest.locales, 'fr'] },
            };
            await expect(new Linguini().load(tampered)).rejects.toThrow(/"fr" listed in manifest/);
        });

        it('rejects manifests whose base locale is not in the locale list', async () => {
            const artifact = compiled();
            const tampered = {
                ...artifact,
                manifest: { ...artifact.manifest, baseLocale: 'fr' },
            };
            await expect(new Linguini().load(tampered)).rejects.toThrow(/Base locale "fr"/);
        });
    });
});
