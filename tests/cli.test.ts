import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli/run.js';
import { Linguini } from '../src/runtime/linguini.js';
import { basicCatalog, writeCatalog } from './helpers.js';

function catalogWithBindings(): string {
    const files = basicCatalog();
    (files['linguini.config.json'] as any) = {
        baseLocale: 'en-US',
        out: 'dist',
        bindings: { out: 'generated/messages.ts' },
    };
    return writeCatalog(files);
}

async function run(argv: string[]): Promise<{ code: number; output: string }> {
    const lines: string[] = [];
    const code = await runCli(argv, line => lines.push(line));
    return { code, output: lines.join('\n') };
}

describe('CLI', () => {
    it('compile writes a loadable artifact and bindings', async () => {
        const dir = catalogWithBindings();
        const { code, output } = await run(['compile', dir]);
        expect(code).toBe(0);
        expect(output).toContain('schemaHash sha256:');

        const outDir = path.join(dir, 'dist');
        expect(existsSync(path.join(outDir, 'manifest.json'))).toBe(true);
        expect(existsSync(path.join(outDir, 'catalog.json'))).toBe(true);
        expect(existsSync(path.join(outDir, 'common.json'))).toBe(true);

        // The written artifact round-trips through the runtime's directory loader.
        const lx = new Linguini();
        await lx.load(outDir);
        expect(lx.format('info.greeting', 'en-US', { name: 'Ada' })).toBe('Hello, Ada!');

        const bindings = readFileSync(path.join(dir, 'generated', 'messages.ts'), 'utf8');
        expect(bindings).toContain('export function createMessages');
    });

    it('compile --artifact-only writes the artifact and skips bindings', async () => {
        // A target whose scan path does not exist (e.g. a pruned Docker workspace) makes a
        // full compile throw — --artifact-only must not touch bindings at all.
        const files = basicCatalog();
        (files['linguini.config.json'] as any) = {
            baseLocale: 'en-US',
            out: 'dist',
            bindings: {
                out: 'generated/messages.ts',
                targets: [
                    {
                        name: 'missing-consumer',
                        out: 'generated/missing.ts',
                        scan: ['no-such-dir/**/*.ts'],
                    },
                ],
            },
        };
        const dir = writeCatalog(files);

        await expect(run(['compile', dir])).rejects.toThrow('scan path not found');

        const { code, output } = await run(['compile', dir, '--artifact-only']);
        expect(code).toBe(0);
        expect(output).toContain('Artifact written');
        expect(output).not.toContain('Bindings written');
        expect(existsSync(path.join(dir, 'dist', 'manifest.json'))).toBe(true);
        expect(existsSync(path.join(dir, 'generated'))).toBe(false);
    });

    it('check verifies bindings schemaHash', async () => {
        const dir = catalogWithBindings();
        await run(['compile', dir]);
        const bindingsPath = path.join(dir, 'generated', 'messages.ts');

        const ok = await run(['check', dir, '--bindings', bindingsPath]);
        expect(ok.code).toBe(0);
        expect(ok.output).toContain('Catalog OK');

        // Stale bindings (different schemaHash) fail the check.
        const contents = readFileSync(bindingsPath, 'utf8');
        writeFileSync(
            bindingsPath,
            contents.replace(/schemaHash = '[^']+'/, "schemaHash = 'sha256:stale'")
        );
        const stale = await run(['check', dir, '--bindings', bindingsPath]);
        expect(stale.code).toBe(1);
        expect(stale.output).toContain('SCHEMA_HASH');
    });

    it('check fails on catalogs with errors', async () => {
        const dir = writeCatalog({
            'linguini.config.json': { baseLocale: 'en-US' },
            'info/info.en-US.json': { data: { bad: '{n, plural, one {x}}' } },
        });
        const { code, output } = await run(['check', dir]);
        expect(code).toBe(1);
        expect(output).toContain('ICU_PARSE');
    });

    it('prints usage without a command', async () => {
        const { code, output } = await run([]);
        expect(code).toBe(1);
        expect(output).toContain('Usage:');
    });

    it('compile fails on catalogs with errors', async () => {
        const dir = writeCatalog({
            'linguini.config.json': { baseLocale: 'en-US' },
            'info/info.en-US.json': { data: { bad: '{n, plural, one {x}}' } },
        });
        const { code } = await run(['compile', dir]);
        expect(code).toBe(1);
    });

    it('rejects unknown commands', async () => {
        const { code, output } = await run(['frobnicate']);
        expect(code).toBe(1);
        expect(output).toContain('Unknown command: frobnicate');
    });

    it('check fails when the bindings file has no schemaHash', async () => {
        const dir = catalogWithBindings();
        const bogus = path.join(dir, 'bogus.ts');
        writeFileSync(bogus, 'export const nothing = true;\n');
        const { code, output } = await run(['check', dir, '--bindings', bogus]);
        expect(code).toBe(1);
        expect(output).toContain('No schemaHash found');
    });

    it('check fails when the bindings file cannot be read', async () => {
        const dir = catalogWithBindings();
        const { code, output } = await run([
            'check',
            dir,
            '--bindings',
            path.join(dir, 'does-not-exist.ts'),
        ]);
        expect(code).toBe(1);
        expect(output).toContain('Cannot read bindings file');
    });
});
