import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Artifact } from '../artifact.js';
import { compileCatalog } from '../compiler/compile.js';
import { resolveConfig } from '../compiler/config.js';
import type { Diagnostic } from '../compiler/diagnostics.js';
import { LinguiniError } from '../errors.js';
import { Linguini } from '../runtime/linguini.js';
import type { V1Tables } from './v1-render.js';
import { buildV1Tables, renderV1Value } from './v1-render.js';

/**
 * `linguini migrate` — one-time converter from the v1 catalog format ({data, refs} files,
 * `{{VAR}}` variables, `*.common.json`) to the v2 format (ICU messages, camelCase arguments,
 * `common.json`). Mechanical conversions happen here; everything needing human judgment lands
 * in the report. The migrated output is compiled with the v2 compiler and render-diffed
 * against v1 semantics as a regression gate.
 */

export type MigrateOptions = {
    /** Output directory for the v2 catalog. */
    out: string;
    /** Base locale written into the generated config. Default `en-US`. */
    baseLocale?: string;
    /**
     * When set, data objects that look like structured values (embed-shaped: title,
     * description, fields, ...) are tagged with this `$type` instead of being walked as
     * nested categories. Every tagged key is reported for triage.
     */
    objectType?: string;
    /**
     * Hoist refs that are duplicated with identical values in two or more namespaces into a
     * shared `refs.<locale>.json`. Default true; the render-diff gate proves hoisting is
     * semantics-preserving.
     */
    hoistSharedRefs?: boolean;
};

export type MigrateReport = {
    namespaces: string[];
    locales: string[];
    /** `{{FROM}}` → `{from}` conversions, per unique variable name. */
    variableRenames: { from: string; to: string }[];
    /** Keys whose object values were tagged with `$type` — review each. */
    taggedObjects: string[];
    /** Sibling keys that look like a hand-rolled singular/plural pair — collapse manually. */
    suspectedPluralPairs: { key: string; pluralKey: string }[];
    /** Keys where literal braces/apostrophes required ICU escaping. */
    escapedValues: string[];
    /** Data leaves that fit no v2 value shape and were dropped — fix by hand. */
    unconvertible: { key: string; reason: string }[];
    /** Input files that are not part of a v1 catalog (copied nowhere). */
    skippedFiles: string[];
    /** Refs duplicated identically across namespaces, hoisted into shared refs.<locale>.json. */
    hoistedRefs: { path: string; locale: string; namespaces: string[] }[];
    /** Ref paths whose values differ across namespaces — kept namespace-local; review. */
    refConflicts: { path: string; locale: string; values: { [ns: string]: unknown } }[];
    /** Diagnostics from compiling the migrated catalog with the v2 compiler. */
    compile: { errors: number; warnings: number; diagnostics: Diagnostic[] };
    /** Render-diff of v1 semantics vs the compiled v2 catalog over identical inputs. */
    verify: {
        checked: number;
        mismatches: { key: string; locale: string; v1: unknown; v2: unknown }[];
    };
};

const LOCALE_FILE = /^(.+)\.([A-Za-z0-9-]+)\.json$/;
const EMBED_KEYS = new Set([
    'title',
    'description',
    'fields',
    'footer',
    'author',
    'thumbnail',
    'image',
    'url',
    'color',
    'timestamp',
]);

type MigrateContext = {
    options: MigrateOptions;
    report: MigrateReport;
    renames: Map<string, string>;
    /** Fully-qualified keys of tagged structured values, for the verify walk. */
    tagged: Set<string>;
    /** Every data leaf key, for plural-pair detection. */
    leafKeys: Set<string>;
};

