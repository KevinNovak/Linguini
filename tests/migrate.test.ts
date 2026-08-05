import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { camelize, migrateCatalog } from '../src/migrate/migrate.js';
import { Linguini } from '../src/runtime/linguini.js';
import { writeCatalog } from './helpers.js';

/** A representative v1 catalog (v1 file format: {data, refs}, {{VARS}}, *.common.json). */
function v1Catalog(): { [relativePath: string]: unknown } {
    return {
        'lang.common.json': {
            links: { docs: 'https://example.com/docs' },
            bot: { name: 'TestBot ({{COM:links.docs}})' },
        },
        'logs.json': { started: 'Started up' },
        'info/info.en-US.json': {
            data: {
                greeting: 'Hi {{USER_NAME}}!',
                braces: 'Use {curly} braces',
                multiline: ['Line one', 'Docs: {{COM:links.docs}}'],
                footer: '{{REF:footers.default}}',
                gift: 'You got a gift',
                giftPlural: 'You got gifts',
                nested: { deep: { msg: 'Age: {{AGE}}' } },
                bad: 42,
                help: {
                    title: 'About {{COM:bot.name}}',
                    description: ['{{USER_NAME}} says hello', 'Second line'],
                    fields: [{ name: 'N', value: 'V', inline: true }],
                },
            },
            refs: {
                footers: { default: 'Footer — {{COM:links.docs}} ({{YEAR}})' },
            },
        },
        'info/info.de.json': {
            data: {
                greeting: 'Hallo {{USER_NAME}}!',
                // Uses a ref only defined in the base locale file.
                footer: '{{REF:footers.default}}',
            },
        },
    };
}

async function migrated() {
    const input = writeCatalog(v1Catalog());
    const out = mkdtempSync(path.join(tmpdir(), 'linguini-migrated-'));
    const report = await migrateCatalog(input, { out, objectType: 'embed' });
    return { out, report };
}

describe('camelize', () => {
    it('converts v1 variable names to camelCase', () => {
        expect(camelize('AGE')).toBe('age');
        expect(camelize('USER_NAME')).toBe('userName');
        expect(camelize('ERROR_CODE_2')).toBe('errorCode2');
        expect(camelize('Server')).toBe('server');
        expect(camelize('alreadyCamel')).toBe('alreadyCamel');
    });
});

