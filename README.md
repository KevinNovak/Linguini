# Linguini

[![NPM Version](https://img.shields.io/npm/v/linguini.svg?maxAge=3600)](https://www.npmjs.com/package/linguini)
[![Downloads](https://img.shields.io/npm/dt/linguini.svg?maxAge=3600)](https://www.npmjs.com/package/linguini)
[![Stars](https://img.shields.io/github/stars/KevinNovak/Linguini.svg)](https://github.com/KevinNovak/Linguini/stargazers)
[![License](https://img.shields.io/badge/license-MIT-blue)](https://opensource.org/licenses/MIT)
[![Pull Requests](https://img.shields.io/badge/Pull%20Requests-Welcome!-brightgreen)](https://github.com/KevinNovak/Linguini/pulls)

**Npm package** - A JSON-based translation file manager.

`npm install linguini`

## Table of Contents

-   [Example](#example)
-   [Initial Setup](#initial-setup)
    -   [Installation](#installation)
    -   [Creating a Linguini Object](#creating-a-linguini-object)
-   [Type Mappers](#type-mappers)
    -   [Built-In Type Mappers](#built-in-type-mappers)
    -   [Custom Type Mappers](#custom-type-mappers)
-   [References](#references)
    -   [General References (REF)](#general-references--ref-)
    -   [Common References (COM)](#common-references--com-)
-   [Variables](#variables)

## Example

An example language file, `lang.en.json`:

```jsonc
{
    "data": {
        // This is a language category:
        "intro": {
            // This is a language item:
            "myFavoriteColor": "My favorite color is blue."
        }
    }
}
```

We could have additional translations of this file, for example: `lang.fr.json`, `lang.ru.json`, etc:

![](https://i.imgur.com/l3CMVe8.png)

Using Linguini, we can retrieve the language item from the appropriate file by passing in the location of the item, and the language code to use:

```ts
let englishLine = linguini.get('intro.myFavoriteColor', 'en', stringTm);
console.log(englishLine);
// Outputs: "My favorite color is blue."

let frenchLine = linguini.get('intro.myFavoriteColor', 'fr', stringTm);
console.log(frenchLine);
// Outputs: "Ma couleur préférée est le bleu."
```

Here `'intro.myFavoriteColor'` is the category and name of the language item, while `'en'` or `'fr'` tells Linguini which language file to pull from: either `lang.en.json` or `lang.fr.json`.

_Side note: If you're wondering what the `stringTm` is for, see the section below on [Type Mappers](#type-mappers)._

## Initial Setup

### Installation

`npm install linguini`

### Creating a Linguini Object

```ts
import { Linguini } from 'linguini';

 // The folder path containing the language files.
let folderPath = path.join(__dirname, './data'),

// The base name of the language files to use. Note this should not include any file extensions or language codes.
let fileName = 'lang';

let linguini = new Linguini(folderPath, fileName);
```

## Type Mappers

Type Mappers are a special kind of function which allow Linguini to convert the JSON language item that was retrieved from the language file into any type of your choice.

### Built-In Type Mappers

Linguini has many built-in Type Mappers which can be used inside the `Linguini#get()` method to retrieve language item values as specific types.

Linguini's built-in Type Mappers:

-   `stringTm`
-   `booleanTm`
-   `numberTm`
-   `bigIntTm`
-   `dateTm`
-   `regExpTm`
-   `urlTm`

For example, let's say you want Linguini to retrieve, not just a plain string, but a [RegExp](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp) object. Linguini has a built-in Type Mapper to convert a JSON language item into a `RegExp`.

Simply import and use the `regExpTm` Type Mapper inside the `Linguini#get()` method:

```ts
import { regExpTm } from 'linguini';

// ...

let regex = linguini.get('regexes.hello', 'en', regExpTm);
```

And in our language file:

```json
{
    "data": {
        "regexes": {
            "hello": { "pattern": "hello", "flags": "i" }
        }
    }
}
```

Notice how this language item is not just a string, but has 2 properties: `pattern` and `flags`. Using Type Mappers allows Linguini to convert just about any JSON data into any type you wish.

### Custom Type Mappers

## References

### General References (REF)

### Common References (COM)

## Variables
