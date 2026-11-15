# Live Review Queue Design

## Goal

Replace the current bucket-based review session behavior with a live queue that:

- refreshes after every submitted review in the background
- always reflects the latest due order from the database
- allows previously reviewed cards to re-enter the same session once due again
- lets newly-due failed cards jump back ahead immediately when their due time is earliest

This change is specifically meant to support stronger short-term memorization flow for `Again` and other short-interval reviews.

## Current Context

- Review queue selection is implemented in [lib/review/fsrs.ts](../../lib/review/fsrs.ts).
- Review session state is coordinated in [lib/store/deckReviewStore.ts](../../lib/store/deckReviewStore.ts).
- Deck review UI lives in [app/deck/[id]/review.tsx](../../app/deck/[id]/review.tsx).
- Folder review UI lives in [app/folder/[id]/review.tsx](../../app/folder/[id]/review.tsx).
- Daily review limits are implemented in [lib/review/reviewLimits.ts](../../lib/review/reviewLimits.ts).
- Undo reloads the review session from the database after restoring state.

## Problem

The current model treats the in-memory session as a pre-admitted bucket of cards.

That causes two behavior problems:

- cards reviewed earlier in the same session are excluded from refill, so a card that becomes due again cannot reappear until a manual reload or a new session
- queue order becomes stale between bucket refreshes, so a newly-due failed card cannot immediately move back toward the front

That is the opposite of the intended memorization loop for short FSRS intervals.

## Approaches

### Approach 1: Keep buckets and stop excluding reviewed cards

Remove the `reviewedKnowledgeIds` exclusion so previously reviewed cards can re-enter later refills.

Pros:

- smallest code change
- fixes the most obvious suppression bug

Cons:

- queue is still stale between refill moments
- cards only re-enter on refill boundaries, not as part of a continuously fresh order
- bucket admission and provisional counters remain harder to reason about

### Approach 2: Keep buckets but rebuild after every review

Preserve the bucket/session abstraction, but reload the entire queue after each submitted review.

Pros:

- fresher than current behavior
- smaller conceptual change than removing buckets entirely

Cons:

- the bucket abstraction no longer adds much value
- provisional admitted-card bookkeeping still exists
- implementation remains more complex than needed for the desired behavior

### Approach 3: Replace buckets with a live queue snapshot

Treat the queue shown after each review as a fresh scheduler query for “what is due right now for this target.”

Pros:

- matches the desired learning behavior directly
- removes same-session exclusion bugs
- makes queue ordering easy to explain: always sort current due cards by due time
- simplifies limit accounting because only completed reviews matter

Cons:

- requires refactoring store assumptions around refills and provisional counts
- queue may visibly reorder more often, by design

## Recommendation

Use Approach 3.

The desired behavior is inherently live, not bucketed. Continuing to center the implementation on session buckets would keep the wrong abstraction in place and create more edge cases around re-entry, ordering, and limits than the feature needs.

## Behavior

### Core Queue Semantics

At any point after a review is submitted, the next queue should represent a fresh query of cards that are due now for the active target.

That means:

- the current card stays stable while the user is viewing and answering it
- after submit succeeds, the answered card is removed from the visible head immediately
- a background refresh rebuilds the queue for the same deck or folder
- cards previously reviewed in the same session are eligible to reappear if they are due again
- ordering is determined by current due time, not by historical position in an earlier bucket

### Short-Interval Re-entry

If a card receives `Again` and its next due time becomes very soon, it should be eligible to re-enter the queue as soon as that due time passes.

If its new due time is earlier than the cards currently waiting, it should appear ahead of them on the next refresh.

This is intentional and should not be treated as instability.

### Refresh Timing

After each successful review submission:

1. persist the review
2. update deck summary state as needed
3. remove the answered card from the local head so the UI can continue immediately
4. start a non-blocking background reload for the current target
5. replace the remaining queue with the fresh result when it arrives, if the user is still on the same target

The background reload should not interrupt answer animations or temporarily clear the screen.

### Empty Queue Behavior

If the queue becomes empty after a review, the app may show the current “session complete” or “nothing due” state while the background refresh runs.

