import { LintLevel } from './config.js';
import type { Diagnostics } from './diagnostics.js';
import { DiagnosticCode, Severity } from './diagnostics.js';

export enum IncludeKind {
    REF = 'REF',
    COM = 'COM',
}

/** `{{REF:path}}` / `{{COM:path}}` include tokens (compile-time only; never reach the runtime). */
export const INCLUDE_TOKEN_REGEX = /\{\{(REF|COM):([^{}]+?)\}\}/g;
/** Any leftover `{{...}}` after expansion — a v1-style variable or a typo'd include. */
export const UNKNOWN_TOKEN_REGEX = /\{\{[^{}]*\}\}/;

/**
 * Flattens a nested object of string / string[] leaves to dot-path → string (arrays join with
 * `\n`). Invalid leaves are reported and skipped.
 */
export function flattenStrings(
    input: any,
    diagnostics: Diagnostics,
    file: string,
    prefix = ''
): Map<string, string> {
    const out = new Map<string, string>();
    if (input === undefined || input === null) {
        return out;
    }
    for (const [key, value] of Object.entries(input)) {
        if (key.includes('.')) {
            diagnostics.error(DiagnosticCode.DOTTED_KEY, `Key "${key}" must not contain "."`, {
                file,
            });
            continue;
        }
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'string') {
            out.set(path, value);
        } else if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
            out.set(path, value.join('\n'));
        } else if (typeof value === 'object' && value !== null) {
            for (const [nestedPath, nestedValue] of flattenStrings(
                value,
                diagnostics,
                file,
                path
            )) {
                out.set(nestedPath, nestedValue);
            }
        } else {
            diagnostics.error(
                DiagnosticCode.INVALID_REF_VALUE,
                `"${path}" must be a string or string array`,
                { file }
            );
        }
    }
    return out;
}

/**
 * Resolves every value in `raw`, expanding include tokens. Tokens of `options.self` kind
 * resolve recursively against `raw` itself (with cycle detection); `COM` tokens resolve via
 * `options.com` when the table itself is not the common table. Failed includes expand to an
 * empty string so compilation can continue collecting further diagnostics.
 */
export function resolveIncludes(
    raw: Map<string, string>,
    options: { self: IncludeKind; com?: (path: string) => string | undefined },
    diagnostics: Diagnostics,
    file: string
): Map<string, string> {
    const resolved = new Map<string, string>();
    const visiting: string[] = [];

    const resolvePath = (path: string): string => {
        const cached = resolved.get(path);
        if (cached !== undefined) {
            return cached;
        }
        if (visiting.includes(path)) {
            diagnostics.error(
                DiagnosticCode.REF_CYCLE,
                `Circular reference: ${[...visiting, path].join(' → ')}`,
                { file }
            );
            return '';
        }
        const rawValue = raw.get(path);
        if (rawValue === undefined) {
            diagnostics.error(
                options.self === IncludeKind.REF
                    ? DiagnosticCode.UNKNOWN_REF
                    : DiagnosticCode.UNKNOWN_COM,
                `Unknown ${options.self === IncludeKind.REF ? 'ref' : 'common'} path "${path}"`,
                { file }
            );
            return '';
        }
        visiting.push(path);
        const value = expandIncludes(rawValue, (kind, includePath) =>
            resolveToken(kind, includePath, resolvePath, options, diagnostics, file)
        );
        visiting.pop();
        resolved.set(path, value);
        return value;
    };

    for (const path of raw.keys()) {
        resolvePath(path);
    }
    return resolved;
}

function resolveToken(
    kind: IncludeKind,
    path: string,
    resolveSelf: (path: string) => string,
    options: { self: IncludeKind; com?: (path: string) => string | undefined },
    diagnostics: Diagnostics,
    file: string
): string {
    if (kind === options.self) {
        return resolveSelf(path);
    }
    if (kind === IncludeKind.COM) {
        const value = options.com?.(path);
        if (value === undefined) {
            diagnostics.error(DiagnosticCode.UNKNOWN_COM, `Unknown common path "${path}"`, {
                file,
            });
            return '';
        }
        return value;
    }
    diagnostics.error(
        DiagnosticCode.INVALID_INCLUDE,
        `{{REF:...}} is not allowed in the common file`,
        { file }
    );
    return '';
}

export function expandIncludes(
    text: string,
    lookup: (kind: IncludeKind, path: string) => string
): string {
    return text.replace(INCLUDE_TOKEN_REGEX, (_match, kind: string, path: string) =>
        lookup(kind as IncludeKind, path.trim())
    );
}

/**
 * Lints include tokens spliced mid-sentence (non-whitespace immediately on both sides).
 * Fragments spliced into a sentence break case/gender agreement in many languages.
 */
export function lintMidSentenceIncludes(
    text: string,
    level: LintLevel,
    diagnostics: Diagnostics,
    where: { file?: string; key?: string }
): void {
    if (level === LintLevel.OFF) {
        return;
    }
    for (const match of text.matchAll(INCLUDE_TOKEN_REGEX)) {
        const before = text[match.index - 1];
        const after = text[match.index + match[0].length];
        const touchesBefore = before !== undefined && !/\s/.test(before);
        const touchesAfter = after !== undefined && !/\s/.test(after);
        if (touchesBefore && touchesAfter) {
            diagnostics.report(
                level === LintLevel.ERROR ? Severity.ERROR : Severity.WARNING,
                DiagnosticCode.MID_SENTENCE_REF,
                `"${match[0]}" is spliced mid-sentence; refs should be whole segments (translations may need different word forms here)`,
                where
            );
        }
    }
}
