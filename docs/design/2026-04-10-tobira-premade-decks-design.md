# Tobira Premade Decks Design

## Goal

Add premade lesson deck assets for `Tobira 1` and `Tobira 2` from the vocab TSV files in `$TOBIRA_SOURCE_ROOT`.

The assets should:

- generate one decklist per lesson
- be organized under `tobira-1/` and `tobira-2/`
- include all vocab rows even when dictionary matching is incomplete
- support best-effort linking to local Japanese dictionary entries
- support exact sense matching when possible
- preserve the original textbook definition blob as a separate source field

The assets should not:

- create user `knowledge` rows during generation
- depend on a perfect dictionary match rate
- include counting, grammar, conjugation, or other practice-only lists

## Scope

In scope:

- parsing `Tobira 1/Lx/Lx-vocab.tsv` and `Tobira 2/Lx/Lx-vocab.tsv`
- excluding non-vocab source files
- generating per-lesson JSON decklists under `assets/decklists/tobira-1/` and `assets/decklists/tobira-2/`
- deterministic local candidate retrieval from the Japanese dictionary tables
- OpenRouter-based exact sense selection over local candidates using structured output
- conservative fallback behavior when entry or sense matching is uncertain
- copy-time rules for turning premade items into user-owned `knowledge`
- adding `knowledge.sourceDefinitions` so textbook definitions remain visible after copy

Out of scope:

- runtime UI for browsing and copying premade decks
- immediate implementation of the premade deck import flow
- automatic retroactive migration of existing user knowledge rows
- sentence/example selection beyond whatever the linked dictionary entry already provides

## Source Selection Rules

Only lesson vocab TSV files are valid inputs.

Include:

- `Tobira 1/L1/L1-vocab.tsv` through `Tobira 1/L10/L10-vocab.tsv`
- `Tobira 2/L11/L11-vocab.tsv` through `Tobira 2/L20/L20-vocab.tsv`

Exclude:

- `*counting*`
- `*grammar*`
- `*conjugation*`
- `*extended_numbers*`
- `*kanji-highlighted*`
- `*anki_import*`
- any aggregate practice files

This exclusion should be mechanical in the generator rather than maintained as a manual allowlist per lesson.

## Product Model

Premade decks are content assets, not user data.

Each premade row describes a future study item that a user may copy into a real deck later. It is not itself a `knowledge` row and does not carry FSRS state.

When a user copies premade items into a real deck:

- the user chooses the target deck
- the user chooses the review type
- the app creates or reuses user-owned `knowledge`
- the app creates one real card per copied premade row

Users should never end up with both a premade card and a separate linked dictionary card for the same row. Copying a premade row creates one review item only.

## Matching Model

### Entry matching

Each premade row should attempt a best-effort link to a local Japanese `entries` row.

Candidate retrieval should be deterministic and local:

1. normalize `kana`, `kanji`, and slash-delimited variants
2. search exact `canonicalForm`, `entry_forms.text`, and `entry_readings.text`
3. rank candidates by exactness of `kanji + kana`, then exact form, then exact reading
4. build a small candidate set for LLM adjudication

The LLM must choose only from local candidates. It must never invent an entry or sense ID.

### Sense matching

After candidate retrieval, use OpenRouter structured output to select exact senses from the chosen candidate entry.

The intended workflow is:

1. get local candidate entries and their senses
2. send the textbook row plus candidate entries and glosses to OpenRouter
3. ask the model to choose `entryId` and exact `senseIds` when possible
4. validate the response against a strict JSON schema

The default model should be `google/gemini-3-flash-preview`.

Reasons:

- this is a precision-sensitive disambiguation step, not bulk freeform generation
- it is stronger than the Lite tier for candidate adjudication
- OpenRouter supports strict structured output with JSON schema

### Conservative fallback

Conservative fallback is required to avoid future duplicate review behavior.

Rules:

- if entry and senses are matched confidently, persist exact `entryId` and `senseIds`
- if entry is trusted but exact sense selection is not, persist `entryId` and mark the row as using all senses
- if entry choice is not trusted, persist no entry link

Do not force a weak entry choice just to avoid null links.

## Generated Asset Shape

Each lesson decklist should contain deck metadata plus a list of premade items.

Suggested shape:

```json
{
  "deck": {
    "id": "tobira-1-l1",
    "book": "tobira-1",
    "lesson": 1,
    "name": "Tobira 1 · Lesson 1",
    "languageId": "lang_ja",
    "source": "tobira"
  },
  "list": [
    {
      "id": "tobira-1-l1-0001",
      "sourceTag": "NOUNS",
      "kana": "わたし",
      "kanji": null,
      "english": "I",
      "front": "わたし",
      "pronunciation": "わたし",
      "sourceDefinitions": "I",
      "dictionaryLink": {
        "entryId": "entry_123",
        "senseIds": ["sense_1"],
        "usesAllSenses": false,
        "matchStatus": "linked_exact",
        "matchMethod": "llm_candidate_selection"
      }
    }
  ]
}
```

