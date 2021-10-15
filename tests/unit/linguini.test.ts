import { assert, expect } from 'chai';
import path from 'path';
import { Linguini, TypeMappers } from '../../src';

describe('Linguini', (): void => {
    let linguini = new Linguini(path.join(__dirname, './data'), 'lang');

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
    });

    describe('#getRef()', (): void => {
        it('Basic example', (): void => {
            let ref = linguini.getRef('aboutMe.favoriteColor', 'en');
            expect(ref).to.equal('Blue');
        });
    });

    describe('#getCom()', (): void => {
        it('Basic example', (): void => {
            let com = linguini.getCom('links.github');
            expect(com).to.equal('https://github.com/KevinNovak');
        });
    });
});
