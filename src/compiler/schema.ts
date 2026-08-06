import { createHash } from 'node:crypto';
import type { Artifact, CatalogSchema } from '../artifact.js';

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

/** Per-key schema hashes: the granular contract behind subset validation (design §14). */
export function hashKeySchemas(schema: CatalogSchema): { [key: string]: string } {
    const out: { [key: string]: string } = {};
    for (const key of Object.keys(schema).sort()) {
        out[key] = `sha256:${createHash('sha256')
            .update(canonicalStringify(schema[key]))
            .digest('hex')}`;
    }
    return out;
}

/** Identity of a bindings target's key subset (its keys + their schema hashes). */
export function hashSubset(subset: { [key: string]: string }): string {
    return `sha256:${createHash('sha256').update(canonicalStringify(subset)).digest('hex')}`;
}

/** Content identity of a compiled artifact: equal hash ⇒ identical rendered output. */
export function hashContent(
    catalog: Artifact['catalog'],
    common: Artifact['common']
): string {
    const hash = createHash('sha256')
        .update(canonicalStringify({ catalog, common }))
        .digest('hex');
    return `sha256:${hash}`;
}
