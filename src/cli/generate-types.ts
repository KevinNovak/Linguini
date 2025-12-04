#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import path from 'path';

/**
 * Linguini CLI
 *
 * Commands:
 *   generate - Generate TypeScript types from language files
 *   validate - Validate translation completeness across locales
 */

interface GenerateOptions {
    langDir: string;
    output: string;
    typeName: string;
}

interface ValidateOptions {
    langDir: string;
    strict: boolean;
}

function main(): void {
    const args = process.argv.slice(2);

    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
        printHelp();
        process.exit(0);
    }

    const command = args[0];

    switch (command) {
        case 'generate':
            const genOptions = parseGenerateArgs(args.slice(1));
            generate(genOptions);
            break;
        case 'validate':
            const valOptions = parseValidateArgs(args.slice(1));
            validate(valOptions);
            break;
        default:
            console.error(`Unknown command: ${command}`);
            printHelp();
            process.exit(1);
    }
}

function printHelp(): void {
    console.log(`
Linguini CLI

Usage:
  linguini <command> [options]

Commands:
  generate <langDir>   Generate TypeScript types from language files
  validate <langDir>   Validate translation completeness across locales

Generate Options:
  --output, -o        Output file path (default: ./linguini.generated.ts)
  --type-name, -t     Name of the generated type (default: Translations)

Validate Options:
  --strict            Exit with error code if any issues found

General Options:
  --help, -h          Show this help message

Examples:
  linguini generate ./lang
  linguini generate ./lang --output ./src/types/translations.ts
  linguini generate ./lang -o ./types.ts -t MyTranslations
  linguini validate ./lang
  linguini validate ./lang --strict
`);
}

function parseGenerateArgs(args: string[]): GenerateOptions {
    const options: GenerateOptions = {
        langDir: '',
        output: './linguini.generated.ts',
        typeName: 'Translations',
    };

    let i = 0;
    while (i < args.length) {
        const arg = args[i];

        if (arg.startsWith('-')) {
            switch (arg) {
                case '--output':
                case '-o':
                    options.output = args[++i];
                    break;
                case '--type-name':
                case '-t':
                    options.typeName = args[++i];
                    break;
                default:
                    console.error(`Unknown option: ${arg}`);
                    process.exit(1);
            }
        } else {
            options.langDir = arg;
        }
        i++;
    }

    if (!options.langDir) {
        console.error('Error: langDir is required');
        printHelp();
        process.exit(1);
    }

    return options;
}

function parseValidateArgs(args: string[]): ValidateOptions {
    const options: ValidateOptions = {
        langDir: '',
        strict: false,
    };

    let i = 0;
    while (i < args.length) {
        const arg = args[i];

        if (arg.startsWith('-')) {
            switch (arg) {
                case '--strict':
                    options.strict = true;
                    break;
                default:
                    console.error(`Unknown option: ${arg}`);
                    process.exit(1);
            }
        } else {
            options.langDir = arg;
        }
        i++;
    }

    if (!options.langDir) {
        console.error('Error: langDir is required');
        printHelp();
        process.exit(1);
    }

    return options;
}

function generate(options: GenerateOptions): void {
    const { langDir, output, typeName } = options;

    if (!existsSync(langDir)) {
        console.error(`Error: Directory not found: ${langDir}`);
        process.exit(1);
    }

    console.log(`Scanning ${langDir} for language files...`);

    // Detect structure and find a representative locale
    const structure = detectStructure(langDir);
    console.log(`Detected structure: ${structure}`);

    // Collect all translation keys and their types
    const schema = collectSchema(langDir, structure);

    // Generate TypeScript code
    const tsCode = generateTypeScript(schema, typeName);

    // Ensure output directory exists
    const outputDir = path.dirname(output);
    if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
    }

    writeFileSync(output, tsCode, 'utf8');
    console.log(`Generated types written to: ${output}`);
}

type FolderStructure = 'locale-folder' | 'locale-in-filename';

