import { readFileSync } from 'node:fs';
import path from 'node:path';
import { LinguiniError } from '../errors.js';

/**
 * Lint levels use lowercase values because they are user-authored tokens in
 * `linguini.config.json` (`"midSentenceRef": "warn"`), not internal discriminants.
 */
export enum LintLevel {
    OFF = 'off',
    WARN = 'warn',
    ERROR = 'error',
}

export type LinguiniConfig = {
    /** The locale whose files define the catalog schema. */
    baseLocale: string;
    /** `'auto'` discovers namespace subdirectories; or an explicit list. */
    namespaces: 'auto' | string[];
    /** Artifact output directory, relative to the catalog directory. */
    out: string;
    bindings?: {
        /** Generated bindings file path, relative to the catalog directory. */
        out: string;
        /** Module specifier the bindings import the runtime from. */
        runtimeImport?: string;
        /** `$type` name → `"module-specifier#ExportedType"` for binding return types. */
        types?: { [typeName: string]: string };
    };
    lint: {
        /** A ref/com token with non-whitespace directly on both sides. */
        midSentenceRef: LintLevel;
        /**
         * Ref/com paths exempt from the midSentenceRef lint — adjudicated-benign splices
         * (markdown link URLs, noun tables). An entry ending in `.` matches the whole family
         * (`"links."`); otherwise it matches the exact path.
         */
        midSentenceRefAllow: string[];
        /** Message parameter names should be camelCase. */
        argCase: LintLevel;
        /** Empty message values. */
        emptyMessage: LintLevel;
    };
    /** Severity of keys present in the base locale but missing from another locale. */
    missingKeys: LintLevel.WARN | LintLevel.ERROR;
};

export const CONFIG_FILE_NAME = 'linguini.config.json';

const DEFAULTS: Omit<LinguiniConfig, 'baseLocale'> = {
    namespaces: 'auto',
    out: 'dist',
    lint: {
        midSentenceRef: LintLevel.WARN,
        midSentenceRefAllow: [],
        argCase: LintLevel.WARN,
        emptyMessage: LintLevel.WARN,
    },
    missingKeys: LintLevel.WARN,
};

export function loadConfig(catalogDir: string): LinguiniConfig {
    const configPath = path.join(catalogDir, CONFIG_FILE_NAME);
    let raw: any;
    try {
        raw = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch (error: any) {
        if (error?.code === 'ENOENT') {
            throw new LinguiniError(`No ${CONFIG_FILE_NAME} found in ${catalogDir}`);
        }
        throw new LinguiniError(`Failed to read ${configPath}: ${error?.message}`);
    }
    return resolveConfig(raw, configPath);
}

export function resolveConfig(raw: any, source = 'config'): LinguiniConfig {
    if (typeof raw?.baseLocale !== 'string' || raw.baseLocale.length === 0) {
        throw new LinguiniError(`${source}: "baseLocale" is required`);
    }
    const lint = { ...DEFAULTS.lint, ...raw.lint };
    for (const [rule, value] of Object.entries(lint)) {
        if (rule === 'midSentenceRefAllow') {
            if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
                throw new LinguiniError(
                    `${source}: lint.midSentenceRefAllow must be a string array`
                );
            }
            continue;
        }
        if (!Object.values(LintLevel).includes(value as LintLevel)) {
            throw new LinguiniError(`${source}: lint.${rule} must be one of: off, warn, error`);
        }
    }
    const missingKeys = raw.missingKeys ?? DEFAULTS.missingKeys;
    if (missingKeys !== LintLevel.WARN && missingKeys !== LintLevel.ERROR) {
        throw new LinguiniError(`${source}: missingKeys must be "warn" or "error"`);
    }
    return {
        baseLocale: raw.baseLocale,
        namespaces: raw.namespaces ?? DEFAULTS.namespaces,
        out: raw.out ?? DEFAULTS.out,
        bindings: raw.bindings,
        lint,
        missingKeys,
    };
}
