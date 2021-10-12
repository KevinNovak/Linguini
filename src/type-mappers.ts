import { URL } from 'url';
import { TypeMapper } from './models/internal-models';
import { StringUtils } from './utils/';

let stringTm: TypeMapper<string> = (jsonValue: any) => StringUtils.join(jsonValue, '\n');
let booleanTm: TypeMapper<boolean> = (jsonValue: any) => Boolean(jsonValue);
let numberTm: TypeMapper<number> = (jsonValue: any) => Number(jsonValue);
let bigIntTm: TypeMapper<BigInt> = (jsonValue: any) => BigInt(jsonValue);

let dateTm: TypeMapper<Date> = (jsonValue: any) => new Date(jsonValue);

let regExpTm: TypeMapper<RegExp> = (jsonValue: any) => {
    if (typeof jsonValue === 'string') {
        let match = /^\/(.*)\/([^\/]*)$/.exec(jsonValue);
        if (!match) {
            return new RegExp('');
        }

        return new RegExp(match[1], match[2]);
    } else {
        return new RegExp(jsonValue.pattern, jsonValue.flags);
    }
};

let urlTm: TypeMapper<URL> = (jsonValue: any) => new URL(jsonValue);

let TypeMappers = {
    String: stringTm,
    Boolean: booleanTm,
    Number: numberTm,
    BigInt: bigIntTm,
    Date: dateTm,
    RegExp: regExpTm,
    URL: urlTm,
};

export { TypeMappers };
