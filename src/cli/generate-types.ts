#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import path from 'path';

/**
 * CLI tool to generate TypeScript types from language files.
 *
 * Usage:
 *   npx linguini generate <langDir> --output <outputPath>
 *
 * Example:
 *   npx linguini generate ./lang --output ./src/types/translations.ts
 */

interface GenerateOptions {
    langDir: string;
    output: string;
    typeName: string;
}

function main(): void {
    const args = process.argv.slice(2);

    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
        printHelp();
        process.exit(0);
    }

    if (args[0] !== 'generate') {
        console.error(`Unknown command: ${args[0]}`);
        printHelp();
        process.exit(1);
    }

    const options = parseArgs(args.slice(1));
    generate(options);
}

function printHelp(): void {
    console.log(`
Linguini Type Generator

Usage:
  linguini generate <langDir> [options]

Arguments:
  langDir             Path to the language files directory

Options:
  --output, -o        Output file path (default: ./linguini.generated.ts)
  --type-name, -t     Name of the generated type (default: Translations)
  --help, -h          Show this help message

Examples:
  linguini generate ./lang
  linguini generate ./lang --output ./src/types/translations.ts
  linguini generate ./lang -o ./types.ts -t MyTranslations
`);
}

function parseArgs(args: string[]): GenerateOptions {
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

// Run the CLI
main();


