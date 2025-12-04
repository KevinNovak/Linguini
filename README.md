# Linguini

[![NPM Version](https://img.shields.io/npm/v/linguini.svg?maxAge=3600)](https://www.npmjs.com/package/linguini)
[![Downloads](https://img.shields.io/npm/dt/linguini.svg?maxAge=3600)](https://www.npmjs.com/package/linguini)
[![Stars](https://img.shields.io/github/stars/KevinNovak/Linguini.svg)](https://github.com/KevinNovak/Linguini/stargazers)
[![License](https://img.shields.io/badge/license-MIT-blue)](https://opensource.org/licenses/MIT)
[![Pull Requests](https://img.shields.io/badge/Pull%20Requests-Welcome!-brightgreen)](https://github.com/KevinNovak/Linguini/pulls)

**Npm package** - A type-safe, flexible JSON-based translation file manager.

`npm install linguini`

## What's New in v2.0

- **🔒 Type Safety**: Full TypeScript support with compile-time key validation and autocomplete
- **📁 Flexible Folder Structure**: Support for any file/folder organization you need
- **🛠️ Codegen CLI**: Auto-generate TypeScript types from your language files
- **⬆️ Backward Compatible**: Legacy API still works, deprecated methods guide migration

## Table of Contents

- [Quick Start](#quick-start)
- [Folder Structures](#folder-structures)
  - [Locale-Folder Structure](#locale-folder-structure)
  - [Locale-in-Filename Structure](#locale-in-filename-structure)
- [Type Safety](#type-safety)
  - [Generating Types](#generating-types)
  - [Using Generated Types](#using-generated-types)
- [API Reference](#api-reference)
  - [t() - Get Translation](#t---get-translation)
  - [ref() - Get Reference](#ref---get-reference)
  - [common() - Get Common Value](#common---get-common-value)
  - [Utility Methods](#utility-methods)
- [Variables](#variables)
- [References](#references)
  - [General References (REF)](#general-references-ref)
  - [Common References (COM)](#common-references-com)
- [Legacy API](#legacy-api)
- [Migration Guide](#migration-guide)

## Quick Start

### Installation

```bash
npm install linguini
```

### Basic Usage

```typescript
import { Linguini } from 'linguini';

// Point to your language files directory
const linguini = new Linguini('./lang');

// Get a translation
const greeting = linguini.t('prompts.greeting', 'en-US', { NAME: 'Alice' });
console.log(greeting);
// Output: "Hello, Alice!"
```

## Folder Structures

Linguini v2 supports two folder structures and will auto-detect which one you're using.

### Locale-Folder Structure

Organize translations by locale folders. Best for larger projects with many files.

```
lang/
├── _common.json              # Shared constants (colors, links, emojis)
├── en-US/
│   ├── _refs.json           # Reusable translated phrases for this locale
│   ├── prompts.json         # Translation data
│   ├── info.json
│   └── validation/
│       ├── errors.json
│       └── warnings.json
└── es-MX/
    ├── _refs.json
    ├── prompts.json
    └── ...
```

**Example files:**

```json
// lang/_common.json - Universal constants (same for all languages)
{
    "colors": {
        "primary": "#FF5733"
    },
    "links": {
        "github": "https://github.com/KevinNovak"
    },
    "emojis": {
        "cake": "🎂"
    }
}
```

```json
// lang/en-US/_refs.json - Reusable translated phrases
{
    "terms": {
        "birthday": "birthday",
        "anniversary": "anniversary"
    },
    "phrases": {
        "thankYou": "Thank you for using our service!"
    }
}
```

```json
// lang/en-US/prompts.json - Translation data
{
    "greeting": "Happy {{REF:terms.birthday}}, {{NAME}}! {{COM:emojis.cake}}",
    "farewell": "Goodbye! {{REF:phrases.thankYou}}"
}
```

**Accessing translations:**

```typescript
const linguini = new Linguini('./lang');

// Keys are namespaced by file path
linguini.t('prompts.greeting', 'en-US', { NAME: 'Alice' });
// → "Happy birthday, Alice! 🎂"

linguini.t('validation.errors.required', 'en-US');
// → "This field is required"
```

### Locale-in-Filename Structure

Include the locale code in each filename. Great for simpler projects or when migrating from v1.

```
lang/
├── _common.json
├── _refs.en-US.json
├── prompts.en-US.json
├── prompts.es-MX.json
├── info.en-US.json
└── validation/
    └── errors.en-US.json
```

**Accessing translations works the same way:**

```typescript
linguini.t('prompts.greeting', 'en-US');
linguini.t('validation.errors.required', 'en-US');
```

### Explicit Structure Configuration

You can explicitly specify which structure to use:

```typescript
const linguini = new Linguini('./lang', {
    folderStructure: 'locale-folder',     // or 'locale-in-filename' or 'auto'
});
```

## Type Safety

Linguini v2 provides full TypeScript support with compile-time key validation.

### Generating Types

Use the CLI to generate TypeScript types from your language files:

```bash
npx linguini generate ./lang --output ./src/types/translations.ts
```

This scans your language files and generates a type definition:

```typescript
// Auto-generated: src/types/translations.ts
export type Translations = {
    prompts: {
        greeting: string;
        farewell: string;
    };
    info: {
        about: {
            title: string;
            description: string;
        };
    };
    validation: {
        errors: {
            required: string;
            minLength: string;
        };
    };
};

export type TranslationsPath = PathsOf<Translations>;
```

### Using Generated Types

Import and use the generated types for full IDE support:

```typescript
import { Linguini } from 'linguini';
import { Translations } from './types/translations';

const linguini = new Linguini<Translations>('./lang');

// ✅ Autocomplete works - shows all valid keys
linguini.t('prompts.greeting', 'en-US');

// ✅ Type inference - return type is correctly inferred
const title = linguini.t('info.about.title', 'en-US'); // type: string

// ❌ Compile error - invalid key caught before runtime!
linguini.t('prompts.greetng', 'en-US'); // Typo caught!
linguini.t('invalid.path', 'en-US');     // Invalid key caught!
```

### CLI Options

```bash
linguini generate <langDir> [options]

Arguments:
  langDir              Path to the language files directory

Options:
  --output, -o         Output file path (default: ./linguini.generated.ts)
  --type-name, -t      Name of the generated type (default: Translations)
  --help, -h           Show help message

Examples:
  linguini generate ./lang
  linguini generate ./lang --output ./src/types/translations.ts
  linguini generate ./lang -o ./types.ts -t MyTranslations
```

**Pro tip:** Add type generation to your build process:

```json
// package.json
{
    "scripts": {
        "generate:types": "linguini generate ./lang -o ./src/types/translations.ts",
        "build": "npm run generate:types && tsc"
    }
}
```

## API Reference

### t() - Get Translation

Get a translation by key with variable replacement.

```typescript
linguini.t(key: string, locale: string, variables?: Variables): T
```

**Parameters:**
- `key` - The translation key in dot-notation (e.g., `'prompts.greeting'`)
- `locale` - The locale code (e.g., `'en-US'`)
- `variables` - Optional object with variables to replace

**Example:**

```typescript
// Simple translation
const msg = linguini.t('prompts.greeting', 'en-US');

// With variables
const msg = linguini.t('prompts.greeting', 'en-US', {
    NAME: 'Alice',
    COUNT: 5
});
```

### ref() - Get Reference

Get a reference string (translated reusable phrase).

```typescript
linguini.ref(key: string, locale: string, variables?: Variables): string
```

**Example:**

```typescript
const term = linguini.ref('terms.birthday', 'en-US');
// → "birthday"

const term = linguini.ref('terms.birthday', 'es-MX');
// → "cumpleaños"
```

### common() - Get Common Value

Get a common value (language-agnostic constant).

```typescript
linguini.common(key: string, variables?: Variables): string
```

**Example:**

```typescript
const color = linguini.common('colors.primary');
// → "#FF5733"

const link = linguini.common('links.github');
// → "https://github.com/KevinNovak"
```

### Utility Methods

```typescript
// Get all available locales
linguini.getLocales(): string[]
// → ['en-US', 'es-MX', 'fr-FR']

// Check if a locale is available
linguini.hasLocale('en-US'): boolean
// → true

// Check if a translation key exists
linguini.has('prompts.greeting', 'en-US'): boolean
// → true
```

## Variables

Variables allow you to dynamically pass in values to your translations. Use double curly braces: `{{VARIABLE_NAME}}`.

```json
// lang/en-US/prompts.json
{
    "welcome": "Welcome {{FIRST_NAME}} {{LAST_NAME}} to our club!",
    "items": "You have {{COUNT}} items in your cart."
}
```

```typescript
const msg = linguini.t('prompts.welcome', 'en-US', {
    FIRST_NAME: 'Harley',
    LAST_NAME: 'Quinn',
});
// → "Welcome Harley Quinn to our club!"

const msg = linguini.t('prompts.items', 'en-US', { COUNT: 5 });
// → "You have 5 items in your cart."
```

## References

References let you define commonly used words or phrases once and reuse them throughout your translations.

### General References (REF)

**References are locale-specific translated phrases.** Use them for terms that need to be translated but are used in multiple places.

Define references in `_refs.json` (locale-folder) or `_refs.{locale}.json` (locale-in-filename):

```json
// lang/en-US/_refs.json
{
    "terms": {
        "birthday": "birthday",
        "anniversary": "anniversary"
    },
    "phrases": {
        "thankYou": "Thank you for using our service!"
    }
}
```

```json
// lang/es-MX/_refs.json
{
    "terms": {
        "birthday": "cumpleaños",
        "anniversary": "aniversario"
    },
    "phrases": {
        "thankYou": "¡Gracias por usar nuestro servicio!"
    }
}
```

Use them in translations with `{{REF:category.item}}`:

```json
{
    "greeting": "Happy {{REF:terms.birthday}}, {{NAME}}!",
    "farewell": "{{REF:phrases.thankYou}}"
}
```

```typescript
linguini.t('prompts.greeting', 'en-US', { NAME: 'Alice' });
// → "Happy birthday, Alice!"

linguini.t('prompts.greeting', 'es-MX', { NAME: 'Alice' });
// → "Happy cumpleaños, Alice!"
```

### Common References (COM)

**Common references are language-agnostic constants.** Use them for values that stay the same across all languages: colors, links, emojis, numbers, etc.

Define in `_common.json`:

```json
// lang/_common.json
{
    "colors": {
        "primary": "#FF5733",
        "success": "#2ECC71"
    },
    "links": {
        "github": "https://github.com/KevinNovak",
        "docs": "https://docs.example.com"
    },
    "emojis": {
        "cake": "🎂",
        "party": "🎉"
    }
}
```

Use them in translations with `{{COM:category.item}}`:

```json
{
    "colorInfo": "Your theme color is {{COM:colors.primary}}",
    "birthday": "Happy Birthday! {{COM:emojis.cake}}"
}
```

```typescript
linguini.t('prompts.colorInfo', 'en-US');
// → "Your theme color is #FF5733"

linguini.common('links.github');
// → "https://github.com/KevinNovak"
```

## Legacy API

The v1 API is still available but deprecated. It will continue to work but shows deprecation warnings.

```typescript
// Legacy constructor
const linguini = new Linguini(folderPath, fileName);

// Legacy methods (deprecated)
linguini.get(location, langCode, typeMapper, variables);  // Use t() instead
linguini.getRaw(location, langCode, variables);           // Use t() instead
linguini.getRef(location, langCode, variables);           // Use ref() instead
linguini.getCom(location, variables);                     // Use common() instead
```

### Type Mappers (Legacy)

Type Mappers were used in v1 to convert JSON values to specific types. With TypeScript generics in v2, these are less necessary but still available:

```typescript
import { TypeMappers } from 'linguini';

// Built-in Type Mappers
TypeMappers.String   // Join arrays with newlines
TypeMappers.Boolean
TypeMappers.Number
TypeMappers.BigInt
TypeMappers.Date
TypeMappers.RegExp
TypeMappers.URL

// Usage (legacy)
const regex = linguini.get('regexes.hello', 'en', TypeMappers.RegExp);
```

## Migration Guide

### From v1 to v2

**1. Update constructor call:**

```typescript
// v1
const linguini = new Linguini(folderPath, fileName);

// v2
const linguini = new Linguini(rootPath);
```

**2. Update method calls:**

```typescript
// v1
linguini.get('intro.greeting', 'en', TypeMappers.String, { NAME: 'Alice' });
linguini.getRef('terms.birthday', 'en');
linguini.getCom('links.github');

// v2
linguini.t('intro.greeting', 'en', { NAME: 'Alice' });
linguini.ref('terms.birthday', 'en');
linguini.common('links.github');
```

**3. Add type safety (optional but recommended):**

```bash
npx linguini generate ./lang -o ./src/types/translations.ts
```

```typescript
import { Translations } from './types/translations';

const linguini = new Linguini<Translations>('./lang');
```

**4. Reorganize files (optional):**

You can keep your existing file structure or migrate to locale-folder structure:

```
# Before (v1)
lang/
├── lang.common.json
├── lang.en.json
└── lang.fr.json

# After (v2 locale-folder)
lang/
├── _common.json
├── en/
│   ├── _refs.json
│   └── prompts.json
└── fr/
    ├── _refs.json
    └── prompts.json
```

## License

MIT
