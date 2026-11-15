# Japanese Pitch Review Design

## Goal

Add a first-class `Pitch` review type for Japanese entries.

The prompt side should show the written form with furigana-style reading only. The answer side should show the pitch-accent pattern only.

This review type should be available only when the source entry is Japanese and has pitch-accent data.

## Current Context

- Review modes are modeled as `reviewType` values in [lib/database/schema.ts](../../lib/database/schema.ts).
- Visible review modes are defined in [lib/review/reviewTypeConfig.ts](../../lib/review/reviewTypeConfig.ts).
- Card-type selection lives in [app/select-card-type.tsx](../../app/select-card-type.tsx).
- Review rendering lives in [components/review/review-cards.tsx](../../components/review/review-cards.tsx).
- Card creation and premade imports are validated in [lib/store/decksStore.ts](../../lib/store/decksStore.ts).
- Japanese pitch-accent data already exists in the lexicon layer and is rendered by [components/japanese/pitch-accent-section.tsx](../../components/japanese/pitch-accent-section.tsx).

## Product Decisions

- The new review type name is `Pitch`.
- The prompt side uses the existing Japanese ruby-style pattern:
  pronunciation above, written form below.
- The prompt does not show a second standalone kana line.
- The answer side shows only the pitch-accent visualization.
- `Pitch` is selectable only for entries whose resolved entry detail is Japanese and has at least one pitch-accent row.
- If pitch data is unavailable, the user should not be able to create the card type in the first place.

## Approaches

### Approach 1: First-class review type backed by existing entry pitch data

Add `Pitch` to the review-type enum and route it through the same card creation, deck, linked-deck, and review flows as the other review types.

Pros:

- Matches the current architecture
- Keeps scheduling, labels, linked decks, and filtering explicit
- Reuses the existing `PitchAccentSection` and lexicon data without schema expansion

Cons:

- Requires touching several review-type switch points

### Approach 2: Treat pitch as a variant of `Front-Back`

Keep the current review types and add a secondary flag or special rendering mode.

Pros:

- Smaller enum surface

Cons:

- Blurs what makes one knowledge card distinct from another
- Makes labels, deck source types, and linked decks less coherent
- Creates hidden behavior that does not match the rest of the app

### Approach 3: Persist dedicated pitch payload on `knowledge`

Copy pitch-accent display data into the `knowledge` row and render from there.

Pros:

- Makes the answer payload explicit on the knowledge object

Cons:

- Duplicates data already available from the entry
- Adds persistence and migration complexity without a clear payoff

## Recommendation

Use Approach 1.

This app already treats review behavior as a first-class property on `knowledge`. `Pitch` fits that model cleanly and avoids inventing a second mechanism for a card type that is semantically distinct from `Front-Back`, `Back-Front`, and `Stroke`.

## Architecture

Add `Pitch` to the shared `ReviewType` enum and to the visible review-type list.

No new table or column is needed. A pitch review card remains an ordinary `knowledge` row with:

- the same `entryId`
- the same dictionary-derived front text and pronunciation
- the same config-signature behavior
- `reviewType: "Pitch"`

The back-side answer is not stored separately on `knowledge`. It is derived at review time from `entryDetail.pitchAccents`, using the same lexicon fetch path the review card already uses.

## Eligibility Rules

Create a shared eligibility helper for pitch review, parallel to the existing stroke eligibility helper.

The helper should return `true` only when:

- the entry exists
- `entry.languageId === "lang_ja"`
- `entry.pitchAccents.length > 0`

This helper should be used in all entry points that create or mirror pitch cards.

## Selection And Creation Flow

### Dictionary Add Flow

In [app/select-card-type.tsx](../../app/select-card-type.tsx):

- load entry detail as it already does for stroke support
- compute pitch eligibility from the resolved entry
- include `Pitch` in the selectable list only when eligible

`Pitch` should have its own label and description in the card-type picker.

Recommended copy:

- label: `Pitch`
- description: `See the word, recall its pitch accent.`

### Deck Store Validation

In [lib/store/decksStore.ts](../../lib/store/decksStore.ts), enforce pitch eligibility before creating knowledge or cards.

If `reviewType === "Pitch"` and the entry is not pitch-eligible, return a dedicated failure result such as:

