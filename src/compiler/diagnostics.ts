export enum Severity {
    ERROR = 'ERROR',
    WARNING = 'WARNING',
}

export enum DiagnosticCode {
    // Config / IO
    CONFIG = 'CONFIG',
    READ_FILE = 'READ_FILE',
    NO_NAMESPACES = 'NO_NAMESPACES',
    NS_MISSING_BASE = 'NS_MISSING_BASE',
    // Structure
    DOTTED_KEY = 'DOTTED_KEY',
    INVALID_VALUE = 'INVALID_VALUE',
    INVALID_VARIANTS = 'INVALID_VARIANTS',
    INVALID_TYPE = 'INVALID_TYPE',
    INVALID_REF_VALUE = 'INVALID_REF_VALUE',
    // Includes
    REF_CYCLE = 'REF_CYCLE',
    UNKNOWN_REF = 'UNKNOWN_REF',
    UNKNOWN_COM = 'UNKNOWN_COM',
    INVALID_INCLUDE = 'INVALID_INCLUDE',
    UNKNOWN_TOKEN = 'UNKNOWN_TOKEN',
    // ICU
    ICU_PARSE = 'ICU_PARSE',
    ICU_UNSUPPORTED = 'ICU_UNSUPPORTED',
    PARAM_CONFLICT = 'PARAM_CONFLICT',
    PLURAL_COVERAGE = 'PLURAL_COVERAGE',
    VARIANT_PARAMS = 'VARIANT_PARAMS',
    // Cross-locale validation
    EXTRA_KEY = 'EXTRA_KEY',
    MISSING_KEY = 'MISSING_KEY',
    FORM_MISMATCH = 'FORM_MISMATCH',
    UNKNOWN_PARAM = 'UNKNOWN_PARAM',
    PARAM_TYPE_MISMATCH = 'PARAM_TYPE_MISMATCH',
    // Lints
    MID_SENTENCE_REF = 'MID_SENTENCE_REF',
    ARG_CASE = 'ARG_CASE',
    EMPTY_MESSAGE = 'EMPTY_MESSAGE',
}

export type Diagnostic = {
    severity: Severity;
    code: DiagnosticCode;
    message: string;
    /** Authoring file the diagnostic points at, when known. */
    file?: string;
    /** Fully-qualified message key, when known. */
    key?: string;
};

export class Diagnostics {
    public readonly items: Diagnostic[] = [];

    public error(
        code: DiagnosticCode,
        message: string,
        where: { file?: string; key?: string } = {}
    ): void {
        this.items.push({ severity: Severity.ERROR, code, message, ...where });
    }

    public warn(
        code: DiagnosticCode,
        message: string,
        where: { file?: string; key?: string } = {}
    ): void {
        this.items.push({ severity: Severity.WARNING, code, message, ...where });
    }

    public report(
        severity: Severity,
        code: DiagnosticCode,
        message: string,
        where: { file?: string; key?: string } = {}
    ): void {
        this.items.push({ severity, code, message, ...where });
    }

    public get errors(): Diagnostic[] {
        return this.items.filter(d => d.severity === Severity.ERROR);
    }

    public get warnings(): Diagnostic[] {
        return this.items.filter(d => d.severity === Severity.WARNING);
    }

    public get hasErrors(): boolean {
        return this.items.some(d => d.severity === Severity.ERROR);
    }
}

export function formatDiagnostic(d: Diagnostic): string {
    const where = [d.file, d.key].filter(Boolean).join(' › ');
    return `${d.severity.toLowerCase()}[${d.code}] ${d.message}${where ? ` (${where})` : ''}`;
}
