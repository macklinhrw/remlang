# Multilingual Schema And Seed Plan

This document is a detailed plan for evolving Remlang from a Chinese-specific local dictionary database into a multilingual lexical platform with a standardized seeding architecture.

It is intentionally implementation-oriented. The goal is not just to describe a future state, but to define a migration path from the current codebase:

- current schema: [lib/database/schema.ts](../../lib/database/schema.ts)
- current seed script: [scripts/seed-expo.ts](../../scripts/seed-expo.ts)
- current dictionary UI: [app/dictionary.tsx](../../app/dictionary.tsx)
- current word detail UI: [app/character.tsx](../../app/character.tsx)

## 1. Why This Refactor Is Needed

The current data model works for Chinese, but it is structurally tied to Chinese-specific assumptions:

- `words.name` is effectively treated as the main written form
- `traditional` is a first-class column on the main lexical row
- `pronunciation` assumes one reading system
- `hsk` assumes Chinese grading
- `decomposition_data` assumes Han-character decomposition needs
- `svg_simplified`, `svg_traditional`, and `svg_special` assume Chinese stroke data stored directly on the lexical row

The seed script has the same issue at the pipeline level:

- one very large script owns all extraction, normalization, loading, and post-processing
- it mixes generic concerns with Chinese-specific parsing
- it has no formal plug-in interface for future language loaders
- it is difficult to test or rerun in smaller parts

Adding Japanese cleanly requires a structural change. Doing it by adding more columns and more branches to the current schema and seed script would make the codebase harder to reason about and harder to extend beyond Japanese.

## 2. Primary Goals

This refactor should achieve the following.

### Schema goals

- Support multiple languages in one bundled database.
- Represent lexical entries in a language-neutral way.
- Allow multiple written forms, readings, and senses per entry.
- Support language-specific extension data without polluting the shared core tables.
- Preserve local/offline behavior and Drizzle ergonomics.

### Seeding goals

- Split seeding into reusable modules.
- Standardize the interface for all language importers.
- Separate source parsing from DB loading.
- Allow one top-level seed script to orchestrate multiple language modules.
- Make validation, logging, and failure handling more robust.

### Migration goals

- Avoid a risky one-shot rewrite.
- Let Chinese migrate first into the new model.
- Keep the app runnable while the new schema is introduced.
- Make Japanese a second importer, not a special case in the Chinese pipeline.

## 3. Non-Goals

This plan does not require:

- changing the app from offline-first to remote/API-backed
- replacing SQLite or Drizzle
- fully redesigning the UI in the same pass
- supporting every language family with one universal linguistic model

The goal is a practical multilingual architecture for the next several languages, not a perfect academic lexicographic ontology.

## 4. Current State Summary

### Current lexical storage

The current core table is `words`, which mixes:

- lexical identity
- Chinese writing-system information
- ranking metadata
- decomposition data
- stroke SVG payloads

This is efficient for the current app, but it is not a stable abstraction for multilingual data.

### Current study storage

The current study subsystem uses:

- `knowledge`
- `cards`
- `review_log`
- `decks`

These tables currently point to `wordId` or rely on Chinese-centric assumptions in how entries are modeled.

### Current seed script

[scripts/seed-expo.ts](../../scripts/seed-expo.ts) currently does all of the following in one file:

- database file creation
- migration application
- dictionary parsing
- HSK parsing
- decomposition parsing
- example sentence processing
- variant handling
- SVG lookup and embedding
- DB insertion
- HSK reranking
- frequency reranking
- FSRS default seeding

That makes it powerful, but also hard to extend safely.

## 5. Target Data Model

The target model should separate:

- lexical core data
- language-specific enrichments
- study/review data
- asset-oriented character data

The design principle is:

> shared tables for concepts that exist in every language import, extension tables for concepts that only exist in some languages.

## 6. Proposed Core Tables

This section describes the target schema conceptually. Exact Drizzle definitions can be produced later from this plan.

### `languages`

Purpose:

- defines the languages known to the database
- gives every seeded entity a stable language anchor

Suggested fields:

- `id`
- `code` like `zh`, `ja`
- `name`
- `defaultGlossLanguage`
- `isEnabled`
- `createdAt`

Notes:

- `code` should be unique
- this allows queries, deck filters, and UI-level language switching

### `dictionaries`

Purpose:

- stores individual dictionary sources or distributions

Suggested fields:

