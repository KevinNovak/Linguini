import { assert, expect } from 'chai';
import path from 'path';
import { Linguini, LinguiniError, TypeMappers } from '../../src';

describe('Linguini', (): void => {
    let folderPath = path.join(__dirname, './data');
    let fileName = 'lang';
    let linguini = new Linguini(folderPath, fileName);

    describe('#get()', (): void => {
        it('Regular expression', (): void => {
            let regex = linguini.get('regexes.hello', 'en', TypeMappers.RegExp);
            expect(regex.toString()).to.equal('/hello/i');
            assert(regex.test('Hello World!'));
            assert(!regex.test('Goodbye Cruel World!'));
        });

        it('Common reference', (): void => {
            let line = linguini.get('intro.myGitHub', 'en', TypeMappers.String);
            expect(line).to.equal('My GitHub is: https://github.com/KevinNovak');
        });

        it('Variable', (): void => {
            let greetingOne = linguini.get('intro.greeting', 'en', TypeMappers.String, {
                FIRST_NAME: 'Bruce',
                LAST_NAME: 'Wayne',
            });
            expect(greetingOne).to.equal('Hello, nice to meet you Bruce Wayne!');

            let greetingTwo = linguini.get('intro.greeting', 'en', TypeMappers.String, {
                FIRST_NAME: 'Clark',
                LAST_NAME: 'Kent',
            });
            expect(greetingTwo).to.equal('Hello, nice to meet you Clark Kent!');
        });
    });

    describe('#getRaw()', (): void => {
        it('Basic example', (): void => {
            let json = linguini.getRaw('regexes.hello', 'en');
            expect(json.pattern).to.equal('hello');
        });

        it('Variable', (): void => {
            let greetingOne = linguini.getRaw('intro.greeting', 'en', {
                FIRST_NAME: 'Bruce',
                LAST_NAME: 'Wayne',
            });
            expect(greetingOne).to.equal('Hello, nice to meet you Bruce Wayne!');

            let greetingTwo = linguini.getRaw('intro.greeting', 'en', {
                FIRST_NAME: 'Clark',
                LAST_NAME: 'Kent',
            });
            expect(greetingTwo).to.equal('Hello, nice to meet you Clark Kent!');
        });

        it('Does not exist', (): void => {
            function myFunction(): void {
                linguini.getRaw('badCategory.badName', 'en');
            }

            assert.throw(
                myFunction,
                LinguiniError,
                `Language item 'badCategory.badName' does not exist in '${folderPath}\\lang.en.json'`
            );
        });
    });

    describe('#getRef()', (): void => {
        it('Basic example', (): void => {
            let ref = linguini.getRef('aboutMe.favoriteColor', 'en');
            expect(ref).to.equal('Blue');
        });

        it('Does not exist', (): void => {
            function myFunction(): void {
                linguini.getRef('badCategory.badName', 'en');
            }

            assert.throw(
                myFunction,
                LinguiniError,
                `Reference string 'badCategory.badName' does not exist in '${folderPath}\\lang.en.json'`
            );
        });
    });

    describe('#getCom()', (): void => {
        it('Basic example', (): void => {
            let com = linguini.getCom('links.github');
            expect(com).to.equal('https://github.com/KevinNovak');
        });

        it('Does not exist', (): void => {
            function myFunction(): void {
                linguini.getCom('badCategory.badName');
            }

            assert.throw(
                myFunction,
                LinguiniError,
                `Common reference string 'badCategory.badName' does not exist in '${folderPath}\\lang.common.json'`
            );
        });
    });
});
