import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
    Artifact,
    CatalogSchema,
    CompiledMessage,
    LocaleCatalog,
    MessageNode,
    MessageSchema,
    ParamType,
    StructuredNode,
} from '../artifact.js';
import { ARTIFACT_FORMAT_VERSION, MessageForm, StructuredNodeKind } from '../artifact.js';
import type { LinguiniConfig } from './config.js';
import { LintLevel, loadConfig } from './config.js';
import { DiagnosticCode, Diagnostics, Severity } from './diagnostics.js';
import { compileIcu, mergeParamTypes } from './icu.js';
import {
    expandIncludes,
    flattenStrings,
    IncludeKind,
    lintMidSentenceIncludes,
    resolveIncludes,
    UNKNOWN_TOKEN_REGEX,
} from './refs.js';
import { canonicalStringify, hashSchema } from './schema.js';

export type CompileResult = {
    diagnostics: Diagnostics;
    /** Present when compilation produced no errors. */
    artifact?: Artifact;
    schema?: CatalogSchema;
};

const LOCALE_FILE_SUFFIX = /^([A-Za-z0-9-]+)\.json$/;
const SHARED_REFS_FILE = /^refs\.([A-Za-z0-9-]+)\.json$/;
const CAMEL_CASE = /^[a-z][a-zA-Z0-9]*$/;

type CompileContext = {
    config: LinguiniConfig;
    diagnostics: Diagnostics;
    locale: string;
    file: string;
    com: Map<string, string>;
    refs: Map<string, string>;
    sharedRefs: Map<string, string>;
};

type CompiledEntry = {
    message: CompiledMessage;
    params: Map<string, ParamType>;
    typeName?: string;
};

