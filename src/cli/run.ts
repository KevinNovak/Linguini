import { watch } from 'node:fs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { generateBindings, generateTargetBindings } from '../compiler/bindings.js';
import { discoverTargetKeys } from '../compiler/discovery.js';
import { loadConfig } from '../compiler/config.js';
import { compileCatalog, writeArtifact } from '../compiler/compile.js';
import type { CompileResult } from '../compiler/compile.js';
import { formatDiagnostic } from '../compiler/diagnostics.js';
import { hashSchema } from '../compiler/schema.js';
import { migrateCatalog } from '../migrate/migrate.js';

const USAGE = `Usage:
  linguini compile [catalogDir] [--artifact-only]
                                             Compile the catalog: write the artifact (and bindings,
                                             if configured); --artifact-only skips bindings, for
                                             environments without the bindings targets' source trees
  linguini check [catalogDir] [--bindings <file>]
                                             Validate without writing; with --bindings, verify the
                                             generated file's schemaHash matches the catalog
  linguini watch [catalogDir]                Recompile on file changes (development)
  linguini migrate <v1Dir> --out <dir> [--object-type <name>] [--base-locale <locale>]
                   [--no-hoist-refs] [--report <file>]
                                             Convert a v1 catalog to the v2 format, compile the
                                             result, render-diff it against v1 semantics, and
                                             write a triage report
`;

type Logger = (message: string) => void;

export async function runCli(argv: string[], log: Logger = console.log): Promise<number> {
    const { positionals, values } = parseArgs({
        args: argv,
        allowPositionals: true,
        options: {
            'artifact-only': { type: 'boolean' },
            bindings: { type: 'string' },
            help: { type: 'boolean', short: 'h' },
            out: { type: 'string' },
            'object-type': { type: 'string' },
            'base-locale': { type: 'string' },
            'no-hoist-refs': { type: 'boolean' },
            report: { type: 'string' },
        },
    });

    const [command, dirArg] = positionals;
    if (values.help || !command) {
        log(USAGE);
        return values.help ? 0 : 1;
    }
    const catalogDir = path.resolve(dirArg ?? '.');

    switch (command) {
        case 'compile':
            return compile(catalogDir, log, { artifactOnly: values['artifact-only'] ?? false });
        case 'check':
            return check(catalogDir, values.bindings, log);
        case 'watch':
            return watchLoop(catalogDir, log);
        case 'migrate':
            return migrate(catalogDir, values, log);
        default:
            log(`Unknown command: ${command}\n\n${USAGE}`);
            return 1;
    }
}

async function migrate(
    inputDir: string,
    values: {
        out?: string;
        'object-type'?: string;
        'base-locale'?: string;
        'no-hoist-refs'?: boolean;
        report?: string;
    },
    log: Logger
): Promise<number> {
    if (!values.out) {
        log('error[MIGRATE] --out <dir> is required');
        return 1;
    }
    const migrateReport = await migrateCatalog(inputDir, {
        out: values.out,
        objectType: values['object-type'],
        baseLocale: values['base-locale'],
        hoistSharedRefs: values['no-hoist-refs'] ? false : undefined,
    });

    const reportPath = path.resolve(values.report ?? path.join(values.out, 'migrate-report.json'));
    mkdirSync(path.dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, JSON.stringify(migrateReport, null, 2));

    log(
        `Migrated ${migrateReport.namespaces.length} namespace(s), ` +
            `${migrateReport.locales.length} locale(s)`
    );
    log(`  Variables renamed:       ${migrateReport.variableRenames.length}`);
    log(`  Tagged $type objects:    ${migrateReport.taggedObjects.length}`);
    log(`  ICU-escaped values:      ${migrateReport.escapedValues.length}`);
    log(`  Suspected plural pairs:  ${migrateReport.suspectedPluralPairs.length}`);
    log(`  Hoisted shared refs:     ${migrateReport.hoistedRefs.length}`);
    log(`  Ref conflicts:           ${migrateReport.refConflicts.length}`);
    log(`  Unconvertible values:    ${migrateReport.unconvertible.length}`);
    log(`  Skipped files:           ${migrateReport.skippedFiles.length}`);
    log(
        `  Compile:                 ${migrateReport.compile.errors} error(s), ` +
            `${migrateReport.compile.warnings} warning(s)`
    );
    log(
        `  Verify:                  ${migrateReport.verify.checked} rendered, ` +
            `${migrateReport.verify.mismatches.length} mismatch(es)`
    );
    log(`Report written to ${reportPath}`);

    const clean =
        migrateReport.compile.errors === 0 &&
        migrateReport.verify.mismatches.length === 0 &&
        migrateReport.unconvertible.length === 0;
    if (!clean) {
        log('Migration needs attention — see the report for triage items.');
    }
    return clean ? 0 : 1;
}

