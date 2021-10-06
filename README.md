# Linguini

[![NPM Version](https://img.shields.io/npm/v/linguini.svg?maxAge=3600)](https://www.npmjs.com/package/linguini)
[![Downloads](https://img.shields.io/npm/dt/linguini.svg?maxAge=3600)](https://www.npmjs.com/package/linguini)
[![Stars](https://img.shields.io/github/stars/KevinNovak/Linguini.svg)](https://github.com/KevinNovak/Linguini/stargazers)
[![License](https://img.shields.io/badge/license-MIT-blue)](https://opensource.org/licenses/MIT)
[![Pull Requests](https://img.shields.io/badge/Pull%20Requests-Welcome!-brightgreen)](https://github.com/KevinNovak/Linguini/pulls)

**Npm package** - A JSON-based translation file manager.

## Table of Contents

-   [Example Language File](#example-language-file)
-   [Example Usage](#example-usage)
-   [Initial Setup](#initial-setup)
    -   [Installation](#installation)
    -   [Usage](#usage)

## Example Language File

An example language file, `lang.en.json`:

```json
{
    "data": {
        "intro": {
            "myFavoriteColor": "My favorite color is blue."
        }
    }
}
```

We could have additional translations of this file, for example: `lang.fr.json`, `lang.ru.json`, etc:

![](https://i.imgur.com/l3CMVe8.png)

## Example Usage

An example of using Linguini with the above language file:

```ts
let englishLine = linguini.get('intro.myFavoriteColor', 'en', stringTm); // "My favorite color is blue."
let frenchLine = linguini.get('intro.myFavoriteColor', 'fr', stringTm); // "Ma couleur préférée est le bleu."
```

## Initial Setup

### Installation

`npm install linguini`

### Usage

```ts
import { Linguini } from 'linguini';

 // The folder path containing the language files.
let folderPath = path.join(__dirname, './data'),

// The base name of the language files to use. Note this should not include any file extensions or language codes.
let fileName = 'lang';

let linguini = new Linguini(folderPath, fileName);
```
