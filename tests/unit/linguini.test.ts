import { assert, expect } from 'chai';
import path from 'path';
import { Linguini, regExpTm, stringTm } from '../../src';

describe('Linguini', (): void => {
    let linguini = new Linguini(path.join(__dirname, './data'), 'lang');

    describe('#get()', (): void => {
        it('Regular expression', (): void => {
            let regex = linguini.get('regexes.hello', 'en', regExpTm);
            expect(regex.toString()).to.equal('/hello/i');
            assert(regex.test('Hello World!'));
            assert(!regex.test('Goodbye Cruel World!'));
        });

        it('Common variable', (): void => {
            let myGithub = linguini.get('intro.myGitHub', 'en', stringTm);
            expect(myGithub).to.equal('My GitHub is: https://github.com/KevinNovak');
        });
    });

    describe('#getRaw()', (): void => {
        it('Basic example', (): void => {
            let json = linguini.getRaw('regexes.hello', 'en');
            expect(json.pattern).to.equal('hello');
        });
    });
});
