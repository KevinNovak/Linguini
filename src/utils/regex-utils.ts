const LANG_FILE_REGEX = '^{{FILE_NAME}}\\.(?!common)([^.]+)\\.json$';

export class RegexUtils {
    public static getLangCodes(fileName: string, fileNames: string[]): string[] {
        let regex = new RegExp(LANG_FILE_REGEX.replace('{{FILE_NAME}}', fileName));
        return fileNames.flatMap(fileName => {
            let langCode = fileName.match(regex)?.[1];
            return langCode ?? [];
        });
    }
}
