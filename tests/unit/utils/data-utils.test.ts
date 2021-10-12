import { expect } from 'chai';
import { DataUtils } from '../../../src/utils/';

describe('DataUtils', (): void => {
    describe('#replaceVariablesInObj()', (): void => {
        it('Complex example', (): void => {
            let json = DataUtils.replaceVariablesInObj(
                {
                    test: '{{MY_VARIABLE}}',
                    nested: {
                        test: '{{MY_VARIABLE}}',
                    },
                    array: ['{{MY_VARIABLE}}', '{{MY_VARIABLE}}'],
                    mixedArray: ['{{MY_VARIABLE}}', true, 5],
                    inside: 'Before {{MY_VARIABLE}} After',
                    number: 5,
                    boolean: true,
                    null: null,
                },
                { MY_VARIABLE: 'HELLO' }
            );
            expect(JSON.stringify(json)).to.equal(
                '{"test":"HELLO","nested":{"test":"HELLO"},"array":["HELLO","HELLO"],"mixedArray":["HELLO",true,5],"inside":"Before HELLO After","number":5,"boolean":true,"null":null}'
            );
        });
    });
});