export async function migrateCatalog(
    inputDir: string,
    options: MigrateOptions
): Promise<MigrateReport> {
    const report: MigrateReport = {
        namespaces: [],
        locales: [],
        variableRenames: [],
        taggedObjects: [],
        suspectedPluralPairs: [],
        escapedValues: [],
        unconvertible: [],
        skippedFiles: [],
        hoistedRefs: [],
        refConflicts: [],
        compile: { errors: 0, warnings: 0, diagnostics: [] },
        verify: { checked: 0, mismatches: [] },
    };
    const ctx: MigrateContext = {
        options,
        report,
        renames: new Map(),
        tagged: new Set(),
        leafKeys: new Set(),
    };
    const baseLocale = options.baseLocale ?? 'en-US';
    const outDir = path.resolve(options.out);

    // Discover the v1 layout: a common file at the root, namespace subdirectories with
    // <ns>.<locale>.json files, and anything else reported as skipped.
    const rootEntries = readdirSync(inputDir, { withFileTypes: true });
    const commonEntry = rootEntries.find(
        entry => entry.isFile() && /(^|\.)common\.json$/.test(entry.name)
    );
    for (const entry of rootEntries) {
        if (entry.isFile() && entry !== commonEntry) {
            report.skippedFiles.push(entry.name);
        }
    }

    const namespaces: { ns: string; locales: Map<string, string> }[] = [];
    for (const entry of rootEntries.filter(e => e.isDirectory())) {
        const locales = new Map<string, string>();
        for (const fileName of readdirSync(path.join(inputDir, entry.name))) {
            const match = fileName.match(LOCALE_FILE);
            if (match) {
                locales.set(match[2]!, path.join(inputDir, entry.name, fileName));
            } else {
                report.skippedFiles.push(`${entry.name}/${fileName}`);
            }
        }
        if (locales.size > 0) {
            namespaces.push({ ns: entry.name, locales });
        }
    }
    if (namespaces.length === 0) {
        throw new LinguiniError(`No v1 namespace directories found in ${inputDir}`);
    }
    report.namespaces = namespaces.map(n => n.ns).sort();
    report.locales = [...new Set(namespaces.flatMap(n => [...n.locales.keys()]))].sort();

    // Convert and write the v2 catalog.
    mkdirSync(outDir, { recursive: true });
    let v1Common: any = {};
    if (commonEntry) {
        v1Common = readJson(path.join(inputDir, commonEntry.name));
        writeJson(path.join(outDir, 'common.json'), convertStringTree(v1Common, 'common', ctx));
    }
    const converted = new Map<string, Map<string, { data: any; refs: any }>>();
    for (const { ns, locales } of namespaces) {
        const perLocale = new Map<string, { data: any; refs: any }>();
        for (const [locale, filePath] of locales) {
            const v1 = readJson(filePath);
            perLocale.set(locale, {
                data: convertData(v1.data ?? {}, ns, ctx),
                refs: convertStringTree(v1.refs ?? {}, `${ns}.refs`, ctx),
            });
        }
        converted.set(ns, perLocale);
    }

    if (options.hoistSharedRefs !== false) {
        hoistSharedRefs(converted, report.locales, outDir, ctx);
    }

    for (const [ns, perLocale] of converted) {
        mkdirSync(path.join(outDir, ns), { recursive: true });
        for (const [locale, file] of perLocale) {
            writeJson(path.join(outDir, ns, `${ns}.${locale}.json`), file);
        }
    }
    writeJson(path.join(outDir, 'linguini.config.json'), { baseLocale, out: 'dist' });

    report.variableRenames = [...ctx.renames]
        .map(([from, to]) => ({ from, to }))
        .sort((a, b) => a.from.localeCompare(b.from));
    report.taggedObjects = [...ctx.tagged].sort();
    detectPluralPairs(ctx);

    // Gate 1: the migrated catalog must satisfy the v2 compiler.
    const compiled = compileCatalog(outDir, resolveConfig({ baseLocale }));
    report.compile = {
        errors: compiled.diagnostics.errors.length,
        warnings: compiled.diagnostics.warnings.length,
        diagnostics: compiled.diagnostics.items,
    };

    // Gate 2: render-diff v1 vs v2 over identical inputs.
    if (compiled.artifact) {
        await verify(inputDir, commonEntry?.name, namespaces, compiled.artifact, ctx);
    }
    return report;
}

// ---------------------------------------------------------------------------
// Conversion

/**
 * Converts one v1 text value to ICU: `{{VAR}}` → `{var}` (camelCased), `{{REF/COM:...}}`
 * preserved, and literal braces/apostrophes ICU-escaped. Tokens are shielded behind sentinels
 * while escaping so their braces survive.
 */
