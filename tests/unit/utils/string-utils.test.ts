import { expect } from 'chai';
import { StringUtils } from '../../../src/utils/';

describe('StringUtils', (): void => {
    describe('#join()', (): void => {
        it('Basic example', (): void => {
            let myString = StringUtils.join(['One', 'Two', 'Three'], '\n');
            expect(myString).to.equal('One\nTwo\nThree');
        });
    });
});