export function compileCatalog(catalogDir: string, config?: LinguiniConfig): CompileResult {
    const diagnostics = new Diagnostics();
    try {
        config ??= loadConfig(catalogDir);
    } catch (error: any) {
        diagnostics.error(DiagnosticCode.CONFIG, error?.message ?? String(error));
        return { diagnostics };
    }

    // Common table.
    let comResolved = new Map<string, string>();
    const commonPath = path.join(catalogDir, 'common.json');
    if (existsSync(commonPath)) {
        const raw = readJson(commonPath, diagnostics);
        const flattened = flattenStrings(raw, diagnostics, 'common.json');
        comResolved = resolveIncludes(
            flattened,
            { self: IncludeKind.COM },
            diagnostics,
            'common.json'
        );
    }

    // Shared per-locale ref tables (refs.<locale>.json at the catalog root). Available to all
    // namespaces; namespace-local refs override on collision. Shared refs may reference only
    // other shared refs and COM values.
    const sharedRaw = new Map<string, Map<string, string>>();
    for (const entry of readdirSync(catalogDir, { withFileTypes: true })) {
        const match = entry.isFile() ? entry.name.match(SHARED_REFS_FILE) : null;
        if (match) {
            const raw = readJson(path.join(catalogDir, entry.name), diagnostics, entry.name);
            sharedRaw.set(match[1]!, flattenStrings(raw, diagnostics, entry.name));
        }
    }
    const sharedResolved = new Map<string, Map<string, string>>();
    const sharedFor = (locale: string): Map<string, string> => {
        let resolved = sharedResolved.get(locale);
        if (!resolved) {
            // Locale file overrides the base file per path, mirroring namespace ref fallback.
            const merged = new Map([
                ...(sharedRaw.get(config!.baseLocale) ?? []),
                ...(locale === config!.baseLocale ? [] : (sharedRaw.get(locale) ?? [])),
            ]);
            resolved = resolveIncludes(
                merged,
                { self: IncludeKind.REF, com: p => comResolved.get(p) },
                diagnostics,
                `refs.${locale}.json`
            );
            sharedResolved.set(locale, resolved);
        }
        return resolved;
    };
    // Validate every shared file, even for locales no namespace ships yet.
    for (const locale of sharedRaw.keys()) {
        sharedFor(locale);
    }

    // Namespace discovery.
    let namespaces: string[];
    if (config.namespaces === 'auto') {
        namespaces = readdirSync(catalogDir, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name)
            .filter(name => discoverLocales(catalogDir, name).length > 0)
            .sort();
    } else {
        namespaces = [...config.namespaces].sort();
    }
    if (namespaces.includes('refs')) {
        diagnostics.error(
            DiagnosticCode.RESERVED_NAMESPACE,
            '"refs" is a reserved namespace name — shared ref files are refs.<locale>.json at the catalog root'
        );
        namespaces = namespaces.filter(ns => ns !== 'refs');
    }
    if (namespaces.length === 0) {
        diagnostics.error(DiagnosticCode.NO_NAMESPACES, `No namespaces found in ${catalogDir}`);
        return { diagnostics };
    }

    const schema: CatalogSchema = {};
    const catalog: { [locale: string]: LocaleCatalog } = {};
    const allLocales = new Set<string>([config.baseLocale]);
    /** Base-locale compiled entries by key, for cross-locale validation. */
    const baseEntries = new Map<string, CompiledEntry>();

    // Pass 1: base locale defines the schema.
    for (const ns of namespaces) {
        const locales = discoverLocales(catalogDir, ns);
        for (const locale of locales) {
            allLocales.add(locale);
        }
        if (!locales.includes(config.baseLocale)) {
            diagnostics.error(
                DiagnosticCode.NS_MISSING_BASE,
                `Namespace "${ns}" has no ${config.baseLocale} (base locale) file`
            );
            continue;
        }
        compileNamespaceLocale(
            catalogDir,
            ns,
            config.baseLocale,
            comResolved,
            sharedFor(config.baseLocale),
            config,
            diagnostics,
            (key, entry) => {
                baseEntries.set(key, entry);
                const messageSchema: MessageSchema = { params: Object.fromEntries(entry.params) };
                if (entry.typeName !== undefined) {
                    messageSchema.typeName = entry.typeName;
                }
                schema[key] = messageSchema;
                (catalog[config!.baseLocale] ??= {})[key] = entry.message;
            }
        );
    }

    // Pass 2: every other locale, validated against the base schema.
    for (const ns of namespaces) {
        for (const locale of discoverLocales(catalogDir, ns)) {
            if (locale === config.baseLocale) {
                continue;
            }
            compileNamespaceLocale(
                catalogDir,
                ns,
                locale,
                comResolved,
                sharedFor(locale),
                config,
                diagnostics,
                (key, entry) => {
                    const file = `${ns}/${ns}.${locale}.json`;
                    const base = baseEntries.get(key);
                    if (!base) {
                        diagnostics.error(
                            DiagnosticCode.EXTRA_KEY,
                            `Key exists in ${locale} but not in base locale ${config!.baseLocale}`,
                            { file, key }
                        );
                        return;
                    }
                    if (base.typeName !== entry.typeName) {
                        diagnostics.error(
                            DiagnosticCode.FORM_MISMATCH,
                            `Message form differs from base locale (base: ${describeForm(base)}, ${locale}: ${describeForm(entry)})`,
                            { file, key }
                        );
                        return;
                    }
                    for (const [name, type] of entry.params) {
                        const baseType = base.params.get(name);
                        if (!baseType) {
                            diagnostics.error(
                                DiagnosticCode.UNKNOWN_PARAM,
                                `Parameter "${name}" does not exist in the base locale message`,
                                { file, key }
                            );
                            return;
                        }
                        if (!mergeParamTypes(baseType, type)) {
                            diagnostics.error(
                                DiagnosticCode.PARAM_TYPE_MISMATCH,
                                `Parameter "${name}" is ${type.type} here but ${baseType.type} in the base locale`,
                                { file, key }
                            );
                            return;
                        }
                    }
                    (catalog[locale] ??= {})[key] = entry.message;
                }
            );
        }
    }

    // Missing keys per locale.
    for (const locale of allLocales) {
        if (locale === config.baseLocale) {
            continue;
        }
        const localeCatalog = catalog[locale] ?? {};
        const missing = Object.keys(schema).filter(key => localeCatalog[key] === undefined);
        for (const key of missing) {
            diagnostics.report(
                config.missingKeys === LintLevel.ERROR ? Severity.ERROR : Severity.WARNING,
                DiagnosticCode.MISSING_KEY,
                `Missing in locale ${locale} (falls back to ${config.baseLocale})`,
                { key }
            );
        }
        catalog[locale] = localeCatalog;
    }

    if (diagnostics.hasErrors) {
        return { diagnostics };
    }

    const artifact: Artifact = {
        manifest: {
            formatVersion: ARTIFACT_FORMAT_VERSION,
            schemaHash: hashSchema(schema),
            baseLocale: config.baseLocale,
            locales: [...allLocales].sort(),
            namespaces,
            createdAt: new Date().toISOString(),
        },
        catalog,
        common: Object.fromEntries(comResolved),
    };
    return { diagnostics, artifact, schema };
}