function detectStructure(langDir: string): FolderStructure {
    const entries = readdirSync(langDir, { withFileTypes: true });
    const localePattern = /^[a-z]{2}(-[A-Z]{2})?$/;

    const hasLocaleFolders = entries.some(
        entry => entry.isDirectory() && localePattern.test(entry.name)
    );

    if (hasLocaleFolders) {
        return 'locale-folder';
    }

    return 'locale-in-filename';
}

interface SchemaNode {
    [key: string]: SchemaNode | string;
}

function collectSchema(langDir: string, structure: FolderStructure): SchemaNode {
    const schema: SchemaNode = {};

    if (structure === 'locale-folder') {
        // Find first locale folder
        const entries = readdirSync(langDir, { withFileTypes: true });
        const localePattern = /^[a-z]{2}(-[A-Z]{2})?$/;
        const localeDir = entries.find(
            e => e.isDirectory() && localePattern.test(e.name)
        );

        if (!localeDir) {
            console.warn('No locale folders found');
            return schema;
        }

        const localePath = path.join(langDir, localeDir.name);
        collectFromDir(localePath, schema, '');
    } else {
        // Locale in filename - find files and strip locale
        collectFromDirWithLocaleInFilename(langDir, schema, '');
    }

    return schema;
}

function collectFromDir(dirPath: string, schema: SchemaNode, namespace: string): void {
    const entries = readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
            // Skip special directories
            if (entry.name.startsWith('_')) continue;

            const newNamespace = namespace ? `${namespace}.${entry.name}` : entry.name;
            collectFromDir(fullPath, schema, newNamespace);
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
            // Skip special files
            if (entry.name.startsWith('_')) continue;

            const fileName = entry.name.replace('.json', '');
            const fileNamespace = namespace ? `${namespace}.${fileName}` : fileName;

            try {
                const content = readFileSync(fullPath, 'utf8');
                const json = JSON.parse(content);

                // Check if structured (has data property) or flat
                const data = json.data ?? json;
                addToSchema(schema, fileNamespace, data);
            } catch (e) {
                console.warn(`Failed to parse ${fullPath}: ${e}`);
            }
        }
    }
}

function collectFromDirWithLocaleInFilename(
    dirPath: string,
    schema: SchemaNode,
    namespace: string
): void {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    const localePattern = /\.([a-z]{2}(?:-[A-Z]{2})?)\.json$/;

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
            if (entry.name.startsWith('_')) continue;

            const newNamespace = namespace ? `${namespace}.${entry.name}` : entry.name;
            collectFromDirWithLocaleInFilename(fullPath, schema, newNamespace);
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
            // Skip common and refs files
            if (entry.name.startsWith('_') || entry.name.includes('.common.')) continue;

            const match = entry.name.match(localePattern);
            if (!match) continue;

            // Strip locale from filename
            const fileName = entry.name.replace(localePattern, '');
            const fileNamespace = namespace ? `${namespace}.${fileName}` : fileName;

            try {
                const content = readFileSync(fullPath, 'utf8');
                const json = JSON.parse(content);

                const data = json.data ?? json;
                addToSchema(schema, fileNamespace, data);
            } catch (e) {
                console.warn(`Failed to parse ${fullPath}: ${e}`);
            }
        }
    }
}

function addToSchema(schema: SchemaNode, namespace: string, data: any): void {
    const parts = namespace.split('.').filter(Boolean);

    // Navigate to the correct position in schema
    let current = schema;
    for (const part of parts) {
        if (!current[part]) {
            current[part] = {};
        }
        current = current[part] as SchemaNode;
    }

    // Add all keys from data
    addDataToNode(current, data);
}

function addDataToNode(node: SchemaNode, data: any): void {
    for (const [key, value] of Object.entries(data)) {
        if (isPlainObject(value)) {
            if (!node[key]) {
                node[key] = {};
            }
            addDataToNode(node[key] as SchemaNode, value);
        } else {
            // Leaf node - store the TypeScript type
            node[key] = inferType(value);
        }
    }
}

function isPlainObject(value: any): value is Record<string, any> {
    return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        value.constructor === Object
    );
}

