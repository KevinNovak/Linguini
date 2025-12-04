/**
 * Utility type to get all valid dot-notation paths from a nested object type.
 * This enables type-safe key lookups with autocomplete.
 * Uses a depth counter to prevent infinite recursion.
 */
export type PathsOf<T, Prefix extends string = '', Depth extends number[] = []> =
    Depth['length'] extends 8
        ? never // Prevent infinite recursion at depth 8
        : T extends object
          ? T extends any[]
              ? never // Arrays are leaf nodes, don't recurse into them
              : {
                    [K in keyof T & string]: T[K] extends object
                        ? T[K] extends any[]
                            ? `${Prefix}${K}` // Array property is a leaf
                            : `${Prefix}${K}` | PathsOf<T[K], `${Prefix}${K}.`, [...Depth, 0]>
                        : `${Prefix}${K}`;
                }[keyof T & string]
          : never;

/**
 * Utility type to get the value type at a given dot-notation path.
 */
export type ValueAt<T, Path extends string> = Path extends `${infer Key}.${infer Rest}`
    ? Key extends keyof T
        ? ValueAt<T[Key], Rest>
        : never
    : Path extends keyof T
      ? T[Path]
      : never;

/**
 * Configuration for how Linguini should detect and load files.
 */
export type FolderStructure = 'locale-folder' | 'locale-in-filename' | 'auto';

/**
 * Handler for missing translation keys.
 * - 'throw': Throw an error (default)
 * - 'fallback': Use fallbackLocale if available
 * - 'key': Return the key itself as the value
 * - Function: Custom handler that receives key and locale, returns a string
 */
export type MissingKeyHandler =
    | 'throw'
    | 'fallback'
    | 'key'
    | ((key: string, locale: string) => string);

/**
 * Pluralization rules for different counts.
 */
export type PluralRules = {
    zero?: string;
    one?: string;
    two?: string;
    few?: string;
    many?: string;
    other: string;
};

/**
 * Result of completeness validation.
 */
export type ValidationIssue = {
    key: string;
    missingIn: string[];
};

/**
 * Options for creating a new Linguini instance.
 */
export type LinguiniOptions = {
    /**
     * Number of levels variables should be replaced.
     * @defaultValue `10`
     */
    replacementLevels: number;

    /**
     * How to detect locale from file/folder structure.
     * - 'locale-folder': Locales are folder names (e.g., `lang/en-US/prompts.json`)
     * - 'locale-in-filename': Locales are in filenames (e.g., `lang/prompts.en-US.json`)
     * - 'auto': Auto-detect based on directory structure
     * @defaultValue `'auto'`
     */
    folderStructure: FolderStructure;

    /**
     * Path to a common file (or folder) for language-agnostic constants.
     * If not provided, looks for `_common.json` in the root path.
     */
    commonPath?: string;

    /**
     * File pattern for language files when using 'locale-in-filename' structure.
     * Use `{locale}` as placeholder for the locale code.
     * @defaultValue `'{name}.{locale}.json'`
     */
    filePattern?: string;

    /**
     * Name of refs file within each locale folder (for 'locale-folder' structure).
     * @defaultValue `'_refs.json'`
     */
    refsFileName?: string;

    /**
     * Fallback locale to use when a key is missing in the requested locale.
     * @example 'en-US'
     */
    fallbackLocale?: string;

    /**
     * How to handle missing translation keys.
     * - 'throw': Throw an error (default)
     * - 'fallback': Use fallbackLocale if available, then throw
     * - 'key': Return the key itself as the value
     * - Function: Custom handler
     * @defaultValue `'throw'`
     */
    onMissingKey?: MissingKeyHandler;
};

/**
 * Internal structure for a loaded language file.
 */
export type LoadedLangFile = {
    /** The namespace derived from the file path */
    namespace: string;
    /** The locale code */
    locale: string;
    /** The translation data */
    data: Record<string, any>;
    /** Reference strings for this file */
    refs: Record<string, any>;
};

/**
 * Internal structure for storing all loaded translations.
 */
export type TranslationStore = {
    /** Common values (language-agnostic) */
    common: Record<string, string>;
    /** Translations per locale */
    locales: {
        [locale: string]: {
            /** Flattened translation data */
            data: Record<string, any>;
            /** Flattened refs */
            refs: Record<string, string>;
        };
    };
};

/**
 * Variables that can be passed to translation functions.
 */
export type Variables = Record<string, string | number>;

/**
 * Type mapper function to convert raw JSON to a typed value.
 */
export type TypeMapper<T> = (jsonValue: any) => T;

/**
 * Legacy types for backward compatibility
 */
export type LangFile = {
    data: CategoryItems<any>;
    refs: CategoryItems<string | string[]>;
};

export type CommonFile = CategoryItems<string | string[]>;

export interface CategoryItems<T> {
    [categoryName: string]: { [itemName: string]: T };
}

