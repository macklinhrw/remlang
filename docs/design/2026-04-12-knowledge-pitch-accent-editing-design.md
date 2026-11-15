# Knowledge Pitch Accent Editing Design

## Goal

Allow a knowledge item to override the primary Japanese pitch accent that the app displays.

The user must be able to:

- choose one of the existing entry pitch-accent variants as the knowledge item's primary displayed accent
- enter a fully custom primary pitch accent for the knowledge item

The override should belong to the shared `knowledge` row so linked cards inherit the same displayed accent unless the knowledge is forked.

## Current Context

- Knowledge editing lives in [app/knowledge/[id].tsx](../../app/knowledge/[id].tsx).
- Shared knowledge persistence lives in [lib/store/knowledgeStore.ts](../../lib/store/knowledgeStore.ts).
- The `knowledge` table is defined in [lib/database/schema.ts](../../lib/database/schema.ts).
- Japanese entry pitch-accent data comes from the lexicon layer in [lib/database/lexicon.ts](../../lib/database/lexicon.ts).
- Pitch-accent rendering currently assumes the first sorted entry variant is primary in [components/japanese/pitch-accent-section.tsx](../../components/japanese/pitch-accent-section.tsx).
- Pitch review cards already depend on entry pitch-accent data and should stay visually consistent with the knowledge detail screen.

## Product Decisions

- Pitch-accent overrides are stored on `knowledge`, not on `cards`.
- Editing pitch accent is available only for knowledge items whose linked entry is Japanese and has at least one pitch-accent row.
- The feature supports three modes:
  - `Default`: use the entry-derived primary accent
  - `Variant`: promote one of the existing entry variants to the displayed primary accent
  - `Custom`: define a knowledge-owned reading plus accent number
- Custom overrides take precedence over selected variants.
- If a stored variant selection no longer matches any entry variant, the app silently falls back to the entry default.
- If persisted custom override data is incomplete or invalid, the app ignores it and falls back to variant selection, then entry default.

## Approaches

### Approach 1: Knowledge-level variant reference plus optional custom override

Persist a selected entry variant identity and separate optional custom reading/accent fields on `knowledge`.

Pros:

- supports both requested behaviors directly
- preserves provenance when the user picked an existing variant
- keeps ownership aligned with the existing shared-knowledge model
- gives deterministic resolution when entry data changes

Cons:

- requires a schema migration
- needs a small amount of resolution logic when loading and rendering knowledge

### Approach 2: Persist only the final displayed pitch payload

Whenever the user changes the primary accent, store only the effective displayed reading and accent number on `knowledge`.

Pros:

- simpler runtime rendering

Cons:

- cannot distinguish a selected entry variant from a custom override
- loses provenance and makes future entry-data changes harder to reason about
- turns a reversible variant selection into an opaque copied value

### Approach 3: Store pitch override per card instead of per knowledge

Treat pitch override as deck-specific or card-specific presentation state.

Pros:

- avoids expanding the shared knowledge schema

Cons:

- conflicts with the current product model where the editable study payload lives on `knowledge`
- would make linked decks and forking behavior inconsistent
- adds complexity for no clear product gain

## Recommendation

Use Approach 1.

The user asked for both variant selection and custom entry, and the app already uses `knowledge` as the shared editable unit. A knowledge-level override layer supports both use cases while preserving linked-card behavior and avoiding card-specific drift.

## Data Model

Add these nullable columns to `knowledge`:

- `primary_pitch_accent_dictionary_id`
- `primary_pitch_accent_reading`
- `primary_pitch_accent_accent_number`
- `primary_pitch_accent_is_custom`

Semantics:

- `primary_pitch_accent_is_custom = false` with populated `dictionary_id` and `reading` means the user selected an existing entry variant.
- `primary_pitch_accent_is_custom = true` with populated `reading` and `accent_number` means the user defined a custom override.
- all four fields `null` means the knowledge item uses the entry default.

`dictionary_id` and `reading` together identify the selected entry variant. `accent_number` is stored only for custom mode. Entry-backed variant mode does not need a copied accent number because the authoritative value already exists on the entry pitch row.

## Resolution Model

Introduce a shared resolver for the effective displayed primary pitch accent.

Resolution order:

1. If `primary_pitch_accent_is_custom` is true and the custom reading and accent number are valid, use the custom override.
2. Otherwise, if `primary_pitch_accent_dictionary_id` and `primary_pitch_accent_reading` match an entry pitch variant, use that variant as the primary display.
3. Otherwise, use the current entry default: the first sorted pitch-accent variant.

