/**
 * Built-in formatters for common translation variable patterns.
 * These help format values before passing them as variables.
 *
 * @example
 * ```typescript
 * linguini.t('lastSeen', 'en-US', {
 *     DATE: Formatters.relativeTime(date),
 *     COUNT: Formatters.number(1234567, 'en-US'),
 * });
 * ```
 */
export class Formatters {
    /**
     * Format a number with locale-specific formatting.
     *
     * @param value - The number to format.
     * @param locale - The locale for formatting (default: 'en-US').
     * @param options - Intl.NumberFormat options.
     * @returns Formatted number string.
     *
     * @example
     * ```typescript
     * Formatters.number(1234567);           // "1,234,567"
     * Formatters.number(1234.56, 'de-DE');  // "1.234,56"
     * ```
     */
    public static number(
        value: number,
        locale: string = 'en-US',
        options?: Intl.NumberFormatOptions
    ): string {
        return new Intl.NumberFormat(locale, options).format(value);
    }

    /**
     * Format a number as currency.
     *
     * @param value - The amount to format.
     * @param currency - The currency code (e.g., 'USD', 'EUR').
     * @param locale - The locale for formatting (default: 'en-US').
     * @returns Formatted currency string.
     *
     * @example
     * ```typescript
     * Formatters.currency(19.99, 'USD');           // "$19.99"
     * Formatters.currency(19.99, 'EUR', 'de-DE'); // "19,99 €"
     * ```
     */
    public static currency(
        value: number,
        currency: string,
        locale: string = 'en-US'
    ): string {
        return new Intl.NumberFormat(locale, {
            style: 'currency',
            currency,
        }).format(value);
    }

    /**
     * Format a number as a percentage.
     *
     * @param value - The decimal value (0.5 = 50%).
     * @param locale - The locale for formatting (default: 'en-US').
     * @param decimals - Number of decimal places (default: 0).
     * @returns Formatted percentage string.
     *
     * @example
     * ```typescript
     * Formatters.percent(0.756);     // "76%"
     * Formatters.percent(0.756, 'en-US', 1); // "75.6%"
     * ```
     */
    public static percent(
        value: number,
        locale: string = 'en-US',
        decimals: number = 0
    ): string {
        return new Intl.NumberFormat(locale, {
            style: 'percent',
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
        }).format(value);
    }

    /**
     * Format a date with various styles.
     *
     * @param date - The date to format.
     * @param locale - The locale for formatting (default: 'en-US').
     * @param style - The date style ('short', 'medium', 'long', 'full').
     * @returns Formatted date string.
     *
     * @example
     * ```typescript
     * Formatters.date(new Date(), 'en-US', 'short'); // "12/4/24"
     * Formatters.date(new Date(), 'en-US', 'long');  // "December 4, 2024"
     * ```
     */
    public static date(
        date: Date,
        locale: string = 'en-US',
        style: 'short' | 'medium' | 'long' | 'full' = 'medium'
    ): string {
        return new Intl.DateTimeFormat(locale, { dateStyle: style }).format(date);
    }

    /**
     * Format a time with various styles.
     *
     * @param date - The date/time to format.
     * @param locale - The locale for formatting (default: 'en-US').
     * @param style - The time style ('short', 'medium', 'long', 'full').
     * @returns Formatted time string.
     *
     * @example
     * ```typescript
     * Formatters.time(new Date(), 'en-US', 'short'); // "3:30 PM"
     * ```
     */
    public static time(
        date: Date,
        locale: string = 'en-US',
        style: 'short' | 'medium' | 'long' | 'full' = 'short'
    ): string {
        return new Intl.DateTimeFormat(locale, { timeStyle: style }).format(date);
    }

    /**
     * Format a date and time together.
     *
     * @param date - The date/time to format.
     * @param locale - The locale for formatting (default: 'en-US').
     * @param dateStyle - The date style.
     * @param timeStyle - The time style.
     * @returns Formatted date and time string.
     */
    public static dateTime(
        date: Date,
        locale: string = 'en-US',
        dateStyle: 'short' | 'medium' | 'long' | 'full' = 'medium',
        timeStyle: 'short' | 'medium' | 'long' | 'full' = 'short'
    ): string {
        return new Intl.DateTimeFormat(locale, { dateStyle, timeStyle }).format(date);
    }

    /**
     * Format a relative time (e.g., "2 hours ago", "in 3 days").
     *
     * @param date - The date to compare against now.
     * @param locale - The locale for formatting (default: 'en-US').
     * @param style - The style ('long', 'short', 'narrow').
     * @returns Formatted relative time string.
     *
     * @example
     * ```typescript
     * const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
     * Formatters.relativeTime(twoHoursAgo); // "2 hours ago"
     *
     * const inThreeDays = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
     * Formatters.relativeTime(inThreeDays); // "in 3 days"
     * ```
     */
    public static relativeTime(
        date: Date,
        locale: string = 'en-US',
        style: 'long' | 'short' | 'narrow' = 'long'
    ): string {
        const rtf = new Intl.RelativeTimeFormat(locale, { style });
        const now = Date.now();
        const diffMs = date.getTime() - now;
        const diffSec = Math.round(diffMs / 1000);
        const diffMin = Math.round(diffSec / 60);
        const diffHour = Math.round(diffMin / 60);
        const diffDay = Math.round(diffHour / 24);
        const diffWeek = Math.round(diffDay / 7);
        const diffMonth = Math.round(diffDay / 30);
        const diffYear = Math.round(diffDay / 365);

        if (Math.abs(diffSec) < 60) {
            return rtf.format(diffSec, 'second');
        } else if (Math.abs(diffMin) < 60) {
            return rtf.format(diffMin, 'minute');
        } else if (Math.abs(diffHour) < 24) {
            return rtf.format(diffHour, 'hour');
        } else if (Math.abs(diffDay) < 7) {
            return rtf.format(diffDay, 'day');
        } else if (Math.abs(diffWeek) < 4) {
            return rtf.format(diffWeek, 'week');
        } else if (Math.abs(diffMonth) < 12) {
            return rtf.format(diffMonth, 'month');
        } else {
            return rtf.format(diffYear, 'year');
        }
    }

