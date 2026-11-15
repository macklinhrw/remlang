# Linked Decks Design

## Goal

Add linked decks that mirror a subset of cards from a primary deck into one or more read-only decks with different card types.

The mirrored subset is defined by the primary deck's designated source review type. Only cards in the primary deck whose `knowledge.reviewType` matches that source review type should be mirrored.

Linked decks should:

- contain real cards and real knowledge rows so review progress stays independent
- mirror membership changes from the primary deck for the source review type subset
- mirror content and config updates from the primary deck for the source review type subset
- mirror deletes, restores, and deck trash or restore actions from the primary deck
- remain read-only, with users routed back to the primary deck for edits

Linked decks should not:

- share FSRS scheduling state or review logs with the primary deck
- allow local edits to card membership or knowledge content
- originate their own propagation back to the primary deck

## Scope

In scope:

- linking one primary deck to multiple derived linked decks
- configuring a source review type on the primary deck
- choosing distinct target review types for linked decks
- backfilling existing cards from the primary deck into new linked decks
- propagating add, content update, delete, restore, and trash or restore actions
- read-only linked deck UI with a path back to the primary deck
- schema, sync export, and sync import support for the new linkage metadata

Out of scope:

- sharing review progress between decks
- bidirectional edits from linked decks
- cross-language linking
- automatic migration of existing decks into linked decks
- virtual linked decks that do not create real target knowledge rows

## Product Rules

### Deck roles

A deck can be either:

- a normal deck with no linking behavior
- a primary deck that owns linked decks
- a linked deck derived from one primary deck

A linked deck cannot also act as a primary deck.

### Mixed review types in primary decks

Primary decks may contain mixed review types.

Only the subset whose `knowledge.reviewType` matches the deck's configured `sourceReviewType` participates in linking. Cards in the same primary deck with any other review type remain local to that deck.

### Linked deck constraints

- a primary deck can have multiple linked decks
- each linked deck must target a review type different from the primary deck's source review type
- a primary deck can have at most one linked deck per target review type
- linked decks are read-only for membership and content changes
- linked decks may still be reviewed normally

### Ownership

All membership and content mutations originate from the primary deck.

Linked decks are derived views backed by real rows. If a user attempts to edit a linked deck, the UI should block the action and offer navigation back to the primary deck.

## Data Model

### Deck metadata

Add nullable metadata to `decks`:

- `sourceReviewType`: nullable text
- `primaryDeckId`: nullable text

`sourceReviewType` is only meaningful on primary decks.

`primaryDeckId` marks a deck as linked and points to the owning primary deck.

### Link tables

Add `deck_links`:

- `id`
- `primaryDeckId`
- `linkedDeckId`
- `targetReviewType`
- timestamps

This records the relationship between one primary deck and one linked deck.

Add `knowledge_links`:

- `id`
- `deckLinkId`
- `sourceKnowledgeId`
- `mirroredKnowledgeId`
- timestamps

This records the exact mirrored knowledge row for one source knowledge row within one linked deck.

Add `card_links`:

- `id`
- `deckLinkId`
- `sourceCardId`
- `mirroredCardId`
- timestamps

This records the exact mirrored card row for one source card row within one linked deck.

### Why explicit lineage is required

The existing `knowledge` model already separates review progress by review type. That is good for linked decks because target knowledge should have its own FSRS state.

However, propagation for content changes, deletes, restores, and deck trash or restore needs durable ownership records. Deriving mirrors only from `entryId + configSignature + reviewType` is not sufficient because:

- deletes and restores need exact source-to-mirror mapping
- cards can be duplicated across decks
- linked decks are read-only and should not drift
- content propagation should not guess which target knowledge row belongs to which primary relationship

Explicit lineage tables make those mutations deterministic.

## Propagation Rules

### Create linked deck

When a user creates a linked deck from a primary deck:

1. validate the primary deck is not itself linked
2. set or confirm the primary deck's `sourceReviewType`
3. create the linked deck with `primaryDeckId = <primary deck id>`
4. create a `deck_links` row with the target review type
5. backfill mirrors for every active primary-deck card whose knowledge row matches `sourceReviewType`

Backfill creates:

- a target knowledge row for the linked deck's target review type
- a mirrored card in the linked deck
- matching `knowledge_links` and `card_links` rows

### Add card to primary deck

When `addEntryToDeck` adds a card to a primary deck:

- if the new card's review type does not match the deck's `sourceReviewType`, do nothing for linked decks
- if it does match, create or reuse one mirrored knowledge row per linked deck, then create the mirrored card and lineage rows for each linked deck

Target knowledge reuse should be limited to the same `deck_link` lineage semantics. The implementation may reuse an existing target knowledge row if it matches the same source knowledge and target review type for that linked deck. It should not attach arbitrary preexisting target knowledge from unrelated decks.

### Update source knowledge content

When source knowledge in the primary subset changes, propagate only content and config fields to mirrored knowledge rows:

- `front`
- `definitions`
- `pronunciation`
- `configSignature`
- `definitionConfig`
- `configLabel`
- any other non-review presentation fields added later that are part of the knowledge card content

Do not propagate FSRS state fields such as:

- `due`
- `stability`
- `difficulty`
- `elapsedDays`
- `scheduledDays`
- `learningSteps`
- `reps`
- `lapses`
- `state`
- `lastReview`
- `review_log`

