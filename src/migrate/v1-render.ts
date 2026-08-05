/**
 * A minimal renderer implementing Linguini v1 semantics (string substitution only), used by the
 * migration verify harness: v1-render the original catalog and v2-format the migrated one over
 * identical inputs, then diff. Variables render as «NAME» placeholders on both sides.
 */

const INCLUDE_REGEX = /\{\{(REF|COM):([^{}]+?)\}\}/g;
const VAR_REGEX = /\{\{([^{}]+?)\}\}/g;
const REPLACEMENT_ROUNDS = 20;

export type V1Tables = {
    com: Map<string, string>;
    refs: Map<string, string>;
};

/** Flattens nested string/string[] leaves to dot-path → string (arrays join with \n). */
export function flattenV1Strings(input: any, prefix = ''): Map<string, string> {
    const out = new Map<string, string>();
    if (input === undefined || input === null) {
        return out;
    }
    for (const [key, value] of Object.entries(input)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'string') {
            out.set(path, value);
        } else if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
            out.set(path, value.join('\n'));
        } else if (typeof value === 'object' && value !== null) {
            for (const [nested, nestedValue] of flattenV1Strings(value, path)) {
                out.set(nested, nestedValue);
            }
        }
    }
    return out;
}

/** Builds fully-expanded COM/REF tables the way v1 did: iterative replacement to a fixed depth. */
export function buildV1Tables(common: any, refs: any): V1Tables {
    const com = flattenV1Strings(common);
    for (let i = 0; i < REPLACEMENT_ROUNDS; i++) {
        for (const [key, value] of com) {
            com.set(key, expandIncludesOnce(value, com, new Map()));
        }
    }
    const refTable = flattenV1Strings(refs);
    for (let i = 0; i < REPLACEMENT_ROUNDS; i++) {
        for (const [key, value] of refTable) {
            refTable.set(key, expandIncludesOnce(value, com, refTable));
        }
    }
    return { com, refs: refTable };
}

function expandIncludesOnce(
    text: string,
    com: Map<string, string>,
    refs: Map<string, string>
): string {
    return text.replace(INCLUDE_REGEX, (match, kind: string, path: string) => {
        const table = kind === 'COM' ? com : refs;
        return table.get(path.trim()) ?? match;
    });
}

/** Renders one v1 text value: expand includes, then fill variables with «NAME» placeholders. */
export function renderV1Text(text: string, tables: V1Tables): string {
    let out = text;
    for (let i = 0; i < REPLACEMENT_ROUNDS; i++) {
        const next = expandIncludesOnce(out, tables.com, tables.refs);
        if (next === out) {
            break;
        }
        out = next;
    }
    return out.replace(VAR_REGEX, (_match, name: string) => `«${name.trim()}»`);
}

/**
 * Renders a v1 value with the same shape rules the v2 compiler applies: strings and all-string
 * arrays become one rendered string; objects/mixed arrays render recursively; other JSON
 * primitives pass through.
 */
export function renderV1Value(value: unknown, tables: V1Tables): unknown {
    if (typeof value === 'string') {
        return renderV1Text(value, tables);
    }
    if (Array.isArray(value)) {
        if (value.length > 0 && value.every(item => typeof item === 'string')) {
            return renderV1Text(value.join('\n'), tables);
        }
        return value.map(item => renderV1Value(item, tables));
    }
    if (typeof value === 'object' && value !== null) {
        const out: { [key: string]: unknown } = {};
        for (const [key, nested] of Object.entries(value)) {
            out[key] = renderV1Value(nested, tables);
        }
        return out;
    }
    return value;
}
