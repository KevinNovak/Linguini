import { describe, expect, it } from 'vitest';
import { MessageForm, MessageNodeKind, ParamKind } from '../src/artifact.js';
import { compileCatalog } from '../src/compiler/compile.js';
import { DiagnosticCode, Diagnostics, formatDiagnostic } from '../src/compiler/diagnostics.js';
import { basicCatalog, writeCatalog } from './helpers.js';

function codes(result: ReturnType<typeof compileCatalog>): DiagnosticCode[] {
    return result.diagnostics.items.map(d => d.code);
}

describe('compileCatalog', () => {
    it('compiles the basic catalog without errors', () => {
        const result = compileCatalog(writeCatalog(basicCatalog()));
        expect(result.diagnostics.errors).toEqual([]);
        expect(result.artifact).toBeDefined();
        expect(result.artifact!.manifest.locales).toEqual(['de', 'en-US']);
        expect(result.artifact!.manifest.namespaces).toEqual(['info']);
        // de is missing most keys → warnings, not errors.
        expect(codes(result)).toContain(DiagnosticCode.MISSING_KEY);
    });

    it('infers the schema from the base locale', () => {
        const result = compileCatalog(writeCatalog(basicCatalog()));
        const schema = result.schema!;
        expect(schema['info.greeting']).toEqual({ params: { name: { type: ParamKind.STRING } } });
        expect(schema['info.birthdayCount']).toEqual({
            params: { count: { type: ParamKind.NUMBER } },
        });
        expect(schema['info.gender']!.params['subject']).toEqual({
            type: ParamKind.SELECT,
            branches: ['female', 'male', 'other'],
        });
        expect(schema['info.friends']).toEqual({ params: { names: { type: ParamKind.LIST } } });
        expect(schema['info.nextBirthday']).toEqual({
            params: { when: { type: ParamKind.DATETIME } },
        });
        expect(schema['info.noParams']).toEqual({ params: {} });
        expect(schema['info.embed']).toEqual({
            params: { name: { type: ParamKind.STRING }, count: { type: ParamKind.NUMBER } },
            typeName: 'embed',
        });
    });

    it('expands refs and coms at compile time', () => {
        const result = compileCatalog(writeCatalog(basicCatalog()));
        const footer = result.artifact!.catalog['en-US']!['info.footerNote']!;
        expect(footer).toEqual({
            form: MessageForm.MESSAGE,
            nodes: [{ kind: MessageNodeKind.TEXT, value: 'Footer — https://example.com/docs' }],
        });
        expect(result.artifact!.common['links.docs']).toBe('https://example.com/docs');
    });

    it('produces a stable schemaHash across content-only changes', () => {
        const files = basicCatalog();
        const first = compileCatalog(writeCatalog(files));

        // Reword a message without touching its parameters → same schema.
        (files['info/info.en-US.json'] as any).data.greeting = 'Greetings, {name}!';
        const reworded = compileCatalog(writeCatalog(files));
        expect(reworded.artifact!.manifest.schemaHash).toBe(first.artifact!.manifest.schemaHash);

        // Add a parameter → different schema.
        (files['info/info.en-US.json'] as any).data.greeting = 'Hello {name}, you are {age}!';
        const changed = compileCatalog(writeCatalog(files));
        expect(changed.artifact!.manifest.schemaHash).not.toBe(first.artifact!.manifest.schemaHash);
    });

    it('errors on keys present only outside the base locale', () => {
        const files = basicCatalog();
        (files['info/info.de.json'] as any).data.deOnly = 'Nur hier';
        const result = compileCatalog(writeCatalog(files));
        expect(codes(result)).toContain(DiagnosticCode.EXTRA_KEY);
        expect(result.artifact).toBeUndefined();
    });

    it('errors on parameters unknown to the base locale message', () => {
        const files = basicCatalog();
        (files['info/info.de.json'] as any).data.greeting = 'Hallo, {vorname}!';
        const result = compileCatalog(writeCatalog(files));
        expect(codes(result)).toContain(DiagnosticCode.UNKNOWN_PARAM);
    });

    it('errors on parameter type mismatches against the base locale', () => {
        const files = basicCatalog();
        (files['info/info.de.json'] as any).data.nextBirthday = 'Am {when, number}';
        const result = compileCatalog(writeCatalog(files));
        expect(codes(result)).toContain(DiagnosticCode.PARAM_TYPE_MISMATCH);
    });

    it('errors on unknown refs, coms, and leftover v1 tokens', () => {
        const result = compileCatalog(
            writeCatalog({
                'linguini.config.json': { baseLocale: 'en-US' },
                'info/info.en-US.json': {
                    data: {
                        badRef: '{{REF:nope.missing}}',
                        badCom: '{{COM:nope.missing}}',
                        v1Style: 'Hello {{USER_NAME}}!',
                    },
                },
            })
        );
        expect(codes(result)).toContain(DiagnosticCode.UNKNOWN_REF);
        expect(codes(result)).toContain(DiagnosticCode.UNKNOWN_COM);
        expect(codes(result)).toContain(DiagnosticCode.UNKNOWN_TOKEN);
    });

    it('detects ref cycles', () => {
        const result = compileCatalog(
            writeCatalog({
                'linguini.config.json': { baseLocale: 'en-US' },
                'info/info.en-US.json': {
                    data: { x: '{{REF:a.first}}' },
                    refs: { a: { first: '{{REF:a.second}}', second: '{{REF:a.first}}' } },
                },
            })
        );
        expect(codes(result)).toContain(DiagnosticCode.REF_CYCLE);
    });

    it('requires plural category coverage per locale', () => {
        const result = compileCatalog(
            writeCatalog({
                'linguini.config.json': { baseLocale: 'en-US' },
                'info/info.en-US.json': {
                    data: { count: '{n, plural, one {# thing} other {# things}}' },
                },
                'info/info.pl.json': {
                    // Polish cardinal requires one/few/many/other.
                    data: { count: '{n, plural, one {# rzecz} other {# rzeczy}}' },
                },
            })
        );
        const coverage = result.diagnostics.errors.filter(
            d => d.code === DiagnosticCode.PLURAL_COVERAGE
        );
        expect(coverage).toHaveLength(1);
        expect(coverage[0]!.message).toContain('few');
        expect(coverage[0]!.message).toContain('many');
    });

    it('rejects ICU messages without an other clause', () => {
        const result = compileCatalog(
            writeCatalog({
                'linguini.config.json': { baseLocale: 'en-US' },
                'info/info.en-US.json': {
                    data: { count: '{n, plural, one {# thing}}' },
                },
            })
        );
        expect(codes(result)).toContain(DiagnosticCode.ICU_PARSE);
    });

    it('requires identical parameters across variants', () => {
        const result = compileCatalog(
            writeCatalog({
                'linguini.config.json': { baseLocale: 'en-US' },
                'info/info.en-US.json': {
                    data: { hi: { $variants: ['Hi {name}!', 'Hey there!'] } },
                },
            })
        );
        expect(codes(result)).toContain(DiagnosticCode.VARIANT_PARAMS);
    });

    it('lints mid-sentence includes and non-camelCase parameters', () => {
        const result = compileCatalog(
            writeCatalog({
                'linguini.config.json': { baseLocale: 'en-US' },
                'common.json': { words: { thing: 'birthday' } },
                'info/info.en-US.json': {
                    data: {
                        midSentence: 'Your{{COM:words.thing}}is today',
                        loud: 'Hello {USER_NAME}!',
                    },
                },
            })
        );
        expect(result.diagnostics.hasErrors).toBe(false);
        const warningCodes = result.diagnostics.warnings.map(d => d.code);
        expect(warningCodes).toContain(DiagnosticCode.MID_SENTENCE_REF);
        expect(warningCodes).toContain(DiagnosticCode.ARG_CASE);
    });

    it('errors when a namespace lacks the base locale file', () => {
        const result = compileCatalog(
            writeCatalog({
                'linguini.config.json': { baseLocale: 'en-US' },
                'info/info.de.json': { data: { x: 'Hallo' } },
            })
        );
        expect(codes(result)).toContain(DiagnosticCode.NS_MISSING_BASE);
    });

    it('escalates missing keys to errors when configured', () => {
        const files = basicCatalog();
        (files['linguini.config.json'] as any).missingKeys = 'error';
        const result = compileCatalog(writeCatalog(files));
        expect(result.diagnostics.errors.some(d => d.code === DiagnosticCode.MISSING_KEY)).toBe(
            true
        );
        expect(result.artifact).toBeUndefined();
    });

    it('refs can declare ICU arguments that flow into the message schema', () => {
        const result = compileCatalog(writeCatalog(basicCatalog()));
        expect(result.schema!['info.signed']).toEqual({
            params: { user: { type: ParamKind.STRING } },
        });
    });

    it('non-base locales fall back to base locale refs per path', () => {
        const result = compileCatalog(writeCatalog(basicCatalog()));
        expect(result.artifact!.catalog['de']!['info.footerNote']).toEqual({
            form: MessageForm.MESSAGE,
            nodes: [{ kind: MessageNodeKind.TEXT, value: 'Footer — https://example.com/docs' }],
        });
    });

    it('resolves COM references inside the common table itself', () => {
        const result = compileCatalog(writeCatalog(basicCatalog()));
        expect(result.artifact!.common['bot.tagline']).toBe(
            'TestBot — see https://example.com/docs'
        );
    });

    it('parses angle-bracket markup as text (ignoreTag)', () => {
        const result = compileCatalog(writeCatalog(basicCatalog()));
        expect(result.schema!['info.mention']).toEqual({
            params: { userId: { type: ParamKind.STRING } },
        });
    });

    it('rejects unknown and skeleton number/date styles', () => {
        const result = compileCatalog(
            writeCatalog({
                'linguini.config.json': { baseLocale: 'en-US' },
                'info/info.en-US.json': {
                    data: {
                        typoStyle: 'You have {n, number, mediun}',
                        badDate: 'On {d, date, huge}',
                        skeleton: 'You have {n, number, ::percent}',
                    },
                },
            })
        );
        const unsupported = result.diagnostics.errors.filter(
            d => d.code === DiagnosticCode.ICU_UNSUPPORTED
        );
        expect(unsupported).toHaveLength(3);
    });

    it('errors when one parameter is used with conflicting types in a message', () => {
        const result = compileCatalog(
            writeCatalog({
                'linguini.config.json': { baseLocale: 'en-US' },
                'info/info.en-US.json': {
                    data: { conflict: 'Count {x, number} on {x, date, short}' },
                },
            })
        );
        expect(codes(result)).toContain(DiagnosticCode.PARAM_CONFLICT);
    });

    it('errors when a locale changes the form of a structured message', () => {
        const files = basicCatalog();
        (files['info/info.de.json'] as any).data.embed = 'Just a string here';
        const result = compileCatalog(writeCatalog(files));
        expect(codes(result)).toContain(DiagnosticCode.FORM_MISMATCH);
    });

    it('errors when a locale changes select branches', () => {
        const files = basicCatalog();
        (files['info/info.de.json'] as any).data.gender =
            '{subject, select, male {er} other {sie}}';
        const result = compileCatalog(writeCatalog(files));
        expect(codes(result)).toContain(DiagnosticCode.PARAM_TYPE_MISMATCH);
    });

    it('rejects keys containing dots', () => {
        const result = compileCatalog(
            writeCatalog({
                'linguini.config.json': { baseLocale: 'en-US' },
                'info/info.en-US.json': { data: { 'bad.key': 'x' } },
            })
        );
        expect(codes(result)).toContain(DiagnosticCode.DOTTED_KEY);
    });

    it('rejects unsupported value shapes', () => {
        const result = compileCatalog(
            writeCatalog({
                'linguini.config.json': { baseLocale: 'en-US' },
                'info/info.en-US.json': { data: { n: 42 } },
            })
        );
        expect(codes(result)).toContain(DiagnosticCode.INVALID_VALUE);
    });

    it('rejects malformed variants', () => {
        const result = compileCatalog(
            writeCatalog({
                'linguini.config.json': { baseLocale: 'en-US' },
                'info/info.en-US.json': {
                    data: { a: { $variants: [] }, b: { $variants: [42] } },
                },
            })
        );
        const invalid = result.diagnostics.errors.filter(
            d => d.code === DiagnosticCode.INVALID_VARIANTS
        );
        expect(invalid).toHaveLength(2);
    });

    it('rejects empty $type names', () => {
        const result = compileCatalog(
            writeCatalog({
                'linguini.config.json': { baseLocale: 'en-US' },
                'info/info.en-US.json': { data: { x: { $type: '', title: 'Hi' } } },
            })
        );
        expect(codes(result)).toContain(DiagnosticCode.INVALID_TYPE);
    });

    it('lints empty messages, and can be turned off', () => {
        const files = {
            'linguini.config.json': { baseLocale: 'en-US' } as any,
            'info/info.en-US.json': { data: { empty: '' } },
        };
        const warned = compileCatalog(writeCatalog(files));
        expect(warned.diagnostics.warnings.map(d => d.code)).toContain(
            DiagnosticCode.EMPTY_MESSAGE
        );

        files['linguini.config.json'] = { baseLocale: 'en-US', lint: { emptyMessage: 'off' } };
        const silenced = compileCatalog(writeCatalog(files));
        expect(silenced.diagnostics.items.map(d => d.code)).not.toContain(
            DiagnosticCode.EMPTY_MESSAGE
        );
    });

    it('escalates lints configured as errors', () => {
        const result = compileCatalog(
            writeCatalog({
                'linguini.config.json': {
                    baseLocale: 'en-US',
                    lint: { midSentenceRef: 'error' },
                },
                'common.json': { words: { thing: 'birthday' } },
                'info/info.en-US.json': {
                    data: { midSentence: 'Your{{COM:words.thing}}is today' },
                },
            })
        );
        expect(result.diagnostics.errors.map(d => d.code)).toContain(
            DiagnosticCode.MID_SENTENCE_REF
        );
        expect(result.artifact).toBeUndefined();
    });

    it('reports unreadable or malformed files', () => {
        const result = compileCatalog(
            writeCatalog({
                'linguini.config.json': { baseLocale: 'en-US' },
                'info/info.en-US.json': '{not valid json',
            })
        );
        expect(codes(result)).toContain(DiagnosticCode.READ_FILE);
    });

    it('reports invalid config as a diagnostic', () => {
        const result = compileCatalog(
            writeCatalog({
                'linguini.config.json': { baseLocale: 'en-US', lint: { argCase: 'loud' } },
                'info/info.en-US.json': { data: { x: 'y' } },
            })
        );
        expect(codes(result)).toContain(DiagnosticCode.CONFIG);
    });

    it('compiles multiple namespaces with prefixed keys', () => {
        const result = compileCatalog(
            writeCatalog({
                'linguini.config.json': { baseLocale: 'en-US' },
                'info/info.en-US.json': { data: { x: 'Info' } },
                'errors/errors.en-US.json': { data: { oops: 'Oops!' } },
            })
        );
        expect(result.diagnostics.errors).toEqual([]);
        expect(result.artifact!.manifest.namespaces).toEqual(['errors', 'info']);
        expect(result.schema!['info.x']).toBeDefined();
        expect(result.schema!['errors.oops']).toBeDefined();
    });

    it('honors an explicit namespaces list, ignoring other directories', () => {
        const result = compileCatalog(
            writeCatalog({
                'linguini.config.json': { baseLocale: 'en-US', namespaces: ['info'] },
                'info/info.en-US.json': { data: { x: 'Info' } },
                'junk/junk.en-US.json': { data: { y: 'Ignored' } },
            })
        );
        expect(result.diagnostics.errors).toEqual([]);
        expect(result.artifact!.manifest.namespaces).toEqual(['info']);
        expect(result.schema!['junk.y']).toBeUndefined();
    });

    it('reports unknown refs and coms referenced from inside ref values', () => {
        const result = compileCatalog(
            writeCatalog({
                'linguini.config.json': { baseLocale: 'en-US' },
                'info/info.en-US.json': {
                    data: { x: 'hi' },
                    refs: {
                        a: { badRef: '{{REF:missing.path}}', badCom: '{{COM:missing.path}}' },
                    },
                },
            })
        );
        expect(codes(result)).toContain(DiagnosticCode.UNKNOWN_REF);
        expect(codes(result)).toContain(DiagnosticCode.UNKNOWN_COM);
    });

    it('rejects REF tokens inside the common file', () => {
        const result = compileCatalog(
            writeCatalog({
                'linguini.config.json': { baseLocale: 'en-US' },
                'common.json': { a: { x: '{{REF:b.y}}' } },
                'info/info.en-US.json': { data: { x: 'hi' } },
            })
        );
        expect(codes(result)).toContain(DiagnosticCode.INVALID_INCLUDE);
    });

    it('rejects dotted keys and invalid value shapes inside refs', () => {
        const result = compileCatalog(
            writeCatalog({
                'linguini.config.json': { baseLocale: 'en-US' },
                'info/info.en-US.json': {
                    data: { x: 'hi' },
                    refs: { a: { 'bad.key': 'x', num: 42 } },
                },
            })
        );
        expect(codes(result)).toContain(DiagnosticCode.DOTTED_KEY);
        expect(codes(result)).toContain(DiagnosticCode.INVALID_REF_VALUE);
    });

    it('midSentenceRef lint can be turned off', () => {
        const result = compileCatalog(
            writeCatalog({
                'linguini.config.json': {
                    baseLocale: 'en-US',
                    lint: { midSentenceRef: 'off' },
                },
                'common.json': { words: { thing: 'birthday' } },
                'info/info.en-US.json': {
                    data: { midSentence: 'Your{{COM:words.thing}}is today' },
                },
            })
        );
        expect(result.diagnostics.items.map(d => d.code)).not.toContain(
            DiagnosticCode.MID_SENTENCE_REF
        );
    });

    it('merges plain usage with a specific type into the specific type', () => {
        const result = compileCatalog(
            writeCatalog({
                'linguini.config.json': { baseLocale: 'en-US' },
                'info/info.en-US.json': {
                    data: { mixed: 'Count {x, number} of {x}' },
                },
            })
        );
        expect(result.diagnostics.errors).toEqual([]);
        expect(result.schema!['info.mixed']).toEqual({
            params: { x: { type: ParamKind.NUMBER } },
        });
    });

    it('supports arbitrarily nested data categories', () => {
        const result = compileCatalog(
            writeCatalog({
                'linguini.config.json': { baseLocale: 'en-US' },
                'info/info.en-US.json': {
                    data: { deep: { nested: { msg: 'Hi {name}!' } } },
                },
            })
        );
        expect(result.diagnostics.errors).toEqual([]);
        expect(result.schema!['info.deep.nested.msg']).toEqual({
            params: { name: { type: ParamKind.STRING } },
        });
        expect(result.artifact!.catalog['en-US']!['info.deep.nested.msg']).toBeDefined();
    });

    it('compiles files that only define refs', () => {
        const result = compileCatalog(
            writeCatalog({
                'linguini.config.json': { baseLocale: 'en-US' },
                'info/info.en-US.json': { refs: { a: { x: 'unused' } } },
            })
        );
        expect(result.diagnostics.errors).toEqual([]);
        expect(Object.keys(result.schema!)).toEqual([]);
    });

    it('errors when no namespaces exist at all', () => {
        const result = compileCatalog(
            writeCatalog({ 'linguini.config.json': { baseLocale: 'en-US' } })
        );
        expect(codes(result)).toContain(DiagnosticCode.NO_NAMESPACES);
    });

    it('errors when an explicit namespace directory is missing', () => {
        const result = compileCatalog(
            writeCatalog({
                'linguini.config.json': { baseLocale: 'en-US', namespaces: ['missing'] },
            })
        );
        expect(codes(result)).toContain(DiagnosticCode.NS_MISSING_BASE);
    });

    it('rejects variants containing invalid ICU', () => {
        const result = compileCatalog(
            writeCatalog({
                'linguini.config.json': { baseLocale: 'en-US' },
                'info/info.en-US.json': {
                    data: { hi: { $variants: ['ok', '{n, plural, one {x}}'] } },
                },
            })
        );
        expect(codes(result)).toContain(DiagnosticCode.ICU_PARSE);
        expect(result.artifact).toBeUndefined();
    });

    it('rejects invalid ICU inside structured leaves, including nested arrays', () => {
        const result = compileCatalog(
            writeCatalog({
                'linguini.config.json': { baseLocale: 'en-US' },
                'info/info.en-US.json': {
                    data: {
                        topLevel: { $type: 'embed', title: '{n, plural, one {x}}' },
                        nested: {
                            $type: 'embed',
                            fields: [{ value: '{n, plural, one {x}}' }],
                        },
                    },
                },
            })
        );
        const parseErrors = result.diagnostics.errors.filter(
            d => d.code === DiagnosticCode.ICU_PARSE
        );
        expect(parseErrors).toHaveLength(2);
        expect(result.artifact).toBeUndefined();
    });

    it('errors on conflicting parameter types across structured leaves', () => {
        const result = compileCatalog(
            writeCatalog({
                'linguini.config.json': { baseLocale: 'en-US' },
                'info/info.en-US.json': {
                    data: {
                        card: {
                            $type: 'embed',
                            title: 'Count {x, number}',
                            description: 'On {x, date, short}',
                        },
                    },
                },
            })
        );
        expect(codes(result)).toContain(DiagnosticCode.PARAM_CONFLICT);
    });

    it('merges compatible parameter reuse across structured leaves', () => {
        const result = compileCatalog(
            writeCatalog({
                'linguini.config.json': { baseLocale: 'en-US' },
                'info/info.en-US.json': {
                    data: {
                        card: {
                            $type: 'embed',
                            title: 'Hello {x}',
                            description: '{x, number} times',
                        },
                    },
                },
            })
        );
        expect(result.diagnostics.errors).toEqual([]);
        expect(result.schema!['info.card']!.params['x']).toEqual({ type: ParamKind.NUMBER });
    });

    it('accepts a locale select translation with identical branches', () => {
        const files = basicCatalog();
        (files['info/info.de.json'] as any).data.gender =
            '{subject, select, male {er} female {sie} other {sie}}';
        const result = compileCatalog(writeCatalog(files));
        expect(result.diagnostics.errors).toEqual([]);
        expect(result.artifact!.catalog['de']!['info.gender']).toBeDefined();
    });
});

