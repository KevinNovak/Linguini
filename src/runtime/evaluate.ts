import type { MessageNode } from '../artifact.js';
import { MessageNodeKind } from '../artifact.js';
import { LinguiniError } from '../errors.js';
import { getDateTimeFormat, getListFormat, getNumberFormat, getPluralRules } from './intl-cache.js';

export type MessageParams = { [name: string]: unknown };

const DATE_TIME_STYLES: { [style: string]: Intl.DateTimeFormatOptions } = {
    short: { dateStyle: 'short' },
    medium: { dateStyle: 'medium' },
    long: { dateStyle: 'long' },
    full: { dateStyle: 'full' },
};

const TIME_STYLES: { [style: string]: Intl.DateTimeFormatOptions } = {
    short: { timeStyle: 'short' },
    medium: { timeStyle: 'medium' },
    long: { timeStyle: 'long' },
    full: { timeStyle: 'full' },
};

const NUMBER_STYLES: { [style: string]: Intl.NumberFormatOptions } = {
    percent: { style: 'percent' },
    integer: { maximumFractionDigits: 0 },
};

type EvalContext = {
    locale: string;
    key: string;
    /** Current plural operand (post-offset), for `#` nodes. */
    pound?: number;
};

function param(params: MessageParams, name: string, ctx: EvalContext): unknown {
    const value = params[name];
    if (value === undefined) {
        throw new LinguiniError(`Missing parameter "${name}" for message "${ctx.key}"`);
    }
    return value;
}

function asNumber(value: unknown, name: string, ctx: EvalContext): number {
    const num = typeof value === 'number' ? value : Number(value);
    if (Number.isNaN(num)) {
        throw new LinguiniError(
            `Parameter "${name}" for message "${ctx.key}" is not a number: ${String(value)}`
        );
    }
    return num;
}

function asDate(value: unknown): Date {
    return value instanceof Date ? value : new Date(value as string | number);
}

export function evaluateMessage(
    nodes: MessageNode[],
    locale: string,
    key: string,
    params: MessageParams = {}
): string {
    return evalNodes(nodes, params, { locale, key });
}

function evalNodes(nodes: MessageNode[], params: MessageParams, ctx: EvalContext): string {
    let out = '';
    for (const node of nodes) {
        out += evalNode(node, params, ctx);
    }
    return out;
}

function evalNode(node: MessageNode, params: MessageParams, ctx: EvalContext): string {
    switch (node.kind) {
        case MessageNodeKind.TEXT: {
            return node.value;
        }
        case MessageNodeKind.ARG: {
            return String(param(params, node.name, ctx));
        }
        case MessageNodeKind.NUMBER: {
            const value = asNumber(param(params, node.name, ctx), node.name, ctx);
            const options = node.style ? NUMBER_STYLES[node.style] : undefined;
            return getNumberFormat(ctx.locale, options).format(value);
        }
        case MessageNodeKind.DATE: {
            const value = asDate(param(params, node.name, ctx));
            const options = DATE_TIME_STYLES[node.style ?? 'medium'] ?? DATE_TIME_STYLES['medium'];
            return getDateTimeFormat(ctx.locale, options).format(value);
        }
        case MessageNodeKind.TIME: {
            const value = asDate(param(params, node.name, ctx));
            const options = TIME_STYLES[node.style ?? 'medium'] ?? TIME_STYLES['medium'];
            return getDateTimeFormat(ctx.locale, options).format(value);
        }
        case MessageNodeKind.LIST: {
            const value = param(params, node.name, ctx);
            if (!Array.isArray(value)) {
                throw new LinguiniError(
                    `Parameter "${node.name}" for message "${ctx.key}" must be an array`
                );
            }
            return getListFormat(ctx.locale).format(value.map(String));
        }
        case MessageNodeKind.SELECT: {
            const value = String(param(params, node.name, ctx));
            const branch = node.branches[value] ?? node.branches['other'];
            if (!branch) {
                throw new LinguiniError(
                    `No "${value}" or "other" branch in select "${node.name}" of message "${ctx.key}"`
                );
            }
            return evalNodes(branch, params, ctx);
        }
        case MessageNodeKind.PLURAL: {
            const value = asNumber(param(params, node.name, ctx), node.name, ctx);
            const operand = value - node.offset;

            // Exact matches (`=0`, `=1`, ...) take precedence over CLDR categories and match
            // against the raw value, per ICU.
            let branch = node.branches[`=${value}`];
            if (!branch) {
                const category = getPluralRules(ctx.locale, {
                    type: node.ordinal ? 'ordinal' : 'cardinal',
                }).select(operand);
                branch = node.branches[category] ?? node.branches['other'];
            }
            if (!branch) {
                throw new LinguiniError(
                    `No matching branch in plural "${node.name}" of message "${ctx.key}"`
                );
            }
            return evalNodes(branch, params, { ...ctx, pound: operand });
        }
        case MessageNodeKind.POUND: {
            if (ctx.pound === undefined) {
                throw new LinguiniError(`"#" outside of a plural branch in message "${ctx.key}"`);
            }
            return getNumberFormat(ctx.locale).format(ctx.pound);
        }
    }
}
