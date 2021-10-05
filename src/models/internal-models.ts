export type LangFile = {
    data: CategoryItems<any>;
    refs: CategoryItems<string | string[]>;
};

export type CommonFile = CategoryItems<string | string[]>;

export interface CategoryItems<T> {
    [categoryName: string]: { [itemName: string]: T };
}

export type TypeMapper<T> = (jsonValue: any) => T;
