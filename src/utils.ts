import { StringUtils } from './utils/';

export class Utils {
    public static join(input: string | string[], separator: string): string {
        return StringUtils.join(input, separator);
    }
}
