import { watch as fsWatch, FSWatcher } from 'fs';
import path from 'path';

import { FileLoader } from './loaders';
import { LinguiniError } from './models/error-models';
import {
    LinguiniOptions,
    MissingKeyHandler,
    PathsOf,
    PluralRules,
    TranslationStore,
    TypeMapper,
    ValidationIssue,
    ValueAt,
    Variables,
} from './models/types';
import { DataUtils, FileUtils, RegexUtils } from './utils/';

// Re-export for convenience
export type { LinguiniOptions, Variables, MissingKeyHandler, PluralRules, ValidationIssue };

/**
 * A scoped accessor for a specific namespace within Linguini.
 */
export class LinguiniScope<T extends Record<string, any> = Record<string, any>> {
    constructor(
        private linguini: Linguini<any>,
        private prefix: string
    ) {}

    /**
     * Get a translation relative to this scope's prefix.
     */
    public t<K extends string>(
        key: K,
        locale: string,
        variables?: Variables
    ): any {
        return this.linguini.t(`${this.prefix}.${key}`, locale, variables);
    }

    /**
     * Get a random item from an array translation.
     */
    public tRandom(key: string, locale: string, variables?: Variables): string {
        return this.linguini.tRandom(`${this.prefix}.${key}`, locale, variables);
    }

    /**
     * Get a pluralized translation.
     */
    public tPlural(key: string, locale: string, count: number, variables?: Variables): string {
        return this.linguini.tPlural(`${this.prefix}.${key}`, locale, count, variables);
    }

    /**
     * Check if a key exists relative to this scope.
     */
    public has(key: string, locale: string): boolean {
        return this.linguini.has(`${this.prefix}.${key}`, locale);
    }

