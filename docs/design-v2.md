# Linguini v2 — Design

Status: **draft for review** (Scott + Kevin)
Companion doc: `birthday-bot/docs/linguini-v2-integration.md` (Birthday Bot–specific integration, deploy decoupling, and migration plan — lives in the Birthday Bot repo).

---

## 1. Motivation

Linguini v1 (1.3.1) is a compact JSON translation-file manager: `{data, refs}` files per locale, a shared `*.common.json`, three tiers of string substitution resolved eagerly at construction, and `TypeMapper` functions for turning JSON values into rich objects. It has served well, but its largest consumer (Birthday Bot) has outgrown it in ways that generalize to any serious consumer:

1. **No compile-time safety.** A typo'd key or a missing `{{VARIABLE}}` argument is only discovered at runtime.
2. **No real plural/gender support.** Consumers hand-roll duplicate "singular/plural" entries, which is wrong for most non-English languages (CLDR defines up to six plural categories per locale).
3. **No locale-aware formatting** (numbers, dates, lists).
4. **Catalog and code are coupled.** Strings live inside the consuming package, so a copy change looks like a code change to build systems and triggers full redeploys.
5. **No hot reload.** Changing a string requires an app restart.
6. **Aging toolchain.** CommonJS, TS 4.5, tslint (dead since 2019), mocha, Node 12 engines.

v2 is a clean break (no v1 API compatibility — see §11) that keeps what v1 got right: JSON authoring, the `refs`/`common` DRY mechanism, dot-path addressing, and pluggable rich-object mapping.

## 2. Goals

- **Typed access.** Generated bindings make every message key and its parameters compile-time checked.
- **Correct internationalization.** ICU MessageFormat (subset) for plurals, ordinals, selects; `Intl` for number/date/list formatting. Translator-tooling compatible (Crowdin, Weblate, Lokalise all validate ICU).
- **Catalog as data.** Authoring files compile to a versioned, self-describing artifact that a running app can load — and hot-swap — independently of code deploys.
- **Layering.** The core is generic and dependency-light. Domain adapters (e.g. Discord embeds) live in consumer packages via a public extension point.
- **Modern toolchain.** ESM, TypeScript 5 strict, vitest, eslint, Node ≥ 20.

### Non-goals

- v1 API or file-format compatibility (a migration tool converts v1 catalogs; see §11).
- A translation management UI. Authoring stays "JSON files in git".
- Message extraction from source code (FormatJS-style `defineMessage` scanning). Catalog files are the source of truth.
- Discord-specific logic in core. (A future `linguini/discord` subpath export is possible; deliberately deferred.)

## 3. Architecture overview

```
authoring files (JSON, per namespace + locale)
        │
        ▼
  linguini compile  ──────────────►  catalog artifact
        │                            (precompiled ICU ASTs + manifest w/ schema hash)
        ▼
  generated typed bindings
  (checked into the consumer repo)
        │                                   │
        ▼                                   ▼
  consumer code ──── calls ────►  Linguini runtime (loads/validates/hot-swaps artifacts)
```

Three pieces, one package:

- **Compiler/CLI** (`linguini compile`, `linguini check`): parses authoring files, expands refs, validates every locale against the base locale, precompiles ICU messages to ASTs, emits the artifact and the typed bindings. Depends on `@formatjs/icu-messageformat-parser` (compile-time only).
- **Runtime**: loads an artifact, evaluates message ASTs with `Intl`-backed formatting, exposes typed lookup, fallback, hot reload. Zero runtime dependencies.
- **Generated bindings**: thin typed functions per message key. They carry the **schema hash** — the contract between compiled code and loadable catalog content (§6).

The key property this buys: **content edits ship as data; shape edits (new key, new/changed parameter) regenerate bindings and ship as code.** The schema hash is what tells the two apart, mechanically.

## 4. Catalog format (authoring)

### 4.1 Files and namespaces

A catalog is a directory of namespaces. Each namespace is a set of per-locale JSON files plus optional shared files:

```
catalog/
  linguini.config.json          (or .ts — see §9)
  common.json                   locale-independent refs ({{COM:...}})
  refs.en-US.json               shared per-locale refs, available to all namespaces
  refs.de.json
  info/
    info.en-US.json
    info.de.json
  errors/
    errors.en-US.json
```

- Locale codes are BCP 47 (`en-US`, `de`, `pt-BR`). One locale is designated **base** in config; it defines the schema.
- Namespace files contain `data` (messages) and optional `refs` (per-locale reusable strings), as in v1. Nesting under `data` is arbitrary depth (v1 was fixed at two levels).

### 4.2 Message values

A value under `data` is one of:

| Shape | Meaning |
|---|---|
| `"string"` | An ICU message. |
| `["line", "line"]` | Multi-line message; lines joined with `\n` **before** ICU parsing (v1 behavior, kept — it makes long messages readable in JSON). |
| `{ "$variants": ["msg a", "msg b"] }` | Random variants. All variants must declare the **same parameter set** (compile error otherwise). Selection uses an injectable RNG (§7.5). Each variant may itself be a string or array-of-lines. |
| `{ "$type": "name", ... }` | A **structured message** handled by a registered message type (§8). All string leaves inside are ICU messages; parameters are the union of leaves' parameters. |

Any other bare object/array shape under `data` is a compile error — v1's "any JSON" looseness is what made typing impossible.

### 4.3 ICU MessageFormat subset

Full ICU argument syntax with these types: plain arguments, `plural`, `selectordinal`, `select`, `number`, `date`, `time`, and `list` (an extension mapped to `Intl.ListFormat`; not in stock ICU but supported by our compiler and evaluator).

```jsonc
{
  "data": {
    "birthdayCount": "{count, plural, one {# birthday today!} other {# birthdays today!}}",
    "placement": "{rank, selectordinal, one {#st} two {#nd} few {#rd} other {#th}} place",
    "nextBirthday": "Next up: {user} on {when, date, medium}",
    "attendees": "Celebrating with {names, list}"
  }
}
```

Rules:

- Plural/selectordinal category coverage is validated **per locale** against CLDR via `Intl.PluralRules` — e.g. a Polish file missing `few`/`many` on a plural message is a compile error; an English file only needs `one`/`other`. `other` is always required.
- `#` inside plural branches formats with `Intl.NumberFormat` for the target locale.
- Literal `{` / `}` use ICU quoting (`'{'`).
- Argument names are `camelCase` by convention (lint warning otherwise); the compiler treats names as opaque.

### 4.4 Refs and common (compile-time includes)

ICU has no include mechanism, so refs are a **preprocessing pass** on the raw string before ICU parsing — exactly v1's model, with v1's syntax kept:

- `{{REF:path.to.ref}}` — expands from the namespace's `refs` section, falling back to the
  **shared ref table** (`refs.<locale>.json` at the catalog root) when the namespace doesn't
  define the path. Both tables resolve per locale with per-path fallback to the base locale;
  namespace-local always overrides shared on collision.
- `{{COM:path}}` — expands from `common.json` (locale-independent).

Shared refs exist because v1 catalogs repeated the same refs (footers, boilerplate) across
every namespace file. They are translatable (per-locale), unlike `common.json`. Shared ref
values may reference only other shared refs and COM values — never namespace-local refs (they
are validated standalone). `refs` is consequently a reserved namespace name.

Rules:

- Refs may reference other refs/coms; expansion resolves recursively with cycle detection (compile error on cycle — v1 silently left unresolved text).
- Refs may declare ICU arguments; those become part of the including message's parameter set.
- **Lint: mid-sentence refs.** A ref expanded into the middle of a sentence (non-whitespace on both sides of the token, heuristically) produces a lint warning. Fragments spliced mid-sentence break case/gender agreement in many languages; refs are for whole reusable segments (footers, links, full sentences). Warning by default, escalatable to error in config.

Expansion happens at compile time; the artifact contains fully-resolved messages. Runtime never sees `{{REF:}}`/`{{COM:}}`.

## 5. Compilation, artifact, validation

`linguini compile` produces, per catalog:

```
out/
  manifest.json     { formatVersion, schemaHash, baseLocale, locales[], namespaces[], createdAt? }
  catalog.json      per locale, per namespace: key → precompiled message
                    (ICU AST | variants of ASTs | structured node with AST leaves)
```

- Precompiling ASTs means the runtime needs no ICU parser — zero runtime deps, fast lookups.
- **Schema** = the map of every fully-qualified key (`namespace.path.to.key`) → its parameter signature (name → inferred type, §6.1) → and, for structured messages, its `$type`. **schemaHash** = a stable hash of that map. Content changes that don't alter the schema don't change the hash.
- The artifact is what ships/syncs to running apps. Authoring files remain the git-tracked source of truth; the artifact is a build output.

`linguini check` (CI mode) validates without emitting:

- Every non-base locale against the base: missing keys (configurable warn/error — warn is normal while translations lag), **extra keys (error)**, unknown arguments (error), argument-type conflicts (error), plural coverage per locale (error).
- Ref cycles, unknown refs, `$variants` parameter mismatches, malformed ICU (error).
- Lint rules: mid-sentence refs, non-camelCase arguments, empty messages.
- With `--bindings <dir>`: verifies generated bindings are up to date (schemaHash match) — this is the check that lets a CI pipeline distinguish "content-only change, ship as data" from "schema change, regenerate and ship as code".

