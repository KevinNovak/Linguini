import type { MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import { parse, TYPE } from '@formatjs/icu-messageformat-parser';
import type { MessageNode, ParamType } from '../artifact.js';
import { MessageNodeKind, ParamKind } from '../artifact.js';
import { getPluralRules } from '../runtime/intl-cache.js';
import type { Diagnostics } from './diagnostics.js';
import { DiagnosticCode } from './diagnostics.js';

/**
 * `{name, list}` is a Linguini extension (backed by Intl.ListFormat), not stock ICU — the
 * parser would reject it, so it is rewritten to a plain `{name}` argument beforehand and the
 * names are re-marked as list nodes after conversion. Known limitation: the rewrite does not
 * see ICU quoting, so a quoted literal `'{x, list}'` would also be rewritten.
 */
const LIST_ARG_REGEX = /\{\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*,\s*list\s*\}/g;

const NUMBER_STYLES = new Set(['percent', 'integer']);
const DATE_TIME_STYLES = new Set(['short', 'medium', 'long', 'full']);

export type CompiledText = {
    nodes: MessageNode[];
    params: Map<string, ParamType>;
};

/**
 * Parses an ICU message (post ref-expansion) into the artifact AST and collects its parameter
 * signature. Returns undefined when the message fails to parse or types conflict — the
 * diagnostics carry the reason.
 */
export function compileIcu(
    text: string,
    locale: string,
    diagnostics: Diagnostics,
    where: { file?: string; key?: string }
): CompiledText | undefined {
    const listNames = new Set<string>();
    const prepared = text.replace(LIST_ARG_REGEX, (_match, name: string) => {
        listNames.add(name);
        return `{${name}}`;
    });

    let elements: MessageFormatElement[];
    try {
        // ignoreTag: consumer text legitimately contains `<...>` (e.g. Discord mentions).
        elements = parse(prepared, { ignoreTag: true, requiresOtherClause: true });
    } catch (error: any) {
        diagnostics.error(
            DiagnosticCode.ICU_PARSE,
            `Invalid ICU message: ${error?.message}`,
            where
        );
        return undefined;
    }

    let nodes: MessageNode[];
    try {
        nodes = convert(elements, listNames);
    } catch (error: any) {
        diagnostics.error(DiagnosticCode.ICU_UNSUPPORTED, error?.message ?? String(error), where);
        return undefined;
    }

    const params = new Map<string, ParamType>();
    if (!collectParams(nodes, params, diagnostics, where)) {
        return undefined;
    }
    checkPluralCoverage(nodes, locale, diagnostics, where);
    return { nodes, params };
}

function convert(elements: MessageFormatElement[], listNames: Set<string>): MessageNode[] {
    const nodes: MessageNode[] = [];
    for (const el of elements) {
        switch (el.type) {
            case TYPE.literal: {
                nodes.push({ kind: MessageNodeKind.TEXT, value: el.value });
                break;
            }
            case TYPE.argument: {
                nodes.push(
                    listNames.has(el.value)
                        ? { kind: MessageNodeKind.LIST, name: el.value }
                        : { kind: MessageNodeKind.ARG, name: el.value }
                );
                break;
            }
            case TYPE.number:
            case TYPE.date:
            case TYPE.time: {
                let style: string | undefined;
                if (el.style != null) {
                    if (typeof el.style !== 'string') {
                        throw new Error(
                            `Skeleton styles are not supported (argument "${el.value}") — use a named style (short/medium/long/full, percent, integer)`
                        );
                    }
                    style = el.style.trim();
                    const validStyles = el.type === TYPE.number ? NUMBER_STYLES : DATE_TIME_STYLES;
                    if (!validStyles.has(style)) {
                        throw new Error(
                            `Unknown style "${style}" for argument "${el.value}" — supported: ${[...validStyles].join(', ')}`
                        );
                    }
                }
                const kind =
                    el.type === TYPE.number
                        ? MessageNodeKind.NUMBER
                        : el.type === TYPE.date
                          ? MessageNodeKind.DATE
                          : MessageNodeKind.TIME;
                nodes.push({ kind, name: el.value, style });
                break;
            }
            case TYPE.select: {
                const branches: { [branch: string]: MessageNode[] } = {};
                for (const [branch, option] of Object.entries(el.options)) {
                    branches[branch] = convert(option.value, listNames);
                }
                nodes.push({ kind: MessageNodeKind.SELECT, name: el.value, branches });
                break;
            }
            case TYPE.plural: {
                const branches: { [branch: string]: MessageNode[] } = {};
                for (const [branch, option] of Object.entries(el.options)) {
                    branches[branch] = convert(option.value, listNames);
                }
                nodes.push({
                    kind: MessageNodeKind.PLURAL,
                    name: el.value,
                    ordinal: el.pluralType === 'ordinal',
                    offset: el.offset ?? 0,
                    branches,
                });
                break;
            }
            case TYPE.pound: {
                nodes.push({ kind: MessageNodeKind.POUND });
                break;
            }
            default: {
                throw new Error(`Unsupported ICU element type: ${el.type}`);
            }
        }
    }
    return nodes;
}

function paramTypeOf(node: MessageNode): ParamType | undefined {
    switch (node.kind) {
        case MessageNodeKind.ARG:
            return { type: ParamKind.STRING };
        case MessageNodeKind.NUMBER:
            return { type: ParamKind.NUMBER };
        case MessageNodeKind.DATE:
        case MessageNodeKind.TIME:
            return { type: ParamKind.DATETIME };
        case MessageNodeKind.LIST:
            return { type: ParamKind.LIST };
        case MessageNodeKind.SELECT:
            return { type: ParamKind.SELECT, branches: Object.keys(node.branches).sort() };
        case MessageNodeKind.PLURAL:
            return { type: ParamKind.NUMBER };
        default:
            return undefined;
    }
}

/**
 * Merges two inferred types for the same parameter. Plain `{name}` usage is generic and merges
 * with anything; otherwise both usages must agree. Returns undefined on conflict.
 */
export function mergeParamTypes(a: ParamType, b: ParamType): ParamType | undefined {
    if (a.type === ParamKind.STRING) {
        return b;
    }
    if (b.type === ParamKind.STRING) {
        return a;
    }
    if (a.type === ParamKind.SELECT && b.type === ParamKind.SELECT) {
        return a.branches.join(' ') === b.branches.join(' ') ? a : undefined;
    }
    return a.type === b.type ? a : undefined;
}

function collectParams(
    nodes: MessageNode[],
    params: Map<string, ParamType>,
    diagnostics: Diagnostics,
    where: { file?: string; key?: string }
): boolean {
    let ok = true;
    for (const node of nodes) {
        const type = paramTypeOf(node);
        if (type && 'name' in node) {
            const existing = params.get(node.name);
            if (existing) {
                const merged = mergeParamTypes(existing, type);
                if (!merged) {
                    diagnostics.error(
                        DiagnosticCode.PARAM_CONFLICT,
                        `Parameter "${node.name}" is used as both ${existing.type} and ${type.type}`,
                        where
                    );
                    ok = false;
                } else {
                    params.set(node.name, merged);
                }
            } else {
                params.set(node.name, type);
            }
        }
        if (node.kind === MessageNodeKind.SELECT || node.kind === MessageNodeKind.PLURAL) {
            for (const branch of Object.values(node.branches)) {
                ok = collectParams(branch, params, diagnostics, where) && ok;
            }
        }
    }
    return ok;
}

/**
 * Every plural/selectordinal must cover the CLDR-required categories for the locale it is
 * written in (e.g. Polish cardinal requires one/few/many/other; English only one/other).
 */
function checkPluralCoverage(
    nodes: MessageNode[],
    locale: string,
    diagnostics: Diagnostics,
    where: { file?: string; key?: string }
): void {
    for (const node of nodes) {
        if (node.kind === MessageNodeKind.PLURAL) {
            const required = getPluralRules(locale, {
                type: node.ordinal ? 'ordinal' : 'cardinal',
            }).resolvedOptions().pluralCategories;
            const present = new Set(Object.keys(node.branches).filter(b => !b.startsWith('=')));
            const missing = required.filter(category => !present.has(category));
            if (missing.length > 0) {
                diagnostics.error(
                    DiagnosticCode.PLURAL_COVERAGE,
                    `Plural "${node.name}" is missing required ${
                        node.ordinal ? 'ordinal' : 'cardinal'
                    } categories for locale "${locale}": ${missing.join(', ')}`,
                    where
                );
            }
        }
        if (node.kind === MessageNodeKind.SELECT || node.kind === MessageNodeKind.PLURAL) {
            for (const branch of Object.values(node.branches)) {
                checkPluralCoverage(branch, locale, diagnostics, where);
            }
        }
    }
}
