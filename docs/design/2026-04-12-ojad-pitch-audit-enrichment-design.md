# OJAD Pitch Audit Enrichment Design

## Goal

Extend the Japanese pitch-accent audit so OJAD can be used as an opt-in verification source when investigating suspicious cases.

This is an audit-only feature. It does not change import matching, runtime pitch selection, or seeded database contents by itself.

## Current Context

- The local audit script lives in [scripts/audit-ja-pitch-accent-import.ts](../../scripts/audit-ja-pitch-accent-import.ts).
- The script already reports:
  - aggregate ambiguous-bucket counts
  - sample suspicious UniDic buckets
  - focused rows for explicit terms
- OJAD is useful here as an external reference when local data looks suspicious, but it should not become part of the normal offline audit path.

## Requirements

### Functional

- Keep the audit offline by default.
- Add an opt-in `--ojad` flag.
- When `--ojad` is enabled, enrich rows already being inspected:
  - sampled suspicious UniDic buckets
  - focused rows for explicit terms
- Fetch OJAD search results for the relevant reading or term.
- Parse OJAD from HTML markup, not screenshots or graphics.
- Extract structured audit data when available:
  - matched headword
  - displayed reading
  - accent encoding from HTML/CSS classes
  - enough raw extracted tokens/classes to debug parser failures or ambiguity
- Compare local rows against OJAD and print a compact audit result.

### Non-Functional

- Network access must remain opt-in via `--ojad`.
- Parser failures must degrade cleanly to informative output, not crash the audit.
- OJAD enrichment should remain bounded to visible audit rows, not every matching row in the database.
- If OJAD does not expose enough information for a case, report uncertainty explicitly instead of guessing.

## Proposed Approach

### 1. Add OJAD enrichment mode to the audit script

Extend the existing CLI parser with:

- `--ojad`
- optional internal helpers for term normalization and request pacing

Default behavior remains unchanged when the flag is absent.

### 2. Introduce a small OJAD fetch-and-parse helper

Add a local helper module for:

- building the OJAD search URL from a term
- fetching the HTML
- parsing the relevant result rows from the HTML
- extracting structured accent metadata from DOM markup and CSS classes

The helper should return structured results plus low-level parsed fields that can be printed when the mapping is unclear.

### 3. Restrict OJAD lookups to audit targets

With `--ojad`, enrich only:

- the suspicious UniDic sample rows already printed by the audit
- focused term rows explicitly requested on the command line

This keeps OJAD in the role of verifier for suspicious cases instead of turning the audit into a full remote crawl.

### 4. Add audit comparison output

For each enriched row, print:

- local entry identity
- local form and reading context
- local accent candidates
- parsed OJAD matches
- a compact status

Initial statuses:

- `matches`
- `reading-mismatch`
- `accent-mismatch`
- `no-ojad-match`
- `ojad-ambiguous`
- `ojad-parse-uncertain`

The comparison should prefer explicit uncertainty over overconfident classification.

## Data Flow

1. Run existing local SQL audit.
2. Build the rows that will be shown to the user.
3. If `--ojad` is disabled, print the current local-only output.
4. If `--ojad` is enabled:
   - derive lookup terms from sampled suspicious rows and focused rows
   - fetch OJAD results for those terms
   - parse structured accent information
   - compare parsed OJAD entries with local rows
   - print local output followed by OJAD comparison blocks

## Parser Strategy

The parser should be conservative.

- Parse only the specific result-row elements needed for audit output.
- Use stable text and class selectors where possible.
- Preserve raw class names and extracted fragments in the returned structure for debugging.
- If accent-number mapping from classes is not fully certain, include the raw class payload and mark the result as `ojad-parse-uncertain`.

This keeps the first version useful even if a few edge cases need later refinement.

## Error Handling

- HTTP failure:
  - print an `ojad-fetch-error` note for the affected lookup term
  - continue auditing other rows
- Empty OJAD result:
  - classify as `no-ojad-match`
- Parse failure:
  - classify as `ojad-parse-uncertain`
  - include raw snippets/classes if available
- Multiple OJAD candidates for the same local row:
  - classify as `ojad-ambiguous`

## Testing

Add focused coverage for:

- CLI flag parsing
- OJAD HTML parsing from saved sample HTML fixtures or inline representative snippets
- comparison classification for:
  - matching case
  - reading mismatch
  - accent mismatch
  - no match
  - ambiguous parse

The audit script itself can still be smoke-tested by execution, but the parser/comparison logic should have direct unit coverage.

## Scope Boundaries

Included:

- audit CLI flag
- OJAD fetch/parsing helper
- enriched audit output
- parser/comparison tests

Not included:

- automatic import corrections based on OJAD
- reseed logic changes
- runtime UI changes
- bulk OJAD crawling or caching

## Risks

- OJAD markup may change, so the parser should be isolated and easy to adjust.
- Some OJAD pages may expose accent information in a way that is structurally parseable but semantically unclear without reverse-engineering class mappings.
- External lookups may be slower or rate-limited, so the feature stays opt-in.

## Implementation Notes

- Keep the audit’s existing text output shape readable in terminals.
- Prefer concise per-row enrichment blocks over large JSON dumps.
- Use official OJAD pages only.
- Treat OJAD as a reference signal for investigation, not as ground truth to silently overwrite local data.