export function writeArtifact(artifact: Artifact, outDir: string): void {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(artifact.manifest, null, 2));
    writeFileSync(path.join(outDir, 'catalog.json'), JSON.stringify(artifact.catalog));
    writeFileSync(path.join(outDir, 'common.json'), JSON.stringify(artifact.common, null, 2));
}

function discoverLocales(catalogDir: string, ns: string): string[] {
    const dir = path.join(catalogDir, ns);
    const prefix = `${ns}.`;
    try {
        return readdirSync(dir)
            .filter(name => name.startsWith(prefix))
            .map(name => name.slice(prefix.length))
            .flatMap(rest => {
                const match = rest.match(LOCALE_FILE_SUFFIX);
                return match ? [match[1]!] : [];
            })
            .sort();
    } catch {
        return [];
    }
}

function compileNamespaceLocale(
    catalogDir: string,
    ns: string,
    locale: string,
    com: Map<string, string>,
    sharedRefs: Map<string, string>,
    config: LinguiniConfig,
    diagnostics: Diagnostics,
    sink: (key: string, entry: CompiledEntry) => void
): void {
    const file = `${ns}/${ns}.${locale}.json`;
    const raw = readJson(path.join(catalogDir, ns, `${ns}.${locale}.json`), diagnostics, file);
    if (raw === undefined) {
        return;
    }

    // Ref table: this locale's refs override the base locale's (per-path fallback), and
    // anything not found locally falls back to the shared table.
    let refsRaw = flattenStrings(raw.refs, diagnostics, file);
    if (locale !== config.baseLocale) {
        const baseFile = `${ns}/${ns}.${config.baseLocale}.json`;
        const baseRaw = readJson(
            path.join(catalogDir, ns, `${ns}.${config.baseLocale}.json`),
            diagnostics,
            baseFile
        );
        if (baseRaw !== undefined) {
            const baseRefs = flattenStrings(baseRaw.refs, new Diagnostics(), baseFile);
            refsRaw = new Map([...baseRefs, ...refsRaw]);
        }
    }
    const refs = resolveIncludes(
        refsRaw,
        { self: IncludeKind.REF, com: p => com.get(p), fallback: p => sharedRefs.get(p) },
        diagnostics,
        file
    );

    const ctx: CompileContext = { config, diagnostics, locale, file, com, refs, sharedRefs };
    walkData(raw.data, ns, ctx, sink);
}

function walkData(
    data: any,
    prefix: string,
    ctx: CompileContext,
    sink: (key: string, entry: CompiledEntry) => void
): void {
    if (data === undefined || data === null) {
        return;
    }
    for (const [key, value] of Object.entries(data)) {
        if (key.includes('.')) {
            ctx.diagnostics.error(DiagnosticCode.DOTTED_KEY, `Key "${key}" must not contain "."`, {
                file: ctx.file,
            });
            continue;
        }
        const fullKey = `${prefix}.${key}`;
        if (isBranch(value)) {
            walkData(value, fullKey, ctx, sink);
            continue;
        }
        const entry = compileValue(value, fullKey, ctx);
        if (entry) {
            sink(fullKey, entry);
        }
    }
}

function isBranch(value: unknown): boolean {
    return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        !('$variants' in value) &&
        !('$type' in value)
    );
}

