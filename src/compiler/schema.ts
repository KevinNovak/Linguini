import { createHash } from 'node:crypto';
import type { CatalogSchema } from '../artifact.js';

/** JSON.stringify with recursively sorted object keys, so hashing is order-independent. */
export function canonicalStringify(value: unknown): string {
    return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortValue);
    }
    if (value !== null && typeof value === 'object') {
        const out: { [key: string]: unknown } = {};
        for (const key of Object.keys(value).sort()) {
            out[key] = sortValue((value as any)[key]);
        }
        return out;
    }
    return value;
}

export function hashSchema(schema: CatalogSchema): string {
    const hash = createHash('sha256').update(canonicalStringify(schema)).digest('hex');
    return `sha256:${hash}`;
}
