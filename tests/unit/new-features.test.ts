import { expect } from 'chai';
import path from 'path';

import { Formatters, Linguini, LinguiniError } from '../../src';

describe('New Features', (): void => {
    const langPath = path.join(__dirname, './data-v2/new-features');

    describe('Fallback Locale', (): void => {
        it('should use fallback locale when key is missing', (): void => {
            const linguini = new Linguini(langPath, {
                fallbackLocale: 'en-US',
                onMissingKey: 'fallback',
            });

            // 'fallbackTest' only exists in en-US, not in es-MX
            const result = linguini.t('messages.fallbackTest', 'es-MX');
            expect(result).to.equal('This exists in en-US');
        });

        it('should use requested locale when key exists', (): void => {
            const linguini = new Linguini(langPath, {
                fallbackLocale: 'en-US',
                onMissingKey: 'fallback',
            });

            const result = linguini.t('messages.welcome', 'es-MX');
            expect(result).to.equal('¡Bienvenido a TestApp!');
        });

        it('should throw when key missing in both requested and fallback locale', (): void => {
            const linguini = new Linguini(langPath, {
                fallbackLocale: 'en-US',
                onMissingKey: 'fallback',
            });

            expect(() => linguini.t('messages.nonExistent', 'es-MX')).to.throw(
                LinguiniError,
                'Invalid translation key'
            );
        });
    });

    describe('Missing Key Handler', (): void => {
        it('should throw by default', (): void => {
            const linguini = new Linguini(langPath);

            expect(() => linguini.t('messages.nonExistent', 'en-US')).to.throw(
                LinguiniError,
                'Invalid translation key'
            );
        });

        it('should return key when onMissingKey is "key"', (): void => {
            const linguini = new Linguini(langPath, {
                onMissingKey: 'key',
            });

            const result = linguini.t('messages.nonExistent', 'en-US');
            expect(result).to.equal('messages.nonExistent');
        });

        it('should use custom handler function', (): void => {
            const linguini = new Linguini(langPath, {
                onMissingKey: (key, locale) => `[MISSING: ${key} in ${locale}]`,
            });

            const result = linguini.t('messages.nonExistent', 'en-US');
            expect(result).to.equal('[MISSING: messages.nonExistent in en-US]');
        });
    });

    describe('tRandom() - Random Selection', (): void => {
        it('should return a string from the array', (): void => {
            const linguini = new Linguini(langPath);

            const validGreetings = ['Hello!', 'Hi there!', 'Hey!', 'Greetings!'];
            const result = linguini.tRandom('messages.greetings', 'en-US');

            expect(validGreetings).to.include(result);
        });

        it('should return different values over multiple calls (probabilistically)', (): void => {
            const linguini = new Linguini(langPath);

            const results = new Set<string>();
            for (let i = 0; i < 100; i++) {
                results.add(linguini.tRandom('messages.greetings', 'en-US'));
            }

            // With 4 options and 100 tries, we should get at least 2 different values
            expect(results.size).to.be.greaterThan(1);
        });

        it('should work with variables', (): void => {
            const linguini = new Linguini(langPath);

            // Even though greetings doesn't have variables, it shouldn't break
            const result = linguini.tRandom('messages.greetings', 'en-US', { unused: 'value' });
            expect(result).to.be.a('string');
        });

        it('should work with non-array values', (): void => {
            const linguini = new Linguini(langPath);

            const result = linguini.tRandom('messages.welcome', 'en-US');
            expect(result).to.equal('Welcome to TestApp!');
        });
    });

    describe('tPlural() - Pluralization', (): void => {
        it('should use "zero" form for 0', (): void => {
            const linguini = new Linguini(langPath);

            const result = linguini.tPlural('plurals.items', 'en-US', 0);
            expect(result).to.equal('No items');
        });

        it('should use "one" form for 1', (): void => {
            const linguini = new Linguini(langPath);

            const result = linguini.tPlural('plurals.items', 'en-US', 1);
            expect(result).to.equal('1 item');
        });

        it('should use "other" form for 2+', (): void => {
            const linguini = new Linguini(langPath);

            expect(linguini.tPlural('plurals.items', 'en-US', 2)).to.equal('2 items');
            expect(linguini.tPlural('plurals.items', 'en-US', 5)).to.equal('5 items');
            expect(linguini.tPlural('plurals.items', 'en-US', 100)).to.equal('100 items');
        });

        it('should work with Spanish plurals', (): void => {
            const linguini = new Linguini(langPath);

            expect(linguini.tPlural('plurals.items', 'es-MX', 0)).to.equal('Sin artículos');
            expect(linguini.tPlural('plurals.items', 'es-MX', 1)).to.equal('1 artículo');
            expect(linguini.tPlural('plurals.items', 'es-MX', 5)).to.equal('5 artículos');
        });

        it('should add COUNT variable automatically', (): void => {
            const linguini = new Linguini(langPath);

            const result = linguini.tPlural('messages.simpleCount', 'en-US', 42);
            expect(result).to.equal('You have 42 messages');
        });

        it('should support additional variables', (): void => {
            const linguini = new Linguini(langPath);

            // COUNT is added automatically, other vars passed through
            const result = linguini.tPlural('plurals.items', 'en-US', 3, { OTHER: 'unused' });
            expect(result).to.equal('3 items');
        });
    });

    describe('scope() - Namespaced Access', (): void => {
        it('should create a scoped accessor', (): void => {
            const linguini = new Linguini(langPath);
            const messagesLang = linguini.scope('messages');

            const result = messagesLang.t('welcome', 'en-US');
            expect(result).to.equal('Welcome to TestApp!');
        });

        it('should support nested scopes', (): void => {
            const linguini = new Linguini(langPath);
            const nestedLang = linguini.scope('messages').scope('nested').scope('deep');

            const result = nestedLang.t('value', 'en-US');
            expect(result).to.equal('Deep nested value');
        });

        it('should support tRandom in scope', (): void => {
            const linguini = new Linguini(langPath);
            const messagesLang = linguini.scope('messages');

            const validGreetings = ['Hello!', 'Hi there!', 'Hey!', 'Greetings!'];
            const result = messagesLang.tRandom('greetings', 'en-US');

            expect(validGreetings).to.include(result);
        });

        it('should support tPlural in scope', (): void => {
            const linguini = new Linguini(langPath);
            const pluralsLang = linguini.scope('plurals');

            const result = pluralsLang.tPlural('items', 'en-US', 5);
            expect(result).to.equal('5 items');
        });

        it('should support has() in scope', (): void => {
            const linguini = new Linguini(langPath);
            const messagesLang = linguini.scope('messages');

            expect(messagesLang.has('welcome', 'en-US')).to.be.true;
            expect(messagesLang.has('nonExistent', 'en-US')).to.be.false;
        });
    });

    describe('validateCompleteness()', (): void => {
        it('should detect missing translations', (): void => {
            const linguini = new Linguini(langPath);

            const issues = linguini.validateCompleteness();

            // 'fallbackTest' and 'nested.deep.value' only exist in en-US
            expect(issues.length).to.be.greaterThan(0);

            const fallbackIssue = issues.find(i => i.key === 'messages.fallbackTest');
            expect(fallbackIssue).to.exist;
            expect(fallbackIssue?.missingIn).to.include('es-MX');
        });

        it('should return empty array when all translations complete', (): void => {
            // Using the locale-folder data which is complete
            const completeLangPath = path.join(__dirname, './data-v2/locale-folder');
            const linguini = new Linguini(completeLangPath);

            const issues = linguini.validateCompleteness();
            expect(issues).to.deep.equal([]);
        });
    });

    describe('reload()', (): void => {
        it('should reload translations from disk', (): void => {
            const linguini = new Linguini(langPath);

            // Just verify it doesn't throw
            linguini.reload();

            // Verify translations still work after reload
            const result = linguini.t('messages.welcome', 'en-US');
            expect(result).to.equal('Welcome to TestApp!');
        });
    });

    describe('Formatters', (): void => {
        describe('.number()', (): void => {
            it('should format numbers with locale', (): void => {
                expect(Formatters.number(1234567)).to.equal('1,234,567');
            });

            it('should support different locales', (): void => {
                const result = Formatters.number(1234.56, 'de-DE');
                // German uses comma for decimal, period for thousands
                expect(result).to.include('1.234');
            });
        });

        describe('.currency()', (): void => {
            it('should format currency', (): void => {
                const result = Formatters.currency(19.99, 'USD');
                expect(result).to.include('$');
                expect(result).to.include('19.99');
            });
        });

        describe('.percent()', (): void => {
            it('should format percentages', (): void => {
                expect(Formatters.percent(0.756, 'en-US', 0)).to.equal('76%');
            });
        });

        describe('.date()', (): void => {
            it('should format dates', (): void => {
                const date = new Date('2024-12-04');
                const result = Formatters.date(date, 'en-US', 'short');
                expect(result).to.include('12');
                expect(result).to.include('4');
            });
        });

        describe('.relativeTime()', (): void => {
            it('should format relative time in the past', (): void => {
                const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
                const result = Formatters.relativeTime(twoHoursAgo);
                expect(result).to.include('hour');
                expect(result).to.include('ago');
            });

            it('should format relative time in the future', (): void => {
                const inThreeDays = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
                const result = Formatters.relativeTime(inThreeDays);
                expect(result).to.include('day');
                expect(result).to.include('in');
            });
        });

        describe('.list()', (): void => {
            it('should format a list with conjunction', (): void => {
                const result = Formatters.list(['Alice', 'Bob', 'Charlie']);
                expect(result).to.include('Alice');
                expect(result).to.include('Bob');
                expect(result).to.include('Charlie');
                expect(result).to.include('and');
            });

            it('should format a list with disjunction', (): void => {
                const result = Formatters.list(['cats', 'dogs'], 'en-US', 'disjunction');
                expect(result).to.include('cats');
                expect(result).to.include('dogs');
                expect(result).to.include('or');
            });

            it('should handle single item', (): void => {
                expect(Formatters.list(['Alice'])).to.equal('Alice');
            });

            it('should handle empty list', (): void => {
                expect(Formatters.list([])).to.equal('');
            });
        });

        describe('.truncate()', (): void => {
            it('should truncate long strings', (): void => {
                expect(Formatters.truncate('Hello World', 8)).to.equal('Hello...');
            });

            it('should not truncate short strings', (): void => {
                expect(Formatters.truncate('Hello', 10)).to.equal('Hello');
            });
        });

        describe('.duration()', (): void => {
            it('should format duration', (): void => {
                const result = Formatters.duration(3661000);
                expect(result).to.include('1h');
                expect(result).to.include('1m');
            });

            it('should format duration verbose', (): void => {
                const result = Formatters.duration(3600000, { verbose: true });
                expect(result).to.include('hour');
            });
        });

        describe('.bytes()', (): void => {
            it('should format bytes', (): void => {
                expect(Formatters.bytes(1024)).to.equal('1 KB');
                expect(Formatters.bytes(1073741824)).to.equal('1 GB');
            });
        });

        describe('.titleCase()', (): void => {
            it('should convert to title case', (): void => {
                expect(Formatters.titleCase('hello world')).to.equal('Hello World');
            });
        });

        describe('.pad()', (): void => {
            it('should pad numbers', (): void => {
                expect(Formatters.pad(5, 2)).to.equal('05');
                expect(Formatters.pad(5, 3)).to.equal('005');
            });

            it('should pad strings on right', (): void => {
                expect(Formatters.pad('hi', 5, ' ', 'right')).to.equal('hi   ');
            });
        });
    });
});

