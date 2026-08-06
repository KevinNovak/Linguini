import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { LinguiniError } from '../errors.js';
import type { BindingsTarget } from './config.js';

/**
 * Key discovery for per-target bindings (design §14.1): a target's key set is the union of
 * explicitly listed `keys` (exact keys or `ns.**` family globs) and every catalog key whose
 * accessor chain (`<ident>.<dotted.key>`) appears in the target's scanned sources.
 *
 * The chain matcher is boundary-checked on both sides so prefix keys cannot mis-match
 * (`t.shared.terms.age` never matches inside `t.shared.terms.ageRegex`, nor inside a longer
 * identifier). Matching is textual by design — the same conservative contract as the deploy
 * system: if source text references an accessor, the key is in the subset, whether or not the
 * path executes at runtime.
 */
export function discoverTargetKeys(
    target: BindingsTarget,
    allKeys: readonly string[],
    catalogDir: string
): string[] {
    const selected = new Set<string>();

    for (const pattern of target.keys ?? []) {
        if (pattern.endsWith('.**')) {
            const prefix = pattern.slice(0, -2); // keep the trailing dot
            const matches = allKeys.filter(key => key.startsWith(prefix));
            if (matches.length === 0) {
                throw new LinguiniError(
                    `bindings target "${target.name}": key family "${pattern}" matches nothing`
                );
            }
            for (const key of matches) selected.add(key);
        } else {
            if (!allKeys.includes(pattern)) {
                throw new LinguiniError(
                    `bindings target "${target.name}": key "${pattern}" does not exist`
                );
            }
            selected.add(pattern);
        }
    }

    const globs = target.scan ?? [];
    if (globs.length > 0) {
        const identifiers = target.scanIdentifiers ?? ['t', 'tl'];
        const corpus = collectSources(globs, catalogDir, target.name)
            .map(file => readFileSync(file, 'utf8'))
            .join('\n');
        for (const key of allKeys) {
            if (selected.has(key)) continue;
            if (identifiers.some(ident => containsChain(corpus, `${ident}.${key}`))) {
                selected.add(key);
            }
        }
    }

    return [...selected].sort();
}

/** Boundary-checked substring search for an accessor chain. */
function containsChain(corpus: string, chain: string): boolean {
    let from = 0;
    while (true) {
        const hit = corpus.indexOf(chain, from);
        if (hit === -1) return false;
        const prev = corpus[hit - 1];
        const next = corpus[hit + chain.length];
        const prevOk = prev === undefined || !/[A-Za-z0-9_$.]/.test(prev);
        const nextOk = next === undefined || !/[A-Za-z0-9_$]/.test(next);
        if (prevOk && nextOk) return true;
        from = hit + 1;
    }
}

/**
 * Minimal glob support, deliberately small (documented in design §14.1): a pattern is a base
 * path, optionally ending in `/**` (recursive) with an optional `/*.<ext>` tail filtering by
 * extension. Examples: `../packages/foo/src/**\/*.ts`, `../apps/bar/src/**`, `../one/file.ts`.
 */
function collectSources(globs: string[], catalogDir: string, targetName: string): string[] {
    const files: string[] = [];
    for (const glob of globs) {
        const normalized = glob.replace(/\\/g, '/');
        const starIdx = normalized.indexOf('/**');
        if (starIdx === -1) {
            files.push(resolveExisting(catalogDir, normalized, targetName));
            continue;
        }
        const base = path.resolve(catalogDir, normalized.slice(0, starIdx));
        const tail = normalized.slice(starIdx + 3); // '' or '/*.ts'
        const extMatch = tail.match(/^\/\*(\.[A-Za-z0-9.]+)$/);
        if (tail !== '' && !extMatch) {
            throw new LinguiniError(
                `bindings target "${targetName}": unsupported glob "${glob}" ` +
                    '(supported: "dir/**", "dir/**/*.ext", exact files)'
            );
        }
        const ext = extMatch?.[1];
        walk(base, targetName, glob, file => {
            if (ext === undefined || file.endsWith(ext)) files.push(file);
        });
    }
    return files;
}

function resolveExisting(catalogDir: string, rel: string, targetName: string): string {
    const abs = path.resolve(catalogDir, rel);
    try {
        statSync(abs);
    } catch {
        throw new LinguiniError(`bindings target "${targetName}": scan path not found: ${rel}`);
    }
    return abs;
}

function walk(
    dir: string,
    targetName: string,
    glob: string,
    onFile: (file: string) => void
): void {
    let entries: string[];
    try {
        entries = readdirSync(dir);
    } catch {
        throw new LinguiniError(`bindings target "${targetName}": scan path not found: ${glob}`);
    }
    for (const name of entries) {
        if (name === 'node_modules' || name === 'dist') continue;
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p, targetName, glob, onFile);
        else onFile(p);
    }
}