describe('migrateCatalog', () => {
    it('produces a v2 catalog that compiles cleanly and passes the render-diff', async () => {
        const { report } = await migrated();
        expect(report.compile.errors).toBe(0);
        expect(report.verify.mismatches).toEqual([]);
        expect(report.verify.checked).toBeGreaterThanOrEqual(9);
        expect(report.namespaces).toEqual(['info']);
        expect(report.locales).toEqual(['de', 'en-US']);
    });

    it('converts variables to camelCase ICU arguments and reports the renames', async () => {
        const { out, report } = await migrated();
        const info = JSON.parse(readFileSync(path.join(out, 'info', 'info.en-US.json'), 'utf8'));
        expect(info.data.greeting).toBe('Hi {userName}!');
        expect(info.data.nested.deep.msg).toBe('Age: {age}');
        expect(info.refs.footers.default).toBe('Footer — {{COM:links.docs}} ({year})');
        expect(report.variableRenames).toEqual([
            { from: 'AGE', to: 'age' },
            { from: 'USER_NAME', to: 'userName' },
            { from: 'YEAR', to: 'year' },
        ]);
    });

    it('escapes literal braces for ICU and reports the affected keys', async () => {
        const { out, report } = await migrated();
        const info = JSON.parse(readFileSync(path.join(out, 'info', 'info.en-US.json'), 'utf8'));
        expect(info.data.braces).toBe("Use '{'curly'}' braces");
        expect(report.escapedValues).toContain('info.braces');
    });

    it('tags embed-shaped objects with $type and reports them', async () => {
        const { out, report } = await migrated();
        const info = JSON.parse(readFileSync(path.join(out, 'info', 'info.en-US.json'), 'utf8'));
        expect(info.data.help.$type).toBe('embed');
        expect(info.data.help.title).toBe('About {{COM:bot.name}}');
        expect(report.taggedObjects).toEqual(['info.help']);
    });

    it('flags suspected plural pairs, unconvertible values, and skipped files', async () => {
        const { report } = await migrated();
        expect(report.suspectedPluralPairs).toEqual([
            { key: 'info.gift', pluralKey: 'info.giftPlural' },
        ]);
        expect(report.unconvertible).toEqual([
            { key: 'info.bad', reason: 'Unsupported v1 value of type number' },
        ]);
        expect(report.skippedFiles).toEqual(['logs.json']);
    });

    it('hoists refs duplicated across namespaces into shared refs.<locale>.json', async () => {
        const input = writeCatalog({
            'lang.common.json': { links: { docs: 'https://example.com/docs' } },
            'info/info.en-US.json': {
                data: { a: '{{REF:footers.default}}' },
                refs: {
                    footers: { default: 'Footer — {{COM:links.docs}}' },
                    local: { only: 'Info only' },
                },
            },
            'prompts/prompts.en-US.json': {
                data: { b: '{{REF:footers.default}}', c: '{{REF:conflicted.x}}' },
                refs: {
                    footers: { default: 'Footer — {{COM:links.docs}}' },
                    conflicted: { x: 'Prompt flavor' },
                },
            },
            'errors/errors.en-US.json': {
                data: { d: '{{REF:conflicted.x}}' },
                refs: { conflicted: { x: 'Error flavor' } },
            },
        });
        const out = mkdtempSync(path.join(tmpdir(), 'linguini-hoist-'));
        const report = await migrateCatalog(input, { out });

        expect(report.compile.errors).toBe(0);
        expect(report.verify.mismatches).toEqual([]);
        expect(report.hoistedRefs).toEqual([
            { path: 'footers.default', locale: 'en-US', namespaces: ['info', 'prompts'] },
        ]);
        expect(report.refConflicts).toEqual([
            {
                path: 'conflicted.x',
                locale: 'en-US',
                values: { prompts: 'Prompt flavor', errors: 'Error flavor' },
            },
        ]);

        const shared = JSON.parse(readFileSync(path.join(out, 'refs.en-US.json'), 'utf8'));
        expect(shared).toEqual({ footers: { default: 'Footer — {{COM:links.docs}}' } });
        // Hoisted from both namespaces; unrelated and conflicting refs stay local.
        const info = JSON.parse(readFileSync(path.join(out, 'info', 'info.en-US.json'), 'utf8'));
        expect(info.refs).toEqual({ local: { only: 'Info only' } });
        const prompts = JSON.parse(
            readFileSync(path.join(out, 'prompts', 'prompts.en-US.json'), 'utf8')
        );
        expect(prompts.refs).toEqual({ conflicted: { x: 'Prompt flavor' } });
    });

    it('skips hoisting when disabled', async () => {
        const input = writeCatalog({
            'info/info.en-US.json': {
                data: { a: '{{REF:f.x}}' },
                refs: { f: { x: 'Same' } },
            },
            'errors/errors.en-US.json': {
                data: { b: '{{REF:f.x}}' },
                refs: { f: { x: 'Same' } },
            },
        });
        const out = mkdtempSync(path.join(tmpdir(), 'linguini-nohoist-'));
        const report = await migrateCatalog(input, { out, hoistSharedRefs: false });
        expect(report.hoistedRefs).toEqual([]);
        expect(existsSync(path.join(out, 'refs.en-US.json'))).toBe(false);
        expect(report.compile.errors).toBe(0);
        expect(report.verify.mismatches).toEqual([]);
    });

    it('writes a common.json and config, and the output loads in the runtime', async () => {
        const { out } = await migrated();
        expect(existsSync(path.join(out, 'common.json'))).toBe(true);
        const config = JSON.parse(readFileSync(path.join(out, 'linguini.config.json'), 'utf8'));
        expect(config.baseLocale).toBe('en-US');

        // Full round trip: compile the migrated catalog and format real messages.
        const { compileCatalog } = await import('../src/compiler/compile.js');
        const artifact = compileCatalog(out).artifact!;
        const lx = new Linguini({ types: { embed: value => value } });
        await lx.load(artifact);
        expect(lx.format('info.greeting', 'en-US', { userName: 'Ada' })).toBe('Hi Ada!');
        expect(lx.format('info.greeting', 'de', { userName: 'Ada' })).toBe('Hallo Ada!');
        expect(lx.format('info.braces', 'en-US')).toBe('Use {curly} braces');
        expect(lx.format('info.footer', 'de', { year: '2026' })).toBe(
            'Footer — https://example.com/docs (2026)'
        );
        const embed = lx.format('info.help', 'en-US', { userName: 'Ada' }) as any;
        expect(embed.title).toBe('About TestBot (https://example.com/docs)');
        expect(embed.description).toBe('Ada says hello\nSecond line');
    });
});
