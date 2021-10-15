import { CategoryItems } from '../models/internal-models';
import { StringUtils } from './';

export class DataUtils {
    public static replaceVariables(input: string, variables: { [name: string]: string }): string {
        let output = input;
        for (let [varName, varValue] of Object.entries(variables)) {
            output = output.replaceAll(`{{${varName}}}`, varValue);
        }
        return output;
    }

    public static replaceVariablesInObj(input: any, variables: { [name: string]: string }): any {
        let output: any;
        switch (typeof input) {
            case 'object': {
                output = JSON.parse(JSON.stringify(input));
                break;
            }
            default: {
                output = input;
                break;
            }
        }

        switch (typeof output) {
            case 'object': {
                for (let key in output) {
                    // "for ... in" loops over all properties, including prototypes
                    // So we need to check if this property belong to only the object
                    if (!output.hasOwnProperty(key)) {
                        continue;
                    }
                    output[key] = this.replaceVariablesInObj(output[key], variables);
                }
                break;
            }
            case 'string': {
                output = this.replaceVariables(output, variables);
                break;
            }
            default: {
                break;
            }
        }

        return output;
    }

    public static flatten<T>(input: CategoryItems<T>): { [refName: string]: T } {
        let output: { [refName: string]: any } = {};
        for (let [categoryName, categoryData] of Object.entries(input)) {
            for (let [itemName, itemData] of Object.entries(categoryData)) {
                output[`${categoryName}.${itemName}`] = itemData;
            }
        }
        return output;
    }

    public static flattenToVariables(
        input: CategoryItems<string | string[]>,
        prefix?: string
    ): { [refName: string]: string } {
        let output: { [refName: string]: any } = {};
        for (let [categoryName, categoryData] of Object.entries(input)) {
            for (let [itemName, itemData] of Object.entries(categoryData)) {
                output[`${prefix}${categoryName}.${itemName}`] = StringUtils.join(itemData, '\n');
            }
        }
        return output;
    }
}
