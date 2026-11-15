# Japanese Pitch Accent Import Hardening Design

## Goal

Fix long-term Japanese pitch-accent data quality issues at import time instead of masking them in runtime sorting.

The specific trigger for this work is `六 [ろく]`, where the app currently chooses accent `1` even though the same entry already contains UniDic accent `2` and external references such as textbook material and OJAD support the `2` pattern. The root cause is not missing data. The importer attached an unrelated UniDic row to the same JMDict entry, and the runtime primary selector then chose the wrong attached row.

This design should:

- prevent bad UniDic pitch rows from attaching to unrelated JMDict entries
- preserve legitimate same-entry pitch variants from Kanjium
- provide an audit path to measure suspicious pitch attachments before and after the fix
- keep runtime resolution simple by improving the data rather than layering on more ranking exceptions

## Current Context

- UniDic pitch import logic lives in [scripts/seed/languages/ja/pitchAccent.ts](../../scripts/seed/languages/ja/pitchAccent.ts).
- Japanese seed orchestration lives in [scripts/seed/languages/ja/index.ts](../../scripts/seed/languages/ja/index.ts).
- Imported pitch rows are stored in `ja_pitch_accents`, defined in [lib/database/schema.ts](../../lib/database/schema.ts).
- Runtime pitch selection currently prefers UniDic over Kanjium, then lower `accentOrder`, then lower `accentNumber`, in [lib/japanesePitchAccent.ts](../../lib/japanesePitchAccent.ts).
- Inspection tooling already exists in [scripts/inspect-ja-pitch-accent.ts](../../scripts/inspect-ja-pitch-accent.ts).

## Audit Findings

Using the current local database and UniDic source file:

- there are `11,305` entry/display-reading buckets with more than one accent pattern
- `10,155` of those are Kanjium-only buckets and appear to be legitimate dictionary variants
- `1,114` are UniDic buckets where one JMDict entry has rows from multiple UniDic lemmas for the same displayed reading
- expanded to entry-plus-display-reading buckets, that produces `2,192` suspicious UniDic combinations
- `1,464` of those mix proper nouns with ordinary lexical entries
- `534` are non-proper-only collisions, so proper-noun filtering alone is insufficient

Representative failures:

- `六 [ろく]`: ordinary number entry attached to a UniDic person-name row with accent `1`
- `〆る [しめる]`: a single JMDict entry attached rows from distinct verb lemmas such as `締める` and `湿る`
- `くねる [くねる]`: verb entry attached a katakana loanword row for `クネル`
- `え [え]`: interjection entry attached rows for unrelated lexical items with the same pronunciation

## Root Cause

The current UniDic matcher is too permissive in two ways:

1. It can attach multiple UniDic lemmas to the same JMDict entry when they share a normalized surface/reading combination.
2. It does not validate whether the UniDic row's lexical class is compatible with the target JMDict entry.

This happens before runtime sorting. Once the bad rows are in `ja_pitch_accents`, the runtime selector behaves consistently but on contaminated data.

## Approaches

### Approach 1: Runtime-only ranking fixes

Change primary selection logic so suspicious UniDic rows lose to other variants.

Pros:

- fast to ship
- avoids reseeding immediately

Cons:

- leaves bad rows in the database
- requires continuing to encode data-quality exceptions in runtime code
- does not help manual inspection or future import quality

### Approach 2: Narrow importer fix for proper nouns only

Reject UniDic rows from proper-noun POS buckets unless the target JMDict entry is clearly a name entry.

Pros:

- addresses a large share of suspicious cases
- easy to reason about

Cons:

- misses non-proper collisions such as `〆る`, `え`, and `くねる`
- still allows unrelated lexical lemmas of the same broad POS to contaminate one entry

### Approach 3: Import hardening with lemma and POS compatibility plus audit tooling

Keep the current import sources, but tighten UniDic candidate matching and add a dedicated audit script for suspicious attachments.

Pros:

- fixes `ろく` at the source
- addresses both proper-noun and non-proper contamination
- gives a repeatable way to measure quality before and after reseeding
- preserves legitimate Kanjium multi-variant data

Cons:

- requires importer changes, tests, and a reseed
- introduces more explicit compatibility logic into the seed pipeline

## Recommendation

Use Approach 3.

The audit shows the core problem is importer contamination, not missing pitch information and not only proper nouns. A long-term fix should prevent unrelated UniDic lemmas from attaching in the first place and should include an audit that lets us inspect residual suspicious cases after reseeding.

## Design

### 1. Split UniDic matching into candidate discovery and candidate validation

Keep the current index-based discovery step, but add an explicit validation phase before a matched UniDic row is accepted.

Validation should check:

- lemma compatibility
- script/form compatibility
- coarse POS compatibility

The importer should reject rows that fail validation and count them separately in stats.

### 2. Add lemma compatibility for UniDic rows

For a UniDic row matched to a JMDict entry:

- normalize the UniDic lemma and orthographic base without over-collapsing scripts
- build a set of acceptable JMDict lexical forms for that entry:
  - canonical form
  - kanji forms
  - kana forms
- require the UniDic row to be compatible with at least one acceptable lexical form

Compatibility rules:

- exact text equality is valid
- kana-to-kana equality after katakana-to-hiragana normalization is valid
- kanji form equality is valid
- numeric compatibility is valid only for explicit numeric spellings already represented by the JMDict entry, such as `6`, `６`, `Ⅵ`, `ⅵ` for `六`
- kana-only compatibility should not be enough to attach a UniDic row if the row's lemma points to a distinct lexical item not represented by the JMDict entry

Implication for `六 [ろく]`:

- UniDic numeric lemma rows for `六` remain valid
- the person-name UniDic row for `六 / ロク / accent=1` is rejected because its lemma is not compatible with the ordinary number entry

