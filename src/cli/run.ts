import { watch } from 'node:fs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { generateBindings } from '../compiler/bindings.js';
import { loadConfig } from '../compiler/config.js';
import { compileCatalog, writeArtifact } from '../compiler/compile.js';
import type { CompileResult } from '../compiler/compile.js';
import { formatDiagnostic } from '../compiler/diagnostics.js';
import { hashSchema } from '../compiler/schema.js';

const USAGE = `Usage:
  linguini compile [catalogDir]              Compile the catalog: write the artifact (and bindings, if configured)
  linguini check [catalogDir] [--bindings <file>]
                                             Validate without writing; with --bindings, verify the
                                             generated file's schemaHash matches the catalog
  linguini watch [catalogDir]                Recompile on file changes (development)
`;

type Logger = (message: string) => void;

export async function runCli(argv: string[], log: Logger = console.log): Promise<number> {
    const { positionals, values } = parseArgs({
        args: argv,
        allowPositionals: true,
        options: {
            bindings: { type: 'string' },
            help: { type: 'boolean', short: 'h' },
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
            return compile(catalogDir, log);
        case 'check':
            return check(catalogDir, values.bindings, log);
        case 'watch':
            return watchLoop(catalogDir, log);
        default:
            log(`Unknown command: ${command}\n\n${USAGE}`);
            return 1;
    }
}

function compile(catalogDir: string, log: Logger): number {
    const result = compileCatalog(catalogDir);
    report(result, log);
    if (!result.artifact || !result.schema) {
        return 1;
    }

    const config = loadConfig(catalogDir);
    const outDir = path.resolve(catalogDir, config.out);
    writeArtifact(result.artifact, outDir);
    log(`Artifact written to ${outDir}`);

    if (config.bindings) {
        const bindingsPath = path.resolve(catalogDir, config.bindings.out);
        const contents = generateBindings(
            result.schema,
            result.artifact.manifest.schemaHash,
            config.bindings
        );
        mkdirSync(path.dirname(bindingsPath), { recursive: true });
        writeFileSync(bindingsPath, contents);
        log(`Bindings written to ${bindingsPath}`);
    }

    log(
        `Compiled ${Object.keys(result.schema).length} messages, ` +
            `${result.artifact.manifest.locales.length} locale(s). ` +
            `schemaHash ${result.artifact.manifest.schemaHash}`
    );
    return 0;
}

function check(catalogDir: string, bindingsFile: string | undefined, log: Logger): number {
    const result = compileCatalog(catalogDir);
    report(result, log);
    if (!result.schema) {
        return 1;
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
        const outputs = [config.out, config.bindings?.out].filter(
            (out): out is string => out !== undefined
        );
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
