/**
 * Memoized Intl formatter instances. Constructing Intl formatters per call is the classic Intl
 * performance trap — each construction loads locale data. Cache keys are `(locale, options)`.
 */

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();
const listFormats = new Map<string, Intl.ListFormat>();
const pluralRules = new Map<string, Intl.PluralRules>();

function key(locale: string, options?: object): string {
    return `${locale}|${options ? JSON.stringify(options) : ''}`;
}

export function getNumberFormat(
    locale: string,
    options?: Intl.NumberFormatOptions
): Intl.NumberFormat {
    const k = key(locale, options);
    let cached = numberFormats.get(k);
    if (!cached) {
        cached = new Intl.NumberFormat(locale, options);
        numberFormats.set(k, cached);
    }
    return cached;
}

export function getDateTimeFormat(
    locale: string,
    options?: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
    const k = key(locale, options);
    let cached = dateTimeFormats.get(k);
    if (!cached) {
        cached = new Intl.DateTimeFormat(locale, options);
        dateTimeFormats.set(k, cached);
    }
    return cached;
}

export function getListFormat(locale: string, options?: Intl.ListFormatOptions): Intl.ListFormat {
    const k = key(locale, options);
    let cached = listFormats.get(k);
    if (!cached) {
        cached = new Intl.ListFormat(locale, options);
        listFormats.set(k, cached);
    }
    return cached;
}

export function getPluralRules(
    locale: string,
    options?: Intl.PluralRulesOptions
): Intl.PluralRules {
    const k = key(locale, options);
    let cached = pluralRules.get(k);
    if (!cached) {
        cached = new Intl.PluralRules(locale, options);
        pluralRules.set(k, cached);
    }
    return cached;
}
