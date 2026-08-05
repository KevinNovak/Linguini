import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LintLevel, loadConfig, resolveConfig } from '../src/compiler/config.js';
import { writeCatalog } from './helpers.js';

describe('config', () => {
    it('applies defaults', () => {
        const config = resolveConfig({ baseLocale: 'en-US' });
        expect(config).toEqual({
            baseLocale: 'en-US',
            namespaces: 'auto',
            out: 'dist',
            bindings: undefined,
            lint: {
                midSentenceRef: LintLevel.WARN,
                argCase: LintLevel.WARN,
                emptyMessage: LintLevel.WARN,
            },
            missingKeys: LintLevel.WARN,
        });
    });

    it('requires baseLocale', () => {
        expect(() => resolveConfig({})).toThrow(/baseLocale/);
        expect(() => resolveConfig({ baseLocale: '' })).toThrow(/baseLocale/);
    });

    it('rejects invalid lint levels', () => {
        expect(() => resolveConfig({ baseLocale: 'en-US', lint: { argCase: 'loud' } })).toThrow(
            /lint\.argCase/
        );
    });

    it('rejects invalid missingKeys values', () => {
        expect(() => resolveConfig({ baseLocale: 'en-US', missingKeys: 'off' })).toThrow(
            /missingKeys/
        );
    });

    it('loadConfig throws when the config file is absent', () => {
        const dir = writeCatalog({ 'placeholder.txt': 'x' });
        expect(() => loadConfig(dir)).toThrow(/No linguini\.config\.json/);
    });

    it('loadConfig distinguishes unreadable configs from absent ones', () => {
        const dir = writeCatalog({ 'placeholder.txt': 'x' });
        // A directory named like the config file fails to read with a non-ENOENT error.
        mkdirSync(path.join(dir, 'linguini.config.json'));
        expect(() => loadConfig(dir)).toThrow(/Failed to read/);
    });
});
