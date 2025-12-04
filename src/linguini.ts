import path from 'path';

import { FileLoader } from './loaders';
import { LinguiniError } from './models/error-models';
import { LinguiniOptions, PathsOf, TranslationStore, TypeMapper, ValueAt, Variables } from './models/types';
import { DataUtils, FileUtils, RegexUtils } from './utils/';

// Re-export for convenience
export type { LinguiniOptions, Variables };

/**
 * Linguini - A type-safe, flexible JSON-based translation file manager.
 *
 * @typeParam T - The translation schema type for type-safe key access.
 *                Generate this type using `npx linguini generate`.
 *
 * @example
 * ```typescript
 * // With generated types (recommended)
 * import { Translations } from './linguini.generated';
 *
 * const linguini = new Linguini<Translations>('./lang');
 * const greeting = linguini.t('prompts.greeting', 'en-US'); // Type-safe!
 *
 * // Without types (still works, but no autocomplete)
 * const linguini = new Linguini('./lang');
 * const greeting = linguini.t('prompts.greeting', 'en-US');
 * ```
 */
export class Linguini<T extends Record<string, any> = Record<string, any>> {
    private options: Required<Pick<LinguiniOptions, 'replacementLevels' | 'folderStructure'>> &
        Partial<LinguiniOptions>;
    private store: TranslationStore;

    // Legacy storage for backward compatibility
    private comData: Record<string, string> = {};
    private langDatas: {
        [langCode: string]: {
            data: Record<string, any>;
            refs: Record<string, string>;
        };
    } = {};

    /**
     * Creates a new Linguini instance.
     *
     * @param rootPath - The root directory containing language files.
     * @param options - Configuration options.
     */
    constructor(rootPath: string, options?: Partial<LinguiniOptions>);

    /**
     * @deprecated Use `new Linguini(rootPath, options)` instead.
     * Creates a new Linguini instance using legacy single-file pattern.
     *
     * @param folderPath - The folder path containing the language files.
     * @param fileName - The base name of the language files (without extension or locale).
     * @param options - Legacy options object.
     */
    constructor(
        folderPath: string,
        fileName: string,
        options?: Partial<{ replacementLevels: number; customCommonFile?: string }>
    );

    constructor(
        pathArg: string,
        fileNameOrOptions?: string | Partial<LinguiniOptions>,
        legacyOptions?: Partial<{ replacementLevels: number; customCommonFile?: string }>
    ) {
        // Detect which constructor signature was used
        if (typeof fileNameOrOptions === 'string') {
            // Legacy constructor: (folderPath, fileName, options?)
            this.options = {
                replacementLevels: legacyOptions?.replacementLevels ?? 10,
                folderStructure: 'locale-in-filename',
                commonPath: legacyOptions?.customCommonFile,
            };
            this.store = { common: {}, locales: {} };
            this.initLegacy(pathArg, fileNameOrOptions, legacyOptions);
        } else {
            // New constructor: (rootPath, options?)
            this.options = {
                replacementLevels: fileNameOrOptions?.replacementLevels ?? 10,
                folderStructure: fileNameOrOptions?.folderStructure ?? 'auto',
                ...fileNameOrOptions,
            };
            this.store = this.initNew(pathArg);
        }
    }

    /**
     * Initialize using the new file loader system.
     */
    private initNew(rootPath: string): TranslationStore {
        const loader = new FileLoader(rootPath, this.options);
        const store = loader.load();

        // Also populate legacy storage for backward compat
        this.comData = store.common;
        for (const [locale, data] of Object.entries(store.locales)) {
            this.langDatas[locale] = {
                data: data.data,
                refs: data.refs,
            };
        }

        return store;
    }

    /**
     * Initialize using legacy single-file pattern.
     * @deprecated
     */
    private initLegacy(
        folderPath: string,
        fileName: string,
        options?: Partial<{ replacementLevels: number; customCommonFile?: string }>
    ): void {
        // Validate options
        if (options?.customCommonFile && !FileUtils.exists(options.customCommonFile)) {
            throw new LinguiniError(
                `Custom common file does not exist: ${options.customCommonFile}`
            );
        }

        // Locate common file
        let comFilePath = options?.customCommonFile ?? path.join(folderPath, `${fileName}.common.json`);

        let comVars: Record<string, string> = {};
        if (FileUtils.exists(comFilePath)) {
            let comFileContents = FileUtils.readFileSync(comFilePath);
            let comFile = JSON.parse(comFileContents);

            comVars = DataUtils.flattenToVariables(comFile, 'COM:');
            for (let i = 0; i < this.options.replacementLevels; i++) {
                comVars = DataUtils.replaceVariablesInObj(comVars, comVars);
            }
            this.comData = comVars;
        }

        this.store.common = comVars;

        let fileNames = FileUtils.readFileNamesSync(folderPath);
        let langCodes = RegexUtils.getLangCodes(fileName, fileNames);

        for (let langCode of langCodes) {
            let langFileName = `${fileName}.${langCode}.json`;
            let langFilePath = path.join(folderPath, langFileName);

            let langFileContents = FileUtils.readFileSync(langFilePath);
            let langFile = JSON.parse(langFileContents);

            let refVars = DataUtils.flattenToVariables(langFile.refs ?? {}, 'REF:');
            refVars = DataUtils.replaceVariablesInObj(refVars, comVars);
            for (let i = 0; i < this.options.replacementLevels; i++) {
                refVars = DataUtils.replaceVariablesInObj(refVars, refVars);
            }

            let langData = DataUtils.replaceVariablesInObj(langFile.data ?? {}, comVars);
            langData = DataUtils.replaceVariablesInObj(langFile.data ?? {}, refVars);

            // Use maxDepth of 2 for legacy format (category.item)
            this.langDatas[langCode] = {
                data: DataUtils.flatten(langData, '', 2),
                refs: refVars,
            };

            this.store.locales[langCode] = {
                data: DataUtils.flatten(langData, '', 2),
                refs: refVars,
            };
        }
    }

