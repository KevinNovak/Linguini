/**
 * The compiled message AST and catalog artifact format.
 *
 * These types are the contract between the compiler and the runtime: the compiler emits them
 * into `catalog.json` / `manifest.json`, and the runtime evaluates them with zero dependencies.
 * Everything here must stay JSON-serializable — enum values are the wire format.
 */

export const ARTIFACT_FORMAT_VERSION = 1;

export enum MessageNodeKind {
    TEXT = 'TEXT',
    ARG = 'ARG',
    NUMBER = 'NUMBER',
    DATE = 'DATE',
    TIME = 'TIME',
    LIST = 'LIST',
    SELECT = 'SELECT',
    PLURAL = 'PLURAL',
    POUND = 'POUND',
}

/** A single node of a compiled ICU message. */
export type MessageNode =
    | { kind: MessageNodeKind.TEXT; value: string }
    | { kind: MessageNodeKind.ARG; name: string }
    | { kind: MessageNodeKind.NUMBER; name: string; style?: string }
    | { kind: MessageNodeKind.DATE; name: string; style?: string }
    | { kind: MessageNodeKind.TIME; name: string; style?: string }
    | { kind: MessageNodeKind.LIST; name: string }
    | { kind: MessageNodeKind.SELECT; name: string; branches: { [branch: string]: MessageNode[] } }
    | {
          kind: MessageNodeKind.PLURAL;
          name: string;
          ordinal: boolean;
          offset: number;
          branches: { [branch: string]: MessageNode[] };
      }
    /** `#` inside a plural branch: the plural operand (minus offset), number-formatted. */
    | { kind: MessageNodeKind.POUND };

export enum StructuredNodeKind {
    MESSAGE = 'MESSAGE',
    LITERAL = 'LITERAL',
    ARRAY = 'ARRAY',
    OBJECT = 'OBJECT',
}

/**
 * A node of a structured (`$type`) message value. String leaves are compiled messages; other
 * JSON leaves pass through untouched so type handlers receive the authored shape.
 */
export type StructuredNode =
    | { kind: StructuredNodeKind.MESSAGE; nodes: MessageNode[] }
    | { kind: StructuredNodeKind.LITERAL; value: boolean | number | null }
    | { kind: StructuredNodeKind.ARRAY; items: StructuredNode[] }
    | { kind: StructuredNodeKind.OBJECT; entries: { [key: string]: StructuredNode } };

export enum MessageForm {
    MESSAGE = 'MESSAGE',
    VARIANTS = 'VARIANTS',
    STRUCTURED = 'STRUCTURED',
}

export type CompiledMessage =
    | { form: MessageForm.MESSAGE; nodes: MessageNode[] }
    | { form: MessageForm.VARIANTS; variants: MessageNode[][] }
    | { form: MessageForm.STRUCTURED; typeName: string; value: StructuredNode };

export enum ParamKind {
    STRING = 'STRING',
    NUMBER = 'NUMBER',
    DATETIME = 'DATETIME',
    LIST = 'LIST',
    SELECT = 'SELECT',
}

/** Inferred type of one message parameter. */
export type ParamType =
    | { type: ParamKind.STRING }
    | { type: ParamKind.NUMBER }
    | { type: ParamKind.DATETIME }
    | { type: ParamKind.LIST }
    | { type: ParamKind.SELECT; branches: string[] };

export type MessageSchema = {
    params: { [name: string]: ParamType };
    /** Present for structured messages: the registered `$type` name. */
    typeName?: string;
};

/** Fully-qualified key (`namespace.path.to.key`) → its shape. Defined by the base locale. */
export type CatalogSchema = { [key: string]: MessageSchema };

export type ArtifactManifest = {
    formatVersion: number;
    /** Stable hash of the CatalogSchema — the code/content compatibility contract. */
    schemaHash: string;
    /**
     * Stable hash of the compiled catalog + common content. Two artifacts with equal
     * contentHash render identically; sync tooling uses it as the artifact's version
     * identity (dedupe, versioned storage paths, "what is live" logging).
     */
    contentHash: string;
    /**
     * Per-key hash of each message's schema (params + typeName) — the granular half of
     * the code/content contract. Subset-validating consumers (design §14) check only the
     * keys they render against these, so a schema change to keys a process never uses
     * hot-swaps straight past it.
     */
    keySchemaHashes: { [key: string]: string };
    baseLocale: string;
    locales: string[];
    namespaces: string[];
    createdAt?: string;
};

export type LocaleCatalog = { [key: string]: CompiledMessage };

export type Artifact = {
    manifest: ArtifactManifest;
    /** Per locale: fully-qualified key → compiled message. */
    catalog: { [locale: string]: LocaleCatalog };
    /** Flattened common values (dot-path → resolved string), available to type handlers via `ctx.com`. */
    common: { [path: string]: string };
};
