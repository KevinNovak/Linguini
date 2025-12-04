import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

import { FolderStructure, LinguiniOptions, TranslationStore } from '../models/types';
import { DataUtils } from '../utils/data-utils';

/**
 * Handles loading and organizing translation files from various folder structures.
 */
export class FileLoader {
    private rootPath: string;
    private options: Required<
        Pick<LinguiniOptions, 'folderStructure' | 'filePattern' | 'refsFileName' | 'replacementLevels'>
    > & { commonPath?: string };

    constructor(
        rootPath: string,
        options: Partial<LinguiniOptions> = {}
    ) {
        this.rootPath = rootPath;
        this.options = {
            folderStructure: options.folderStructure ?? 'auto',
            filePattern: options.filePattern ?? '{name}.{locale}.json',
            refsFileName: options.refsFileName ?? '_refs.json',
            replacementLevels: options.replacementLevels ?? 10,
            commonPath: options.commonPath,
        };
    }

    /**
     * Load all translations from the configured root path.
     */
    public load(): TranslationStore {
        const structure = this.detectStructure();
        const common = this.loadCommon();

        let store: TranslationStore = {
            common: this.processCommon(common),
            locales: {},
        };

        if (structure === 'locale-folder') {
            store = this.loadLocaleFolderStructure(store);
        } else {
            store = this.loadLocaleInFilenameStructure(store);
        }

        return store;
    }

    /**
     * Detect which folder structure is being used.
     */
    private detectStructure(): Exclude<FolderStructure, 'auto'> {
        if (this.options.folderStructure !== 'auto') {
            return this.options.folderStructure;
        }

        const entries = readdirSync(this.rootPath, { withFileTypes: true });

        // Check if there are subdirectories that look like locale codes
        const localePattern = /^[a-z]{2}(-[A-Z]{2})?$/;
        const hasLocaleFolders = entries.some(
            entry => entry.isDirectory() && localePattern.test(entry.name)
        );

        if (hasLocaleFolders) {
            return 'locale-folder';
        }

        // Check if there are files with locale patterns
        const fileLocalePattern = /\.[a-z]{2}(-[A-Z]{2})?\.json$/;
        const hasLocaleFiles = entries.some(
            entry => entry.isFile() && fileLocalePattern.test(entry.name)
        );

        if (hasLocaleFiles) {
            return 'locale-in-filename';
        }

        // Default to locale-folder
        return 'locale-folder';
    }

    /**
     * Load common file(s) - language-agnostic constants.
     */
    private loadCommon(): Record<string, any> {
        const commonPath = this.options.commonPath ?? path.join(this.rootPath, '_common.json');

        if (!existsSync(commonPath)) {
            // Try legacy pattern
            const legacyPattern = /.common.json$/;
            const entries = readdirSync(this.rootPath, { withFileTypes: true });
            const legacyCommon = entries.find(
                entry => entry.isFile() && legacyPattern.test(entry.name)
            );

            if (legacyCommon) {
                const content = readFileSync(path.join(this.rootPath, legacyCommon.name), 'utf8');
                return JSON.parse(content);
            }

            return {};
        }

        const stat = statSync(commonPath);

        if (stat.isFile()) {
            const content = readFileSync(commonPath, 'utf8');
            return JSON.parse(content);
        }

        // If it's a directory, load all JSON files within
        if (stat.isDirectory()) {
            return this.loadJsonFilesInDir(commonPath);
        }

        return {};
    }

    /**
     * Process common values into flattened variables with COM: prefix.
     */
    private processCommon(common: Record<string, any>): Record<string, string> {
        let comVars = DataUtils.flattenToVariables(common, 'COM:');

        // Replace variables within common values
        for (let i = 0; i < this.options.replacementLevels; i++) {
            comVars = DataUtils.replaceVariablesInObj(comVars, comVars);
        }

        return comVars;
    }

