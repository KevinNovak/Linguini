import { URL } from 'url';
import { TypeMapper } from '..';

let dateTm: TypeMapper<Date> = (jsonValue: any) => new Date(jsonValue);

let regExpTm: TypeMapper<RegExp> = (jsonValue: any) =>
    new RegExp(jsonValue.pattern, jsonValue.flags);

let urlTm: TypeMapper<URL> = (jsonValue: any) => new URL(jsonValue);

export { dateTm, regExpTm, urlTm };