    // ==================== NEW TYPE-SAFE API ====================

    /**
     * Get a translation by key with full type safety.
     *
     * @param key - The translation key in dot-notation (e.g., 'prompts.greeting').
     * @param locale - The locale code (e.g., 'en-US').
     * @param variables - Variables to replace in the translation (e.g., `{{NAME}}`).
     * @returns The translation value.
     *
     * @example
     * ```typescript
     * const greeting = linguini.t('prompts.greeting', 'en-US', { NAME: 'Alice' });
     * ```
     */
    public t<K extends string>(
        key: K,
        locale: string,
        variables?: Variables
    ): K extends PathsOf<T> ? ValueAt<T, K> : any {
        const localeData = this.store.locales[locale];
        if (!localeData) {
            throw new LinguiniError(`Invalid locale: ${locale}`);
        }

        let value = localeData.data[key];
        if (value === undefined) {
            throw new LinguiniError(`Invalid translation key: ${key}`);
        }

        // Deep clone to avoid mutating stored data
        value = JSON.parse(JSON.stringify(value));

        if (variables) {
            value = DataUtils.replaceVariablesInObj(value, this.variablesToRecord(variables));
        }

        return value;
    }

    /**
     * Get a reference string by key with full type safety.
     *
     * @param key - The reference key in dot-notation (e.g., 'terms.birthday').
     * @param locale - The locale code (e.g., 'en-US').
     * @param variables - Variables to replace in the reference.
     * @returns The reference string.
     */
    public ref(key: string, locale: string, variables?: Variables): string {
        const localeData = this.store.locales[locale];
        if (!localeData) {
            throw new LinguiniError(`Invalid locale: ${locale}`);
        }

        let ref = localeData.refs[`REF:${key}`];
        if (ref === undefined) {
            throw new LinguiniError(`Invalid reference key: ${key}`);
        }

        if (variables) {
            ref = DataUtils.replaceVariablesInObj(ref, this.variablesToRecord(variables));
        }

        return ref;
    }

    /**
     * Get a common value (language-agnostic constant).
     *
     * @param key - The common key in dot-notation (e.g., 'colors.primary').
     * @param variables - Variables to replace in the value.
     * @returns The common value.
     */
    public common(key: string, variables?: Variables): string {
        let com = this.store.common[`COM:${key}`];
        if (com === undefined) {
            throw new LinguiniError(`Invalid common key: ${key}`);
        }

        if (variables) {
            com = DataUtils.replaceVariablesInObj(com, this.variablesToRecord(variables));
        }

        return com;
    }

    /**
     * Get all available locales.
     */
    public getLocales(): string[] {
        return Object.keys(this.store.locales);
    }

    /**
     * Check if a locale is available.
     */
    public hasLocale(locale: string): boolean {
        return locale in this.store.locales;
    }

    /**
     * Check if a translation key exists for a locale.
     */
    public has(key: string, locale: string): boolean {
        const localeData = this.store.locales[locale];
        if (!localeData) return false;
        return key in localeData.data;
    }

    // ==================== DEPRECATED LEGACY API ====================

    /**
     * @deprecated Use `t()` instead.
     * Returns an item from a language file, mapped to a type.
     */
    public get<R>(
        location: string,
        langCode: string,
        typeMapper: TypeMapper<R>,
        variables?: Record<string, string>
    ): R {
        let raw = this.getRaw(location, langCode, variables);
        return typeMapper(raw);
    }

    /**
     * @deprecated Use `t()` instead.
     * Returns an item from a language file as raw JSON.
     */
    public getRaw(location: string, langCode: string, variables?: Record<string, string>): any {
        let langData = this.langDatas[langCode];
        if (langData === undefined) {
            throw new LinguiniError(`Invalid language code: ${langCode}`);
        }

        let jsonValue = langData.data[location];
        if (jsonValue === undefined) {
            throw new LinguiniError(`Invalid location: ${location}`);
        }

        jsonValue = JSON.parse(JSON.stringify(jsonValue));
        if (variables) {
            jsonValue = DataUtils.replaceVariablesInObj(jsonValue, variables);
        }
        return jsonValue;
    }

    /**
     * @deprecated Use `ref()` instead.
     * Returns a reference string from a language file.
     */
    public getRef(
        location: string,
        langCode: string,
        variables?: Record<string, string>
    ): string {
        let langData = this.langDatas[langCode];
        if (langData === undefined) {
            throw new LinguiniError(`Invalid language code: ${langCode}`);
        }

        let ref = langData.refs[`REF:${location}`];
        if (ref === undefined) {
            throw new LinguiniError(`Invalid location: ${location}`);
        }

        if (variables) {
            ref = DataUtils.replaceVariablesInObj(ref, variables);
        }
        return ref;
    }

    /**
     * @deprecated Use `common()` instead.
     * Returns a common reference string from the common language file.
     */
    public getCom(location: string, variables?: Record<string, string>): string {
        let com = this.comData[`COM:${location}`];
        if (com === undefined) {
            throw new LinguiniError(`Invalid location: ${location}`);
        }

        if (variables) {
            com = DataUtils.replaceVariablesInObj(com, variables);
        }
        return com;
    }

    // ==================== PRIVATE HELPERS ====================

    private variablesToRecord(variables: Variables): Record<string, string> {
        const result: Record<string, string> = {};
        for (const [key, value] of Object.entries(variables)) {
            result[key] = String(value);
        }
        return result;
    }
}