    /**
     * Load translations using locale-folder structure (e.g., `lang/en-US/prompts.json`).
     */
    private loadLocaleFolderStructure(store: TranslationStore): TranslationStore {
        const entries = readdirSync(this.rootPath, { withFileTypes: true });
        const localePattern = /^[a-z]{2}(-[A-Z]{2})?$/;

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            if (entry.name.startsWith('_')) continue; // Skip _common, etc.

            const locale = entry.name;
            if (!localePattern.test(locale)) continue;

            const localePath = path.join(this.rootPath, locale);
            const { data, refs } = this.loadLocaleFolder(localePath, locale, store.common);

            store.locales[locale] = { data, refs };
        }

        return store;
    }

    /**
     * Load all translation files from a locale folder.
     */
    private loadLocaleFolder(
        localePath: string,
        locale: string,
        common: Record<string, string>
    ): { data: Record<string, any>; refs: Record<string, string> } {
        let allData: Record<string, any> = {};
        let allRefs: Record<string, string> = {};

        // Load global refs file first if it exists
        const refsPath = path.join(localePath, this.options.refsFileName);
        if (existsSync(refsPath)) {
            const refsContent = readFileSync(refsPath, 'utf8');
            const refsJson = JSON.parse(refsContent);
            allRefs = DataUtils.flattenToVariables(refsJson, 'REF:');
        }

        // Process refs with common values
        allRefs = DataUtils.replaceVariablesInObj(allRefs, common);
        for (let i = 0; i < this.options.replacementLevels; i++) {
            allRefs = DataUtils.replaceVariablesInObj(allRefs, allRefs);
        }

        // Recursively load all JSON files
        const files = this.findJsonFiles(localePath);

        for (const filePath of files) {
            const fileName = path.basename(filePath);

            // Skip refs file and common files
            if (fileName === this.options.refsFileName) continue;
            if (fileName.startsWith('_')) continue;

            // Calculate namespace from relative path
            const relativePath = path.relative(localePath, filePath);
            const namespace = this.pathToNamespace(relativePath);

            const content = readFileSync(filePath, 'utf8');
            const json = JSON.parse(content);

            // Check if file uses data/refs structure or flat structure
            if (json.data !== undefined) {
                // Structured file
                const fileData = DataUtils.flatten(json.data);
                const fileRefs = json.refs
                    ? DataUtils.flattenToVariables(json.refs, 'REF:')
                    : {};

                // Process file refs
                let processedRefs = DataUtils.replaceVariablesInObj(fileRefs, common);
                processedRefs = DataUtils.replaceVariablesInObj(processedRefs, allRefs);
                for (let i = 0; i < this.options.replacementLevels; i++) {
                    processedRefs = DataUtils.replaceVariablesInObj(processedRefs, processedRefs);
                }

                // Merge refs
                allRefs = { ...allRefs, ...processedRefs };

                // Namespace the data
                for (const [key, value] of Object.entries(fileData)) {
                    const fullKey = namespace ? `${namespace}.${key}` : key;
                    allData[fullKey] = value;
                }
            } else {
                // Flat file - entire content is data
                const fileData = DataUtils.flatten(json);

                for (const [key, value] of Object.entries(fileData)) {
                    const fullKey = namespace ? `${namespace}.${key}` : key;
                    allData[fullKey] = value;
                }
            }
        }

        // Replace variables in data
        allData = DataUtils.replaceVariablesInObj(allData, common);
        allData = DataUtils.replaceVariablesInObj(allData, allRefs);

        return { data: allData, refs: allRefs };
    }

    /**
     * Load translations using locale-in-filename structure (e.g., `lang/prompts.en-US.json`).
     */
    private loadLocaleInFilenameStructure(store: TranslationStore): TranslationStore {
        const files = this.findJsonFiles(this.rootPath);
        const localePattern = /\.([a-z]{2}(?:-[A-Z]{2})?)\.json$/;

        // Group files by locale
        const filesByLocale: Map<string, string[]> = new Map();

        for (const filePath of files) {
            const fileName = path.basename(filePath);

            // Skip common files
            if (fileName.startsWith('_') || fileName.includes('.common.')) continue;

            const match = fileName.match(localePattern);
            if (!match) continue;

            const locale = match[1];
            if (!filesByLocale.has(locale)) {
                filesByLocale.set(locale, []);
            }
            filesByLocale.get(locale)!.push(filePath);
        }

        // Process each locale
        for (const [locale, filePaths] of Array.from(filesByLocale.entries())) {
            let allData: Record<string, any> = {};
            let allRefs: Record<string, string> = {};

            // Look for refs file
            const refsFileName = `_refs.${locale}.json`;
            const refsPath = path.join(this.rootPath, refsFileName);
            if (existsSync(refsPath)) {
                const refsContent = readFileSync(refsPath, 'utf8');
                const refsJson = JSON.parse(refsContent);
                allRefs = DataUtils.flattenToVariables(refsJson, 'REF:');
            }

            // Process refs with common values
            allRefs = DataUtils.replaceVariablesInObj(allRefs, store.common);
            for (let i = 0; i < this.options.replacementLevels; i++) {
                allRefs = DataUtils.replaceVariablesInObj(allRefs, allRefs);
            }

            for (const filePath of filePaths) {
                const fileName = path.basename(filePath);
                if (fileName.startsWith('_refs.')) continue;

                // Calculate namespace from file path
                const relativePath = path.relative(this.rootPath, filePath);
                const namespace = this.pathToNamespace(relativePath, locale);

                const content = readFileSync(filePath, 'utf8');
                const json = JSON.parse(content);

                // Check if file uses data/refs structure or flat structure
                if (json.data !== undefined) {
                    const fileData = DataUtils.flatten(json.data);
                    const fileRefs = json.refs
                        ? DataUtils.flattenToVariables(json.refs, 'REF:')
                        : {};

                    // Process file refs
                    let processedRefs = DataUtils.replaceVariablesInObj(fileRefs, store.common);
                    processedRefs = DataUtils.replaceVariablesInObj(processedRefs, allRefs);
                    for (let i = 0; i < this.options.replacementLevels; i++) {
                        processedRefs = DataUtils.replaceVariablesInObj(processedRefs, processedRefs);
                    }

                    allRefs = { ...allRefs, ...processedRefs };

                    for (const [key, value] of Object.entries(fileData)) {
                        const fullKey = namespace ? `${namespace}.${key}` : key;
                        allData[fullKey] = value;
                    }
                } else {
                    const fileData = DataUtils.flatten(json);

                    for (const [key, value] of Object.entries(fileData)) {
                        const fullKey = namespace ? `${namespace}.${key}` : key;
                        allData[fullKey] = value;
                    }
                }
            }

            // Replace variables in data
            allData = DataUtils.replaceVariablesInObj(allData, store.common);
            allData = DataUtils.replaceVariablesInObj(allData, allRefs);

            store.locales[locale] = { data: allData, refs: allRefs };
        }

        return store;
    }

    /**
     * Recursively find all JSON files in a directory.
     */
    private findJsonFiles(dirPath: string): string[] {
        const files: string[] = [];
        const entries = readdirSync(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);

            if (entry.isDirectory()) {
                files.push(...this.findJsonFiles(fullPath));
            } else if (entry.isFile() && entry.name.endsWith('.json')) {
                files.push(fullPath);
            }
        }

        return files;
    }

    /**
     * Load all JSON files in a directory and merge them.
     */
    private loadJsonFilesInDir(dirPath: string): Record<string, any> {
        const result: Record<string, any> = {};
        const files = this.findJsonFiles(dirPath);

        for (const filePath of files) {
            const content = readFileSync(filePath, 'utf8');
            const json = JSON.parse(content);

            // Use filename (without .json) as namespace
            const relativePath = path.relative(dirPath, filePath);
            const namespace = this.pathToNamespace(relativePath);

            if (namespace) {
                result[namespace] = json;
            } else {
                Object.assign(result, json);
            }
        }

        return result;
    }

    /**
     * Convert a file path to a namespace string.
     */
    private pathToNamespace(relativePath: string, locale?: string): string {
        // Remove .json extension
        let ns = relativePath.replace(/\.json$/, '');

        // Remove locale from filename if present
        if (locale) {
            ns = ns.replace(new RegExp(`\\.${locale}$`), '');
        }

        // Convert path separators to dots
        ns = ns.replace(/[/\\]/g, '.');

        return ns;
    }
}