- `id`
- `languageId`
- `slug`
- `name`
- `sourceType`
- `sourceUrl`
- `version`
- `dictDate`
- `license`
- `seedModule`
- `createdAt`
- `updatedAt`

Examples:

- `cedict`
- `jmdict-eng-common`
- `kanjidic2-en`
- `jmnedict-all`

Notes:

- this table should become more important than it is today
- every entry should know which dictionary it came from

### `entries`

Purpose:

- canonical lexical entry record
- replaces the central role of `words`

Suggested fields:

- `id`
- `languageId`
- `dictionaryId`
- `entryType`
- `canonicalForm`
- `canonicalReading`
- `status`
- `sourceEntryId`
- `createdAt`
- `updatedAt`

Examples of `entryType`:

- `word`
- `name`
- `character`
- `expression`

Notes:

- `canonicalForm` and `canonicalReading` are convenience fields for search/result rendering
- the true source of forms/readings should be child tables

### `entry_forms`

Purpose:

- stores written forms for an entry

Suggested fields:

- `id`
- `entryId`
- `text`
- `script`
- `formType`
- `isPrimary`
- `isCommon`
- `appliesToReading`
- `rawRank`
- `createdAt`

Examples of `script`:

- `Hans`
- `Hant`
- `Jpan`
- `Kana`
- `Latn`

Examples of `formType`:

- `headword`
- `variant`
- `alias`
- `orthographic`

Notes:

- this replaces the current `name` and `traditional` pattern
- Chinese simplified/traditional become two forms instead of two columns
- Japanese kanji spellings become forms too

### `entry_readings`

Purpose:

- stores pronunciation/reading values for an entry

Suggested fields:

- `id`
- `entryId`
- `text`
- `system`
- `script`
- `isPrimary`
- `isCommon`
- `rawRank`
- `createdAt`

Examples of `system`:

- `pinyin_numeric`
- `pinyin_tone_marks`
- `kana`
- `romaji_hepburn`

Notes:

- this removes the assumption that an entry has exactly one pronunciation field

### `entry_senses`

Purpose:

- stores sense groupings for an entry

Suggested fields:

- `id`
- `entryId`
- `senseOrder`
- `partOfSpeech`
- `register`
- `domain`
- `dialect`
- `info`
- `createdAt`

Notes:

- the current `definitions` newline blob should be retired in favor of structured senses
- tags can be normalized or serialized depending on complexity tolerance

### `sense_glosses`

Purpose:

- stores textual glosses for a sense, optionally in multiple gloss languages

Suggested fields:

- `id`
- `senseId`
- `glossLanguage`
- `glossOrder`
- `text`
- `gender`
- `glossType`

Notes:

- this supports the current English-only use case without locking the schema to English forever
- even if the app UI stays English-first, this is the correct place for translations

### `entry_relations`

Purpose:

- stores relationships between entries

Suggested fields:

- `id`
- `entryId`
- `relatedEntryId`
- `relationType`
- `relationOrder`

Examples:

- `variant_of`
- `synonym`
- `antonym`
- `see_also`
- `derived_from`

Notes:

- this replaces the current `variantParentId` self-link on `words`
- use this for both variants and other lexical graph edges

### `example_sentences`

Purpose:

- stores sentence records in a language-neutral way

Suggested fields:

- `id`
- `languageId`
- `text`
- `textNormalized`
- `translationGroupId`
- `sourceType`
- `sourceRef`
- `difficultyBand`
- `createdAt`
- `updatedAt`

Notes:

- current Chinese sentence variants can become linked sentence groups
- Japanese examples can live here too

### `example_translations`

Purpose:

- stores translations for examples

Suggested fields:

- `id`
- `sentenceId`
- `languageCode`
- `text`
- `translationOrder`

Notes:

- cleaner than baking translation into the sentence table

### `entry_examples`

Purpose:

- join table linking entries or senses to examples

Suggested fields:

- `entryId`
- `senseId`
- `sentenceId`
- `relationType`

Notes:

- early migration can link examples to `entryId`
- later, some importers can attach examples to `senseId` when the source format supports it

## 7. Proposed Language-Specific Extension Tables

These tables should hold data that is useful, but not universally applicable.

### Chinese extension tables

#### `zh_entry_data`

Suggested fields:

- `entryId`
- `hsk`
- `frequencyRank`
- `variantRank`
- `decompositionData`
- `classifierInfo`
- `strokeAssetId`

Notes:

- `svg_*` should not stay on the generic entry row long-term

