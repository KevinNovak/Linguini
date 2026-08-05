import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Writes a catalog fixture to a fresh temp directory. Values are JSON.stringified unless already strings. */
export function writeCatalog(files: { [relativePath: string]: unknown }): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'linguini-test-'));
    for (const [relativePath, content] of Object.entries(files)) {
        const filePath = path.join(dir, relativePath);
        mkdirSync(path.dirname(filePath), { recursive: true });
        writeFileSync(
            filePath,
            typeof content === 'string' ? content : JSON.stringify(content, null, 2)
        );
    }
    return dir;
}

/** A small but representative catalog used across suites. */
export function basicCatalog(): { [relativePath: string]: unknown } {
    return {
        'linguini.config.json': { baseLocale: 'en-US' },
        'common.json': {
            links: { docs: 'https://example.com/docs' },
            colors: { success: '#00ff00' },
            // tagline exercises COM-in-COM resolution inside the common table.
            bot: { name: 'TestBot', tagline: 'TestBot — see {{COM:links.docs}}' },
        },
        'info/info.en-US.json': {
            data: {
                greeting: 'Hello, {name}!',
                multiline: ['Line one', 'Docs: {{COM:links.docs}}'],
                birthdayCount: '{count, plural, one {# birthday} other {# birthdays}}',
                footerNote: '{{REF:footers.default}}',
                noParams: 'Just text.',
                randomGreeting: { $variants: ['Hi {name}!', 'Hey {name}!', 'Yo {name}!'] },
                gender: '{subject, select, male {he} female {she} other {they}}',
                friends: 'With {names, list}',
                nextBirthday: 'On {when, date, medium}',
                atTime: 'At {when, time, short}',
                tagline: '{{COM:bot.tagline}}',
                // A ref that declares its own ICU argument.
                signed: '{{REF:footers.signed}}',
                // ignoreTag: Discord-style mention markup must survive ICU parsing.
                mention: 'Happy birthday <@{userId}>!',
                // ICU quoting: '{' and '}' are literal braces.
                literalBraces: "Use '{'name'}' as a placeholder",
                embed: {
                    $type: 'embed',
                    title: 'About {{COM:bot.name}}',
                    description: ['{name} says hello', 'Second line'],
                    fields: [{ name: 'Count', value: '{count, number}', inline: true }],
                },
            },
            refs: {
                footers: {
                    default: 'Footer — {{COM:links.docs}}',
                    signed: 'Sent for {user}',
                },
            },
        },
        'info/info.de.json': {
            data: {
                greeting: 'Hallo, {name}!',
                birthdayCount: '{count, plural, one {# Geburtstag} other {# Geburtstage}}',
                // Uses a ref defined only in the base locale file (per-path ref fallback).
                footerNote: '{{REF:footers.default}}',
            },
        },
    };
}
