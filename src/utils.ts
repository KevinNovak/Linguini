import { StringUtils } from './utils/';

export class Utils {
    /**
     * Joins a string array into a string. Useful for custom Type Mappers.
     *
     * @param input - The string array (or string) to join.
     * @param separator - A separator string to place between items.
     *
     * @returns The joined string.
     */
    public static join(input: string | string[], separator: string): string {
        return StringUtils.join(input, separator);
    }
}