If the refresh finds new due cards, the review screen should resume with the refreshed queue instead of requiring a manual reload.

This is important for cards that become due again almost immediately.

## Limits

### Counting Rule

Daily limits should count completed reviews, not cards that were merely loaded into memory.

That means the queue builder should only use persisted review counts from `review_log` and should not maintain provisional “already admitted into this bucket” counters.

### Deck and Folder Review

For deck review:

- build the current due queue
- apply deck limits
- apply global limits

For folder review:

- build the current due queue across child decks
- apply source deck limits per candidate
- apply folder limits
- apply global limits

Because the queue refreshes after every actual review, persisted counts are sufficient to keep limits correct. There is no need to reserve future capacity for cards that might never be answered.

### Review Re-entry and Limits

If a card is reviewed multiple times in one day, each completed review should count toward total daily review limits.

Only the first review of a card while it is still in `New` should count toward new-card limits, consistent with existing review-limit semantics.

## Store Design

`lib/store/deckReviewStore.ts` should stop modeling the queue as a finite bucket with refill thresholds.

Instead, it should manage:

- the current review target
- the latest loaded session snapshot
- whether an initial load is in progress
- whether a background queue refresh is in progress
- the currently displayed card while submit is in flight
- undo availability and errors

### Session Snapshot Semantics

`session.cards` should mean “the latest known due queue for this target,” not “the remainder of a pre-admitted bucket.”

The store should not maintain a list of reviewed knowledge IDs for exclusion from future queue refreshes.

### Submit Flow

When a review is submitted:

1. capture the current card
2. submit the review through the data layer
3. update deck summaries
4. optimistically advance the visible queue by removing that card from the local head
5. increment local reviewed counters for UI statistics
6. trigger a background queue reload for the same target without resetting reviewed statistics

The background reload should replace the queue using the database result and should keep the reviewed counter intact for the current screen stats.

### Target Safety

If the user leaves the review target while a background refresh is running, the returning result must be ignored unless the target type, target id, and language still match.

## Data-Layer Design

`lib/review/fsrs.ts` should continue to expose deck and folder review session loaders, but the implementation should no longer assume bucket refill.

Required changes:

- remove reviewed-card exclusion from normal session refresh behavior
- remove refill-specific provisional session counting for later buckets
- keep due ordering by current due timestamp
- continue deduplicating by knowledge id within a single query result

No schema change is required for this feature.

## Undo Interaction

Undo should continue to use the safe database-first flow:

1. restore the previous review in the database
2. refresh deck data
3. reload the live queue from the database

This behavior fits the live queue model better than the old bucket model because there is no need to patch an in-memory preloaded queue.

## UI

### Review Screens

Deck and folder review screens should keep their existing structure and controls.

The user-visible behavior change is:

- the next queue stays fresh automatically after each answer
- failed cards can return during the same session
- manual reload remains available as a fallback but becomes less important

### Loading States

Keep distinct states for:

- initial queue load
- submit in progress
- background queue refresh
- undo in progress

Background queue refresh should be lightweight and should not replace the current card with a loading screen while the user is already moving through reviews.

## Error Handling

- If review submit succeeds but the background queue refresh fails, keep the locally advanced queue and show the existing queue error state only where appropriate.
- If a background refresh returns no due cards, the screen should show the existing finished or clear state.
- If a later refresh finds newly-due cards after the screen looked finished, the queue should resume without requiring a full navigation reset.
- If the current target changes mid-refresh, drop the stale result.

## Testing

Add coverage for:

- a previously reviewed card becoming due again and reappearing in the same session
- an `Again` card returning ahead of older queued cards when its due time is earliest
- queue refresh running after every successful review without resetting reviewed statistics
- deck daily limits counting completed reviews rather than queued cards
- folder review respecting child deck, folder, and global limits with live refresh
- undo restoring a card and the next queue refresh reflecting the restored due state
- stale in-flight refresh results being ignored after target changes

## Out of Scope

- changing FSRS scheduling math
- changing review-grade labels or answer UI
- introducing server-driven queue scheduling
- adding a separate explicit “learning queue” distinct from the due queue
