# Deck Trash Design

## Goal

Add a reversible delete flow for decks.

Deleting a deck should:

- mark the deck as deleted in the local database
- mark all cards in that deck as deleted
- remove the deck from the normal deck list and deck detail flow
- expose the deleted deck from a dedicated Trash view

This pass does not restore decks, permanently delete decks, or delete underlying knowledge and review history.

## Scope

In scope:

- soft-delete behavior for decks and cards
- deck deletion from the deck detail page
- deck deletion from the deck list options modal
- confirmation UI before deletion
- a Trash screen for viewing deleted decks
- query and store updates so deleted decks/cards are excluded from the normal app flow

Out of scope:

- restore from trash
- permanent delete
- trash for entities other than decks
- deleting orphaned knowledge or review history

## Data Model

### Schema changes

Add soft-delete fields to `decks` and `cards`:

- `deleted`: boolean, default `false`, not null
- `deletedAt`: nullable timestamp string

These fields let the app distinguish active content from trashed content without removing rows.

### Deletion semantics

When a deck is deleted:

1. update the target `decks` row with `deleted = true` and `deletedAt = now`
2. update all `cards` rows with the matching `deckId` to `deleted = true` and `deletedAt = now`
3. call `markLocalChange(db)` once after the mutation succeeds

`knowledge` and `review_log` rows remain unchanged.

## Store and Query Design

### Normal deck queries

`getDecks` and `getDeckDetail` in `lib/store/decksStore.ts` should exclude deleted decks.

Deck detail card loading should also exclude deleted cards so a trashed deck cannot appear populated if it is somehow referenced.

Deck statistics should count only non-deleted cards.

### Trash queries

Add a trash-specific query in `lib/store/decksStore.ts` that returns deleted decks for the active language, including:

- deck identity fields
- deleted timestamp
- deleted card count

This can reuse the existing deck list item shape with trash-specific filtering and counts, or define a dedicated `DeletedDeckListItem` if that is clearer.

### Mutation API

Add a store-level mutation such as `trashDeck(db, deckId)` that:

- validates the deck exists and is not already deleted
- performs the deck/card soft-delete updates
- marks local sync change
- refreshes or invalidates the observable deck store

Return values should distinguish:

- success
- missing deck
- already deleted

This keeps UI code simple and avoids repeating mutation logic across screens.

## UI Design

### Deck detail page

Add a destructive action block near the bottom of `app/deck/[id].tsx`:

- section label such as `Danger Zone`
- destructive button labeled `Delete Deck`
- helper copy explaining the deck moves to Trash and can no longer be reviewed from the main deck list

Pressing the button opens a confirmation alert.

Confirm text should make the effect explicit, for example:

`Delete "<deck name>"? This moves the deck and its cards to Trash.`

On success:

- navigate to `/decks`
- refresh the deck list state if needed

### Deck list options modal

Extend the existing deck options popup in `app/decks.tsx` with a destructive row:

- `Delete deck`

Selecting it should:

- close the modal
- open the same confirmation alert
- on confirm, trash the deck and refresh the visible list

### Trash screen

Add a new route, e.g. `app/trash.tsx`.

The screen should:

- follow existing app styling patterns
- show deleted decks for the active language
- display deck name, deleted time, and deleted card count
- show an empty state when no deleted decks exist

For this pass, the screen is view-only.

### Navigation entry point

Expose Trash from the drawer in `app/_layout.tsx` and the drawer content list so it is reachable from anywhere the deck list is reachable.

## Error Handling

If deletion fails:

- keep the user on the current screen
- show an alert with a short failure message

If the deck is already deleted or missing:

- treat it as a handled case
- refresh active deck state
- navigate back to `/decks` from deck detail if necessary

## Testing and Verification

Minimum verification for this change:

- schema/types compile after adding soft-delete fields
- normal deck list excludes deleted decks
- deck detail excludes deleted cards
- trash query returns deleted decks
- deleting from deck detail removes the deck from normal navigation and returns to `/decks`
- deleting from the deck list modal removes the deck from the list
- Trash screen renders deleted deck rows

Implementation validation:

- `pnpm exec tsc --noEmit`
- `expo lint`

If adding automated tests is practical in the current repo layout, prefer store-level tests for filtering and mutation behavior. If not, rely on manual verification of the flows above.

## Risks

- Existing SQLite installs need a migration for the new soft-delete columns.
- Review or deck flows that query cards directly may accidentally surface deleted cards if they are not updated to filter them out.
- If the observable store is only invalidated and not refreshed after delete, the deck list may look stale until the next focus event.

## Recommended Implementation Order

1. Add schema fields and migration support for soft-delete metadata on decks and cards.
2. Add store queries and mutation helpers for active decks vs trashed decks.
3. Add delete confirmation flow to deck detail.
4. Add delete confirmation flow to the deck list modal.
5. Add the Trash screen and drawer entry.
6. Run typecheck, lint, and manual flow verification.