#### `zh_character_data`

Suggested fields:

- `character`
- `decompositionData`
- `frequencyRank`
- `hsk`
- `svgSimplified`
- `svgTraditional`
- `svgSpecial`

Notes:

- if you keep storing SVGs in DB, this is a better place than `words`
- one character should not need to duplicate its SVG payload across many lexical entries

### Japanese extension tables

#### `ja_entry_data`

Suggested fields:

- `entryId`
- `jlpt`
- `isCommon`
- `priorityTags`
- `nameType`
- `kanjidicCharacterRefs`

Notes:

- JMdict and JMnedict metadata should live here instead of bloating `entries`

#### `ja_character_data`

Suggested fields:

- `character`
- `grade`
- `strokeCounts`
- `frequency`
- `jlpt`
- `radicalClassical`
- `radicalNelson`
- `readingsJson`
- `meaningsJson`

Notes:

- much of this maps naturally from Kanjidic2

#### `ja_character_components`

Suggested fields:

- `character`
- `component`
- `componentOrder`

Notes:

- this is the normalized version of `kradfile`

#### `ja_radicals`

Suggested fields:

- `radical`
- `strokeCount`
- `code`

#### `ja_radical_characters`

Suggested fields:

- `radical`
- `character`

Notes:

- these two tables are the normalized version of `radkfile`

## 8. Proposed Changes To Study Tables

The study layer should stop pointing directly at Chinese-shaped lexical records.

### `knowledge`

Current issue:

- `wordId` ties knowledge rows to the old `words` model

Target:

- replace `wordId` with `entryId`

Optional future refinement:

- support `targetType` plus `targetId`, where target can be `entry`, `sense`, or `character`

This would allow:

- word study
- kanji/character study
- name study
- sense-specific cards

For the first migration, `entryId` is enough.

### `cards`

No structural overhaul needed, but card generation should assume entries can come from different languages and different dictionary sources.

### `review_log`

No major multilingual changes required as long as `knowledge` points at language-neutral targets.

## 9. Search Model Implications

The current dictionary search logic in [app/dictionary.tsx](../../app/dictionary.tsx) is tightly coupled to:

- one `words` table
- one `name`
- one `pronunciation`
- one newline-delimited `definitions`

The target search model should query across:

- canonical entry fields
- forms
- readings
- glosses
- language-specific ranking fields

### Recommended search shape

For SQLite-backed search, use a result assembly model like:

1. search candidate forms
2. search candidate readings
3. search candidate glosses
4. merge candidate entry IDs
5. rank by:
   - exact form match
   - exact reading match
   - exact gloss match
   - commonness
   - language-specific rank like HSK or frequency
6. hydrate the final result rows from `entries`, `entry_forms`, and `entry_readings`

This does not need to be fully implemented during the schema migration, but the schema must support it.

## 10. Seed Architecture Target

The seed pipeline should be modular and standardized.

The current seed script should become a coordinator, not the owner of every import detail.

## 11. Proposed Seed Module Layout

Recommended structure:

```text
scripts/
  seed/
    index.ts
    run.ts
    core/
      context.ts
      types.ts
      logger.ts
      batch.ts
      validate.ts
      load.ts
      files.ts
      db.ts
      metrics.ts
    languages/
      zh/
        index.ts
        dictionaries.ts
        parse-cedict.ts
        parse-hsk.ts
        parse-examples.ts
        parse-decomposition.ts
        parse-svg.ts
        normalize.ts
        load.ts
        postprocess.ts
      ja/
        index.ts
        dictionaries.ts
        parse-jmdict.ts
        parse-jmnedict.ts
        parse-kanjidic.ts
        parse-kradfile.ts
        parse-radkfile.ts
        normalize.ts
        load.ts
        postprocess.ts
```

Compatibility step:

- keep [scripts/seed-expo.ts](../../scripts/seed-expo.ts) temporarily
- make it a thin wrapper that imports and runs `scripts/seed/index.ts`

## 12. Standard Seeder Interface

Each language seeder should implement a common interface.

Suggested interface:

```ts
export interface LanguageSeeder {
  languageCode: string;
  dictionaries(): Promise<SeedDictionary[]>;
  prepare(ctx: SeedContext): Promise<void>;
  extract(ctx: SeedContext): Promise<SeedSourcePayload>;
  validate(payload: SeedSourcePayload, ctx: SeedContext): Promise<ValidationReport>;
  transform(payload: SeedSourcePayload, ctx: SeedContext): Promise<NormalizedSeedData>;
  load(data: NormalizedSeedData, ctx: SeedContext): Promise<LoadReport>;
  postProcess(ctx: SeedContext): Promise<void>;
}
```

