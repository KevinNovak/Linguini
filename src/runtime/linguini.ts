import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Artifact, CompiledMessage, StructuredNode } from '../artifact.js';
import { ARTIFACT_FORMAT_VERSION, MessageForm, StructuredNodeKind } from '../artifact.js';
import { LinguiniError } from '../errors.js';
import type { MessageParams } from './evaluate.js';
import { evaluateMessage } from './evaluate.js';

export enum MissingKeyPolicy {
    /** A key missing from the whole fallback chain throws (default). */
    THROW = 'THROW',
    /** Return the literal key as a last resort. */
    FALLBACK = 'FALLBACK',
}

export type MessageTypeContext = {
    locale: string;
    key: string;
    /** Look up a resolved common value (`common.json` dot-path). Throws on unknown path. */
    com: (comPath: string) => string;
};

/**
 * Builds a rich object from a structured (`$type`) message value. `value` is the authored JSON
 * shape with every string leaf already evaluated for the target locale and parameters.
 */
export type MessageTypeHandler<T = unknown> = (value: unknown, ctx: MessageTypeContext) => T;

export type LinguiniOptions = {
    /**
     * The schemaHash the consuming code was generated against. When set, artifacts with a
     * different hash are rejected — the guard that keeps hot-loaded content compatible with
     * compiled bindings.
     */
    schemaHash?: string;
    /**
     * Locales appended to every lookup's fallback chain (after BCP 47 truncation of the
     * requested locale). Defaults to `[baseLocale]` of the loaded artifact.
     */
    fallbackLocales?: string[];
    /**
     * What to do when a key is absent from the entire fallback chain. Either way `onMissing`
     * fires whenever the requested locale itself lacked the key.
     */
    missingKeys?: MissingKeyPolicy;
    /** Telemetry hook: the requested locale did not contain the key (a fallback or miss). */
    onMissing?: (key: string, locale: string) => void;
    /** Structured message type handlers, by `$type` name. */
    types?: { [typeName: string]: MessageTypeHandler<any> };
    /** RNG for `$variants` selection; inject a seeded generator in tests. */
    random?: () => number;
    /** A reload (`load()` after initial load) swapped in a new artifact. */
    onReloaded?: (artifact: Artifact) => void;
    /** A reload was rejected; the previous artifact keeps serving. */
    onRejected?: (error: Error) => void;
};

export type ArtifactSource = string | Artifact;

export class Linguini {
    private options: LinguiniOptions;
    private artifact?: Artifact;

    constructor(options: LinguiniOptions = {}) {
        this.options = options;
    }

    /**
     * Loads and validates an artifact, then atomically swaps it in. `source` is either a
     * directory containing `manifest.json` + `catalog.json` + `common.json`, or a preloaded
     * artifact object. On failure the previous artifact (if any) keeps serving and the error
     * is thrown; reload failures additionally invoke `onRejected`.
     */
    public async load(source: ArtifactSource): Promise<void> {
        const isReload = this.artifact !== undefined;
        try {
            const artifact = typeof source === 'string' ? await readArtifact(source) : source;
            this.validate(artifact);
            this.artifact = artifact;
            if (isReload) {
                this.options.onReloaded?.(artifact);
            }
        } catch (error) {
            if (isReload) {
                this.options.onRejected?.(error as Error);
            }
            throw error;
        }
    }

    public get manifest(): Artifact['manifest'] {
        return this.loaded().manifest;
    }

    /** Locales present in the loaded artifact. */
    public locales(): string[] {
        return [...this.loaded().manifest.locales];
    }

    /**
     * Formats a message. Returns a string for plain and variant messages, or the registered
     * type handler's output for structured messages. Generated bindings narrow the return type.
     */
    public format(key: string, locale: string, params: MessageParams = {}): unknown {
        const artifact = this.loaded();

        for (const candidate of this.fallbackChain(locale)) {
            const message = artifact.catalog[candidate]?.[key];
            if (message !== undefined) {
                if (candidate !== locale) {
                    this.options.onMissing?.(key, locale);
                }
                return this.evaluate(message, candidate, key, params);
            }
        }

        this.options.onMissing?.(key, locale);
        if (this.options.missingKeys === MissingKeyPolicy.FALLBACK) {
            return key;
        }
        throw new LinguiniError(`Missing message "${key}" for locale "${locale}"`);
    }

