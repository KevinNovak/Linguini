/**
 * A locale-bound view of a generated messages tree: every accessor's leading `locale`
 * parameter is pre-applied. Consumers resolve the locale once per interaction and call
 * `tl.info.greeting({ name })` instead of threading the locale through every call.
 */
export type LocaleBound<T> = {
    [K in keyof T]: T[K] extends (locale: string, ...args: infer A) => infer R
        ? (...args: A) => R
        : LocaleBound<T[K]>;
};

export function bindLocale<T extends object>(tree: T, locale: string): LocaleBound<T> {
    const out: { [key: string]: unknown } = {};
    for (const [key, value] of Object.entries(tree)) {
        out[key] =
            typeof value === 'function'
                ? (...args: unknown[]) => value(locale, ...args)
                : bindLocale(value as object, locale);
    }
    return out as LocaleBound<T>;
}
