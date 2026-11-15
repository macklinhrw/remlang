# Review Submit Transition Speed Design

## Goal

Make the review screen move to the next card immediately after a difficulty button is pressed, without waiting on slower background store refresh work.

## Current Context

- Review submit flow is coordinated in [lib/store/deckReviewStore.ts](../../lib/store/deckReviewStore.ts).
- Review persistence and queue rebuilds are driven by [lib/review/fsrs.ts](../../lib/review/fsrs.ts).
- Deck and folder summary badges are refreshed through [lib/store/decksStore.ts](../../lib/store/decksStore.ts).
- The review UI already supports optimistic head removal followed by a background live-queue refresh.

## Problem

The current submit path awaits `refreshDecksStore()` before advancing the visible review queue.

That means every difficulty tap blocks on a full decks-store refresh, even though the review screen already has enough local state to show the next card immediately after the database write succeeds.

This makes every review transition feel slow, not just heavier card types.

## Approaches

### Approach 1: Optimize `refreshDecksStore()`

Keep the current sequencing and try to make the decks refresh cheaper.

Pros:

- preserves current control flow
- may improve other refresh-heavy flows too

Cons:

- review transition still depends on unrelated store work
- likely leaves some latency even after optimization
- does not fix the architectural issue that the review screen blocks on deck-list maintenance

### Approach 2: Move decks refresh off the critical path

Advance the review UI immediately after `submitKnowledgeReview()` succeeds, then refresh deck summaries and refill the live queue in the background.

Pros:

- directly targets the user-visible delay
- minimal behavioral change
- preserves current live-queue semantics and badge refresh behavior

Cons:

- deck badges may update slightly after the card transition instead of before it
- background refresh failures need to be handled separately from submit failures

### Approach 3: Add a fully optimistic global update path

Optimistically update the visible review queue and all deck summary badges, then reconcile in the background.

Pros:

- fastest possible feel
- minimizes visible lag across the app

Cons:

- more state complexity
- higher risk of temporary mismatch between optimistic badges and refreshed counts
- unnecessary for the current issue

## Recommendation

Use Approach 2.

The review screen should only block on the operation that is necessary for correctness of the rating tap: persisting the review itself. The slower decks-store refresh is useful for cross-screen consistency, but it is not required to display the next card.

## Behavior

### Submit Flow

After a difficulty button is pressed:

1. persist the review through `submitKnowledgeReview()`
2. if persistence succeeds, immediately remove the current card from the local queue head
3. clear the answer panel state and update reviewed counters
4. keep undo availability updated for the reviewed card
5. start deck-summary refresh and live-queue refresh in the background

The user should see the next card as soon as the review write succeeds.

### Error Handling

- If `submitKnowledgeReview()` fails, preserve the current card and show the existing submit error state.
- If the background deck-summary refresh fails, log the error and keep the review UI advanced.
- If the background queue refresh fails, preserve the existing visible queue state and existing refresh error behavior.

### Undo

Undo behavior remains unchanged in this change.

Undo may still await a full refresh because the reported latency issue is specifically the normal review-advance path.

## Store Design

In [lib/store/deckReviewStore.ts](../../lib/store/deckReviewStore.ts):

- keep `submitKnowledgeReview()` awaited inside `submitDeckReviewRating()`
- move the optimistic local queue advance so it happens immediately after the successful submit result is available
- remove `await refreshDecksStore(...)` from the critical path before local queue advancement
- trigger `refreshDecksStore(...)` in the background after local state has already advanced
- keep the existing background `loadReviewSession(...)` refill flow

### Concurrency

The background deck refresh and background queue refresh can run independently.

Neither background task should block `isSubmitting` from clearing once the local review state has been advanced.

## Testing

Verify:

- pressing any review rating advances to the next card without waiting for deck refresh completion
- submit failures still keep the current card visible
- deck badges still update after the background refresh completes
- queue refill behavior remains unchanged when the local visible queue runs low or empties

## Non-Goals

- changing FSRS scheduling behavior
- changing undo sequencing
- rewriting deck badge refresh logic
- adding new schema or cache layers
