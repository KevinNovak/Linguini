import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Artifact } from '../src/artifact.js';
import { generateTargetBindings } from '../src/compiler/bindings.js';
import { compileCatalog } from '../src/compiler/compile.js';
import { discoverTargetKeys } from '../src/compiler/discovery.js';
import { Linguini } from '../src/runtime/linguini.js';
import { basicCatalog, writeCatalog } from './helpers.js';

function compiled(files = basicCatalog()): { artifact: Artifact; keys: string[] } {
    const result = compileCatalog(writeCatalog(files));
    return { artifact: result.artifact!, keys: Object.keys(result.schema!) };
}

describe('per-key schema hashes (manifest)', () => {
    it('emits a hash per key, stable across content-only changes', () => {
        const first = compiled();
        expect(Object.keys(first.artifact.manifest.keySchemaHashes).sort()).toEqual(
            [...first.keys].sort()
        );

        const files = basicCatalog();
        (files['info/info.en-US.json'] as any).data.greeting = 'Greetings, {name}!';
        const reworded = compiled(files);
        expect(reworded.artifact.manifest.keySchemaHashes).toEqual(
            first.artifact.manifest.keySchemaHashes
        );

        (files['info/info.en-US.json'] as any).data.greeting = 'Hello {name}, you are {age}!';
        const changed = compiled(files);
        expect(changed.artifact.manifest.keySchemaHashes['info.greeting']).not.toBe(
            first.artifact.manifest.keySchemaHashes['info.greeting']
        );
        // Other keys' hashes are untouched by one key's schema change.
        expect(changed.artifact.manifest.keySchemaHashes['info.noParams']).toBe(
            first.artifact.manifest.keySchemaHashes['info.noParams']
        );
    });
});

describe('discoverTargetKeys', () => {
    function sourceDir(contents: string): string {
        const dir = writeCatalog({});
        mkdirSync(path.join(dir, 'consumer'), { recursive: true });
        writeFileSync(path.join(dir, 'consumer', 'a.ts'), contents);
        return dir;
    }

    it('finds boundary-checked accessor chains and unions explicit keys', () => {
        const { keys } = compiled();
        const dir = sourceDir(
            `const x = t.info.greeting(locale, { name });\n` +
                `const y = tl.info.noParams();\n` +
                `const z = nott.info.gender; // not the tree ident\n`
        );
        const found = discoverTargetKeys(
            { name: 'x', out: 'x.ts', scan: ['consumer/**/*.ts'], keys: ['info.friends'] },
            keys,
            dir
        );
        expect(found).toEqual(['info.friends', 'info.greeting', 'info.noParams']);
    });

    it('never matches a key inside a longer key chain', () => {
        const { keys } = compiled();
        const dir = sourceDir(`t.info.greetingLonger(locale);\n`);
        const found = discoverTargetKeys(
            { name: 'x', out: 'x.ts', scan: ['consumer/**/*.ts'] },
            keys,
            dir
        );
        expect(found).not.toContain('info.greeting');
    });

    it('expands ns.** families and rejects unknown keys and empty scan paths', () => {
        const { keys } = compiled();
        const dir = sourceDir('');
        expect(
            discoverTargetKeys({ name: 'x', out: 'x.ts', keys: ['info.**'] }, keys, dir)
        ).toEqual([...keys].sort());
        expect(() =>
            discoverTargetKeys({ name: 'x', out: 'x.ts', keys: ['info.nope'] }, keys, dir)
        ).toThrow(/does not exist/);
        expect(() =>
            discoverTargetKeys(
                { name: 'x', out: 'x.ts', scan: ['missing-dir/**/*.ts'] },
                keys,
                dir
            )
        ).toThrow(/not found/);
    });
});

