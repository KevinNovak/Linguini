import { describe, expect, it } from 'vitest';
import { generateBindings } from '../src/compiler/bindings.js';
import { compileCatalog } from '../src/compiler/compile.js';
import { hashSchema } from '../src/compiler/schema.js';
import { basicCatalog, writeCatalog } from './helpers.js';

describe('generateBindings', () => {
    const result = compileCatalog(writeCatalog(basicCatalog()));
    const schema = result.schema!;
    const schemaHash = result.artifact!.manifest.schemaHash;

    it('emits the schemaHash and runtime import', () => {
        const output = generateBindings(schema, schemaHash);
        expect(output).toContain(`export const schemaHash = '${schemaHash}';`);
        expect(output).toContain(`import type { Linguini } from 'linguini';`);
        expect(schemaHash).toBe(hashSchema(schema));
    });

    it('types parameters per the inference table', () => {
        const output = generateBindings(schema, schemaHash);
        expect(output).toContain(
            `greeting: (locale: string, params: { name: string | number }) => lx.format('info.greeting', locale, params) as string,`
        );
        expect(output).toContain('params: { count: number }');
        expect(output).toContain(`params: { subject: 'female' | 'male' | 'other' }`);
        expect(output).toContain('params: { names: readonly string[] }');
        expect(output).toContain('params: { when: Date | number }');
        expect(output).toContain(
            `noParams: (locale: string) => lx.format('info.noParams', locale) as string,`
        );
    });

    it('maps structured message types via config and imports them', () => {
        const output = generateBindings(schema, schemaHash, {
            out: '',
            types: { embed: './embed-types.js#LangEmbed' },
        });
        expect(output).toContain(`import type { LangEmbed } from './embed-types.js';`);
        expect(output).toContain('as LangEmbed,');
    });

    it('falls back to unknown for unmapped structured types', () => {
        const output = generateBindings(schema, schemaHash);
        expect(output).toContain('as unknown,');
    });

    it('quotes non-identifier keys', () => {
        const files = {
            'linguini.config.json': { baseLocale: 'en-US' },
            'info/info.en-US.json': { data: { 'weird-key': 'value' } },
        };
        const weird = compileCatalog(writeCatalog(files));
        const output = generateBindings(weird.schema!, weird.artifact!.manifest.schemaHash);
        expect(output).toContain(`'weird-key': (locale: string)`);
    });

    it('accepts type mappings without a module specifier as bare type names', () => {
        const output = generateBindings(schema, schemaHash, {
            out: '',
            types: { embed: 'GlobalEmbed' },
        });
        expect(output).toContain('as GlobalEmbed,');
    });

    it('uses a custom runtime import specifier', () => {
        const output = generateBindings(schema, schemaHash, {
            out: '',
            runtimeImport: '@my/linguini',
        });
        expect(output).toContain(`import type { Linguini } from '@my/linguini';`);
    });
});
