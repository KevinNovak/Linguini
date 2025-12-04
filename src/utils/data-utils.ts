import { StringUtils } from './';

export class DataUtils {
    public static replaceVariables(input: string, variables: { [name: string]: string }): string {
        let output = input;
        for (let [varName, varValue] of Object.entries(variables)) {
            output = output.replaceAll(`{{${varName}}}`, varValue);
        }
        return output;
    }

    public static replaceVariablesInObj(
        jsonValue: any,
        variables: { [name: string]: string }
    ): any {
        switch (typeof jsonValue) {
            case 'object': {
                if (jsonValue === null) break;
                for (let key in jsonValue) {
                    // "for ... in" loops over all properties, including prototypes
                    // So we need to check if this property belong to only the object
                    if (!jsonValue.hasOwnProperty(key)) {
                        continue;
                    }
                    jsonValue[key] = this.replaceVariablesInObj(jsonValue[key], variables);
                }
                break;
            }
            case 'string': {
                jsonValue = this.replaceVariables(jsonValue, variables);
                break;
            }
            default: {
                break;
            }
        }

        return jsonValue;
    }

    /**
     * Flatten a nested object to dot-notation keys.
     * Supports arbitrary nesting depth, or can be limited to a specific depth.
     *
     * @param input - The object to flatten
     * @param prefix - Prefix for keys (used internally for recursion)
     * @param maxDepth - Maximum depth to flatten. If undefined, flattens completely.
     *                   A depth of 2 means category.item (legacy format).
     * @param currentDepth - Current depth (used internally for recursion)
     */
    public static flatten<T = any>(
        input: Record<string, any>,
        prefix: string = '',
        maxDepth?: number,
        currentDepth: number = 0
    ): Record<string, T> {
        let output: Record<string, T> = {};

        for (let [key, value] of Object.entries(input)) {
            const fullKey = prefix ? `${prefix}.${key}` : key;
            const nextDepth = currentDepth + 1;

            // If we've reached max depth, stop recursing
            if (maxDepth !== undefined && nextDepth >= maxDepth) {
                output[fullKey] = value;
            } else if (this.isPlainObject(value)) {
                // Recursively flatten nested objects
                const nested = this.flatten<T>(value, fullKey, maxDepth, nextDepth);
                Object.assign(output, nested);
            } else {
                // Leaf value (string, array, number, etc.)
                output[fullKey] = value;
            }
        }

        return output;
    }

    /**
     * Flatten a nested object to variables with a prefix.
     * String arrays are joined with newlines.
     */
    public static flattenToVariables(
        input: Record<string, any>,
        prefix: string = ''
    ): Record<string, string> {
        let output: Record<string, string> = {};

        for (let [key, value] of Object.entries(input)) {
            const fullKey = `${prefix}${key}`;

            if (this.isPlainObject(value)) {
                // Recursively flatten nested objects
                const nested = this.flattenToVariables(value, `${fullKey}.`);
                Object.assign(output, nested);
            } else {
                // Leaf value - convert to string
                output[fullKey] = StringUtils.join(value, '\n');
            }
        }

        return output;
    }

    /**
     * Check if a value is a plain object (not array, null, etc.).
     */
    private static isPlainObject(value: any): value is Record<string, any> {
        return (
            typeof value === 'object' &&
            value !== null &&
            !Array.isArray(value) &&
            value.constructor === Object
        );
    }
}