describe('shared refs (refs.<locale>.json)', () => {
    function sharedCatalog(): { [relativePath: string]: unknown } {
        return {
            'linguini.config.json': { baseLocale: 'en-US' },
            'common.json': { links: { docs: 'https://example.com/docs' } },
            'refs.en-US.json': {
                footers: { shared: 'Shared footer — {{COM:links.docs}}' },
                words: { bot: 'the bot' },
            },
            'info/info.en-US.json': {
                data: { a: '{{REF:footers.shared}}' },
                refs: { local: { note: 'Ask {{REF:words.bot}}' } },
            },
            'errors/errors.en-US.json': {
                data: { b: '{{REF:footers.shared}}', c: '{{REF:local.note}}' },
                refs: { local: { note: 'Tell {{REF:words.bot}}' } },
            },
        };
    }

    it('resolves shared refs from any namespace, including from local refs', () => {
        const result = compileCatalog(writeCatalog(sharedCatalog()));
        expect(result.diagnostics.errors).toEqual([]);
        const text = (key: string, locale = 'en-US'): string =>
            (result.artifact!.catalog[locale]![key] as any).nodes[0].value;
        expect(text('info.a')).toBe('Shared footer — https://example.com/docs');
        expect(text('errors.b')).toBe('Shared footer — https://example.com/docs');
        expect(text('errors.c')).toBe('Tell the bot');
    });

    it('lets namespace-local refs override shared refs', () => {
        const files = sharedCatalog();
        (files['info/info.en-US.json'] as any).refs.footers = { shared: 'Local override' };
        const result = compileCatalog(writeCatalog(files));
        expect(result.diagnostics.errors).toEqual([]);
        expect((result.artifact!.catalog['en-US']!['info.a'] as any).nodes[0].value).toBe(
            'Local override'
        );
        // Other namespaces still get the shared value.
        expect((result.artifact!.catalog['en-US']!['errors.b'] as any).nodes[0].value).toBe(
            'Shared footer — https://example.com/docs'
        );
    });

    it('falls back shared refs per path from locale file to base file', () => {
        const files = sharedCatalog();
        files['refs.de.json'] = { footers: { shared: 'Geteilte Fußzeile' } };
        (files['info/info.de.json'] as any) = { data: { a: '{{REF:footers.shared}}' } };
        (files['errors/errors.de.json'] as any) = { data: { c: '{{REF:words.bot}}' } };
        const result = compileCatalog(writeCatalog(files));
        expect(result.diagnostics.errors).toEqual([]);
        expect((result.artifact!.catalog['de']!['info.a'] as any).nodes[0].value).toBe(
            'Geteilte Fußzeile'
        );
        // words.bot is absent from refs.de.json → falls back to refs.en-US.json.
        expect((result.artifact!.catalog['de']!['errors.c'] as any).nodes[0].value).toBe('the bot');
    });

    it('reports unknown refs referenced from the shared file', () => {
        const files = sharedCatalog();
        (files['refs.en-US.json'] as any).broken = { x: '{{REF:nope.missing}}' };
        const result = compileCatalog(writeCatalog(files));
        expect(result.diagnostics.errors.map(d => d.code)).toContain(DiagnosticCode.UNKNOWN_REF);
    });

    it('rejects a namespace directory named refs', () => {
        const result = compileCatalog(
            writeCatalog({
                'linguini.config.json': { baseLocale: 'en-US' },
                'refs/refs.en-US.json': { data: { x: 'nope' } },
                'info/info.en-US.json': { data: { y: 'ok' } },
            })
        );
        expect(result.diagnostics.errors.map(d => d.code)).toContain(
            DiagnosticCode.RESERVED_NAMESPACE
        );
    });
});

describe('Diagnostics helpers', () => {
    it('warn() records a warning and formatDiagnostic renders it', () => {
        const diagnostics = new Diagnostics();
        diagnostics.warn(DiagnosticCode.MISSING_KEY, 'lagging translation', { key: 'a.b' });
        expect(diagnostics.warnings).toHaveLength(1);
        expect(diagnostics.hasErrors).toBe(false);
        expect(formatDiagnostic(diagnostics.items[0]!)).toBe(
            'warning[MISSING_KEY] lagging translation (a.b)'
        );
    });
});
