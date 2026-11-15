# Review Undo Design

## Goal

Add an “undo previous review” feature that:

- works after leaving and reopening the review screen
- supports exactly one step of undo
- is available from the top-right of both deck and folder review screens
- restores the exact pre-review FSRS state for the previously reviewed card

The feature should stay narrowly scoped to “undo the previous review,” not general review history editing.

## Current Context

- Review submission is implemented in [lib/review/fsrs.ts](../../lib/review/fsrs.ts).
- Review session state is coordinated in [lib/store/deckReviewStore.ts](../../lib/store/deckReviewStore.ts).
- Deck review UI lives in [app/deck/[id]/review.tsx](../../app/deck/[id]/review.tsx).
- Folder review UI lives in [app/folder/[id]/review.tsx](../../app/folder/[id]/review.tsx).
- Review history is persisted in the `review_log` table defined in [lib/database/schema.ts](../../lib/database/schema.ts).
- Daily review limits derive counts from `review_log` in [lib/review/reviewLimits.ts](../../lib/review/reviewLimits.ts).

## Approaches

### Approach 1: Dedicated `review_undo` snapshot table

Create a new table that stores the full pre-review FSRS snapshot plus a reference to the created `review_log` row.

Pros:

- exact rollback
- survives leaving and reopening the review screen
- keeps undo concerns separate from audit history
- easy to consume once and invalidate

Cons:

- requires schema and sync changes
- introduces one more persisted review artifact

### Approach 2: Extend `review_log` with pre-review fields

Store the pre-review snapshot directly on each review log row.

Pros:

- no extra table
- undo state stays adjacent to the logged review

Cons:

- mixes rollback state into the audit record
- makes `review_log` wider and less focused
- awkward once a review is undone

### Approach 3: Reconstruct prior state from older logs

Infer the prior FSRS state from the current `knowledge` row and earlier `review_log` rows.

Pros:

- smallest schema change

Cons:

- not exact for first reviews or non-review edits
- brittle and difficult to trust
- too risky for persisted undo

## Recommendation

Use Approach 1.

Persistent undo needs an exact snapshot of the pre-review state. A dedicated `review_undo` table makes that explicit, keeps the forward audit trail clean, and avoids trying to infer state that the app does not currently store.

## Behavior

### Undo Scope

- The app supports undoing only the single most recent review.
- Submitting a new review invalidates any older undo candidate.
- Undo is consumed once. After undo succeeds, there is no remaining undo candidate until another review is submitted.

### Persistence Semantics

- Undo must still work after leaving and reopening the review screen.
- Undo availability is database-backed, not only stored in the in-memory review session.
- The undo candidate is global to the local review history, but the button should only be active when the current review screen can legitimately act on that candidate.

### Target Matching

For a deck review screen, the undo button is active only when the undoable knowledge item belongs to that deck.

For a folder review screen, the undo button is active only when the undoable knowledge item belongs to any non-deleted card in one of that folder’s child decks.

If the latest undo candidate does not belong to the currently open review target, the button remains disabled.

### After Undo

After undo succeeds:

- the `knowledge` row is restored to its exact pre-review FSRS state
- the matching review log no longer counts as an active review
- the review session reloads from the database
- the restored card becomes due again if its restored state is due
- undo availability clears until another review is submitted

## Data Model

### New Table: `review_undo`

Add a new `review_undo` table with:

- `id`
- `knowledgeId`
- `reviewLogId`
- `undone` boolean
- `invalidated` boolean
- `createdAt`
- the full pre-review FSRS snapshot:
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

`reviewLogId` points to the review created by the submit action that this undo would reverse.

`invalidated` exists so a new review can explicitly retire any older undo candidate without deleting history.

### Existing Table Change: `review_log`

Keep the matching `review_log` row, but rely on its existing `deleted` flag when undoing instead of permanently removing the row.

This preserves sync and audit compatibility better than hard deletion.

### Counting Change

All daily review-limit queries must ignore `review_log.deleted = true`.

Without that change, an undone review would still count toward daily limits.

## Review Submit Flow

When a review is submitted:

1. Load the current `knowledge` row.
2. Compute the next FSRS state using the current rating.
3. In a single transaction:
   - mark any existing non-undone, non-invalidated `review_undo` rows as `invalidated = true`
   - insert the new `review_log` row
   - insert a `review_undo` row with the pre-review FSRS snapshot and the inserted `reviewLogId`
   - update `knowledge` to the new FSRS state
4. Mark local sync change metadata as usual.

This ensures the newest review becomes the only undo candidate.

## Undo Flow

Undo should be implemented as a single shared data-layer action, called by both deck and folder review screens.

When undo runs:

1. Find the latest `review_undo` row where:
   - `undone = false`
   - `invalidated = false`
2. Verify that the current review target is allowed to act on that `knowledgeId`.
3. In a single transaction:
   - restore `knowledge` from the stored pre-review snapshot
   - mark the matching `review_log` row as `deleted = true`
   - mark the `review_undo` row as `undone = true`
4. Mark local sync change metadata.
5. Refresh deck data and reload the current review session from the database.

If there is no valid undo candidate, the action should no-op with a user-facing message instead of failing noisily.

## Store and Session Design

`lib/store/deckReviewStore.ts` should own undo state for both deck and folder review screens.

Add derived store state for:

- whether an undo candidate exists for the current target
- whether undo is currently running
- an undo error message if the operation fails

The store should expose:

- `loadUndoAvailability(...)`
- `undoPreviousReview(...)`

Undo should not try to mutate the in-memory queue incrementally. The safe path is:

1. perform the database undo
2. refresh decks
3. reload the review session and preview from the database

That avoids drift with bucket refill logic, due counts, and review-limit provisional counters.

## UI

### Placement

Add an undo button to the top-right of both review screens:

- [app/deck/[id]/review.tsx](../../app/deck/[id]/review.tsx)
- [app/folder/[id]/review.tsx](../../app/folder/[id]/review.tsx)

### Button States

- Enabled when the current review target contains the latest undo candidate.
- Disabled otherwise.
- Shows loading state while undo is in progress.

The button should remain in a stable top-right position whether enabled or disabled so the UI does not jump.

### Interaction

Pressing the button should:

1. run undo
2. reload the current review session
3. leave the user on the same review screen

No separate history screen or deck-page undo entry point is included in this feature.

## Error Handling

- If the undo candidate is missing, already undone, or invalidated, show a small inline error and leave the session intact.
- If the review target no longer contains the knowledge item, disable undo and do not attempt the operation.
- If the transaction fails midway, the entire operation must roll back.
- If the review session reload fails after undo, the database state remains correct and the screen should show the existing queue load error state.

## Sync

Because review history already participates in sync, `review_undo` must also be included in sync export/import if review undo is expected to survive across devices.

For this feature, the local data model and sync schema should treat `review_undo` as another syncable table, similar to `review_log`.

Undone and invalidated rows should remain syncable records rather than being hard-deleted.

## Testing

Add coverage for:

- submitting a review creates exactly one active undo snapshot
- submitting a second review invalidates the previous undo snapshot
- undo restores the previous FSRS fields exactly
- undo marks the matching `review_log` row deleted
- review-limit counts exclude deleted review logs
- deck review screen enables undo only when the candidate belongs to that deck
- folder review screen enables undo only when the candidate belongs to a child deck in that folder
- undo still works after reloading the review screen/store state

## Out of Scope

- multi-step undo
- redo
- undo outside the review screens
- editing arbitrary historical reviews
