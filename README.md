# Linguini

[![NPM Version](https://img.shields.io/npm/v/linguini.svg?maxAge=3600)](https://www.npmjs.com/package/linguini)
[![Downloads](https://img.shields.io/npm/dt/linguini.svg?maxAge=3600)](https://www.npmjs.com/package/linguini)
[![Stars](https://img.shields.io/github/stars/KevinNovak/Linguini.svg)](https://github.com/KevinNovak/Linguini/stargazers)
[![License](https://img.shields.io/badge/license-MIT-blue)](https://opensource.org/licenses/MIT)
[![Pull Requests](https://img.shields.io/badge/Pull%20Requests-Welcome!-brightgreen)](https://github.com/KevinNovak/Linguini/pulls)

**Npm package** - A JSON-based translation file manager.

## Installation

`npm install linguini`

## Example Language File

An example language file, `lang.en.json`:

```json
{
    "data": {
        "intro": {
            "myFavoriteColor": "My favorite color is {{REF:aboutMe.favoriteColor}}."
        }
    },
    "refs": {
        "aboutMe": {
            "favoriteColor": "Blue"
        }
    }
}
```

We could have additional translations of this file, for example: `lang.fr.json`, `lang.ru.json`, etc:

![](https://i.imgur.com/l3CMVe8.png)

## Example Usage

An example of using Linguini with the above language file:

```ts
let englishLine = linguini.get('intro.myFavoriteColor', 'en', stringTm); // "My favorite color is Blue."
let frenchLine = linguini.get('intro.myFavoriteColor', 'fr', stringTm); // "Ma couleur préférée est le bleu."
```

## Setup

`npm install linguini`

```ts
let linguini = new Linguini(path.join(__dirname, './data'), 'lang');
```