function inferType(value: any): string {
    if (typeof value === 'string') {
        return 'string';
    }
    if (typeof value === 'number') {
        return 'number';
    }
    if (typeof value === 'boolean') {
        return 'boolean';
    }
    if (Array.isArray(value)) {
        if (value.length === 0) {
            return 'string[]';
        }
        const elementType = inferType(value[0]);
        return `${elementType}[]`;
    }
    if (isPlainObject(value)) {
        // Complex object - generate inline type
        const props = Object.entries(value)
            .map(([k, v]) => `${sanitizeKey(k)}: ${inferType(v)}`)
            .join('; ');
        return `{ ${props} }`;
    }
    return 'unknown';
}

function sanitizeKey(key: string): string {
    // If key contains special characters, wrap in quotes
    if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)) {
        return key;
    }
    return `'${key}'`;
}

function generateTypeScript(schema: SchemaNode, typeName: string): string {
    const lines: string[] = [
        '/**',
        ' * Auto-generated by Linguini type generator.',
        ' * Do not edit manually.',
        ` * Generated at: ${new Date().toISOString()}`,
        ' */',
        '',
        `export type ${typeName} = ${generateType(schema, 0)};`,
        '',
        '// Path type for type-safe key access',
        `export type ${typeName}Path = PathsOf<${typeName}>;`,
        '',
        '// Utility type to get all valid dot-notation paths',
        'type PathsOf<T, Prefix extends string = \'\', Depth extends number[] = []> = Depth[\'length\'] extends 10',
        '    ? never // Prevent infinite recursion',
        '    : T extends object',
        '        ? {',
        '              [K in keyof T & string]: T[K] extends object',
        '                  ? T[K] extends any[]',
        '                      ? `${Prefix}${K}`',
        '                      : PathsOf<T[K], `${Prefix}${K}.`, [...Depth, 0]> | `${Prefix}${K}`',
        '                  : `${Prefix}${K}`;',
        '          }[keyof T & string]',
        '        : never;',
        '',
        '// Utility type to get the value type at a given path',
        'export type ValueAt<T, Path extends string> = Path extends `${infer Key}.${infer Rest}`',
        '    ? Key extends keyof T',
        '        ? ValueAt<T[Key], Rest>',
        '        : never',
        '    : Path extends keyof T',
        '        ? T[Path]',
        '        : never;',
        '',
    ];

    return lines.join('\n');
}

function generateType(node: SchemaNode, indent: number): string {
    const entries = Object.entries(node);

    if (entries.length === 0) {
        return '{}';
    }

    const indentStr = '    '.repeat(indent + 1);
    const closingIndent = '    '.repeat(indent);

    const props = entries.map(([key, value]) => {
        const safeKey = sanitizeKey(key);
        if (typeof value === 'string') {
            return `${indentStr}${safeKey}: ${value};`;
        }
        return `${indentStr}${safeKey}: ${generateType(value as SchemaNode, indent + 1)};`;
    });

    return `{\n${props.join('\n')}\n${closingIndent}}`;
}

// ==================== VALIDATE COMMAND ====================