### Why this interface

- `prepare` handles file checks, preloading, or dependency setup
- `extract` is source-format-specific parsing
- `validate` catches malformed source data before load
- `transform` converts source-specific structures into repo-owned normalized structures
- `load` is where DB writes happen
- `postProcess` handles reranking, repair passes, or derived tables

This is much better than allowing every importer to parse and insert arbitrarily.

## 13. Shared Seed Types

The core should define normalized types owned by Remlang, not by any upstream source format.

Suggested normalized payload:

```ts
type NormalizedSeedData = {
  dictionaries: NormalizedDictionary[];
  entries: NormalizedEntry[];
  forms: NormalizedForm[];
  readings: NormalizedReading[];
  senses: NormalizedSense[];
  glosses: NormalizedGloss[];
  relations: NormalizedRelation[];
  examples: NormalizedExample[];
  exampleTranslations: NormalizedExampleTranslation[];
  exampleLinks: NormalizedExampleLink[];
  languageExtensions?: {
    zh?: {
      entryData?: NormalizedZhEntryData[];
      characterData?: NormalizedZhCharacterData[];
    };
    ja?: {
      entryData?: NormalizedJaEntryData[];
      characterData?: NormalizedJaCharacterData[];
      characterComponents?: NormalizedJaCharacterComponent[];
      radicals?: NormalizedJaRadical[];
      radicalCharacters?: NormalizedJaRadicalCharacter[];
    };
  };
}
```

### Important rule

Only `transform()` may produce these normalized structures.

The `load()` stage should not be doing semantic parsing of source formats. It should only:

- insert normalized rows
- enforce ordering
- map temporary IDs to DB IDs if needed

## 14. Seed Context

All seed modules should receive a shared context object.

Suggested `SeedContext`:

```ts
type SeedContext = {
  db: DrizzleDb;
  sqlite: BetterSqlite3Database;
  rootDir: string;
  resourcesDir: string;
  outputDbPath: string;
  tempDir: string;
  logger: SeedLogger;
  metrics: SeedMetrics;
  batchSize: number;
  failFast: boolean;
  enabledLanguages: string[];
};
```

Benefits:

- no module has to recreate path logic
- batch sizing and failure behavior become configurable
- logging format stays consistent

## 15. Robustness Improvements For The Seed Pipeline

This is a core part of the plan. The new pipeline should be safer than the current one.

### Input validation

Every importer should validate:

- required files exist
- files are parseable
- top-level structure matches expectation
- required keys are present
- counts are sane

For example:

- JMdict JSON should have `words`
- Kanjidic JSON should have `characters`
- CEDICT lines should parse into expected components

### Schema validation

Use a validation layer for normalized rows before DB insertion.

Possible approach:

- `zod` schemas for normalized types
- summary validation report with counts and errors

This catches issues earlier than SQL insertion failures.

### Deterministic logging

Replace ad hoc `console.log` usage with structured logging.

At minimum every stage should log:

- stage start
- item counts
- skipped rows
- warnings
- fatal errors
- stage finish duration

### Failure strategy

The runner should support:

- `failFast = true`
- `failFast = false`

In `failFast = false` mode, the loader should accumulate and report row-level failures rather than aborting immediately.

### Idempotence and reruns

Seeding should be safe to rerun from a clean DB repeatedly with the same output.

For each language:

- derived IDs should be deterministic where practical
- repeated runs should not silently drift due to random ordering
- sort orders should be explicit before insertion

### Metrics collection

Track:

- source rows parsed
- rows skipped
- entries inserted
- forms inserted
- senses inserted
- examples inserted
- post-process updates
- duration per stage

This matters once you seed multiple languages and need to compare runs.

### Debug logging cleanup

The current seed script has very specific debug traces, especially around the character `好`.

Those should be replaced with:

- targeted assertions
- optional debug filters
- structured warning summaries

## 16. Asset Strategy

The current Chinese pipeline stores SVG payloads directly on `words`. That should not be the long-term multilingual pattern.

### Recommended direction

Move asset-like character payloads into language-specific character tables:

- `zh_character_data`
- possible future `ja_character_data` if stroke assets are introduced

Reasons:

- avoids duplicating the same character SVG across many lexical entries
- keeps generic lexical rows small
- makes character-level study easier

### Near-term compromise

During migration, keep the Chinese SVG fields available until the app is updated, but plan to move them out of the entry layer.

## 17. Migration Strategy

This should be incremental.

## 18. Phase 0: Preparation

Tasks:

- add this plan document
- define exact target schema in a follow-up technical spec
- inventory all current queries that depend on `words`
- identify all current Chinese-only assumptions in UI and seed code

Deliverable:

- agreed schema and seeding interfaces before coding starts

## 19. Phase 1: Seed Framework Extraction Without Schema Rewrite

Goal:

- reduce risk by modularizing the current seed process before changing the DB model

Tasks:

- create `scripts/seed/core/*`
- move batching, logging, file access, and DB setup into shared utilities
- wrap current Chinese logic as `languages/zh/*`
- keep output behavior effectively the same

Deliverable:

- the app still seeds Chinese into the current schema
- the seed script is no longer one giant file

Success criteria:

- generated DB matches current Chinese behavior closely
- seed logs are cleaner
- Chinese seeding can run through a standardized interface

## 20. Phase 2: Introduce New Multilingual Core Tables

Goal:

- add the new core tables while keeping legacy tables alive temporarily

Tasks:

- add `languages`
- add `entries`, `entry_forms`, `entry_readings`, `entry_senses`, `sense_glosses`, `entry_relations`
- add generic example tables
- keep legacy `words` and related Chinese fields in place temporarily

Deliverable:

- DB contains both old and new structures

Success criteria:

- Chinese can be loaded into the new schema in parallel
- no app breakage yet

## 21. Phase 3: Load Chinese Into New Schema

Goal:

- prove the new schema is sufficient before adding Japanese

Tasks:

- transform CEDICT into:
  - entries
  - forms for simplified/traditional
  - readings for pinyin
  - senses and glosses
  - Chinese extension rows
- migrate example linking into the new example model
- preserve rank and HSK behavior in Chinese extension tables

Deliverable:

- Chinese fully represented in the new core+extension model

Success criteria:

- dictionary search can be rebuilt from the new tables
- word detail pages can be rebuilt from the new tables

## 22. Phase 4: App Query Migration

Goal:

- make the app read from the new model

Tasks:

- refactor dictionary search to query `entries` plus child tables
- refactor character/entry detail page to hydrate from forms, readings, senses, and examples
- migrate study tables from `wordId` to `entryId`

Deliverable:

- runtime app no longer depends on `words` as the primary lexical abstraction

Success criteria:

- Chinese app behavior remains correct
- no user-visible regression in search or detail pages

## 23. Phase 5: Add Japanese Seeders

Goal:

- import Japanese through the same interface Chinese now uses

Recommended import order:

1. JMdict common word set
2. Kanjidic
3. Kradfile/Radkfile
4. optional JMdict examples
5. optional JMnedict

Tasks:

- add `languages/ja/*`
- parse [jmdict-eng-common-3.6.2.json](../../assets/resources/jmdict-simplified/jmdict-eng-common-3.6.2.json)
- map JMdict entries to normalized entries/forms/readings/senses/glosses
- parse [kanjidic2-en-3.6.2.json](../../assets/resources/jmdict-simplified/kanjidic2-en-3.6.2.json)
- map kanji metadata to Japanese character tables
- parse [kradfile-3.6.2.json](../../assets/resources/jmdict-simplified/kradfile-3.6.2.json) and [radkfile-3.6.2.json](../../assets/resources/jmdict-simplified/radkfile-3.6.2.json)
- add examples from [jmdict-examples-eng-3.6.2.json](../../assets/resources/jmdict-simplified/jmdict-examples-eng-3.6.2.json) if needed

Deliverable:

- one database containing both Chinese and Japanese

Success criteria:

- language-aware search can be filtered by `zh` or `ja`
- Japanese entries hydrate correctly in the same UI model

## 24. Phase 6: Remove Legacy Chinese-Centric Schema

Goal:

- delete the old abstractions once the app and seed pipeline no longer rely on them

Tasks:

- retire `words` as the central lexical table
- remove direct Chinese columns from generic rows
- remove compatibility loaders and old query code

Deliverable:

- one clean multilingual schema

Success criteria:

- no runtime code path depends on legacy lexical tables

## 25. Japanese-Specific Mapping Notes

Japanese requires a few specific modeling choices.