function compile(
    catalogDir: string,
    log: Logger,
    options: { artifactOnly?: boolean } = {}
): number {
    const result = compileCatalog(catalogDir);
    report(result, log);
    if (!result.artifact || !result.schema) {
        return 1;
    }

    const config = loadConfig(catalogDir);
    const outDir = path.resolve(catalogDir, config.out);
    writeArtifact(result.artifact, outDir);
    log(`Artifact written to ${outDir}`);

    if (config.bindings && !options.artifactOnly) {
        for (const [outPath, contents] of renderAllBindings(catalogDir, config, result)) {
            const bindingsPath = path.resolve(catalogDir, outPath);
            mkdirSync(path.dirname(bindingsPath), { recursive: true });
            writeFileSync(bindingsPath, contents);
            log(`Bindings written to ${bindingsPath}`);
        }
    }

    log(
        `Compiled ${Object.keys(result.schema).length} messages, ` +
            `${result.artifact.manifest.locales.length} locale(s). ` +
            `schemaHash ${result.artifact.manifest.schemaHash} ` +
            `contentHash ${result.artifact.manifest.contentHash}`
    );
    return 0;
}

/**
 * Renders every configured bindings module: the per-target subset modules (design §14) and,
 * when `bindings.out` is set, the whole-catalog module (the pre-targets behavior, unchanged).
 * Returns [outPath, contents] pairs with paths relative to the catalog directory.
 */
function renderAllBindings(
    catalogDir: string,
    config: ReturnType<typeof loadConfig>,
    result: CompileResult
): Array<[string, string]> {
    const bindings = config.bindings!;
    const out: Array<[string, string]> = [];
    if (bindings.out) {
        out.push([
            bindings.out,
            generateBindings(result.schema!, result.artifact!.manifest.schemaHash, bindings),
        ]);
    }
    for (const target of bindings.targets ?? []) {
        const subsetKeys = discoverTargetKeys(target, Object.keys(result.schema!), catalogDir);
        out.push([
            target.out,
            generateTargetBindings(
                result.schema!,
                result.artifact!.manifest.keySchemaHashes,
                target,
                subsetKeys,
                bindings
            ),
        ]);
    }
    return out;
}

