import { TypeMapper } from '..';
import { StringUtils } from '../utils';

let stringTm: TypeMapper<string> = (jsonValue: any) => StringUtils.join(String(jsonValue), '\n');
let booleanTm: TypeMapper<boolean> = (jsonValue: any) => Boolean(jsonValue);
let numberTm: TypeMapper<number> = (jsonValue: any) => Number(jsonValue);
let bigIntTm: TypeMapper<BigInt> = (jsonValue: any) => BigInt(jsonValue);

export { stringTm, booleanTm, numberTm, bigIntTm };
