import { URL } from 'url';
import { TypeMapper } from '..';

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

export { dateTm, regExpTm, urlTm };
