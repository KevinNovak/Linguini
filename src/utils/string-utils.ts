export class StringUtils {
    public static join(input: string | string[], separator: string): string {
        return input instanceof Array ? input.join(separator) : input;
    }
}