### 3. Preserve script distinctions in matching

Do not let orthographic matching rely only on katakana-to-hiragana-normalized surface forms.

The importer should distinguish at least these categories:

- kanji or mixed-script forms
- kana forms
- Latin or symbol forms used for numeric variants

This prevents false positives such as:

- ordinary hiragana lexical items accidentally matching katakana loanwords
- kana interjections accidentally matching katakana name spellings

Reading normalization should still be used for reading comparison, but orthographic compatibility should remain stricter than reading compatibility.

### 4. Add coarse POS compatibility gates for UniDic

Map UniDic POS buckets to a small set of compatibility classes and compare them to the JMDict entry.

Proposed classes:

- `verb`
- `adjective`
- `adverb`
- `interjection`
- `pronoun`
- `counter`
- `numeral`
- `noun-general`
- `noun-proper`
- `suffix/prefix/auxiliary`
- `other`

Derive JMDict-side compatibility from entry senses and known form metadata.

Minimum rules:

- `noun-proper` UniDic rows should not attach to entries that do not look name-like
- `numeral` UniDic rows should strongly prefer entries whose senses or headwords indicate number usage
- `verb` UniDic rows should attach only to verb-like JMDict entries
- `interjection` UniDic rows should not attach to ordinary noun entries with the same reading unless the entry itself is interjection-like

This gate should be coarse and conservative. If compatibility cannot be established, reject the row rather than attaching it speculatively.

### 5. Keep Kanjium import behavior unchanged

Do not apply the new UniDic compatibility gates to Kanjium.

Reasoning:

- the audit shows most ambiguous same-reading variants are Kanjium-only
- those variants appear to be legitimate alternative accent patterns rather than importer contamination
- Kanjium lacks the same lemma metadata, so forcing UniDic-style validation onto it would be speculative

### 6. Expand import statistics

Extend `JaPitchAccentImportStats` to capture rejection causes so the audit is measurable.

Add counters for:

- `rejectedLemmaMismatchRows`
- `rejectedScriptMismatchRows`
- `rejectedPosMismatchRows`
- `rejectedAmbiguousCompatibleRows`

Keep sample rows for each rejection bucket.

This makes importer behavior observable during seeding and QA.

### 7. Add a dedicated suspicious-attachment audit script

Add a new script, for example `scripts/audit-ja-pitch-accent-import.ts`, that reports:

- same-entry same-reading UniDic rows from multiple source lemmas
- current primary accent versus alternative accents for those buckets
- source POS summaries for attached UniDic rows
- representative examples grouped by suspicion type

The script should support:

- full summary mode
- focused lookup for one term or entry id
- before/after comparison against a supplied database file when useful

This should complement, not replace, [scripts/inspect-ja-pitch-accent.ts](../../scripts/inspect-ja-pitch-accent.ts).

### 8. Reseed and validate runtime behavior

After importer changes:

- rebuild Japanese pitch-accent rows
- regenerate the seeded database
- rerun the suspicious-attachment audit
- inspect known problematic entries such as `六`

Runtime selection code in [lib/japanesePitchAccent.ts](../../lib/japanesePitchAccent.ts) should remain unchanged unless post-reseed audit still shows a separate ranking problem.

## Data Flow

1. Read UniDic row.
2. Discover candidate JMDict entry ids using the current indexes.
3. For each discovered candidate, evaluate compatibility rules.
4. If exactly one compatible candidate remains, import the row for that entry.
5. If none remain, record a rejection reason.
6. If multiple compatible candidates remain, record an ambiguity rejection rather than attaching the row speculatively.
7. Keep Kanjium import on its current path.
8. Run audit tooling on the resulting seeded database.

## Error Handling

- If UniDic metadata needed for compatibility is missing, reject conservatively instead of attaching loosely.
- If a row passes discovery but fails compatibility, count and sample it rather than silently dropping it.
- If a row still maps to multiple compatible entries after validation, treat it as ambiguous and reject it.
- If the audit still finds suspicious buckets after reseeding, do not paper over them in runtime ordering until they are classified.

## Testing

Add or update focused tests in [scripts/seed/languages/ja/pitchAccent.test.ts](../../scripts/seed/languages/ja/pitchAccent.test.ts) for:

- `六 [ろく]` style contamination:
  - numeric UniDic row is accepted
  - proper-name UniDic row is rejected
- mixed-lemma same-POS contamination:
  - `〆る`-style distinct verb lemmas do not collapse onto one entry
- katakana-versus-hiragana lexical collisions:
  - `くねる`-style loanword rows do not attach to unrelated hiragana verbs
- interjection versus noun collisions:
  - `え`-style rows are filtered by POS compatibility
- legitimate UniDic same-lemma multi-form import still works
- kana-only entries still import successfully when compatibility is real
- Kanjium multi-variant imports remain unchanged

Add smoke-level verification for the new audit script:

- summary output contains expected counts on a fixture database
- focused lookup for `ろく` surfaces the expected source rows

## Success Criteria

- `六 [ろく]` resolves to the ordinary numeric accent data after reseed, without requiring a manual override
- suspicious UniDic multi-lemma buckets drop materially from the current baseline of `2,192`
- Kanjium-only multi-variant counts remain broadly stable
- importer stats expose why rejected rows were excluded
- no runtime ranking changes are required to fix importer-caused primary errors

## Open Assumptions

- JMDict entry forms and senses provide enough signal to derive coarse POS compatibility without adding new source datasets
- numeric variant spellings can be handled by a narrow explicit compatibility rule rather than a broad symbol-normalization rule
- Kanjium ambiguity should remain allowed unless later review shows a separate data-quality problem there
