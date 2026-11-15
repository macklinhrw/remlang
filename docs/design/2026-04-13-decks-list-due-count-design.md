# Decks List Due Count Design

## Goal

Make the due badges on the decks list page match the number of cards a user could actually review immediately after tapping into a deck or folder.

That means the decks list count must:

- exclude paused new cards
- respect deck, folder, and global review limits
- match the live review queue semantics already used by deck and folder review sessions
- update promptly after review submit and undo flows

## Current Context

- The decks list UI reads `dueCount` from `decks$.collections` in [app/decks.tsx](../../app/decks.tsx).
- Deck and folder summary stats are built in [lib/store/decksStore.ts](../../lib/store/decksStore.ts).
- Actual review queue admission lives in [lib/review/fsrs.ts](../../lib/review/fsrs.ts).
- Review submit and undo refresh the decks store from [lib/store/deckReviewStore.ts](../../lib/store/deckReviewStore.ts).

## Problem

The decks list currently computes `dueCount` from raw overdue knowledge state inside `decksStore`.

That diverges from the real review queue because the review session path additionally applies:

- `newCardsPaused` filtering
- per-deck limits
- per-folder limits
- global language limits
- queue admission rules that deduplicate by knowledge and count only cards actually admitted

Because the list and the review screen use different counting rules, the badge can:

- show paused new cards as due
- show more cards than the user can actually review right now
- disagree with folder review totals for the same underlying decks

## Approaches

### Approach 1: Patch `decksStore` counting inline

Add more conditions to the existing deck and folder stat builders in `decksStore`.

Pros:

- small local change
- may fix the paused-card bug quickly

Cons:

- duplicates queue admission logic
- likely to drift again as review behavior changes
- harder to keep deck and folder counts perfectly aligned with session behavior

### Approach 2: Use the review queue layer as the single source of truth

Move the deck-list due counts onto shared helper functions in `fsrs.ts` that use the same queue admission rules as `getDeckReviewSession` and `getFolderReviewSession`.

Pros:

- one definition of “due now”
- automatically respects paused new cards and all active limits
- deck list and review screens stay aligned over time

Cons:

- requires refactoring the store to depend on review-layer helpers
- can be slightly more expensive than the current raw overdue count path

### Approach 3: Keep current counts and refresh more aggressively

Only change refresh timing after review activity.

Pros:

- smallest behavioral change

Cons:

- does not fix incorrect counting semantics
- stale updates improve, but wrong numbers remain wrong

## Recommendation

Use Approach 2.

The intended badge meaning is “what you can actually review right now.” That is already implemented in the review queue layer, so the list should reuse that logic instead of re-implementing its own approximation.

## Behavior

### Deck Badge Semantics

For a single deck, `dueCount` should equal the current admitted review count for that deck using the same rules as `getDeckReviewSession`, excluding only session pagination limits used for card payload loading.

In practice this means:

- count only due knowledge
- exclude deleted and suspended knowledge
- exclude paused new cards when `deck.newCardsPaused` is enabled
- apply deck review limits
- apply global review limits
- count unique admitted knowledge items, not raw joined card rows

### Folder Badge Semantics

For a folder, `dueCount` should equal the current admitted review count for the folder using the same rules as `getFolderReviewSession`.

That means:

- child deck limits still apply
- folder limits still apply
- global limits still apply
- paused new cards are excluded both at child-deck scope and folder scope
- duplicate knowledge represented by multiple child-deck cards is counted once

### Top-Level Total

The “X due across Y cards” line on the decks page should continue summing the `dueCount` values from `collections`.

Once collection items use the real admitted counts, that total will also reflect actual available reviews.

## Data-Layer Design

Add shared counting helpers in `fsrs.ts` that expose admitted due counts without requiring the full review card payload.

The helpers should reuse the existing queue-admission algorithm that powers deck and folder review sessions, rather than duplicating it.

### Proposed Helpers

- `getDeckAvailableDueCount(db, deckId, languageId?)`
- `getFolderAvailableDueCount(db, folderId, languageId?)`

These helpers should:

- load the same limit settings and base review counts used by review sessions
- run the same queue-admission path as review sessions
- return only the admitted count

### Queue Helper Refactor

`getDueReviewQueueSlice` already returns both `cards` and `dueCount`.

Refactor it so the count can be computed without paying for entry-detail hydration when only the number is needed.

A clean way to do that is:

- keep the admission walk shared
- make review-card hydration conditional on whether card payloads are requested

The count and the card list must come from the same admission result.

## Store Design

`lib/store/decksStore.ts` should stop deriving `dueCount` from raw overdue knowledge checks.

Instead:

- deck stats should ask the review layer for the available due count per deck
- folder stats should ask the review layer for the available due count per folder
- card totals and last-reviewed timestamps can keep their current store-specific aggregation logic

### Deck Stats

Replace the current raw `dueValue <= now` count in `getDeckStatsByDeckId` with counts from the shared FSRS helper.

### Folder Stats

Replace the current `isKnowledgeDue` folder count in `getFolderStats` with counts from the shared FSRS helper.

## Refresh Behavior

`deckReviewStore` already calls `refreshDecksStore()` after review submit and undo.

Keep that behavior.

With the new shared counting source, a full store refresh after submit or undo will produce the same numbers the user would see by immediately reopening the queue.

### Optimistic Update Path

`decks$.applyKnowledgeReview()` becomes redundant for correctness once a full refresh follows every submit.

It may be retained temporarily if harmless, but it should no longer be relied on for final badge values.

If it causes visible flicker or transient mismatches against refreshed counts, remove it.

## Error Handling

If an available-due helper fails while refreshing deck summaries:

- fail the overall decks refresh as it does today
- keep the existing UI behavior for refresh failures

Do not silently fall back to the old raw overdue count path, because that would reintroduce inconsistent semantics.

## Testing

Add focused coverage around the shared due-count helpers.

Required cases:

- paused new cards are excluded from deck counts
- deck daily limits reduce deck counts
- folder counts honor child deck limits, folder limits, and global limits
- duplicate knowledge in a folder counts once
- helper counts match `getDeckReviewSession(...).dueCount`
- helper counts match `getFolderReviewSession(...).dueCount`

Also verify the existing review submit and undo flows still refresh deck badges through `refreshDecksStore()`.

## Non-Goals

- changing review queue semantics
- changing badge styling or decks page layout
- introducing new schema or cached count tables
- optimizing count queries beyond what is necessary for correctness in this fix
