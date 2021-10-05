import { existsSync, readdirSync, readFileSync } from 'fs';

export class FileUtils {
    public static exists(path: string): boolean {
        return existsSync(path);
    }

    public static readFileSync(filePath: string): string {
        return readFileSync(filePath, { encoding: 'utf8' });
    }

    public static readFileNamesSync(folderPath: string): string[] {
        return readdirSync(folderPath, { encoding: 'utf8' });
    }
}
