import { expect } from 'chai';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import path from 'path';

describe('CLI: generate-types', (): void => {
    const testOutputDir = path.join(__dirname, './output');
    const cliPath = path.join(__dirname, '../../../src/cli/generate-types.ts');

    // Helper to quote paths for shell (handles spaces)
    function q(p: string): string {
        return `"${p}"`;
    }

    // Helper to run the CLI
    function runCli(args: string): string {
        return execSync(`npx ts-node ${q(cliPath)} ${args}`, {
            encoding: 'utf8',
            cwd: path.join(__dirname, '../../..'),
        });
    }

    before(() => {
        // Create output directory for generated files
        if (!existsSync(testOutputDir)) {
            mkdirSync(testOutputDir, { recursive: true });
        }
    });

    after(() => {
        // Clean up generated files
        if (existsSync(testOutputDir)) {
            rmSync(testOutputDir, { recursive: true });
        }
    });

    describe('Locale-Folder Structure', (): void => {
        const langDir = path.join(__dirname, '../data-v2/locale-folder');
        const outputPath = path.join(testOutputDir, 'locale-folder.ts');

        it('should generate types from locale-folder structure', (): void => {
            runCli(`generate ${q(langDir)} --output ${q(outputPath)}`);

            expect(existsSync(outputPath)).to.be.true;

            const content = readFileSync(outputPath, 'utf8');

            // Check that it's a valid TypeScript file with expected structure
            expect(content).to.include('export type Translations =');
            expect(content).to.include('export type TranslationsPath =');
            expect(content).to.include('export type ValueAt<');
        });

        it('should generate correct nested structure', (): void => {
            runCli(`generate ${q(langDir)} --output ${q(outputPath)}`);

            const content = readFileSync(outputPath, 'utf8');

            // Check for expected keys from our test data
            expect(content).to.include('prompts:');
            expect(content).to.include('greeting:');
            expect(content).to.include('farewell:');
            expect(content).to.include('info:');
            expect(content).to.include('about:');
            expect(content).to.include('validation:');
            expect(content).to.include('errors:');
            expect(content).to.include('warnings:');
        });

        it('should handle deeply nested structures', (): void => {
            runCli(`generate ${q(langDir)} --output ${q(outputPath)}`);

            const content = readFileSync(outputPath, 'utf8');

            // Check for nested validation.errors.custom
            expect(content).to.include('custom:');
            expect(content).to.include('birthday:');
        });

        it('should infer correct types', (): void => {
            runCli(`generate ${q(langDir)} --output ${q(outputPath)}`);

            const content = readFileSync(outputPath, 'utf8');

            // String types should be inferred
            expect(content).to.include(': string;');
        });
    });

    describe('Locale-in-Filename Structure', (): void => {
        const langDir = path.join(__dirname, '../data-v2/locale-in-filename');
        const outputPath = path.join(testOutputDir, 'locale-in-filename.ts');

        it('should generate types from locale-in-filename structure', (): void => {
            runCli(`generate ${q(langDir)} --output ${q(outputPath)}`);

            expect(existsSync(outputPath)).to.be.true;

            const content = readFileSync(outputPath, 'utf8');

            expect(content).to.include('export type Translations =');
            expect(content).to.include('prompts:');
            expect(content).to.include('info:');
            expect(content).to.include('validation:');
        });

        it('should handle subdirectories', (): void => {
            runCli(`generate ${q(langDir)} --output ${q(outputPath)}`);

            const content = readFileSync(outputPath, 'utf8');

            // validation/errors.en-US.json should create validation.errors namespace
            expect(content).to.include('validation:');
            expect(content).to.include('errors:');
        });
    });

    describe('CLI Options', (): void => {
        const langDir = path.join(__dirname, '../data-v2/locale-folder');

        it('should support custom type name with --type-name', (): void => {
            const outputPath = path.join(testOutputDir, 'custom-type.ts');

            runCli(`generate ${q(langDir)} --output ${q(outputPath)} --type-name MyCustomType`);

            const content = readFileSync(outputPath, 'utf8');

            expect(content).to.include('export type MyCustomType =');
            expect(content).to.include('export type MyCustomTypePath =');
        });

        it('should support -o shorthand for output', (): void => {
            const outputPath = path.join(testOutputDir, 'shorthand-o.ts');

            runCli(`generate ${q(langDir)} -o ${q(outputPath)}`);

            expect(existsSync(outputPath)).to.be.true;
        });

        it('should support -t shorthand for type-name', (): void => {
            const outputPath = path.join(testOutputDir, 'shorthand-t.ts');

            runCli(`generate ${q(langDir)} -o ${q(outputPath)} -t ShorthandType`);

            const content = readFileSync(outputPath, 'utf8');

            expect(content).to.include('export type ShorthandType =');
        });

        it('should include generation timestamp', (): void => {
            const outputPath = path.join(testOutputDir, 'timestamp.ts');

            runCli(`generate ${q(langDir)} -o ${q(outputPath)}`);

            const content = readFileSync(outputPath, 'utf8');

            expect(content).to.include('Auto-generated by Linguini');
            expect(content).to.include('Generated at:');
        });

        it('should show help with --help', (): void => {
            const output = runCli('--help');

            expect(output).to.include('Linguini CLI');
            expect(output).to.include('Usage:');
            expect(output).to.include('--output');
            expect(output).to.include('--type-name');
            expect(output).to.include('validate');
        });
    });

    describe('Generated Types Validity', (): void => {
        const langDir = path.join(__dirname, '../data-v2/locale-folder');
        const outputPath = path.join(testOutputDir, 'validity-test.ts');

        it('should generate compilable TypeScript', (): void => {
            runCli(`generate ${q(langDir)} -o ${q(outputPath)}`);

            // Try to compile the generated file
            try {
                execSync(`npx tsc --noEmit ${q(outputPath)}`, {
                    encoding: 'utf8',
                    cwd: path.join(__dirname, '../../..'),
                });
            } catch (error: any) {
                // If compilation fails, the test fails
                expect.fail(`Generated TypeScript failed to compile: ${error.message}`);
            }
        });

        it('should generate valid PathsOf utility type', (): void => {
            runCli(`generate ${q(langDir)} -o ${q(outputPath)}`);

            const content = readFileSync(outputPath, 'utf8');

            // Check PathsOf type is included
            expect(content).to.include('type PathsOf<T');
            expect(content).to.include("Depth['length'] extends 10");
        });

        it('should generate valid ValueAt utility type', (): void => {
            runCli(`generate ${q(langDir)} -o ${q(outputPath)}`);

            const content = readFileSync(outputPath, 'utf8');

            expect(content).to.include('export type ValueAt<T, Path extends string>');
            expect(content).to.include('infer Key');
            expect(content).to.include('infer Rest');
        });
    });

    describe('Edge Cases', (): void => {
        const tempLangDir = path.join(testOutputDir, 'temp-lang');

        beforeEach(() => {
            if (!existsSync(tempLangDir)) {
                mkdirSync(tempLangDir, { recursive: true });
            }
        });

        afterEach(() => {
            if (existsSync(tempLangDir)) {
                rmSync(tempLangDir, { recursive: true });
            }
        });

        it('should handle empty language directory', (): void => {
            const localeDir = path.join(tempLangDir, 'en-US');
            mkdirSync(localeDir, { recursive: true });

            const outputPath = path.join(testOutputDir, 'empty.ts');

            runCli(`generate ${q(tempLangDir)} -o ${q(outputPath)}`);

            const content = readFileSync(outputPath, 'utf8');
            expect(content).to.include('export type Translations =');
        });

        it('should handle special characters in keys', (): void => {
            const localeDir = path.join(tempLangDir, 'en-US');
            mkdirSync(localeDir, { recursive: true });

            // Create file with special key
            writeFileSync(
                path.join(localeDir, 'test.json'),
                JSON.stringify({
                    'normal-key': 'value',
                    'key_with_underscore': 'value',
                    'key.with.dots': 'value',
                })
            );

            const outputPath = path.join(testOutputDir, 'special-chars.ts');

            runCli(`generate ${q(tempLangDir)} -o ${q(outputPath)}`);

            const content = readFileSync(outputPath, 'utf8');

            // Keys with special chars should be quoted
            expect(content).to.include("'normal-key':");
            expect(content).to.include("'key.with.dots':");
        });

        it('should handle array values', (): void => {
            const localeDir = path.join(tempLangDir, 'en-US');
            mkdirSync(localeDir, { recursive: true });

            writeFileSync(
                path.join(localeDir, 'test.json'),
                JSON.stringify({
                    multiline: ['line 1', 'line 2', 'line 3'],
                    single: 'just a string',
                })
            );

            const outputPath = path.join(testOutputDir, 'arrays.ts');

            runCli(`generate ${q(tempLangDir)} -o ${q(outputPath)}`);

            const content = readFileSync(outputPath, 'utf8');

            expect(content).to.include('multiline: string[];');
            expect(content).to.include('single: string;');
        });

        it('should handle complex object values', (): void => {
            const localeDir = path.join(tempLangDir, 'en-US');
            mkdirSync(localeDir, { recursive: true });

            writeFileSync(
                path.join(localeDir, 'test.json'),
                JSON.stringify({
                    regex: { pattern: 'hello', flags: 'i' },
                    nested: {
                        deep: {
                            value: 'found it',
                        },
                    },
                })
            );

            const outputPath = path.join(testOutputDir, 'complex.ts');

            runCli(`generate ${q(tempLangDir)} -o ${q(outputPath)}`);

            const content = readFileSync(outputPath, 'utf8');

            // Complex objects should be represented
            expect(content).to.include('regex:');
            expect(content).to.include('pattern:');
            expect(content).to.include('flags:');
            expect(content).to.include('nested:');
            expect(content).to.include('deep:');
        });

        it('should create output directory if it does not exist', (): void => {
            const newDir = path.join(testOutputDir, 'new', 'nested', 'dir');
            const outputPath = path.join(newDir, 'generated.ts');
            const localeFolderPath = path.join(__dirname, '../data-v2/locale-folder');

            runCli(`generate ${q(localeFolderPath)} -o ${q(outputPath)}`);

            expect(existsSync(outputPath)).to.be.true;
        });
    });
});