function check(catalogDir: string, bindingsFile: string | undefined, log: Logger): number {
    const result = compileCatalog(catalogDir);
    report(result, log);
    if (!result.schema) {
        return 1;
    }

    const config = loadConfig(catalogDir);
    if (config.bindings?.targets) {
        // Multi-target mode: verify every configured module matches a fresh render byte-for-byte.
        let stale = 0;
        for (const [outPath, expected] of renderAllBindings(catalogDir, config, result)) {
            const abs = path.resolve(catalogDir, outPath);
            let actual: string | undefined;
            try {
                actual = readFileSync(abs, 'utf8');
            } catch {
                actual = undefined;
            }
            if (actual === undefined) {
                log(`error[BINDINGS] Missing generated module: ${outPath}`);
                stale++;
            } else if (actual.replace(/\r\n/g, '\n') !== expected.replace(/\r\n/g, '\n')) {
                log(
                    `error[BINDINGS] Stale generated module: ${outPath} — run \`linguini compile\` ` +
                        'and ship the regenerated bindings as a code change'
                );
                stale++;
            }
        }
        if (stale > 0) {
            return 1;
        }
        log(
            `All ${config.bindings.targets.length + (config.bindings.out ? 1 : 0)} bindings module(s) up to date`
        );
    }

    if (bindingsFile) {
        const expected = hashSchema(result.schema);
        let contents: string;
        try {
            contents = readFileSync(path.resolve(bindingsFile), 'utf8');
        } catch (error: any) {
            log(`error[BINDINGS] Cannot read bindings file: ${error?.message}`);
            return 1;
        }
        const match = contents.match(/schemaHash = '([^']+)'/);
        if (!match) {
            log(`error[BINDINGS] No schemaHash found in ${bindingsFile}`);
            return 1;
        }
        if (match[1] !== expected) {
            log(
                `error[SCHEMA_HASH] Bindings are stale: catalog schema is ${expected} but ` +
                    `bindings were generated against ${match[1]}. Run \`linguini compile\` and ` +
                    'ship the regenerated bindings as a code change.'
            );
            return 1;
        }
        log(`Bindings schemaHash matches (${expected})`);
    }

    log('Catalog OK');
    return 0;
}

export type WatchHandle = { close: () => void };

/**
 * Compiles once, then recompiles (debounced) on authoring-file changes. Events under the
 * configured artifact/bindings output paths are ignored — the compiler writes into the watched
 * tree, and reacting to its own output would recompile forever.
 */
export function startWatch(catalogDir: string, log: Logger): WatchHandle {
    let ignoredPrefixes: string[] = [];
    try {
        const config = loadConfig(catalogDir);
        const outputs = [
            config.out,
            config.bindings?.out,
            ...(config.bindings?.targets ?? []).map(target => target.out),
        ].filter((out): out is string => out !== undefined);
        // For the bindings file, its containing directory also emits watch events when the
        // file is (re)created — ignore that directory too, unless it is the catalog root.
        ignoredPrefixes = outputs
            .map(out => path.relative(catalogDir, path.resolve(catalogDir, out)))
            .filter(rel => rel !== '' && !rel.startsWith('..'))
            .flatMap(rel => {
                const normalized = path.normalize(rel);
                const parent = path.dirname(normalized);
                return parent === '.' ? [normalized] : [normalized, parent];
            });
    } catch {
        // Unreadable config — compile() below reports it; fall back to the default out dir.
        ignoredPrefixes = ['dist'];
    }

    const run = (): void => {
        const code = compile(catalogDir, log);
        log(code === 0 ? 'Watching for changes…' : 'Compile failed — watching for changes…');
    };
    run();

    let timer: NodeJS.Timeout | undefined;
    const watcher = watch(catalogDir, { recursive: true }, (_event, filename) => {
        if (filename) {
            const normalized = path.normalize(filename);
            if (
                ignoredPrefixes.some(
                    prefix => normalized === prefix || normalized.startsWith(prefix + path.sep)
                )
            ) {
                return;
            }
        }
        clearTimeout(timer);
        timer = setTimeout(run, 200);
    });

    return {
        close: (): void => {
            clearTimeout(timer);
            watcher.close();
        },
    };
}

async function watchLoop(catalogDir: string, log: Logger): Promise<number> {
    const handle = startWatch(catalogDir, log);
    // Keep the process alive until interrupted.
    return await new Promise<number>(resolve => {
        process.on('SIGINT', () => {
            handle.close();
            resolve(0);
        });
    });
}

function report(result: CompileResult, log: Logger): void {
    for (const diagnostic of result.diagnostics.items) {
        log(formatDiagnostic(diagnostic));
    }
}