### JMdict

Map as:

- one JMdict item -> one `entry`
- kanji spellings -> `entry_forms`
- kana readings -> `entry_readings`
- each JMdict sense -> `entry_senses`
- each gloss -> `sense_glosses`
- JMdict priority/common flags -> `ja_entry_data`

### JMnedict

Map as:

- one JMnedict item -> one `entry`
- set `entryType = name`
- store name classification in `ja_entry_data`

Important recommendation:

- keep JMnedict out of default main dictionary search initially
- it is very large and changes the UX materially

### Kanjidic

Map as:

- one character -> `ja_character_data`
- readings and meanings can live in normalized child tables or JSON payload columns

For first pass, JSON payload columns are acceptable if they keep the implementation manageable.

### Kradfile and Radkfile

Map as:

- `kradfile` -> character to components
- `radkfile` -> radical to characters

Normalize them into relational tables so future queries are simple.

## 26. Backward Compatibility Strategy

During migration, preserve compatibility where useful.

Recommended techniques:

- temporary dual-write from Chinese seeding into legacy and new tables
- compatibility selectors/adapters in the app layer
- migration views in SQLite only if they make the transition substantially easier

Avoid:

- indefinite dual-schema maintenance
- adding more features to legacy `words`

## 27. Testing Strategy

This refactor needs tests at the seed and query layers.

### Seed tests

For each language module:

- parse fixture input
- validate normalized output
- load into test DB
- assert row counts and key relationships

### Query tests

For the new dictionary search model:

- exact form match
- exact reading match
- exact gloss match
- language filtering
- mixed-language result ordering

### Migration tests

For Chinese:

- confirm current user-visible data is preserved
- compare key counts between old and new representations

## 28. Operational Considerations

### Database size

Multilingual support will increase DB size. This plan should assume:

- Japanese import may need to be configurable
- not every source must be included in every build

Recommended runner flags:

- `--languages=zh,ja`
- `--include-dictionaries=cedict,jmdict-eng-common,kanjidic2-en`
- `--skip-examples`

### Build reproducibility

Record metadata in `dictionaries`:

- source version
- source date
- seed module version

This makes it possible to inspect how a given bundled DB was built.

## 29. Recommended First Implementation Sequence

This is the concrete order I would follow.

1. Extract shared seed utilities out of [seed-expo.ts](../../scripts/seed-expo.ts).
2. Move current Chinese logic into `scripts/seed/languages/zh/*` while preserving output.
3. Define normalized seed types and the `LanguageSeeder` interface.
4. Add new multilingual core tables in Drizzle.
5. Make the Chinese seeder output normalized core data plus Chinese extension data.
6. Update one read path in the app to use the new schema.
7. Add Japanese seeding from `jmdict-eng-common`.
8. Add Kanjidic and radical/component enrichment.
9. Migrate the rest of the app off legacy lexical tables.
10. Delete or deprecate the old single-language path.

This order minimizes risk and keeps each step explainable.

## 30. Open Questions

These should be resolved before or during implementation.

### Should examples attach to entries or senses?

Recommendation:

- attach to `entryId` first
- add optional `senseId` support later

### Should characters be first-class entries?

Recommendation:

- not initially
- keep them in dedicated character tables and link them as needed

### Should Chinese SVGs stay in SQLite?

Recommendation:

- acceptable short-term
- long-term move them to character-oriented tables, not lexical entry rows

### Should Japanese names be imported immediately?

Recommendation:

- no
- start with `JMdict common` and `Kanjidic`
- add `JMnedict` only when the product actually needs names

## 31. Definition Of Done For This Refactor

This refactor is done when all of the following are true:

- the bundled database can contain at least Chinese and Japanese
- the lexical core schema is language-neutral
- Chinese-specific fields are no longer stored on generic lexical rows
- the seed pipeline is split into language modules implementing one standard interface
- the top-level seed runner orchestrates languages rather than owning their parsing logic
- the app reads from the new lexical model
- legacy single-language assumptions are removed from the critical path

## 32. Immediate Next Steps

The next concrete deliverables after this document should be:

1. a Drizzle schema proposal file or migration draft for the multilingual core tables
2. TypeScript definitions for `LanguageSeeder`, `SeedContext`, and normalized seed payloads
3. extraction of the current Chinese seed script into modular files without behavior changes

That sequence keeps the work grounded and reduces the risk of trying to redesign schema and pipeline simultaneously in one untestable jump.
