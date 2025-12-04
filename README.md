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
- **🔀 Fallback Locales**: Graceful degradation when translations are missing
- **🎲 Random Selection**: `tRandom()` for varying responses from arrays
- **📊 Pluralization**: `tPlural()` with CLDR-style plural rules
- **🔍 Scoped Access**: `scope()` for modular, namespaced translations
- **✅ Validation**: `validateCompleteness()` to catch missing translations
- **🎨 Formatters**: Built-in utilities for numbers, dates, lists, and more
- **👀 Watch Mode**: Hot-reload translations during development
- **⬆️ Backward Compatible**: Legacy API still works, deprecated methods guide migration

## Table of Contents

- [Quick Start](#quick-start)
- [Folder Structures](#folder-structures)
- [Type Safety](#type-safety)
- [API Reference](#api-reference)
  - [t() - Get Translation](#t---get-translation)
  - [tRandom() - Random Selection](#trandom---random-selection)
  - [tPlural() - Pluralization](#tplural---pluralization)
  - [ref() - Get Reference](#ref---get-reference)
  - [common() - Get Common Value](#common---get-common-value)
  - [scope() - Namespaced Access](#scope---namespaced-access)
  - [Utility Methods](#utility-methods)
- [Configuration Options](#configuration-options)
- [Formatters](#formatters)
- [Variables](#variables)
- [References](#references)
- [CLI Commands](#cli-commands)
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

### Locale-in-Filename Structure

Include the locale code in each filename. Great for simpler projects or when migrating from v1.

```
lang/
├── _common.json
├── _refs.en-US.json
├── prompts.en-US.json
├── prompts.es-MX.json
└── validation/
    └── errors.en-US.json
```

## Type Safety

Linguini v2 provides full TypeScript support with compile-time key validation.

### Generating Types

```bash
npx linguini generate ./lang --output ./src/types/translations.ts
```

### Using Generated Types

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
```

## API Reference

### t() - Get Translation

Get a translation by key with variable replacement.

```typescript
linguini.t(key: string, locale: string, variables?: Variables): T
```

```typescript
const msg = linguini.t('prompts.greeting', 'en-US', { NAME: 'Alice' });
```

### tRandom() - Random Selection

Get a random item from an array translation. Perfect for varying bot responses.

```json
// lang/en-US/prompts.json
{
    "greetings": ["Hello!", "Hi there!", "Hey!", "Greetings!"]
}
```

```typescript
const greeting = linguini.tRandom('prompts.greetings', 'en-US');
// → Randomly: "Hello!" or "Hi there!" or "Hey!" or "Greetings!"
```

### tPlural() - Pluralization

Get a pluralized translation based on count. Supports CLDR plural rules (zero, one, two, few, many, other).

```json
// lang/en-US/messages.json
{
    "items": {
        "zero": "No items",
        "one": "{{COUNT}} item",
        "other": "{{COUNT}} items"
    }
}
```

```typescript
linguini.tPlural('messages.items', 'en-US', 0);   // → "No items"
linguini.tPlural('messages.items', 'en-US', 1);   // → "1 item"
linguini.tPlural('messages.items', 'en-US', 5);   // → "5 items"
linguini.tPlural('messages.items', 'en-US', 100); // → "100 items"
```

The `COUNT` variable is automatically available in the translation.

### ref() - Get Reference

Get a reference string (translated reusable phrase).

```typescript
const term = linguini.ref('terms.birthday', 'en-US');
// → "birthday"

const term = linguini.ref('terms.birthday', 'es-MX');
// → "cumpleaños"
```

### common() - Get Common Value

Get a common value (language-agnostic constant).

```typescript
const color = linguini.common('colors.primary');
// → "#FF5733"

const emoji = linguini.common('emojis.cake');
// → "🎂"
```

### scope() - Namespaced Access

Create a scoped accessor for a specific namespace. Useful for modular code.

```typescript
const validationLang = linguini.scope('validation.errors');

// Now all keys are relative to the scope
validationLang.t('required', 'en-US');     // Same as t('validation.errors.required', ...)
validationLang.tPlural('items', 'en-US', 5);
validationLang.has('minLength', 'en-US');

// Scopes can be nested
const customErrors = validationLang.scope('custom');
customErrors.t('birthday', 'en-US');       // Same as t('validation.errors.custom.birthday', ...)
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

// Validate translation completeness across locales
linguini.validateCompleteness(): ValidationIssue[]
// → [{ key: 'prompts.newFeature', missingIn: ['es-MX', 'fr-FR'] }]

// Reload translations from disk
linguini.reload(): void

// Watch for changes (development)
linguini.watch(() => console.log('Translations reloaded!'));
linguini.unwatch();
```

## Configuration Options

```typescript
const linguini = new Linguini('./lang', {
    // How to detect locale structure
    folderStructure: 'auto',  // 'locale-folder' | 'locale-in-filename' | 'auto'
    
    // Fallback when key is missing in requested locale
    fallbackLocale: 'en-US',
    
    // How to handle missing keys
    onMissingKey: 'throw',    // 'throw' | 'fallback' | 'key' | (key, locale) => string
    
    // Variable replacement depth (for nested refs)
    replacementLevels: 10,
    
    // Custom common file path
    commonPath: './lang/_common.json',
    
    // Custom refs filename (locale-folder structure)
    refsFileName: '_refs.json',
});
```

### Missing Key Handlers

```typescript
// Throw an error (default)
onMissingKey: 'throw'

// Try fallback locale first, then throw
onMissingKey: 'fallback'  // requires fallbackLocale

// Return the key itself
onMissingKey: 'key'
// linguini.t('missing.key', 'en') → 'missing.key'

// Custom handler
onMissingKey: (key, locale) => `[MISSING: ${key}]`
```

## Formatters

Built-in utilities for formatting values before passing them as variables.

```typescript
import { Formatters } from 'linguini';

// Numbers
Formatters.number(1234567);                    // → "1,234,567"
Formatters.number(1234.56, 'de-DE');           // → "1.234,56"

// Currency
Formatters.currency(19.99, 'USD');             // → "$19.99"
Formatters.currency(19.99, 'EUR', 'de-DE');    // → "19,99 €"

// Percent
Formatters.percent(0.756);                     // → "76%"

// Dates
Formatters.date(new Date(), 'en-US', 'long');  // → "December 4, 2024"
Formatters.time(new Date());                   // → "3:30 PM"
Formatters.dateTime(new Date());               // → "Dec 4, 2024, 3:30 PM"

// Relative time
Formatters.relativeTime(twoHoursAgo);          // → "2 hours ago"
Formatters.relativeTime(inThreeDays);          // → "in 3 days"

// Lists
Formatters.list(['Alice', 'Bob', 'Charlie']);  // → "Alice, Bob, and Charlie"
Formatters.list(['cats', 'dogs'], 'en-US', 'disjunction'); // → "cats or dogs"

// Duration
Formatters.duration(3661000);                  // → "1h 1m 1s"
Formatters.duration(3600000, { verbose: true }); // → "1 hour"

// File sizes
Formatters.bytes(1024);                        // → "1 KB"
Formatters.bytes(1073741824);                  // → "1 GB"

// Text utilities
Formatters.truncate('Hello World', 8);         // → "Hello..."
Formatters.titleCase('hello world');           // → "Hello World"
Formatters.pad(5, 3);                          // → "005"
```

Use with translations:

```typescript
linguini.t('lastSeen', 'en-US', {
    DATE: Formatters.relativeTime(lastSeenDate),
    COUNT: Formatters.number(viewCount, 'en-US'),
});
```

## Variables

Variables allow dynamic values in translations using `{{VARIABLE_NAME}}`.

```json
{
    "welcome": "Welcome {{FIRST_NAME}} {{LAST_NAME}}!",
    "items": "You have {{COUNT}} items."
}
```

```typescript
linguini.t('prompts.welcome', 'en-US', {
    FIRST_NAME: 'Harley',
    LAST_NAME: 'Quinn',
});
// → "Welcome Harley Quinn!"
```

## References

### General References (REF)

Locale-specific translated phrases defined in `_refs.json`:

```json
// lang/en-US/_refs.json
{
    "terms": { "birthday": "birthday" }
}
```

```json
// lang/es-MX/_refs.json  
{
    "terms": { "birthday": "cumpleaños" }
}
```

Use in translations with `{{REF:category.item}}`:

```json
{
    "greeting": "Happy {{REF:terms.birthday}}, {{NAME}}!"
}
```

### Common References (COM)

Language-agnostic constants defined in `_common.json`:

```json
{
    "colors": { "primary": "#FF5733" },
    "emojis": { "cake": "🎂" }
}
```

Use in translations with `{{COM:category.item}}`:

```json
{
    "birthday": "Happy Birthday! {{COM:emojis.cake}}"
}
```

## CLI Commands

### Generate Types

```bash
linguini generate <langDir> [options]

Options:
  --output, -o     Output file path (default: ./linguini.generated.ts)
  --type-name, -t  Name of the generated type (default: Translations)
```

### Validate Translations

```bash
linguini validate <langDir> [options]

Options:
  --strict         Exit with error code if any issues found
```

Use in CI/CD:

```bash
linguini validate ./lang --strict
```

## Legacy API

The v1 API is still available but deprecated:

```typescript
// Legacy constructor
const linguini = new Linguini(folderPath, fileName);

// Legacy methods (use new API instead)
linguini.get(location, langCode, typeMapper, variables);  // → t()
linguini.getRaw(location, langCode, variables);           // → t()
linguini.getRef(location, langCode, variables);           // → ref()
linguini.getCom(location, variables);                     // → common()
```

## Migration Guide

### From v1 to v2

**1. Update constructor:**

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

**3. Add type safety (recommended):**

```bash
npx linguini generate ./lang -o ./src/types/translations.ts
```

```typescript
import { Translations } from './types/translations';
const linguini = new Linguini<Translations>('./lang');
```

## License

MIT
