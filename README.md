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
-   [Variables](#variables)
-   [References](#references)
    -   [General References (REF)](#general-references-ref)
    -   [Common References (COM)](#common-references-com)

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
    },
    "refs": {}
}
```

We could have additional translations of this file, for example: `lang.fr.json`, `lang.ru.json`, etc:

![](https://i.imgur.com/l3CMVe8.png)

Using Linguini, we can retrieve the language item from the appropriate file by passing in the location of the item, and the language code to use:

```js
let englishLine = linguini.get('intro.myFavoriteColor', 'en', TypeMappers.String);
console.log(englishLine);
// Outputs: "My favorite color is blue."

let frenchLine = linguini.get('intro.myFavoriteColor', 'fr', TypeMappers.String);
console.log(frenchLine);
// Outputs: "Ma couleur préférée est le bleu."
```

Here `'intro.myFavoriteColor'` is the category and name of the language item, while `'en'` or `'fr'` tells Linguini which language file to pull from: either `lang.en.json` or `lang.fr.json`.

_Side note: If you're wondering what the `TypeMappers.String` is for, see the section below on [Type Mappers](#type-mappers)._

## Initial Setup

### Installation

`npm install linguini`

### Creating a Linguini Object

```js
import { Linguini } from 'linguini';

// The folder path containing the language files.
let folderPath = path.join(__dirname, './data');

// The base name of the language files to use. Note this should not include any file extensions or language codes.
let fileName = 'lang';

let linguini = new Linguini(folderPath, fileName);
```

## Type Mappers

Type Mappers are a special kind of function which allow Linguini to convert the JSON language item that was retrieved from the language file into any type of your choice.

### Built-In Type Mappers

Linguini has many built-in Type Mappers which can be used inside the `Linguini#get()` method to retrieve language item values as specific types.

Linguini's built-in Type Mappers:

-   `String`
-   `Boolean`
-   `Number`
-   `BigInt`
-   `Date`
-   `RegExp`
-   `URL`

For example, let's say you want Linguini to retrieve, not just a plain string, but a [RegExp](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp) object. Linguini has a built-in Type Mapper to convert a JSON language item into a `RegExp`.

Simply import and use `TypeMappers.RegExp` inside the `Linguini#get()` method:

```js
import { TypeMappers } from 'linguini';

// ...

let regex = linguini.get('regexes.hello', 'en', TypeMappers.RegExp);
```

And in our language file:

```json
{
    "data": {
        "regexes": {
            "hello": { "pattern": "hello", "flags": "i" }
        }
    },
    "refs": {}
}
```

Notice how this language item is not just a string, but has 2 properties: `pattern` and `flags`. Using Type Mappers allows Linguini to convert just about any JSON data into any type you wish.

### Custom Type Mappers

If Linguini doesn't have a built-in Type Mapper that suits your needs, you can always create you own. A Type Mapper is simply a function that takes the JSON language item and returns the mapped type.

For example, we can create `Person` Type Mapper, `personTm`:

```js
let personTm = jsonValue => new Person(jsonValue.firstName, jsonValue.lastName);
```

And in our language file, we can define `Person` objects like so:

```json
{
    "data": {
        "superheroes": {
            "batman": { "firstName": "Bruce", "lastName": "Wayne" },
            "superman": { "firstName": "Clark", "lastName": "Kent" }
        }
    },
    "refs": {}
}
```

## Variables

Variables allow you to dynamically pass in values to your language items. A variable can be defined in a language file using double curly braces like so: `{{MY_VARIABLE}}`.

Here is a full example:

```json
{
    "data": {
        "intro": {
            "welcome": "Welcome {{FIRST_NAME}} {{LAST_NAME}} to our club!"
        }
    },
    "refs": {}
}
```

Then in our code, we can pass in values for the variables like so:

```js
let welcomeLine = linguini.get('intro.welcome', 'en', TypeMappers.String, {
    FIRST_NAME: 'Harley',
    LAST_NAME: 'Quinn',
});
console.log(welcomeLine);
// Outputs: "Welcome Harley Quinn to our club!"
```

## References

If you find yourself repeating the same word or phrase over and over in a language file, then references will be your best friend! You can define a commonly used word/phrase once, and then reference it anywhere you need it!

### General References (REF)

General references are defined in a language file using double curly braces with a `REF:` prefix like so: `{{REF:myCategory.myItem}}`, and are used to point to an item in the `"refs"` section of the language file.

Here is an example:

```jsonc
{
    "data": {
        "intro": {
            "myFavoriteColor": "My favorite color is {{REF:aboutMe.favoriteColor}}.",
            "yourFavoriteColor": "Is your favorite color {{REF:aboutMe.favoriteColor}} too?"
        }
    },
    "refs": {
        // This is a general reference category:
        "aboutMe": {
            // This is a general reference item:
            "favoriteColor": "purple"
        }
    }
}
```

And in the code:

```js
let myFavoriteColor = linguini.get('intro.myFavoriteColor', 'en', TypeMappers.String);
console.log(myFavoriteColor);
// Outputs: "My favorite color is purple!"

let yourFavoriteColor = linguini.get('intro.yourFavoriteColor', 'en', TypeMappers.String);
console.log(yourFavoriteColor);
// Outputs: "Is your favorite color purple too?"
```

You can also retrieve a reference directly by using `Linguini#getRef()`.

### Common References (COM)

Common References are handy when you want to use the same word/phrase across _multiple_ language files. For example, links are a good place to use Common References, since links are typically displayed alongside translated text, but often stay the same regardless of language.

To use Common References, create a file that matches your language file names, but use `common` as the language code. For example: `lang.common.json`.

In the common language file, you can define references like so:

```jsonc
{
    // This is a common reference category:
    "links": {
        // This is a common reference item:
        "github": "https://github.com/KevinNovak"
    }
}
```

Then in _any language file_, you can refer to a common reference by using using double curly braces with a `COM:` prefix like so: `{{COM:myCategory.myItem}}`.

So continuing with the above common file example, we can use this link in another language file like so:

```json
{
    "data": {
        "aboutMe": {
            "myGitHub": "Follow me on GitHub at {{COM:links.github}}!"
        }
    },
    "refs": {}
}
```

And in the code:

```js
let myGitHub = linguini.get('aboutMe.myGitHub', 'en', TypeMappers.String);
console.log(myGitHub);
// Outputs: "Follow me on GitHub at https://github.com/KevinNovak!"
```

You can also retrieve a common reference directly by using `Linguini#getCom()`.