### Delete or restore source card

When a source card is soft-deleted:

- soft-delete every mirrored card referenced by its `card_links`

When a source card is restored:

- restore every mirrored card referenced by its `card_links`

If a source card is permanently removed in the future, its lineage rows should also be cleaned up.

### Trash or restore primary deck

When a primary deck is moved to Trash:

- trash the primary deck
- trash all linked decks
- soft-delete all active cards in the primary deck
- soft-delete all active mirrored cards in linked decks

When a primary deck is restored:

- restore the primary deck
- restore all linked decks
- restore all mirrored cards that were deleted through the link relationship

Linked decks must not be independently trashed or restored from their own screen.

### Review in linked decks

Review updates only the linked deck's own target knowledge row and review logs.

No review state propagates across links.

## Store and Mutation Design

### Primary deck helpers

Add store helpers in `lib/store/decksStore.ts` for:

- creating a linked deck for a target review type
- creating multiple linked decks from one primary deck setup flow
- backfilling linked decks from existing primary cards
- propagating card add operations
- propagating source knowledge content updates
- propagating source card delete or restore
- propagating primary deck trash or restore

The existing `addEntryToDeck` path should remain the single source of truth for adding a card to a deck, with linked-deck propagation layered into that path when the deck is a primary deck and the added card matches its `sourceReviewType`.

### Guardrails

Store-level mutations should reject:

- attempts to create a link from a linked deck
- attempts to create duplicate target review type links for the same primary deck
- attempts to mutate linked decks directly for membership or content changes

These guardrails should exist even if the UI already hides those actions.

### Read-only deck detail

`getDeckDetail` should expose enough relationship metadata for the UI to know whether a deck is:

- normal
- primary
- linked

For linked decks, the UI also needs the owning primary deck id and name.

## UI Design

### Primary deck detail

Extend `app/deck/[id].tsx` with a `Linked Decks` section that lets the user:

- see whether the deck is linked or primary
- configure or change the `sourceReviewType`
- create one or more linked decks for other review types
- navigate into linked decks

The UI should explain that only cards of the source review type are mirrored.

### Linked deck detail

Linked deck detail should show:

- a read-only badge or banner
- the target review type
- the owning primary deck name
- a `Go to Primary Deck` button

The screen should hide or disable any actions that would mutate card membership or card content locally.

Delete or trash actions should be replaced with explanatory copy indicating that the deck is managed by its primary deck.

### Add-to-deck flow

The existing add-to-deck flow does not need a new step.

When the user adds a card to a primary deck, propagation should happen automatically if the card's review type matches the deck's configured source review type.

### Deck list

The deck list should visually distinguish linked decks from normal decks and primary decks. A lightweight badge is sufficient.

Users should still be able to start review from linked decks.

## Sync and Persistence

The new deck fields and link tables must be included in:

- local schema and migration files
- sync export
- sync import
- backend sync schema and persistence, if those tables are mirrored server-side

If sync cannot support the feature in the same implementation pass, the app should not ship partial local-only linked deck support because link lineage would be lost across devices.

## Error Handling

If linked deck creation fails partway through backfill:

- roll back the transaction if practical
- otherwise clean up the partially created linked deck and lineage rows before returning an error

If propagation fails during a primary-deck mutation:

- fail the full mutation rather than leaving the linked decks partially updated

These operations should be transactional where the database layer allows it.

## Testing and Verification

Minimum automated coverage:

- creating a linked deck backfills only the primary deck cards that match `sourceReviewType`
- adding a matching source card creates mirrored cards in every linked deck
- adding a non-matching source card creates no mirrors
- updating source knowledge content updates mirrored knowledge content but not FSRS fields
- reviewing a mirrored card does not update source knowledge
- deleting or restoring a source card propagates to mirrored cards
- trashing or restoring a primary deck propagates to linked decks
- direct mutation attempts against linked decks are rejected

Manual verification:

- create a mixed-type primary deck
- configure a source review type
- create linked decks for two other review types
- confirm only the source subset backfills
- add another matching source card and confirm both linked decks update
- add a non-matching card and confirm linked decks do not change
- review a card in a linked deck and confirm the primary deck schedule does not move
- trash and restore the primary deck and confirm linked decks follow

Implementation validation:

- `pnpm exec tsc --noEmit`
- `expo lint`

## Risks

- The existing codebase currently has few explicit single-card content mutation paths, so implementation may require introducing a new shared knowledge-update helper before linked propagation can be centralized cleanly.
- Sync support will expand because lineage metadata must round-trip correctly.
- Without transactions, partial propagation would leave linked decks inconsistent with their primary deck.
- Existing deck UIs assume decks are directly editable, so read-only linked deck behavior must be enforced both visually and in store mutations.

## Recommended Implementation Order

1. Add schema fields, link tables, relations, and migrations.
2. Extend sync export and import support for deck metadata and lineage tables.
3. Add store helpers for linked deck creation and backfill.
4. Add propagation to `addEntryToDeck`.
5. Introduce shared source-knowledge content update helpers and propagate those updates.
6. Extend deck trash or restore logic to cascade through linked decks.
7. Update deck detail and deck list UI for primary vs linked decks.
8. Add automated coverage and run typecheck and lint.