## 6. Codegen contract (typed bindings)

`linguini compile --bindings` emits a TypeScript module of typed accessors, modeled on paraglide/typesafe-i18n but **bound to the runtime** rather than fully compiled — content must remain hot-swappable, so bindings carry types and keys, not message text:

```ts
// generated — do not edit
import type { Linguini } from 'linguini';
export const schemaHash = 'sha256:…';

export function createMessages(lx: Linguini) {
  return {
    info: {
      birthdayCount: (locale: string, params: { count: number }) =>
        lx.format('info.birthdayCount', locale, params),
      nextBirthday: (locale: string, params: { user: string; when: Date }) =>
        lx.format('info.nextBirthday', locale, params),
      // …
    },
    // …
  };
}
```

- Wrong key → compile error (property doesn't exist). Missing/extra/mistyped parameter → compile error. Dead keys become detectable via unused-export analysis.
- Bindings are **checked into the consumer repo** (small, diffable — a schema change shows up in review as a bindings diff).
- `createMessages` binds to a `Linguini` instance so consumers control loading/reload; the generated tree is the only lookup API consumers should use (the untyped `lx.format` remains public for dynamic cases).

### 6.1 Parameter type inference

| ICU usage | TS type |
|---|---|
| plain `{name}` | `string \| number` |
| `plural` / `selectordinal` arg | `number` |
| `select` arg | union of branch keys (`'male' \| 'female' \| 'other'` …) |
| `number` arg | `number` |
| `date` / `time` arg | `Date \| number` |
| `list` arg | `readonly string[]` |

Conflicting usages of one argument across a message (or across `$variants`) are a compile error.

### 6.2 Structured messages in bindings

For `$type` values, the binding's return type comes from config (§9): the consumer maps type names to TS types (`"embed" → import('./embed-types.js').LangEmbed`). The runtime returns whatever the registered handler builds (§8); codegen just types it.

## 7. Runtime API

```ts
import { Linguini } from 'linguini';
import { createMessages, schemaHash } from './generated/messages.js';

const lx = new Linguini({
  schemaHash,                       // artifacts must match to load
  fallbackLocales: ['en-US'],       // appended to every resolution chain
  onMissing: (key, locale) => {…},  // telemetry hook; see 7.3
  types: { embed: embedHandler },   // structured message handlers, §8
  random: undefined,                // optional seedable RNG, §7.5
});

await lx.load(artifactSource);      // path | preloaded object | custom loader
const t = createMessages(lx);

t.info.birthdayCount('de', { count: 3 });
```

### 7.1 Loading and hot reload

- `load()` fully validates the artifact (format version, schemaHash, structural integrity) and then **atomically swaps** the in-memory catalog. On any validation failure it throws (initial load) or rejects and keeps serving the current catalog (reload) — a bad sync can never take down strings.
- A schemaHash mismatch is the designed rejection path: it means the artifact was compiled against a different message shape than the running code. The consumer's reload wiring (fs watch in dev, pub/sub in prod) is outside core; core exposes `load()` + a `reloaded`/`rejected` event hook so consumers can alarm on rejections.

### 7.2 Locale resolution

Per lookup: requested locale → BCP 47 truncation chain (`pt-BR` → `pt`) → `fallbackLocales` in order. First locale containing the key wins. `lx.locales()` reports loaded locales; `lx.formatAll(key, params)` returns `{ [locale]: value }` across loaded locales (generalizes v1-consumer needs like Discord `name_localizations`).

### 7.3 Missing keys

Policy per instance: `'throw'` (default — right for a fully-compiled catalog, since bindings make misses near-impossible) or `'fallback'` (return base-locale value, or the literal key as last resort). Every fallback/miss invokes `onMissing` — misses should be visible in dashboards, never silent.

### 7.4 Formatting

`Intl.NumberFormat` / `DateTimeFormat` / `PluralRules` / `ListFormat` instances are memoized per `(locale, options)` — constructing them per call is the classic Intl performance trap. Skeleton/style arguments from ICU map onto `Intl` options.

### 7.5 Randomness

`$variants` selection calls the injected `random: () => number` (default `Math.random`). Tests inject a seeded generator; consumers can weight/rotate by wrapping.

## 8. Extension point: message types (the TypeMapper successor)

v1's `TypeMapper<T> = (json) => T` ran on raw JSON after variable substitution. v2 formalizes this as **registered message types** operating on structured values:

```ts
import type { MessageTypeHandler } from 'linguini';

// value: the $type node with every string leaf already ICU-evaluated
// ctx: { locale, key, com(path) }  — com() gives access to common values (e.g. colors)
const embedHandler: MessageTypeHandler<LangEmbed> = (value, ctx) => ({ …build… });
```

- The compiler validates `$type` nodes structurally (registered name, string leaves parse as ICU) but is agnostic to their meaning.
- Handlers are pure functions registered at runtime construction; codegen types their outputs via config.
- This is the **entire** contract a domain adapter needs. Birthday Bot's Discord embed builder is a consumer-side handler using only this public API — which keeps a future `linguini/discord` subpath extraction mechanical, and keeps `@discordjs/*` out of core's dependency tree.

## 9. Config and CLI

`catalog/linguini.config.json` (or `.ts` for typed config):

```jsonc
{
  "baseLocale": "en-US",
  "namespaces": "auto",              // discover subdirectories; or explicit list
  "out": "../dist/catalog",
  "bindings": { "out": "../src/generated/messages.ts", "types": { "embed": "./embed-types.js#LangEmbed" } },
  "lint": { "midSentenceRef": "warn", "argCase": "warn" },
  "missingKeys": "warn"              // non-base locales lagging base
}
```

CLI: `linguini compile [--bindings]`, `linguini check [--bindings <file>]`, `linguini watch` (dev: recompile + local reload signal on file change). The CLI is part of the package (`bin`), no separate tool.

## 10. Toolchain modernization

- **ESM-only**, `"type": "module"`, `exports` map. TypeScript 5.x, `strict` + `noUncheckedIndexedAccess`.
- **Node ≥ 20** engines (developed against 22/24); all `Intl` APIs used are available from 18+.
- **vitest** replaces mocha/chai/ts-mocha. **eslint flat config + prettier** replace tslint.
- Build with `tsc` (types + JS; no bundler needed for a library). Publish with provenance.
- Dependencies: `@formatjs/icu-messageformat-parser` (compiler path only). Runtime path: zero deps.
- Version `2.0.0`, semver from there. README rewritten around v2; v1 docs archived under a `v1` branch/tag.

## 11. Compatibility and migration

**Clean break.** v2 shares no API or artifact compatibility with v1. Rationale: the codegen model changes call shape anyway, and the known consumer (Birthday Bot) is rewriting call sites regardless.

What v2 ships instead of compatibility:

- `linguini migrate` — one-time converter: v1 `{data, refs}` + `*.common.json` in, v2 catalog out. Mechanical conversions: `{{VAR}}` → `{var}` (name case-mapped), array-join semantics preserved, refs/coms preserved, detectable singular/plural entry pairs collapsed into ICU `plural` messages.
- A **triage report** for everything needing human judgment: mid-sentence refs, ambiguous plural pairs, values that don't fit §4.2 shapes, suspicious argument names.
- A **render-diff harness**: evaluate v1 and migrated-v2 catalogs over the same inputs and diff output, as the migration's regression proof.

(Birthday Bot drives the migrate tool via a script + Claude-skill combination — detailed in the companion doc.)

## 12. Testing strategy

- **Unit**: ICU evaluator (per arg type, nesting, escaping), ref expansion (depth, cycles), plural category selection across representative locales (en, de, pl, ru, ar, ja), variant selection with seeded RNG, formatter memoization.
- **Property-based** (fast-check): interpolation round-trips, "compile accepts ⇒ runtime evaluates without throw for any well-typed params".
- **Compiler**: golden tests — fixture catalogs → snapshot artifacts + snapshot generated bindings; every validation rule has a failing fixture.
- **Contract**: generated binding types match runtime behavior (type-level tests via `expect-type` + runtime probes).
- **CLI**: end-to-end compile/check/migrate over fixtures, including the render-diff harness against a real v1 catalog.

## 13. Open questions

1. **`.ts` config support at launch, or JSON-only first?** (Lean: JSON first; `.ts` config needs a loader story.)
2. **`list` type syntax** — `{names, list}` as an ICU extension vs. requiring pre-formatted strings. (Resolved: supported, backed by `Intl.ListFormat`.)
3. **Weighted variants** (`$variants` with weights) — v2.0 or later? (Lean: later; keep 2.0 surface small.)
4. ~~Name for the generated accessor tree~~ **Resolved:** factory is `createMessages(lx)`, the conventional tree variable is `t`, and core ships `bindLocale(t, locale)` — a typed locale-bound view (`LocaleBound<T>` strips each accessor's leading locale parameter) so consumers resolve the locale once per interaction: `tl.info.greeting({ name })`. The unbound tree remains for registration metadata, `formatAll`, and cross-locale formatting.
