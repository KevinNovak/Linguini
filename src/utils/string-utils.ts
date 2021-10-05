// TODO: Export this utility function?
export class StringUtils {
    public static join(input: string | string[], separator: string): string {
        return typeof input === 'string' ? input : input.join(separator);
    }
}
