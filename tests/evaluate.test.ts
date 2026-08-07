import { describe, expect, it } from 'vitest';
import type { MessageNode } from '../src/artifact.js';
import { MessageNodeKind } from '../src/artifact.js';
import { evaluateMessage } from '../src/runtime/evaluate.js';

function msg(nodes: MessageNode[], locale: string, params?: { [name: string]: unknown }): string {
    return evaluateMessage(nodes, locale, 'test.key', params);
}

describe('evaluateMessage', () => {
    it('joins text and arguments', () => {
        const nodes: MessageNode[] = [
            { kind: MessageNodeKind.TEXT, value: 'Hello, ' },
            { kind: MessageNodeKind.ARG, name: 'name' },
            { kind: MessageNodeKind.TEXT, value: '!' },
        ];
        expect(msg(nodes, 'en-US', { name: 'Ada' })).toBe('Hello, Ada!');
    });

    it('throws on missing parameters', () => {
        const nodes: MessageNode[] = [{ kind: MessageNodeKind.ARG, name: 'name' }];
        expect(() => msg(nodes, 'en-US')).toThrow(/Missing parameter "name"/);
    });

    describe('plural', () => {
        const plural = (branches: { [b: string]: MessageNode[] }, offset = 0): MessageNode[] => [
            { kind: MessageNodeKind.PLURAL, name: 'count', ordinal: false, offset, branches },
        ];
        const branches = {
            one: [
                { kind: MessageNodeKind.POUND },
                { kind: MessageNodeKind.TEXT, value: ' birthday' },
            ] as MessageNode[],
            other: [
                { kind: MessageNodeKind.POUND },
                { kind: MessageNodeKind.TEXT, value: ' birthdays' },
            ] as MessageNode[],
        };

        it('selects English cardinal categories', () => {
            expect(msg(plural(branches), 'en-US', { count: 1 })).toBe('1 birthday');
            expect(msg(plural(branches), 'en-US', { count: 3 })).toBe('3 birthdays');
        });

        it('prefers exact matches over categories', () => {
            const withExact = {
                '=0': [{ kind: MessageNodeKind.TEXT, value: 'none' }] as MessageNode[],
                ...branches,
            };
            expect(msg(plural(withExact), 'en-US', { count: 0 })).toBe('none');
            expect(msg(plural(withExact), 'en-US', { count: 1 })).toBe('1 birthday');
        });

        it('selects Polish few/many categories', () => {
            const pl = {
                one: [{ kind: MessageNodeKind.TEXT, value: 'one' }] as MessageNode[],
                few: [{ kind: MessageNodeKind.TEXT, value: 'few' }] as MessageNode[],
                many: [{ kind: MessageNodeKind.TEXT, value: 'many' }] as MessageNode[],
                other: [{ kind: MessageNodeKind.TEXT, value: 'other' }] as MessageNode[],
            };
            expect(msg(plural(pl), 'pl', { count: 1 })).toBe('one');
            expect(msg(plural(pl), 'pl', { count: 3 })).toBe('few');
            expect(msg(plural(pl), 'pl', { count: 5 })).toBe('many');
        });

        it('applies offset to # and category selection', () => {
            const withOffset = plural(branches, 1);
            expect(msg(withOffset, 'en-US', { count: 2 })).toBe('1 birthday');
            expect(msg(withOffset, 'en-US', { count: 4 })).toBe('3 birthdays');
        });
    });

    it('selects English ordinal categories', () => {
        const nodes: MessageNode[] = [
            {
                kind: MessageNodeKind.PLURAL,
                name: 'rank',
                ordinal: true,
                offset: 0,
                branches: {
                    one: [
                        { kind: MessageNodeKind.POUND },
                        { kind: MessageNodeKind.TEXT, value: 'st' },
                    ],
                    two: [
                        { kind: MessageNodeKind.POUND },
                        { kind: MessageNodeKind.TEXT, value: 'nd' },
                    ],
                    few: [
                        { kind: MessageNodeKind.POUND },
                        { kind: MessageNodeKind.TEXT, value: 'rd' },
                    ],
                    other: [
                        { kind: MessageNodeKind.POUND },
                        { kind: MessageNodeKind.TEXT, value: 'th' },
                    ],
                },
            },
        ];
        expect(msg(nodes, 'en-US', { rank: 1 })).toBe('1st');
        expect(msg(nodes, 'en-US', { rank: 2 })).toBe('2nd');
        expect(msg(nodes, 'en-US', { rank: 3 })).toBe('3rd');
        expect(msg(nodes, 'en-US', { rank: 4 })).toBe('4th');
        expect(msg(nodes, 'en-US', { rank: 11 })).toBe('11th');
    });

    it('evaluates select with other fallback', () => {
        const nodes: MessageNode[] = [
            {
                kind: MessageNodeKind.SELECT,
                name: 'subject',
                branches: {
                    male: [{ kind: MessageNodeKind.TEXT, value: 'he' }],
                    other: [{ kind: MessageNodeKind.TEXT, value: 'they' }],
                },
            },
        ];
        expect(msg(nodes, 'en-US', { subject: 'male' })).toBe('he');
        expect(msg(nodes, 'en-US', { subject: 'unknown' })).toBe('they');
    });

    it('formats numbers with styles', () => {
        expect(
            msg([{ kind: MessageNodeKind.NUMBER, name: 'n', style: 'percent' }], 'en-US', {
                n: 0.5,
            })
        ).toBe('50%');
        expect(msg([{ kind: MessageNodeKind.NUMBER, name: 'n' }], 'en-US', { n: 1234.5 })).toBe(
            new Intl.NumberFormat('en-US').format(1234.5)
        );
    });

    it('formats dates locale-aware', () => {
        const date = new Date(2026, 7, 4);
        const expected = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(date);
        expect(msg([{ kind: MessageNodeKind.DATE, name: 'when' }], 'en-US', { when: date })).toBe(
            expected
        );
    });

    it('defaults date and time styles to medium, accepting numeric timestamps', () => {
        const timestamp = new Date(2026, 7, 4, 15, 30).getTime();
        expect(
            msg([{ kind: MessageNodeKind.DATE, name: 'when' }], 'en-US', { when: timestamp })
        ).toBe(new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(timestamp));
        expect(
            msg([{ kind: MessageNodeKind.TIME, name: 'when' }], 'en-US', { when: timestamp })
        ).toBe(new Intl.DateTimeFormat('en-US', { timeStyle: 'medium' }).format(timestamp));
    });

    it('formats lists via Intl.ListFormat', () => {
        const expected = new Intl.ListFormat('en-US').format(['Ada', 'Grace', 'Katherine']);
        expect(
            msg([{ kind: MessageNodeKind.LIST, name: 'names' }], 'en-US', {
                names: ['Ada', 'Grace', 'Katherine'],
            })
        ).toBe(expected);
    });

    it('formats times with named styles', () => {
        const date = new Date(2026, 7, 4, 15, 30);
        const expected = new Intl.DateTimeFormat('en-US', { timeStyle: 'short' }).format(date);
        expect(
            msg([{ kind: MessageNodeKind.TIME, name: 'when', style: 'short' }], 'en-US', {
                when: date,
            })
        ).toBe(expected);
    });

    it('formats integer-style numbers', () => {
        const expected = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(3.7);
        expect(
            msg([{ kind: MessageNodeKind.NUMBER, name: 'n', style: 'integer' }], 'en-US', {
                n: 3.7,
            })
        ).toBe(expected);
    });

    it('selects all six Arabic cardinal categories', () => {
        const branches = Object.fromEntries(
            ['zero', 'one', 'two', 'few', 'many', 'other'].map(category => [
                category,
                [{ kind: MessageNodeKind.TEXT, value: category }] as MessageNode[],
            ])
        );
        const nodes: MessageNode[] = [
            { kind: MessageNodeKind.PLURAL, name: 'count', ordinal: false, offset: 0, branches },
        ];
        expect(msg(nodes, 'ar', { count: 0 })).toBe('zero');
        expect(msg(nodes, 'ar', { count: 1 })).toBe('one');
        expect(msg(nodes, 'ar', { count: 2 })).toBe('two');
        expect(msg(nodes, 'ar', { count: 3 })).toBe('few');
        expect(msg(nodes, 'ar', { count: 11 })).toBe('many');
        expect(msg(nodes, 'ar', { count: 100 })).toBe('other');
    });

    it('evaluates plurals nested inside selects', () => {
        const nodes: MessageNode[] = [
            {
                kind: MessageNodeKind.SELECT,
                name: 'subject',
                branches: {
                    male: [
                        {
                            kind: MessageNodeKind.PLURAL,
                            name: 'count',
                            ordinal: false,
                            offset: 0,
                            branches: {
                                one: [
                                    { kind: MessageNodeKind.TEXT, value: 'his ' },
                                    { kind: MessageNodeKind.POUND },
                                    { kind: MessageNodeKind.TEXT, value: ' gift' },
                                ],
                                other: [
                                    { kind: MessageNodeKind.TEXT, value: 'his ' },
                                    { kind: MessageNodeKind.POUND },
                                    { kind: MessageNodeKind.TEXT, value: ' gifts' },
                                ],
                            },
                        },
                    ],
                    other: [{ kind: MessageNodeKind.TEXT, value: 'their gifts' }],
                },
            },
        ];
        expect(msg(nodes, 'en-US', { subject: 'male', count: 1 })).toBe('his 1 gift');
        expect(msg(nodes, 'en-US', { subject: 'male', count: 2 })).toBe('his 2 gifts');
        expect(msg(nodes, 'en-US', { subject: 'x', count: 2 })).toBe('their gifts');
    });

    describe('runtime evaluation errors', () => {
        it('throws when a select has no matching branch and no other', () => {
            const nodes: MessageNode[] = [
                {
                    kind: MessageNodeKind.SELECT,
                    name: 'subject',
                    branches: { male: [{ kind: MessageNodeKind.TEXT, value: 'he' }] },
                },
            ];
            expect(() => msg(nodes, 'en-US', { subject: 'robot' })).toThrow(/"other" branch/);
        });

        it('throws for # outside a plural branch', () => {
            expect(() => msg([{ kind: MessageNodeKind.POUND }], 'en-US')).toThrow(
                /outside of a plural/
            );
        });

        it('throws when a plural has no matching branch and no other', () => {
            const nodes: MessageNode[] = [
                {
                    kind: MessageNodeKind.PLURAL,
                    name: 'count',
                    ordinal: false,
                    offset: 0,
                    branches: { one: [{ kind: MessageNodeKind.POUND }] },
                },
            ];
            expect(() => msg(nodes, 'en-US', { count: 5 })).toThrow(/No matching branch/);
        });

        it('throws for non-numeric plural parameters', () => {
            const nodes: MessageNode[] = [
                {
                    kind: MessageNodeKind.PLURAL,
                    name: 'count',
                    ordinal: false,
                    offset: 0,
                    branches: { other: [{ kind: MessageNodeKind.POUND }] },
                },
            ];
            expect(() => msg(nodes, 'en-US', { count: 'abc' })).toThrow(/not a number/);
        });

        it('throws for non-array list parameters', () => {
            expect(() =>
                msg([{ kind: MessageNodeKind.LIST, name: 'names' }], 'en-US', { names: 'a, b' })
            ).toThrow(/must be an array/);
        });
    });
});