function validate(options: ValidateOptions): void {
    const { langDir, strict } = options;

    if (!existsSync(langDir)) {
        console.error(`Error: Directory not found: ${langDir}`);
        process.exit(1);
    }

    console.log(`Validating translations in ${langDir}...`);

    const structure = detectStructure(langDir);
    console.log(`Detected structure: ${structure}`);

    // Collect keys from all locales
    const localeKeys = collectLocaleKeys(langDir, structure);
    const locales = Object.keys(localeKeys);

    if (locales.length < 2) {
        console.log('Only one locale found, nothing to compare.');
        process.exit(0);
    }

    console.log(`Found ${locales.length} locales: ${locales.join(', ')}`);

    // Collect all unique keys
    const allKeys = new Set<string>();
    for (const keys of Object.values(localeKeys)) {
        for (const key of Array.from(keys)) {
            allKeys.add(key);
        }
    }

    console.log(`Total unique keys: ${allKeys.size}`);

    // Find missing keys
    const issues: Array<{ key: string; missingIn: string[] }> = [];

    for (const key of Array.from(allKeys)) {
        const missingIn: string[] = [];
        for (const locale of locales) {
            if (!localeKeys[locale].has(key)) {
                missingIn.push(locale);
            }
        }
        if (missingIn.length > 0) {
            issues.push({ key, missingIn });
        }
    }

    // Report results
    if (issues.length === 0) {
        console.log('\n✅ All translations are complete!');
        process.exit(0);
    }

    console.log(`\n⚠️  Found ${issues.length} missing translation(s):\n`);

    for (const issue of issues) {
        console.log(`  Key: ${issue.key}`);
        console.log(`  Missing in: ${issue.missingIn.join(', ')}`);
        console.log();
    }

    if (strict) {
        console.error('Validation failed due to missing translations.');
        process.exit(1);
    }
}

function collectLocaleKeys(
    langDir: string,
    structure: FolderStructure
): Record<string, Set<string>> {
    const result: Record<string, Set<string>> = {};

    if (structure === 'locale-folder') {
        const entries = readdirSync(langDir, { withFileTypes: true });
        const localePattern = /^[a-z]{2}(-[A-Z]{2})?$/;

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            if (!localePattern.test(entry.name)) continue;

            const locale = entry.name;
            const localePath = path.join(langDir, locale);
            result[locale] = collectKeysFromDir(localePath, '');
        }
    } else {
        // Locale in filename
        const files = findJsonFiles(langDir);
        const localePattern = /\.([a-z]{2}(?:-[A-Z]{2})?)\.json$/;

        for (const file of files) {
            const fileName = path.basename(file);
            if (fileName.startsWith('_') || fileName.includes('.common.')) continue;

            const match = fileName.match(localePattern);
            if (!match) continue;

            const locale = match[1];
            if (!result[locale]) {
                result[locale] = new Set();
            }

            const relativePath = path.relative(langDir, file);
            const namespace = relativePath
                .replace(localePattern, '')
                .replace(/[/\\]/g, '.')
                .replace(/\.json$/, '');

            const keys = collectKeysFromFile(file, namespace);
            for (const key of Array.from(keys)) {
                result[locale].add(key);
            }
        }
    }

    return result;
}

function collectKeysFromDir(dirPath: string, namespace: string): Set<string> {
    const keys = new Set<string>();
    const entries = readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
            if (entry.name.startsWith('_')) continue;
            const newNamespace = namespace ? `${namespace}.${entry.name}` : entry.name;
            const subKeys = collectKeysFromDir(fullPath, newNamespace);
            for (const key of Array.from(subKeys)) {
                keys.add(key);
            }
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
            if (entry.name.startsWith('_')) continue;

            const fileName = entry.name.replace('.json', '');
            const fileNamespace = namespace ? `${namespace}.${fileName}` : fileName;
            const fileKeys = collectKeysFromFile(fullPath, fileNamespace);
            for (const key of Array.from(fileKeys)) {
                keys.add(key);
            }
        }
    }

    return keys;
}

function collectKeysFromFile(filePath: string, namespace: string): Set<string> {
    const keys = new Set<string>();

    try {
        const content = readFileSync(filePath, 'utf8');
        const json = JSON.parse(content);
        const data = json.data ?? json;
        collectKeysRecursive(data, namespace, keys);
    } catch (e) {
        console.warn(`Warning: Failed to parse ${filePath}`);
    }

    return keys;
}

function collectKeysRecursive(obj: any, prefix: string, keys: Set<string>): void {
    for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;

        if (isPlainObject(value)) {
            collectKeysRecursive(value, fullKey, keys);
        } else {
            keys.add(fullKey);
        }
    }
}

function findJsonFiles(dirPath: string): string[] {
    const files: string[] = [];
    const entries = readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
            files.push(...findJsonFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
            files.push(fullPath);
        }
    }

    return files;
}

// Run the CLI
main();