function convertText(text: string, key: string, ctx: MigrateContext): string {
    const tokens: string[] = [];
    let out = text.replace(/\{\{[^{}]*\}\}/g, match => {
        tokens.push(match);
        return `\u0000${tokens.length - 1}\u0000`;
    });

    const beforeEscaping = out;
    out = out.replace(/'(?=[{}])/g, "''").replace(/([{}])/g, "'$1'");
    if (out !== beforeEscaping && !ctx.report.escapedValues.includes(key)) {
        ctx.report.escapedValues.push(key);
    }

    return out.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => {
        const token = tokens[Number(index)]!;
        if (/^\{\{(REF|COM):/.test(token)) {
            return token;
        }
        const name = token.slice(2, -2).trim();
        const to = camelize(name);
        ctx.renames.set(name, to);
        return `{${to}}`;
    });
}

export function camelize(name: string): string {
    if (!name.includes('_') && !/^[A-Z0-9]+$/.test(name)) {
        return name.charAt(0).toLowerCase() + name.slice(1);
    }
    const parts = name.toLowerCase().split('_').filter(Boolean);
    return (
        (parts[0] ?? '') +
        parts
            .slice(1)
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join('')
    );
}

/** Converts a refs/common tree: string leaves converted, structure preserved. */
function convertStringTree(node: any, keyPrefix: string, ctx: MigrateContext): any {
    if (typeof node === 'string') {
        return convertText(node, keyPrefix, ctx);
    }
    if (Array.isArray(node)) {
        return node.map((item, i) => convertStringTree(item, `${keyPrefix}[${i}]`, ctx));
    }
    if (typeof node === 'object' && node !== null) {
        const out: { [key: string]: any } = {};
        for (const [key, value] of Object.entries(node)) {
            out[key] = convertStringTree(value, `${keyPrefix}.${key}`, ctx);
        }
        return out;
    }
    return node;
}

function convertData(node: any, keyPrefix: string, ctx: MigrateContext): any {
    const out: { [key: string]: any } = {};
    for (const [key, value] of Object.entries(node ?? {})) {
        const fullKey = `${keyPrefix}.${key}`;
        if (typeof value === 'string' || isStringArray(value)) {
            ctx.leafKeys.add(fullKey);
            out[key] = convertStringTree(value, fullKey, ctx);
        } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            if (ctx.options.objectType && looksStructured(value)) {
                ctx.tagged.add(fullKey);
                ctx.leafKeys.add(fullKey);
                out[key] = {
                    $type: ctx.options.objectType,
                    ...convertStringTree(value, fullKey, ctx),
                };
            } else {
                out[key] = convertData(value, fullKey, ctx);
            }
        } else {
            ctx.report.unconvertible.push({
                key: fullKey,
                reason: `Unsupported v1 value of type ${Array.isArray(value) ? 'mixed array' : typeof value}`,
            });
        }
    }
    return out;
}

function isStringArray(value: unknown): boolean {
    return (
        Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string')
    );
}

function looksStructured(value: object): boolean {
    return Object.keys(value).some(key => EMBED_KEYS.has(key));
}

/**
 * Hoists refs duplicated with identical values across ≥2 namespaces into a shared
 * `refs.<locale>.json`. Namespace-local refs override shared ones in v2, so namespaces whose
 * value differs from the hoisted one keep their local copy — semantics are preserved either
 * way, and the render-diff gate proves it.
 */
function hoistSharedRefs(
    converted: Map<string, Map<string, { data: any; refs: any }>>,
    locales: string[],
    outDir: string,
    ctx: MigrateContext
): void {
    for (const locale of locales) {
        const perNs = new Map<string, Map<string, unknown>>();
        for (const [ns, perLocale] of converted) {
            const file = perLocale.get(locale);
            if (file) {
                perNs.set(ns, flattenLeaves(file.refs));
            }
        }

        const sharedFlat = new Map<string, unknown>();
        const allPaths = new Set([...perNs.values()].flatMap(flat => [...flat.keys()]));
        for (const refPath of allPaths) {
            // Group namespaces by identical value.
            const byValue = new Map<string, { value: unknown; namespaces: string[] }>();
            for (const [ns, flat] of perNs) {
                if (flat.has(refPath)) {
                    const value = flat.get(refPath);
                    const signature = JSON.stringify(value);
                    const group = byValue.get(signature) ?? { value, namespaces: [] };
                    group.namespaces.push(ns);
                    byValue.set(signature, group);
                }
            }
            const best = [...byValue.values()].sort(
                (a, b) => b.namespaces.length - a.namespaces.length
            )[0]!;
            if (best.namespaces.length >= 2) {
                sharedFlat.set(refPath, best.value);
                for (const ns of best.namespaces) {
                    removeLeaf(converted.get(ns)!.get(locale)!.refs, refPath);
                }
                ctx.report.hoistedRefs.push({
                    path: refPath,
                    locale,
                    namespaces: best.namespaces.sort(),
                });
            }
            if (byValue.size > 1) {
                const values: { [ns: string]: unknown } = {};
                for (const group of byValue.values()) {
                    for (const ns of group.namespaces) {
                        values[ns] = group.value;
                    }
                }
                ctx.report.refConflicts.push({ path: refPath, locale, values });
            }
        }

        if (sharedFlat.size > 0) {
            writeJson(path.join(outDir, `refs.${locale}.json`), unflatten(sharedFlat));
        }
    }
}

/** Flattens string / string[] leaves to dot-path → value (values kept verbatim). */
function flattenLeaves(node: any, prefix = ''): Map<string, unknown> {
    const out = new Map<string, unknown>();
    if (node === undefined || node === null) {
        return out;
    }
    for (const [key, value] of Object.entries(node)) {
        const leafPath = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'string' || isStringArray(value)) {
            out.set(leafPath, value);
        } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            for (const [nested, nestedValue] of flattenLeaves(value, leafPath)) {
                out.set(nested, nestedValue);
            }
        }
    }
    return out;
}