    /**
     * Format a list of items with proper grammar.
     *
     * @param items - The items to join.
     * @param locale - The locale for formatting (default: 'en-US').
     * @param type - The list type ('conjunction', 'disjunction', 'unit').
     * @returns Formatted list string.
     *
     * @example
     * ```typescript
     * Formatters.list(['Alice', 'Bob', 'Charlie']);
     * // "Alice, Bob, and Charlie"
     *
     * Formatters.list(['cats', 'dogs'], 'en-US', 'disjunction');
     * // "cats or dogs"
     * ```
     */
    public static list(
        items: string[],
        locale: string = 'en-US',
        type: 'conjunction' | 'disjunction' | 'unit' = 'conjunction'
    ): string {
        // Use Intl.ListFormat if available (Node 12+), otherwise fallback
        if (typeof (Intl as any).ListFormat !== 'undefined') {
            return new (Intl as any).ListFormat(locale, { type }).format(items);
        }

        // Fallback for older environments
        if (items.length === 0) return '';
        if (items.length === 1) return items[0];
        if (items.length === 2) {
            const connector = type === 'disjunction' ? ' or ' : ' and ';
            return items.join(connector);
        }

        const lastItem = items[items.length - 1];
        const otherItems = items.slice(0, -1);
        const connector = type === 'disjunction' ? ', or ' : ', and ';
        return otherItems.join(', ') + connector + lastItem;
    }

    /**
     * Truncate a string to a maximum length, adding ellipsis if needed.
     *
     * @param text - The text to truncate.
     * @param maxLength - Maximum length including ellipsis.
     * @param ellipsis - The ellipsis string (default: '...').
     * @returns Truncated string.
     *
     * @example
     * ```typescript
     * Formatters.truncate('Hello World', 8); // "Hello..."
     * ```
     */
    public static truncate(
        text: string,
        maxLength: number,
        ellipsis: string = '...'
    ): string {
        if (text.length <= maxLength) {
            return text;
        }
        return text.slice(0, maxLength - ellipsis.length) + ellipsis;
    }

    /**
     * Format a duration in milliseconds to a human-readable string.
     *
     * @param ms - Duration in milliseconds.
     * @param options - Formatting options.
     * @returns Formatted duration string.
     *
     * @example
     * ```typescript
     * Formatters.duration(3661000);           // "1h 1m 1s"
     * Formatters.duration(3661000, { verbose: true }); // "1 hour 1 minute 1 second"
     * ```
     */
    public static duration(
        ms: number,
        options: { verbose?: boolean; maxUnits?: number } = {}
    ): string {
        const { verbose = false, maxUnits = 3 } = options;

        const units = [
            { ms: 31536000000, short: 'y', long: 'year' },
            { ms: 2592000000, short: 'mo', long: 'month' },
            { ms: 604800000, short: 'w', long: 'week' },
            { ms: 86400000, short: 'd', long: 'day' },
            { ms: 3600000, short: 'h', long: 'hour' },
            { ms: 60000, short: 'm', long: 'minute' },
            { ms: 1000, short: 's', long: 'second' },
        ];

        const parts: string[] = [];
        let remaining = Math.abs(ms);

        for (const unit of units) {
            if (parts.length >= maxUnits) break;

            const count = Math.floor(remaining / unit.ms);
            if (count > 0) {
                remaining -= count * unit.ms;
                if (verbose) {
                    parts.push(`${count} ${unit.long}${count !== 1 ? 's' : ''}`);
                } else {
                    parts.push(`${count}${unit.short}`);
                }
            }
        }

        if (parts.length === 0) {
            return verbose ? '0 seconds' : '0s';
        }

        return parts.join(' ');
    }

    /**
     * Format bytes to a human-readable size string.
     *
     * @param bytes - The number of bytes.
     * @param decimals - Number of decimal places (default: 2).
     * @returns Formatted size string.
     *
     * @example
     * ```typescript
     * Formatters.bytes(1024);        // "1 KB"
     * Formatters.bytes(1536, 1);     // "1.5 KB"
     * Formatters.bytes(1073741824);  // "1 GB"
     * ```
     */
    public static bytes(bytes: number, decimals: number = 2): string {
        if (bytes === 0) return '0 Bytes';

        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
    }

    /**
     * Convert a string to title case.
     *
     * @param text - The text to convert.
     * @returns Title-cased string.
     *
     * @example
     * ```typescript
     * Formatters.titleCase('hello world'); // "Hello World"
     * ```
     */
    public static titleCase(text: string): string {
        return text.replace(/\w\S*/g, txt =>
            txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase()
        );
    }

    /**
     * Pad a string/number to a minimum length.
     *
     * @param value - The value to pad.
     * @param length - The minimum length.
     * @param char - The padding character (default: '0').
     * @param direction - Pad 'left' or 'right' (default: 'left').
     * @returns Padded string.
     *
     * @example
     * ```typescript
     * Formatters.pad(5, 2);           // "05"
     * Formatters.pad('hi', 5, ' ', 'right'); // "hi   "
     * ```
     */
    public static pad(
        value: string | number,
        length: number,
        char: string = '0',
        direction: 'left' | 'right' = 'left'
    ): string {
        const str = String(value);
        if (str.length >= length) return str;

        const padding = char.repeat(length - str.length);
        return direction === 'left' ? padding + str : str + padding;
    }
}