Field rules:

- `front`: prefer `kanji` when present, otherwise `kana`
- `pronunciation`: `kana`
- `sourceDefinitions`: the original textbook English blob
- `dictionaryLink`: nullable

If a trusted entry exists but sense selection is not exact:

- `entryId` is present
- `senseIds` is `[]`
- `usesAllSenses` is `true`

If there is no trusted entry match:

- `dictionaryLink` is `null`

## Copy-Time Knowledge Creation

Copying a premade row should create one user knowledge item, not two.

### Exact match case

If a row has a trusted `entryId` and exact `senseIds`:

- create dictionary-backed `knowledge`
- set `knowledge.entryId`
- build `definitionConfig` from the matched senses only
- set `knowledge.sourceDefinitions` to the Tobira definition blob

Default presentation:

- main definition content: dictionary senses selected by `definitionConfig`
- secondary reference content: textbook definition blob

### Trusted entry but no exact sense match

If a row has a trusted `entryId` but no exact `senseIds`:

- create dictionary-backed `knowledge`
- set `knowledge.entryId`
- use the default all-senses definition config for that entry
- set `knowledge.sourceDefinitions` to the Tobira definition blob

Default presentation:

- main definition content: textbook definition blob
- dictionary content: available but collapsed by default

This avoids weak dictionary links overriding the textbook meaning the deck was authored around.

### No entry link

If a row has no trusted `entryId`:

- create custom `knowledge`
- do not set `entryId`
- use textbook values for the card content
- set `knowledge.sourceDefinitions` to the Tobira definition blob

## Knowledge Schema Addition

Add `sourceDefinitions` to `knowledge`.

Purpose:

- preserve the original textbook definition blob after copy
- distinguish textbook-authored meaning from dictionary-derived meaning
- support future UI that shows both layers intentionally

Suggested semantics:

- `definitions`: the active review-facing content
- `sourceDefinitions`: the original premade textbook definition blob

This field should remain nullable for older knowledge rows and non-premade knowledge.

## Generation Workflow

The generator should evolve from a flat text exporter into a premade deck pipeline.

For each lesson vocab TSV:

1. parse the TSV into normalized textbook rows
2. derive `front`, `pronunciation`, and `sourceDefinitions`
3. retrieve deterministic local dictionary candidates
4. run OpenRouter structured matching over those candidates
5. validate the result
6. write the final JSON decklist for that lesson

The OpenRouter step should be optional behind environment configuration so the generator can still run in a local no-enrichment mode.

## OpenRouter Structured Output Contract

The matching call should use a strict schema similar to:

```json
{
  "selectedEntryId": "string or null",
  "selectedSenseIds": ["string"],
  "usesAllSenses": true,
  "confidence": "exact | strong | weak | none",
  "reason": "string"
}
```

Validation rules:

- `selectedEntryId` must be one of the candidate entries or `null`
- `selectedSenseIds` must belong to the selected entry only
- `usesAllSenses` must be `true` when the model cannot justify exact sense selection
- invalid or out-of-candidate output is treated as unresolved

## Reporting And Safety

Each run should emit a summary report with:

- total rows processed
- exact linked rows
- linked rows using all senses
- unlinked rows
- ambiguous candidate sets
- OpenRouter failures
- schema validation failures

If the model response is invalid, missing, or inconsistent with the candidate set, the generator must fall back conservatively and continue.

## Storage Layout

Write output to:

- `assets/decklists/tobira-1/L1-decklist.json` through `L10-decklist.json`
- `assets/decklists/tobira-2/L11-decklist.json` through `L20-decklist.json`

This directory structure is the primary categorization mechanism for `Tobira 1` versus `Tobira 2`.

## Testing Expectations

Implementation should include:

- parser tests for representative vocab TSV rows
- candidate retrieval tests for exact, reading-only, and no-match cases
- structured-output validation tests
- generator snapshot tests for at least one lesson from each book
- copy-time knowledge creation tests covering:
  - exact sense match
  - trusted entry with all-senses fallback
  - no entry link
  - preservation of `sourceDefinitions`

## Open Questions Resolved

- Per-lesson decklists: yes
- Category layout: use `tobira-1/` and `tobira-2/` directories
- Include unmatched rows: yes
- Create custom fallback knowledge when needed: yes
- Allow user-selected review type at copy time: yes
- Preserve textbook definitions after copy: yes, via `knowledge.sourceDefinitions`
- Weak sense match behavior: conservative fallback to all senses for trusted entries
