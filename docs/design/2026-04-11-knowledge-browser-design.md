# Knowledge Browser Design

## Goal

Add a first-class `Knowledge` area to the sidebar for browsing and managing existing `knowledge` rows.

This screen is not a second dictionary surface. It is a management surface for shared study objects that may be linked to many cards across many decks.

## Current Context

- The app uses an Expo Router drawer in [app/_layout.tsx](../../app/_layout.tsx).
- Shared study data lives in the `knowledge` table in [lib/database/schema.ts](../../lib/database/schema.ts).
- Deck card rows currently route into entry detail via [app/deck/[id].tsx](../../app/deck/[id].tsx).
- Review cards currently route into entry detail via [components/review/review-cards.tsx](../../components/review/review-cards.tsx).
- Knowledge variants already exist as first-class records via `configSignature`, `definitionConfig`, `configLabel`, and `reviewType`.

## Approaches

### Approach 1: Dedicated drawer section for knowledge

Add a new top-level drawer item and dedicated routes for browsing and editing knowledge.

Pros:

- Clear separation between dictionary source data and shared knowledge data
- Fits the existing drawer navigation model
- Gives CRUD and link-impact behavior a proper home

Cons:

- Requires new screens and new store/query helpers

### Approach 2: Expand dictionary into a dual-purpose screen

Use the current dictionary screen for both source lookup and knowledge browsing.

Pros:

- Reuses some list/search UI

Cons:

- Blurs the distinction between source entries and user-managed shared knowledge
- Makes impact-heavy CRUD feel bolted onto the wrong surface

### Approach 3: Put knowledge management under decks only

Treat knowledge as a secondary deck-management surface.

Pros:

- Close to where many users first encounter knowledge-backed cards

Cons:

- Weakens the “global shared object” model
- Makes cross-deck browsing and search less direct

## Recommendation

Use Approach 1.

Knowledge is a shared entity that can outlive any one deck or card. It needs global browse/search, explicit linked-card impact messaging, and origin-aware editing behavior. A dedicated drawer area is the cleanest and least confusing model.

## Routes And Navigation

Add two new routes:

- [app/knowledge.tsx](../../app/knowledge.tsx): paginated browser
- [app/knowledge/[id].tsx](../../app/knowledge/[id].tsx): detail/editor

Add `Knowledge` to the drawer item list in [app/_layout.tsx](../../app/_layout.tsx).

### Entry Points

Users can open knowledge detail from:

- the `Knowledge` browser
- deck card rows
- review card UI

### Origin Context

When navigation originates from a specific card, include enough route state to identify that origin:

- `cardId`
- `deckId`
- `deckName` when available for display
- `originPath` for return navigation

This context is used only for edit decisions. Browser-originated navigation has no origin context and therefore supports only shared knowledge mutations.

## Browser Screen

The browser is active-language scoped. Day one does not add extra filters beyond language, search, and pagination.

### Search

Provide free-text search over fields users recognize:

- `knowledge.front`
- `knowledge.pronunciation`
- `knowledge.definitions`

Search should debounce input and reset pagination back to page 1 when the query changes.

### Pagination

Provide offset/limit pagination with explicit next/previous controls and a visible result summary.

The screen should show:

- current page
- current result range
- total result count

### Row Content

Each row should show enough information to distinguish shared variants quickly:

- front
- pronunciation when present
- first definition line
- review type
- config label
- suspended state
- linked-card count

Tapping a row opens knowledge detail.

## Knowledge Detail Screen

This screen is a knowledge workspace, not a read-only inspector.

### Read Surface

Show:

- front
- pronunciation
- full selected definitions
- review type
- config label
- note
- tags
- suspended state
- linked-card count
- deck usage summary

If `entryId` exists, keep a path into the current entry detail flow rather than duplicating all dictionary content here.

### Editable Fields

Day-one editable actions:

- change selected definitions and senses when backed by an `entryId`
- edit note
- edit tags
- suspend or unsuspend
- trash or delete knowledge

No extra management actions are required on day one for deck assignment from this screen.

## Shared-Link Impact Rules

Every knowledge mutation must clearly report how many linked cards are affected.

At minimum, update the UI before destructive or persistence-confirming actions with:

- linked card count
- linked deck count

Example copy:

- `This changes 12 linked cards across 3 decks.`
- `This deletes knowledge used by 7 linked cards across 2 decks.`

This applies to:

- editing definitions
- editing note
- editing tags
- suspend or unsuspend
- trash or delete

## Origin-Aware Edit Behavior

If the user arrived from a specific card, the detail screen offers two save paths for edits:

1. Update this knowledge in place
2. Create a copy for the originating deck/card

### Update In Place

This updates the shared `knowledge` row and therefore affects every linked card. The confirmation UI must state the linked-card impact before save.

### Create Copy For Origin Card

This path exists only when origin context is present.

Flow:

1. Build the edited knowledge payload
2. Check for an existing equivalent knowledge row for the same semantic variant
3. If no equivalent row exists, create a new knowledge row
4. Relink only the originating card to that new knowledge row
5. Leave all other linked cards on the original knowledge row

### Duplicate Detection

When deciding whether an equivalent knowledge row already exists, compare the values that define a knowledge variant:

- `entryId`
- `reviewType`
- `configSignature`
- edited note and tags if those are treated as part of uniqueness for copy flows

Day one should treat note and tags as user-managed properties of the row. If a copy flow edits only note or tags, that still justifies a fork because those fields are shared on the source row. Duplicate detection should therefore compare the full persisted payload used to create a copy, not just dictionary-definition shape.

If an equivalent row already exists:

- do not create a duplicate
- prompt the user to link the originating card to the existing row instead

## Delete And Trash Behavior

Knowledge deletion is destructive because cards depend on knowledge.

The confirmation step must always:

- state how many linked cards and decks are affected
- describe the resulting behavior for linked cards

Implementation must make the linked-card outcome explicit and consistent:

- either trash/delete the dependent cards with the knowledge
- or block deletion when linked cards still exist

The implementation plan must choose one behavior and use it consistently across UI copy, store logic, and tests. Day one should not leave this implicit.

## Data Layer

Add dedicated knowledge query and mutation helpers rather than placing this logic directly in screen files.

Recommended responsibilities:

- fetch paginated knowledge browser results for the active language
- fetch one knowledge detail record
- compute linked-card count and linked-deck count
- compute usage summary by deck
- compute mutation impact preview
- update shared knowledge in place
- create forked knowledge and relink the origin card
- detect duplicate target knowledge rows for fork flows
- suspend or unsuspend knowledge
- trash or delete knowledge using the selected linked-card policy

This can live in a new knowledge-focused store or data module such as `lib/store/knowledgeStore.ts`.

## UI Notes

### Browser

The browser should feel structurally similar to `Decks` and `Dictionary`, but it should read as a management index rather than a search-only screen.

Keep the first version intentionally narrow:

- one search box
- pagination controls
- result count summary
- compact but information-dense row cards

### Detail

Use sectioned editing rather than a dense form wall:

- summary
- definitions
- notes and tags
- usage and impact
- destructive actions

If the screen has origin context, show a small banner or section that identifies the originating card and deck so the “copy for this deck” action is explainable.

## Testing

Add tests around the data-layer logic that make the shared-link behavior safe.

Priority coverage:

- search query and pagination behavior
- linked-card and linked-deck impact counts
- in-place update affecting all linked cards through shared knowledge semantics
- copy flow creating a new knowledge row and relinking only the origin card
- duplicate detection causing link-to-existing instead of duplicate creation
- suspend or unsuspend preserving link counts and shared semantics
- delete or trash behavior matching the chosen linked-card policy

## Implementation Notes

Expected first implementation slices:

1. Drawer wiring and empty routes
2. Knowledge browser query plus list UI
3. Knowledge detail query plus read surface
4. Shared update actions with impact previews
5. Origin-aware copy and relink flow
6. Delete or trash handling
7. Navigation updates from deck and review card surfaces

## Open Decisions Resolved By This Spec

- The browser is for existing `knowledge` rows, not dictionary entries.
- Day-one browser filters are limited to active language, free-text search, and pagination.
- Day-one detail actions are definitions/senses editing, note editing, tag editing, suspend or unsuspend, and trash or delete.
- Card-origin navigation must preserve origin context so edits can fork only for that originating deck/card.
- All CRUD-affecting actions must state linked-card impact before confirmation.