describe('generateTargetBindings', () => {
    it('emits only the subset tree plus schemaSubset and subsetHash', () => {
        const files = basicCatalog();
        const result = compileCatalog(writeCatalog(files));
        const module = generateTargetBindings(
            result.schema!,
            result.artifact!.manifest.keySchemaHashes,
            { name: 'mini', out: 'mini.ts' },
            ['info.greeting', 'info.noParams']
        );
        expect(module).toContain("'info.greeting':");
        expect(module).toContain('export const subsetHash =');
        expect(module).toContain("lx.format('info.greeting'");
        expect(module).not.toContain('info.gender');
        expect(() =>
            generateTargetBindings(
                result.schema!,
                result.artifact!.manifest.keySchemaHashes,
                { name: 'mini', out: 'mini.ts' },
                []
            )
        ).toThrow(/zero keys/);
    });
});

describe('runtime subset validation', () => {
    const subsetOf = (artifact: Artifact, keys: string[]): { [key: string]: string } =>
        Object.fromEntries(keys.map(k => [k, artifact.manifest.keySchemaHashes[k]!]));

    it('accepts artifacts whose non-subset keys changed shape', async () => {
        const { artifact } = compiled();
        const lx = new Linguini();
        lx.registerSchemaSubset(subsetOf(artifact, ['info.noParams']));
        await lx.load(artifact);

        // New artifact: info.greeting gains a param (schema change OUTSIDE the subset).
        const files = basicCatalog();
        (files['info/info.en-US.json'] as any).data.greeting = 'Hello {name} ({age})!';
        const changed = compiled(files).artifact;
        await expect(lx.load(changed)).resolves.toBeUndefined();
        expect(lx.format('info.noParams', 'en-US')).toBeTruthy();
    });

    it('rejects artifacts that changed a subset key, keeping the old catalog serving', async () => {
        const { artifact } = compiled();
        const rejected: Error[] = [];
        const lx = new Linguini({ onRejected: e => rejected.push(e) });
        lx.registerSchemaSubset(subsetOf(artifact, ['info.greeting']));
        await lx.load(artifact);

        const files = basicCatalog();
        (files['info/info.en-US.json'] as any).data.greeting = 'Hello {name} ({age})!';
        const changed = compiled(files).artifact;
        await expect(lx.load(changed)).rejects.toThrow(/does not match the registered/);
        expect(rejected).toHaveLength(1);
        expect(lx.format('info.greeting', 'en-US', { name: 'Ada' })).toBe('Hello, Ada!');
    });

    it('rejects artifacts missing a subset key entirely', async () => {
        const { artifact } = compiled();
        const lx = new Linguini();
        lx.registerSchemaSubset(subsetOf(artifact, ['info.greeting']));
        const tampered: Artifact = {
            ...artifact,
            manifest: {
                ...artifact.manifest,
                keySchemaHashes: { ...artifact.manifest.keySchemaHashes },
            },
        };
        delete tampered.manifest.keySchemaHashes['info.greeting'];
        await expect(lx.load(tampered)).rejects.toThrow(/missing key "info.greeting"/);
    });

    it('validates immediately when registering against a loaded artifact', async () => {
        const { artifact } = compiled();
        const lx = new Linguini();
        await lx.load(artifact);
        expect(() =>
            lx.registerSchemaSubset({ 'info.greeting': 'sha256:not-the-real-hash' })
        ).toThrow(/does not match/);
        expect(() =>
            lx.registerSchemaSubset(subsetOf(artifact, ['info.friends']))
        ).not.toThrow();
    });

    it('rejects conflicting registrations and pre-subset artifacts', async () => {
        const { artifact } = compiled();
        const lx = new Linguini();
        lx.registerSchemaSubset(subsetOf(artifact, ['info.greeting']));
        expect(() =>
            lx.registerSchemaSubset({ 'info.greeting': 'sha256:different' })
        ).toThrow(/Conflicting schema subsets/);

        const legacy: Artifact = { ...artifact, manifest: { ...artifact.manifest } };
        delete (legacy.manifest as Partial<typeof legacy.manifest>).keySchemaHashes;
        await expect(lx.load(legacy)).rejects.toThrow(/no keySchemaHashes/);
    });
});