function unflatten(flat: Map<string, unknown>): any {
    const out: any = {};
    for (const [flatPath, value] of [...flat].sort(([a], [b]) => a.localeCompare(b))) {
        const segments = flatPath.split('.');
        let node = out;
        for (const segment of segments.slice(0, -1)) {
            node = node[segment] ??= {};
        }
        node[segments[segments.length - 1]!] = value;
    }
    return out;
}

/** Deletes a dot-path leaf and prunes any parents left empty. */
function removeLeaf(tree: any, leafPath: string): void {
    const segments = leafPath.split('.');
    // chain[i] is the node holding segments[i].
    const chain: any[] = [tree];
    for (const segment of segments.slice(0, -1)) {
        const next = chain[chain.length - 1]?.[segment];
        if (typeof next !== 'object' || next === null) {
            return;
        }
        chain.push(next);
    }
    delete chain[chain.length - 1][segments[segments.length - 1]!];
    for (let i = chain.length - 1; i > 0; i--) {
        if (Object.keys(chain[i]).length === 0) {
            delete chain[i - 1][segments[i - 1]!];
        } else {
            break;
        }
    }
}

/** Sibling keys like `gift`/`giftPlural` are hand-rolled plural pairs — flag for collapsing. */
function detectPluralPairs(ctx: MigrateContext): void {
    for (const key of ctx.leafKeys) {
        for (const suffix of ['Plural', 'Singular']) {
            if (key.endsWith(suffix)) {
                const base = key.slice(0, -suffix.length);
                if (ctx.leafKeys.has(base)) {
                    ctx.report.suspectedPluralPairs.push({ key: base, pluralKey: key });
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Verify (render-diff)

async function verify(
    inputDir: string,
    commonFileName: string | undefined,
    namespaces: { ns: string; locales: Map<string, string> }[],
    artifact: Artifact,
    ctx: MigrateContext
): Promise<void> {
    const identityTypes = ctx.options.objectType
        ? { [ctx.options.objectType]: (value: unknown) => value }
        : {};
    const lx = new Linguini({ types: identityTypes });
    await lx.load(artifact);

    // Placeholder params for every renamed variable: {camel} renders as «ORIGINAL».
    const params: { [name: string]: string } = {};
    for (const [from, to] of ctx.renames) {
        params[to] = `«${from}»`;
    }

    const v1Common = commonFileName ? readJson(path.join(inputDir, commonFileName)) : {};

    for (const { ns, locales } of namespaces) {
        const baseFile = locales.get(artifact.manifest.baseLocale);
        for (const [locale, filePath] of locales) {
            const v1 = readJson(filePath);
            // v2 gives non-base locales per-path ref fallback to the base file; mirror it.
            let refs = v1.refs ?? {};
            if (locale !== artifact.manifest.baseLocale && baseFile) {
                refs = deepMerge(readJson(baseFile).refs ?? {}, refs);
            }
            const tables = buildV1Tables(v1Common, refs);
            verifyNode(v1.data ?? {}, ns, locale, tables, lx, params, ctx, artifact);
        }
    }
}

function verifyNode(
    node: any,
    keyPrefix: string,
    locale: string,
    tables: V1Tables,
    lx: Linguini,
    params: { [name: string]: string },
    ctx: MigrateContext,
    artifact: Artifact
): void {
    for (const [key, value] of Object.entries(node ?? {})) {
        const fullKey = `${keyPrefix}.${key}`;
        const isLeaf =
            typeof value === 'string' ||
            isStringArray(value) ||
            (typeof value === 'object' &&
                value !== null &&
                !Array.isArray(value) &&
                ctx.tagged.has(fullKey));
        if (!isLeaf) {
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                verifyNode(value, fullKey, locale, tables, lx, params, ctx, artifact);
            }
            continue;
        }
        if (artifact.catalog[locale]?.[fullKey] === undefined) {
            continue; // Dropped as unconvertible, or compile rejected it — already reported.
        }
        const expected = renderV1Value(value, tables);
        const actual = lx.format(fullKey, locale, params);
        ctx.report.verify.checked++;
        if (JSON.stringify(expected) !== JSON.stringify(actual)) {
            ctx.report.verify.mismatches.push({ key: fullKey, locale, v1: expected, v2: actual });
        }
    }
}

function deepMerge(base: any, override: any): any {
    if (
        typeof base !== 'object' ||
        base === null ||
        typeof override !== 'object' ||
        override === null ||
        Array.isArray(base) ||
        Array.isArray(override)
    ) {
        return override ?? base;
    }
    const out = { ...base };
    for (const [key, value] of Object.entries(override)) {
        out[key] = key in base ? deepMerge(base[key], value) : value;
    }
    return out;
}

function readJson(filePath: string): any {
    return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath: string, value: unknown): void {
    writeFileSync(filePath, JSON.stringify(value, null, 4) + '\n');
}