The resolver should return:

- the effective primary reading
- the effective primary accent number
- the active mode: `default`, `variant`, or `custom`
- enough identity metadata to reorder the displayed variants without duplication

This resolver should be shared by the knowledge detail screen and review rendering so the app shows the same primary accent everywhere.

## Editing UI

In [app/knowledge/[id].tsx](../../app/knowledge/[id].tsx), add a `Pitch Accent` section when:

- `detail.entryDetail` exists
- `detail.entryDetail.languageId === "lang_ja"`
- `detail.entryDetail.pitchAccents.length > 0`

The section should contain:

- a preview of the current effective primary pattern
- a three-way mode picker: `Default`, `Variant`, `Custom`
- variant selection UI when `Variant` is active
- custom inputs when `Custom` is active

### Variant Mode

Show all available entry variants using the existing compact pitch visualization pattern.

Selecting a variant stores:

- `primary_pitch_accent_dictionary_id`
- `primary_pitch_accent_reading`
- `primary_pitch_accent_is_custom = false`
- `primary_pitch_accent_accent_number = null`

### Custom Mode

Show:

- a reading input
- an accent-number input

Validation rules:

- reading must be non-empty
- reading must be kana-normalized text
- accent number must parse as an integer
- accent number must be between `0` and the mora count of the reading, inclusive

An invalid custom draft can be shown while editing, but save should be blocked until the custom values are valid.

### Default Mode

Clearing the override returns the knowledge item to the entry default by setting all override fields to `null`.

## Save And Fork Behavior

Update [lib/store/knowledgeStore.ts](../../lib/store/knowledgeStore.ts) so pitch-accent override fields are part of the editable knowledge draft.

Implications:

- `updateKnowledgeInPlace` saves pitch-accent override changes alongside the existing definition, note, tag, and suspended updates.
- `forkKnowledgeForCard` copies the pitch-accent override fields into the newly created knowledge row.
- equivalent-knowledge matching must include the pitch-accent override fields so distinct pitch selections do not collapse into the same shared knowledge row by mistake

This keeps pitch override behavior aligned with the existing shared-vs-forked editing model.

## Rendering Changes

Update [components/japanese/pitch-accent-section.tsx](../../components/japanese/pitch-accent-section.tsx) so it can render an optional resolved primary override instead of always assuming the first sorted entry variant is primary.

Expected behavior:

- when there is no override, the component behaves as it does today
- when the resolved primary is a selected entry variant, that variant is shown first and omitted from the variant list below
- when the resolved primary is custom, the custom pattern is shown first and the full entry-derived variant list remains available below

The same resolved primary should be used in:

- the knowledge detail screen
- any other knowledge surfaces that show pitch accent
- `Pitch` review answer rendering in [components/review/review-cards.tsx](../../components/review/review-cards.tsx)

This prevents the knowledge editor and review surfaces from disagreeing about what the item's primary accent is.

## Error Handling

- Do not show the pitch-accent editing section for non-Japanese or no-pitch knowledge items.
- If persisted variant override data no longer matches an entry variant, fall back silently to entry default.
- If persisted custom override data is incomplete or invalid, ignore it and fall back through the normal resolution chain.
- If a custom draft is invalid in the editor, disable save and show a short validation message near the input.

## Migration Impact

Add a SQLite migration that appends the four new nullable columns to `knowledge`.

No backfill is required. Existing rows default to `null` for all override fields and therefore continue using entry-default pitch-accent behavior.

## Testing

Add focused coverage for:

- schema/store updates persisting default, variant, and custom pitch override states
- effective primary resolution order: custom, then variant, then entry default
- invalid persisted custom data falling back safely
- variant selection no longer matching an entry row falling back safely
- custom accent-number validation against mora count
- equivalent-knowledge matching treating different pitch overrides as distinct
- forked knowledge preserving pitch override fields
- `PitchAccentSection` rendering with no override, selected-variant override, and custom override
- pitch review rendering using the resolved knowledge primary rather than the entry default

## Open Assumptions

- A variant selection is identified sufficiently by `dictionary_id + reading` for the current imported pitch data.
- The existing compact pitch-accent visualization is sufficient for the variant picker and does not need a new bespoke component.
- Kana validation can be handled with lightweight normalization rules already available in the app rather than requiring an external parser.
