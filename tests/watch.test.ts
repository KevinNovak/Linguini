import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { WatchHandle } from '../src/cli/run.js';
import { startWatch } from '../src/cli/run.js';
import { basicCatalog, writeCatalog } from './helpers.js';

async function until(condition: () => boolean, timeoutMs = 8000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
        if (Date.now() > deadline) {
            throw new Error('Timed out waiting for condition');
        }
        await new Promise(resolve => setTimeout(resolve, 50));
    }
}

describe('linguini watch', () => {
    let handle: WatchHandle | undefined;

    afterEach(() => {
        handle?.close();
        handle = undefined;
    });

    it('recompiles on changes without reacting to its own output', async () => {
        const files = basicCatalog();
        (files['linguini.config.json'] as any) = {
            baseLocale: 'en-US',
            out: 'dist',
            bindings: { out: 'generated/messages.ts' },
        };
        const dir = writeCatalog(files);

        const logs: string[] = [];
        const compiles = (): number => logs.filter(l => l.startsWith('Artifact written')).length;
        handle = startWatch(dir, line => logs.push(line));

        // Initial compile happens synchronously on start.
        expect(compiles()).toBe(1);
        expect(logs.some(l => l === 'Watching for changes…')).toBe(true);

        // Edit an authoring file → exactly one debounced recompile.
        const infoPath = path.join(dir, 'info', 'info.en-US.json');
        const info = JSON.parse(readFileSync(infoPath, 'utf8'));
        info.data.greeting = 'Greetings, {name}!';
        writeFileSync(infoPath, JSON.stringify(info, null, 2));
        await until(() => compiles() >= 2);

        // The new content reached the artifact.
        const catalog = JSON.parse(readFileSync(path.join(dir, 'dist', 'catalog.json'), 'utf8'));
        const greeting = catalog['en-US']['info.greeting'];
        expect(JSON.stringify(greeting)).toContain('Greetings,');

        // The recompile wrote into dist/ and generated/ inside the watched tree; if the
        // watcher reacted to its own output it would keep recompiling. Give the debounce
        // window time to fire and verify the count is stable.
        const settled = compiles();
        await new Promise(resolve => setTimeout(resolve, 700));
        expect(compiles()).toBe(settled);
    }, 15_000);

    it('keeps watching after a broken edit and recovers on the fix', async () => {
        const dir = writeCatalog({
            'linguini.config.json': { baseLocale: 'en-US' },
            'info/info.en-US.json': { data: { x: 'Hello' } },
        });
        const logs: string[] = [];
        handle = startWatch(dir, line => logs.push(line));

        const infoPath = path.join(dir, 'info', 'info.en-US.json');
        writeFileSync(infoPath, '{broken json');
        await until(() => logs.some(l => l.includes('READ_FILE')));
        expect(logs.some(l => l.startsWith('Compile failed'))).toBe(true);

        writeFileSync(infoPath, JSON.stringify({ data: { x: 'Fixed' } }));
        await until(() => logs.filter(l => l.startsWith('Artifact written')).length >= 2);
    }, 15_000);

    it('starts (and reports the failure) even when the config is unreadable', () => {
        const dir = writeCatalog({ 'info/info.en-US.json': { data: { x: 'Hi' } } });
        const logs: string[] = [];
        handle = startWatch(dir, line => logs.push(line));
        expect(logs.some(l => l.includes('CONFIG'))).toBe(true);
        expect(logs.some(l => l.startsWith('Compile failed'))).toBe(true);
    });
});
