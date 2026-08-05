import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateBindings } from '../src/compiler/bindings.js';
import { compileCatalog } from '../src/compiler/compile.js';
import { Linguini } from '../src/runtime/linguini.js';
import { basicCatalog, writeCatalog } from './helpers.js';

/**
 * The contract test: generated bindings must (a) typecheck under strict tsc, including
 * rejecting wrong keys/params via @ts-expect-error probes, and (b) execute correctly against
 * the runtime. This is the guarantee the whole codegen design rests on.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const genDir = path.join(repoRoot, 'tests', '.generated');

const EMBED_TYPES = `export type LangEmbed = {
    title: string;
    description: string;
    fields: { name: string; value: string; inline: boolean }[];
};
`;

// Every @ts-expect-error line asserts a rejection: if the call were accepted, tsc would fail
// with "Unused '@ts-expect-error' directive".
const CONSUMER = `import { bindLocale, Linguini } from '../../src/index.js';
import { createMessages } from './messages.js';

export function use(lx: Linguini): string {
    const t = createMessages(lx);
    const greeting: string = t.info.greeting('en-US', { name: 'Ada' });

    const tl = bindLocale(t, 'en-US');
    const bound: string = tl.info.greeting({ name: 'Ada' });
    tl.info.noParams();
    const boundEmbed = tl.info.embed({ name: 'Ada', count: 1 });
    const boundTitle: string = boundEmbed.title;
    void bound;
    void boundTitle;
    // @ts-expect-error locale is already bound
    tl.info.greeting('en-US', { name: 'Ada' });
    // @ts-expect-error params are still typed on the bound view
    tl.info.birthdayCount({ count: 'three' });
    t.info.birthdayCount('en-US', { count: 3 });
    t.info.gender('en-US', { subject: 'female' });
    t.info.noParams('en-US');
    t.info.friends('en-US', { names: ['a', 'b'] });
    t.info.nextBirthday('en-US', { when: new Date(0) });
    const embed = t.info.embed('en-US', { name: 'Ada', count: 1 });
    const title: string = embed.title;

    // @ts-expect-error unknown key
    t.info.doesNotExist;
    // @ts-expect-error count must be a number
    t.info.birthdayCount('en-US', { count: 'three' });
    // @ts-expect-error required params are missing
    t.info.greeting('en-US');
    // @ts-expect-error not a valid select branch
    t.info.gender('en-US', { subject: 'robot' });
    // @ts-expect-error list params take arrays
    t.info.friends('en-US', { names: 'a, b' });

    return greeting + title;
}
`;

function generate(): { artifact: NonNullable<ReturnType<typeof compileCatalog>['artifact']> } {
    const result = compileCatalog(writeCatalog(basicCatalog()));
    expect(result.diagnostics.errors).toEqual([]);
    const bindings = generateBindings(result.schema!, result.artifact!.manifest.schemaHash, {
        out: '',
        runtimeImport: '../../src/index.js',
        types: { embed: './embed-types.js#LangEmbed' },
    });
    mkdirSync(genDir, { recursive: true });
    writeFileSync(path.join(genDir, 'messages.ts'), bindings);
    writeFileSync(path.join(genDir, 'embed-types.ts'), EMBED_TYPES);
    writeFileSync(path.join(genDir, 'consumer.ts'), CONSUMER);
    return { artifact: result.artifact! };
}

describe('bindings contract', () => {
    it('generated bindings and a typed consumer pass strict tsc, including rejection probes', () => {
        generate();
        const tscPath = path.join(repoRoot, 'node_modules', 'typescript', 'lib', 'tsc.js');
        try {
            execFileSync(
                process.execPath,
                [
                    tscPath,
                    '--noEmit',
                    '--strict',
                    '--target',
                    'es2022',
                    '--module',
                    'nodenext',
                    '--moduleResolution',
                    'nodenext',
                    '--skipLibCheck',
                    path.join(genDir, 'consumer.ts'),
                ],
                { cwd: repoRoot, encoding: 'utf8' }
            );
        } catch (error: any) {
            throw new Error(`tsc failed:\n${error?.stdout ?? error?.message}`);
        }
    }, 60_000);

    it('generated bindings execute correctly against the runtime', async () => {
        const { artifact } = generate();
        const lx = new Linguini({
            schemaHash: artifact.manifest.schemaHash,
            types: { embed: value => value },
        });
        await lx.load(artifact);

        const mod = await import(pathToFileURL(path.join(genDir, 'messages.ts')).href);
        expect(mod.schemaHash).toBe(artifact.manifest.schemaHash);

        const t = mod.createMessages(lx);
        expect(t.info.greeting('en-US', { name: 'Ada' })).toBe('Hello, Ada!');
        expect(t.info.birthdayCount('de', { count: 1 })).toBe('1 Geburtstag');
        expect(t.info.noParams('en-US')).toBe('Just text.');
        const embed = t.info.embed('en-US', { name: 'Ada', count: 2 });
        expect(embed.title).toBe('About TestBot');
        expect(embed.fields[0].value).toBe('2');

        const { bindLocale } = await import('../src/index.js');
        const tl = bindLocale(t, 'de') as any;
        expect(tl.info.greeting({ name: 'Ada' })).toBe('Hallo, Ada!');
        expect(tl.info.birthdayCount({ count: 3 })).toBe('3 Geburtstage');
        // Missing keys in de fall back through the chain, same as the unbound tree.
        expect(tl.info.noParams()).toBe('Just text.');
    });
});