    /** Formats `key` in every loaded locale that contains it (no fallback). */
    public formatAll(key: string, params: MessageParams = {}): { [locale: string]: unknown } {
        const artifact = this.loaded();
        const out: { [locale: string]: unknown } = {};
        for (const locale of artifact.manifest.locales) {
            const message = artifact.catalog[locale]?.[key];
            if (message !== undefined) {
                out[locale] = this.evaluate(message, locale, key, params);
            }
        }
        return out;
    }

    /** Looks up a resolved common value. Throws on unknown path. */
    public com(comPath: string): string {
        const value = this.loaded().common[comPath];
        if (value === undefined) {
            throw new LinguiniError(`Unknown common path: ${comPath}`);
        }
        return value;
    }

    private evaluate(
        message: CompiledMessage,
        locale: string,
        key: string,
        params: MessageParams
    ): unknown {
        switch (message.form) {
            case MessageForm.MESSAGE: {
                return evaluateMessage(message.nodes, locale, key, params);
            }
            case MessageForm.VARIANTS: {
                const random = this.options.random ?? Math.random;
                const index = Math.min(
                    Math.floor(random() * message.variants.length),
                    message.variants.length - 1
                );
                const nodes = message.variants[index]!;
                return evaluateMessage(nodes, locale, key, params);
            }
            case MessageForm.STRUCTURED: {
                const handler = this.options.types?.[message.typeName];
                if (!handler) {
                    throw new LinguiniError(
                        `No handler registered for message type "${message.typeName}" (message "${key}")`
                    );
                }
                const built = this.buildStructured(message.value, locale, key, params);
                return handler(built, { locale, key, com: p => this.com(p) });
            }
        }
    }

    private buildStructured(
        node: StructuredNode,
        locale: string,
        key: string,
        params: MessageParams
    ): unknown {
        switch (node.kind) {
            case StructuredNodeKind.MESSAGE: {
                return evaluateMessage(node.nodes, locale, key, params);
            }
            case StructuredNodeKind.LITERAL: {
                return node.value;
            }
            case StructuredNodeKind.ARRAY: {
                return node.items.map(item => this.buildStructured(item, locale, key, params));
            }
            case StructuredNodeKind.OBJECT: {
                const out: { [k: string]: unknown } = {};
                for (const [k, v] of Object.entries(node.entries)) {
                    out[k] = this.buildStructured(v, locale, key, params);
                }
                return out;
            }
        }
    }

    private fallbackChain(locale: string): string[] {
        const chain = [locale];
        // BCP 47 truncation: pt-BR → pt.
        const parts = locale.split('-');
        while (parts.length > 1) {
            parts.pop();
            chain.push(parts.join('-'));
        }
        const fallbacks = this.options.fallbackLocales ?? [this.loaded().manifest.baseLocale];
        for (const fallback of fallbacks) {
            if (!chain.includes(fallback)) {
                chain.push(fallback);
            }
        }
        return chain;
    }

    private loaded(): Artifact {
        if (!this.artifact) {
            throw new LinguiniError('No catalog artifact loaded — call load() first');
        }
        return this.artifact;
    }

    private validate(artifact: Artifact): void {
        const { manifest, catalog } = artifact;
        if (manifest?.formatVersion !== ARTIFACT_FORMAT_VERSION) {
            throw new LinguiniError(
                `Unsupported artifact format version: ${manifest?.formatVersion} (expected ${ARTIFACT_FORMAT_VERSION})`
            );
        }
        if (this.options.schemaHash && manifest.schemaHash !== this.options.schemaHash) {
            throw new LinguiniError(
                `Artifact schemaHash ${manifest.schemaHash} does not match expected ${this.options.schemaHash} — ` +
                    'the catalog was compiled against a different message schema than this code'
            );
        }
        if (!manifest.locales.includes(manifest.baseLocale)) {
            throw new LinguiniError(
                `Base locale "${manifest.baseLocale}" missing from manifest locales`
            );
        }
        for (const locale of manifest.locales) {
            if (catalog[locale] === undefined) {
                throw new LinguiniError(
                    `Locale "${locale}" listed in manifest but missing from catalog`
                );
            }
        }
    }
}

async function readArtifact(dir: string): Promise<Artifact> {
    const [manifest, catalog, common] = await Promise.all([
        readJson(path.join(dir, 'manifest.json')),
        readJson(path.join(dir, 'catalog.json')),
        readJson(path.join(dir, 'common.json')),
    ]);
    return { manifest, catalog, common } as Artifact;
}

async function readJson(filePath: string): Promise<any> {
    const contents = await readFile(filePath, 'utf8');
    return JSON.parse(contents);
}