- `pitch_not_supported`

This mirrors the existing defensive validation used for stroke cards and prevents stale UI state from creating invalid cards.

### Premade Deck Flow

Premade items with a linked Japanese entry may create `Pitch` cards only when the linked entry resolves to pitch-eligible data.

Premade items without a linked entry must not create `Pitch` cards, because there is no authoritative pitch-accent source to render from.

## Review Rendering

### Prompt Side

Add a dedicated `Pitch` branch in [components/review/review-cards.tsx](../../components/review/review-cards.tsx).

The prompt card should render like a focused Japanese reading prompt:

- small `Front` label
- furigana-style reading above the written form
- no definitions
- no extra pitch preview

The existing `ReviewReadingDisplay` pattern is close, but it should be adjusted or extended so the pitch prompt can guarantee the exact layout:

- pronunciation displayed above
- written form displayed below
- only for Japanese cards with a distinct reading

If the written form and reading are effectively identical, show the written form once rather than duplicating the same string.

### Answer Side

The `Pitch` answer card should show:

- small `Back` label
- the existing `PitchAccentSection`
- the entry-link button when available

It should not show:

- definitions
- notes
- textbook reference
- pronunciation header

This keeps the review target narrow and avoids turning the answer into a generic dictionary card.

### Fallback Behavior

Creation is gated, so pitch cards should normally always have pitch data.

If review rendering somehow receives a `Pitch` card with missing or empty `entryDetail.pitchAccents`, render a compact fallback message instead of crashing:

- `Pitch accent data is unavailable for this card.`

This is a defensive UI fallback, not a normal product path.

## Labels And Review-Type Surface

Update every user-facing review-type switch to recognize `Pitch`.

At minimum:

- [lib/database/schema.ts](../../lib/database/schema.ts)
- [lib/review/reviewTypeConfig.ts](../../lib/review/reviewTypeConfig.ts)
- [lib/review/fsrs.ts](../../lib/review/fsrs.ts)
- [app/select-card-type.tsx](../../app/select-card-type.tsx)
- [app/premade-decks.tsx](../../app/premade-decks.tsx)
- [app/premade-decks/[id].tsx](../../app/premade-decks/[id].tsx)
- [app/deck/[id]/create-linked-deck.tsx](../../app/deck/[id]/create-linked-deck.tsx)
- any review-type label helpers in knowledge and deck detail screens

User-facing label should be `Pitch`.

## Linked Deck Behavior

`Pitch` should behave like other first-class review types in linked decks.

Implications:

- a primary deck may use `Pitch` as its `sourceReviewType`
- a linked deck may target `Pitch`
- linked-deck creation should not offer `Pitch` unless the mirrored source cards can be pitch-eligible

Because pitch eligibility depends on entry detail, linked-deck sync must validate `Pitch` the same way it currently validates stroke support.

For mirrored cards whose source knowledge does not resolve to pitch-eligible entry data, the sync should skip creating the mirrored card rather than creating an invalid one.

## Data And Migration Impact

Add `Pitch` to the `ReviewType` enum in TypeScript. No SQL migration is required unless the project maintains a database-level enum constraint elsewhere, which it currently does not for SQLite `text` columns.

Existing rows do not need backfill.

## Error Handling

Handle invalid pitch creation attempts with explicit store-level statuses rather than silent fallback to another review type.

Do not silently downgrade `Pitch` to `Front-Back`. If the review type is invalid for the entry, fail creation and leave the user on the current flow.

## Testing

Add focused coverage for:

- review-type label mapping for `Pitch`
- visible review-type normalization with `Pitch`
- pitch eligibility helper behavior
- deck-store add flow rejecting non-Japanese or no-pitch entries for `Pitch`
- premade-item add flow rejecting `Pitch` when no linked pitch-eligible entry exists
- review-card rendering for `Pitch` prompt layout
- review-card rendering for `Pitch` answer showing pitch only
- defensive fallback rendering when a pitch card has no pitch data

## Open Assumptions

- The user approved a pitch-only answer card and does not want definitions or notes on the back.
- The existing pitch-accent visualization in `PitchAccentSection` is sufficient for day one and does not need a separate “guess then reveal number” UI.
- Pitch review should be available in the same places other visible review types are offered, subject to eligibility.