function compileValue(value: unknown, key: string, ctx: CompileContext): CompiledEntry | undefined {
    // Plain message: string, or string[] joined as lines.
    const text = asText(value);
    if (text !== undefined) {
        const compiled = compileTextLeaf(text, key, ctx);
        if (!compiled) {
            return undefined;
        }
        return {
            message: { form: MessageForm.MESSAGE, nodes: compiled.nodes },
            params: compiled.params,
        };
    }

    if (typeof value === 'object' && value !== null && '$variants' in value) {
        return compileVariants((value as any).$variants, key, ctx);
    }
    if (typeof value === 'object' && value !== null && '$type' in value) {
        return compileStructured(value, key, ctx);
    }

    ctx.diagnostics.error(
        DiagnosticCode.INVALID_VALUE,
        'Message values must be a string, a string array, {"$variants": [...]}, or {"$type": "...", ...}',
        { file: ctx.file, key }
    );
    return undefined;
}

function compileVariants(
    variants: unknown,
    key: string,
    ctx: CompileContext
): CompiledEntry | undefined {
    if (!Array.isArray(variants) || variants.length === 0) {
        ctx.diagnostics.error(
            DiagnosticCode.INVALID_VARIANTS,
            '"$variants" must be a non-empty array',
            { file: ctx.file, key }
        );
        return undefined;
    }
    const nodes: MessageNode[][] = [];
    let params: Map<string, ParamType> | undefined;
    let signature: string | undefined;
    for (const variant of variants) {
        const text = asText(variant);
        if (text === undefined) {
            ctx.diagnostics.error(
                DiagnosticCode.INVALID_VARIANTS,
                'Each variant must be a string or string array',
                { file: ctx.file, key }
            );
            return undefined;
        }
        const compiled = compileTextLeaf(text, key, ctx);
        if (!compiled) {
            return undefined;
        }
        const compiledSignature = canonicalStringify(Object.fromEntries(compiled.params));
        if (signature === undefined) {
            signature = compiledSignature;
            params = compiled.params;
        } else if (compiledSignature !== signature) {
            ctx.diagnostics.error(
                DiagnosticCode.VARIANT_PARAMS,
                'All variants of a message must use the same parameters',
                { file: ctx.file, key }
            );
            return undefined;
        }
        nodes.push(compiled.nodes);
    }
    return { message: { form: MessageForm.VARIANTS, variants: nodes }, params: params! };
}

function compileStructured(
    value: object,
    key: string,
    ctx: CompileContext
): CompiledEntry | undefined {
    const typeName = (value as any).$type;
    if (typeof typeName !== 'string' || typeName.length === 0) {
        ctx.diagnostics.error(DiagnosticCode.INVALID_TYPE, '"$type" must be a non-empty string', {
            file: ctx.file,
            key,
        });
        return undefined;
    }
    const params = new Map<string, ParamType>();
    const entries: { [k: string]: StructuredNode } = {};
    for (const [k, v] of Object.entries(value)) {
        if (k === '$type') {
            continue;
        }
        const node = buildStructuredNode(v, key, ctx, params);
        if (!node) {
            return undefined;
        }
        entries[k] = node;
    }
    return {
        message: {
            form: MessageForm.STRUCTURED,
            typeName,
            value: { kind: StructuredNodeKind.OBJECT, entries },
        },
        params,
        typeName,
    };
}

function buildStructuredNode(
    value: unknown,
    key: string,
    ctx: CompileContext,
    params: Map<string, ParamType>
): StructuredNode | undefined {
    const text = asText(value);
    if (text !== undefined) {
        const compiled = compileTextLeaf(text, key, ctx);
        if (!compiled) {
            return undefined;
        }
        if (!mergeParamsInto(params, compiled.params, key, ctx)) {
            return undefined;
        }
        return { kind: StructuredNodeKind.MESSAGE, nodes: compiled.nodes };
    }
    if (typeof value === 'boolean' || typeof value === 'number' || value === null) {
        return { kind: StructuredNodeKind.LITERAL, value };
    }
    if (Array.isArray(value)) {
        const items: StructuredNode[] = [];
        for (const item of value) {
            const node = buildStructuredNode(item, key, ctx, params);
            if (!node) {
                return undefined;
            }
            items.push(node);
        }
        return { kind: StructuredNodeKind.ARRAY, items };
    }
    if (typeof value === 'object') {
        const entries: { [k: string]: StructuredNode } = {};
        for (const [k, v] of Object.entries(value)) {
            const node = buildStructuredNode(v, key, ctx, params);
            if (!node) {
                return undefined;
            }
            entries[k] = node;
        }
        return { kind: StructuredNodeKind.OBJECT, entries };
    }
    ctx.diagnostics.error(
        DiagnosticCode.INVALID_VALUE,
        `Unsupported value inside "$type" message`,
        { file: ctx.file, key }
    );
    return undefined;
}

