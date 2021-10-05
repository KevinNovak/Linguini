import path from 'path';
import { CommonFile, LangFile, TypeMapper } from './models/internal-models';
import { DataUtils, FileUtils, RegexUtils } from './utils';

type LinguiniOptions = {
    /**
     * Number of levels variables should be replaced.
     * @defaultValue `10`
     */
    replacementLevels: number;
};

export class Linguini {
    private options: LinguiniOptions = {
        replacementLevels: 10,
    };
    private langDatas: {
        [langCode: string]: { [location: string]: any };
    } = {};

    /**
     * Creates a new Linguini object to manage language files.
     *
     * @param folderPath - The folder path containing the language files.
     * @param fileName - The base name of the language files to use. Note this should not include any file extensions or language codes. Ex: `lang`.
     * @param options - Options to use for this Linguini setup.
     *
     * @returns A new Linguini object.
     */
    constructor(
        private folderPath: string,
        private fileName: string,
        options: Partial<LinguiniOptions> = {}
    ) {
        this.options = Object.assign(this.options, options);

        // Locate common file
        let comFileName = `${this.fileName}.common.json`;
        let comFilePath = path.join(this.folderPath, comFileName);

        let comVars: { [refName: string]: string } = {};
        if (FileUtils.exists(comFilePath)) {
            // Read common file
            let comFileContents = FileUtils.readFileSync(comFilePath);
            let comFile = JSON.parse(comFileContents) as CommonFile;

            // Extract common variables
            comVars = DataUtils.flattenToVariables(comFile, 'COM:');
            for (let i = 0; i < this.options.replacementLevels; i++) {
                comVars = DataUtils.replaceVariablesInObj(comVars, comVars);
            }
        }

        let fileNames = FileUtils.readFileNamesSync(this.folderPath);
        let langCodes = RegexUtils.getLangCodes(this.fileName, fileNames);

        for (let langCode of langCodes) {
            // Locate lang file
            let langFileName = `${this.fileName}.${langCode}.json`;
            let langFilePath = path.join(this.folderPath, langFileName);

            // Read lang file
            let langFileContents = FileUtils.readFileSync(langFilePath);
            let langFile = JSON.parse(langFileContents) as LangFile;

            // Extract ref variables
            let refVars = DataUtils.flattenToVariables(langFile.refs, 'REF:');
            for (let i = 0; i < this.options.replacementLevels; i++) {
                refVars = DataUtils.replaceVariablesInObj(refVars, refVars);
            }

            // Replace variables in lang data
            let langData = DataUtils.replaceVariablesInObj(langFile.data, refVars);
            langData = DataUtils.replaceVariablesInObj(langFile.data, comVars);

            // Store lang data
            this.langDatas[langCode] = DataUtils.flatten(langData);
        }
    }

    /**
     * Returns an item from a language file, mapped to a type.
     *
     * @param location - The location of the item in the language file, using dot-notation, and relative to the "data" section in the JSON. Ex: `myCategory.myItem`.
     * @param langCode - The language file code to extract from. Ex: `en`.
     * @param typeMapper - A function which maps the retrieved item data to a type.
     * @param variables - Any variables (Ex: `{{MY_VARIABLE}}`) to replace in the retrieved data.
     *
     * @returns The retrieved language file item.
     */
    public get<T>(
        location: string,
        langCode: string,
        typeMapper: TypeMapper<T>,
        variables?: { [name: string]: string }
    ): T {
        let raw = this.getRaw(location, langCode, variables);
        return typeMapper(raw);
    }

    /**
     * Returns an item from a language file, as raw JSON.
     *
     * @param location - The location of the item in the language file, using dot-notation, and relative to the "data" section in the JSON. Ex: `myCategory.myItem`.
     * @param langCode - The language file code to extract from. Ex: `en`.
     * @param variables - Any variables (Ex: `{{MY_VARIABLE}}`) to replace in the retrieved data.
     *
     * @returns The retrieved language file item.
     */
    public getRaw(location: string, langCode: string, variables?: { [name: string]: string }): any {
        let output = this.langDatas[langCode][location];
        if (variables) {
            output = DataUtils.replaceVariablesInObj(output, variables);
        }
        return output;
    }
}