    /**
     * Create a further nested scope.
     */
    public scope(prefix: string): LinguiniScope {
        return new LinguiniScope(this.linguini, `${this.prefix}.${prefix}`);
    }
}

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
    private rootPath: string = '';
    private options: Required<Pick<LinguiniOptions, 'replacementLevels' | 'folderStructure'>> &
        Partial<LinguiniOptions>;
    private store: TranslationStore;
    private watcher: FSWatcher | null = null;

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
            this.rootPath = pathArg;
            this.options = {
                replacementLevels: legacyOptions?.replacementLevels ?? 10,
                folderStructure: 'locale-in-filename',
                commonPath: legacyOptions?.customCommonFile,
                onMissingKey: 'throw',
            };
            this.store = { common: {}, locales: {} };
            this.initLegacy(pathArg, fileNameOrOptions, legacyOptions);
        } else {
            // New constructor: (rootPath, options?)
            this.rootPath = pathArg;
            this.options = {
                replacementLevels: fileNameOrOptions?.replacementLevels ?? 10,
                folderStructure: fileNameOrOptions?.folderStructure ?? 'auto',
                onMissingKey: fileNameOrOptions?.onMissingKey ?? 'throw',
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
        let comFilePath =
            options?.customCommonFile ?? path.join(folderPath, `${fileName}.common.json`);

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
        // Try to get from requested locale
        let value = this.tryGetValue(key, locale);

        // Handle missing value
        if (value === undefined) {
            value = this.handleMissingKey(key, locale);
            if (value === undefined) {
                // handleMissingKey returned undefined, which means throw
                throw new LinguiniError(`Invalid translation key: ${key}`);
            }
        }

        // Deep clone to avoid mutating stored data
        value = JSON.parse(JSON.stringify(value));

        if (variables) {
            value = DataUtils.replaceVariablesInObj(value, this.variablesToRecord(variables));
        }

        return value;
    }

    /**
     * Get a random item from an array translation.
     * Useful for varying bot responses.
     *
     * @param key - The translation key pointing to an array.
     * @param locale - The locale code.
     * @param variables - Variables to replace.
     * @returns A randomly selected string from the array.
     *
     * @example
     * ```typescript
     * // JSON: { "greetings": ["Hello!", "Hi!", "Hey!"] }
     * const greeting = linguini.tRandom('greetings', 'en-US');
     * ```
     */
    public tRandom(key: string, locale: string, variables?: Variables): string {
        const value = this.t(key, locale);

        if (!Array.isArray(value)) {
            // If not an array, just return as string
            return this.applyVariables(String(value), variables);
        }

        if (value.length === 0) {
            throw new LinguiniError(`Array at key '${key}' is empty`);
        }

        const randomIndex = Math.floor(Math.random() * value.length);
        const selected = value[randomIndex];

        return this.applyVariables(String(selected), variables);
    }

    /**
     * Get a pluralized translation based on count.
     * Supports zero, one, two, few, many, and other forms.
     *
     * @param key - The translation key pointing to a plural rules object.
     * @param locale - The locale code.
     * @param count - The count to determine which plural form to use.
     * @param variables - Additional variables (COUNT is automatically added).
     * @returns The appropriate plural form with variables replaced.
     *
     * @example
     * ```typescript
     * // JSON: { "items": { "zero": "No items", "one": "1 item", "other": "{{COUNT}} items" } }
     * linguini.tPlural('items', 'en-US', 0);  // "No items"
     * linguini.tPlural('items', 'en-US', 1);  // "1 item"
     * linguini.tPlural('items', 'en-US', 5);  // "5 items"
     * ```
     */
    public tPlural(key: string, locale: string, count: number, variables?: Variables): string {
        const value = this.t(key, locale) as PluralRules | string;

        // If it's just a string, return it with count variable
        if (typeof value === 'string') {
            return this.applyVariables(value, { ...variables, COUNT: count });
        }

        // Determine which plural form to use
        const form = this.getPluralForm(count, locale);
        let text: string;

        if (form === 'zero' && value.zero !== undefined) {
            text = value.zero;
        } else if (form === 'one' && value.one !== undefined) {
            text = value.one;
        } else if (form === 'two' && value.two !== undefined) {
            text = value.two;
        } else if (form === 'few' && value.few !== undefined) {
            text = value.few;
        } else if (form === 'many' && value.many !== undefined) {
            text = value.many;
        } else {
            text = value.other;
        }

        if (text === undefined) {
            throw new LinguiniError(`Missing plural form '${form}' or 'other' for key: ${key}`);
        }

        return this.applyVariables(text, { ...variables, COUNT: count });
    }

    /**
     * Get a reference string by key.
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
     * Create a scoped accessor for a specific namespace.
     * Useful for modular code where each module handles its own translations.
     *
     * @param prefix - The namespace prefix (e.g., 'validation.errors').
     * @returns A scoped Linguini accessor.
     *
     * @example
     * ```typescript
     * const validationLang = linguini.scope('validation.errors');
     * validationLang.t('required', 'en-US'); // Same as t('validation.errors.required', ...)
     * ```
     */
    public scope(prefix: string): LinguiniScope<T> {
        return new LinguiniScope<T>(this, prefix);
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

    /**
     * Validate that all locales have the same keys.
     * Useful for CI/CD to catch missing translations.
     *
     * @returns Array of validation issues (missing keys per locale).
     *
     * @example
     * ```typescript
     * const issues = linguini.validateCompleteness();
     * if (issues.length > 0) {
     *     console.error('Missing translations:', issues);
     *     process.exit(1);
     * }
     * ```
     */
    public validateCompleteness(): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        const locales = this.getLocales();

        if (locales.length < 2) {
            return issues; // Nothing to compare
        }

        // Collect all keys from all locales
        const allKeys = new Set<string>();
        for (const locale of locales) {
            const localeData = this.store.locales[locale];
            for (const key of Object.keys(localeData.data)) {
                allKeys.add(key);
            }
        }

        // Check each key exists in all locales
        for (const key of Array.from(allKeys)) {
            const missingIn: string[] = [];
            for (const locale of locales) {
                if (!this.has(key, locale)) {
                    missingIn.push(locale);
                }
            }
            if (missingIn.length > 0) {
                issues.push({ key, missingIn });
            }
        }

        return issues;
    }

    /**
     * Watch for file changes and reload translations automatically.
     * Useful during development.
     *
     * @param callback - Optional callback when translations are reloaded.
     *
     * @example
     * ```typescript
     * linguini.watch(() => console.log('Translations reloaded!'));
     * ```
     */
    public watch(callback?: () => void): void {
        if (this.watcher) {
            return; // Already watching
        }

        this.watcher = fsWatch(this.rootPath, { recursive: true }, (eventType, filename) => {
            if (filename && filename.endsWith('.json')) {
                try {
                    this.reload();
                    callback?.();
                } catch (error) {
                    console.error('Failed to reload translations:', error);
                }
            }
        });
    }

    /**
     * Stop watching for file changes.
     */
    public unwatch(): void {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
    }

    /**
     * Reload all translations from disk.
     */
    public reload(): void {
        this.store = this.initNew(this.rootPath);
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

    private applyVariables(text: string, variables?: Variables): string {
        if (!variables) return text;
        return DataUtils.replaceVariablesInObj(text, this.variablesToRecord(variables));
    }

    private tryGetValue(key: string, locale: string): any {
        const localeData = this.store.locales[locale];
        if (!localeData) {
            throw new LinguiniError(`Invalid locale: ${locale}`);
        }
        return localeData.data[key];
    }

    private handleMissingKey(key: string, locale: string): any {
        const handler = this.options.onMissingKey ?? 'throw';

        if (handler === 'throw') {
            return undefined; // Let caller throw
        }

        if (handler === 'key') {
            return key;
        }

        if (handler === 'fallback') {
            const fallback = this.options.fallbackLocale;
            if (fallback && fallback !== locale && this.hasLocale(fallback)) {
                const fallbackData = this.store.locales[fallback];
                if (fallbackData && key in fallbackData.data) {
                    return fallbackData.data[key];
                }
            }
            return undefined; // Fallback failed, let caller throw
        }

        if (typeof handler === 'function') {
            return handler(key, locale);
        }

        return undefined;
    }

    /**
     * Get the plural form category for a count.
     * This is a simplified version - for full CLDR support, use a library.
     */
    private getPluralForm(
        count: number,
        _locale: string
    ): 'zero' | 'one' | 'two' | 'few' | 'many' | 'other' {
        // Simplified English-like plural rules
        // For full i18n support, consider using Intl.PluralRules
        if (count === 0) return 'zero';
        if (count === 1) return 'one';
        if (count === 2) return 'two';
        return 'other';
    }
}