function mergeParamsInto(
    target: Map<string, ParamType>,
    source: Map<string, ParamType>,
    key: string,
    ctx: CompileContext
): boolean {
    for (const [name, type] of source) {
        const existing = target.get(name);
        if (!existing) {
            target.set(name, type);
            continue;
        }
        const merged = mergeParamTypes(existing, type);
        if (!merged) {
            ctx.diagnostics.error(
                DiagnosticCode.PARAM_CONFLICT,
                `Parameter "${name}" is used as both ${existing.type} and ${type.type}`,
                { file: ctx.file, key }
            );
            return false;
        }
        target.set(name, merged);
    }
    return true;
}

/** String → itself; array of strings → lines joined with `\n`; anything else → undefined. */
function asText(value: unknown): string | undefined {
    if (typeof value === 'string') {
        return value;
    }
    if (Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string')) {
        return value.join('\n');
    }
    return undefined;
}

function compileTextLeaf(
    text: string,
    key: string,
    ctx: CompileContext
): { nodes: MessageNode[]; params: Map<string, ParamType> } | undefined {
    const where = { file: ctx.file, key };

    if (text.trim().length === 0 && ctx.config.lint.emptyMessage !== LintLevel.OFF) {
        ctx.diagnostics.report(
            ctx.config.lint.emptyMessage === LintLevel.ERROR ? Severity.ERROR : Severity.WARNING,
            DiagnosticCode.EMPTY_MESSAGE,
            'Empty message value',
            where
        );
    }

    lintMidSentenceIncludes(
        text,
        ctx.config.lint.midSentenceRef,
        ctx.config.lint.midSentenceRefAllow,
        ctx.diagnostics,
        where
    );

    const expanded = expandIncludes(text, (kind, includePath) => {
        const value =
            kind === IncludeKind.REF
                ? (ctx.refs.get(includePath) ?? ctx.sharedRefs.get(includePath))
                : ctx.com.get(includePath);
        if (value === undefined) {
            ctx.diagnostics.error(
                kind === IncludeKind.REF ? DiagnosticCode.UNKNOWN_REF : DiagnosticCode.UNKNOWN_COM,
                `Unknown ${kind === IncludeKind.REF ? 'ref' : 'common'} path "${includePath}"`,
                where
            );
            return '';
        }
        return value;
    });

    const leftover = expanded.match(UNKNOWN_TOKEN_REGEX);
    if (leftover) {
        ctx.diagnostics.error(
            DiagnosticCode.UNKNOWN_TOKEN,
            `Unknown token ${leftover[0]} — v1-style {{VARIABLE}} tokens are ICU arguments in v2: use {variable}`,
            where
        );
        return undefined;
    }

    const compiled = compileIcu(expanded, ctx.locale, ctx.diagnostics, where);
    if (!compiled) {
        return undefined;
    }

    if (ctx.config.lint.argCase !== LintLevel.OFF) {
        for (const name of compiled.params.keys()) {
            if (!CAMEL_CASE.test(name)) {
                ctx.diagnostics.report(
                    ctx.config.lint.argCase === LintLevel.ERROR ? Severity.ERROR : Severity.WARNING,
                    DiagnosticCode.ARG_CASE,
                    `Parameter "${name}" should be camelCase`,
                    where
                );
            }
        }
    }
    return compiled;
}

function describeForm(entry: CompiledEntry): string {
    return entry.typeName ? `$type "${entry.typeName}"` : entry.message.form;
}

function readJson(filePath: string, diagnostics: Diagnostics, file?: string): any {
    try {
        return JSON.parse(readFileSync(filePath, 'utf8'));
    } catch (error: any) {
        diagnostics.error(
            DiagnosticCode.READ_FILE,
            `Failed to read ${filePath}: ${error?.message}`,
            {
                file,
            }
        );
        return undefined;
    }
}
