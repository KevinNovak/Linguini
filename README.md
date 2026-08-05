# Linguini

[![NPM Version](https://img.shields.io/npm/v/linguini.svg?maxAge=3600)](https://www.npmjs.com/package/linguini)
[![Downloads](https://img.shields.io/npm/dt/linguini.svg?maxAge=3600)](https://www.npmjs.com/package/linguini)
[![Stars](https://img.shields.io/github/stars/KevinNovak/Linguini.svg)](https://github.com/KevinNovak/Linguini/stargazers)
[![License](https://img.shields.io/badge/license-MIT-blue)](https://opensource.org/licenses/MIT)
[![Pull Requests](https://img.shields.io/badge/Pull%20Requests-Welcome!-brightgreen)](https://github.com/KevinNovak/Linguini/pulls)

Typed, ICU-based JSON translation catalogs: compile-time checked keys and parameters, CLDR
plurals, `Intl` formatting, and hot-reloadable catalog artifacts.

`npm install linguini`

> **v2 is a clean break from v1.** The authoring format moved to ICU MessageFormat, the runtime
> is typed via generated bindings, and catalogs compile to versioned artifacts. v1 docs live on
> the `v1` branch. See [`docs/design-v2.md`](docs/design-v2.md) for the full design.

## How it works

```
catalog/ (JSON you author)  →  linguini compile  →  artifact (data)  +  typed bindings (code)
```

1. You author messages in JSON files, per namespace and locale.
2. `linguini compile` validates everything (ICU syntax, plural coverage per locale, refs,
   translations against the base locale), precompiles messages, and emits:
    - an **artifact** — the content, loadable and hot-swappable at runtime;
    - **typed bindings** — a generated module giving every message a typed accessor.
3. At runtime, `Linguini` loads the artifact and your code calls typed functions. A
   **schemaHash** ties the two together: content edits hot-reload freely; shape changes (new
   keys or parameters) require regenerated bindings, which is a normal reviewable code change.

## Quick start

Catalog layout:

```
catalog/
  linguini.config.json
  common.json                 ← shared, locale-independent values
  refs.en-US.json             ← shared, per-locale refs (all namespaces can use them)
  info/
    info.en-US.json
    info.de.json
```

`linguini.config.json`:

```json
{
    "baseLocale": "en-US",
    "out": "dist",
    "bindings": { "out": "../src/generated/messages.ts" }
}
```

`info/info.en-US.json`:

```json
{
    "data": {
        "greeting": "Hello, {name}!",
        "birthdayCount": "{count, plural, one {# birthday today!} other {# birthdays today!}}",
        "nextBirthday": "Next up: {user} on {when, date, medium}",
        "attendees": "Celebrating with {names, list}",
        "footer": "{{REF:footers.default}}"
    },
    "refs": {
        "footers": { "default": "Sent by MyBot — {{COM:links.docs}}" }
    }
}
```

Compile, then use the generated bindings:

```ts
import { Linguini } from 'linguini';
import { createMessages, schemaHash } from './generated/messages.js';

const lx = new Linguini({ schemaHash });
await lx.load('./catalog/dist');
const t = createMessages(lx);

t.info.greeting('en-US', { name: 'Ada' }); // "Hello, Ada!"
t.info.birthdayCount('de', { count: 3 }); // typed: count must be a number
t.info.greting; // ✗ compile error — key doesn't exist
```

## Message values

| Shape                      | Meaning                                                            |
| -------------------------- | ------------------------------------------------------------------ |
| `"string"`                 | An ICU message.                                                    |
| `["line", "line"]`         | Multi-line message (joined with `\n`).                             |
| `{ "$variants": [...] }`   | Random variants (same parameters required; RNG is injectable).     |
| `{ "$type": "name", ... }` | Structured message built by a registered type handler (see below). |

### ICU MessageFormat

Full argument syntax with `plural`, `selectordinal`, `select`, `number`, `date`, `time`, and a
`list` extension backed by `Intl.ListFormat`. Plural categories are validated per locale
against CLDR — a Polish file missing `few`/`many` fails compilation; an English file only
needs `one`/`other`.

### Refs and common values

`{{REF:path}}` (per-locale, from the namespace's `refs` section — falling back to the shared
`refs.<locale>.json` at the catalog root) and `{{COM:path}}` (locale-independent, from
`common.json`) are compile-time includes: fully expanded during `linguini compile`, with cycle
detection. Namespace-local refs override shared refs on collision. A lint warns when an
include is spliced mid-sentence, since fragments break word-form agreement in many languages.

### Structured messages

Register a handler to turn structured values into rich objects (a Discord embed, a
notification payload, ...):

```ts
const lx = new Linguini({
    types: {
        embed: (value, ctx) => buildEmbed(value, ctx.com('colors.default')),
    },
});
```

String leaves inside the value are ICU messages; the handler receives them fully evaluated.
Map `$type` names to TypeScript types in the config (`bindings.types`) to type the accessor's
return value.

## Runtime

```ts
const lx = new Linguini({
    schemaHash, // reject artifacts compiled against a different schema
    fallbackLocales: ['en-US'], // appended to every lookup chain (default: base locale)
    missingKeys: 'throw', // or 'fallback'
    onMissing: (key, locale) => metrics.count('lang.miss', { key, locale }),
    onReloaded: () => {},
    onRejected: error => alerting.warn(error),
});
```

- Lookup falls back requested locale → BCP 47 truncation (`pt-BR` → `pt`) → `fallbackLocales`.
- `lx.load()` validates and **atomically swaps** — a bad reload keeps the old catalog serving.
- `lx.formatAll(key, params)` returns the message in every loaded locale (e.g. for Discord
  `name_localizations`).
- All `Intl` formatters are memoized per locale + options.

## CLI

```
linguini compile [catalogDir]                    # write artifact + bindings
linguini check [catalogDir] [--bindings <file>]  # validate; verify bindings schemaHash in CI
linguini watch [catalogDir]                      # recompile on change (development)
```

`check --bindings` is the CI gate that distinguishes content-only changes (ship the artifact,
hot-reload, no deploy) from schema changes (regenerate bindings, ship as code).

## Requirements

Node.js ≥ 20. ESM only. The runtime has zero dependencies; the compiler uses
[`@formatjs/icu-messageformat-parser`](https://www.npmjs.com/package/@formatjs/icu-messageformat-parser).
