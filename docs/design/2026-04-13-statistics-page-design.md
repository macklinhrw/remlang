# Statistics Page Design

## Goal

Add a simple statistics page that gives the user an immediate sense of study activity and progress for the active language.

The first version should show:

- number of new cards reviewed today
- number of total cards reviewed today
- a recent review-history chart
- number of cards currently known

## Current Context

- The app uses a top-level drawer navigation defined in [app/_layout.tsx](../../app/_layout.tsx).
- The active language already scopes app behavior through [lib/store/appLanguageStore.tsx](../../lib/store/appLanguageStore.tsx).
- Review activity is persisted in `review_log` and undo marks reverted rows deleted.
- Review limit counting already groups review history by local day in [lib/review/reviewLimits.ts](../../lib/review/reviewLimits.ts).
- Existing list-style settings and dashboard-like cards live in [app/settings.tsx](../../app/settings.tsx) and [app/decks.tsx](../../app/decks.tsx).

## User Decisions

The user approved these product choices:

- location: a new top-level drawer page
- known-card definition: current `knowledge.state === "Review"`
- default chart window: last 30 days

## Problem

The app currently has no dedicated place to see:

- how much was reviewed today
- whether recent study volume is rising or falling
- how many cards have reached a stable learned state

The user wants a lightweight stats page, not a heavy analytics system.

## Approaches

### Approach 1: Query-driven stats page from existing tables

Build the page directly from `review_log`, `knowledge`, `cards`, and `decks`, scoped to the active language.

Pros:

- no schema change
- no second source of truth
- undo behavior stays correct automatically because deleted review logs are already excluded
- fastest path to a useful v1

Cons:

- every page load recomputes aggregates
- large histories may be less efficient than a cached approach later

### Approach 2: Precomputed daily stats table

Add a dedicated table that stores daily aggregates and maybe known-card snapshots.

Pros:

- fastest reads
- easy to extend to richer analytics later

Cons:

- adds write-time complexity
- requires careful undo invalidation
- creates duplication with existing review history

### Approach 3: Minimal summary only

Add only today’s counts and known-card count, with no chart.

Pros:

- smallest implementation
- almost no UI complexity

Cons:

- leaves out the trend view that makes the page genuinely useful

## Recommendation

Use Approach 1.

This feature is intended to be simple. The app already has the necessary data, and the existing local-first model favors computing small aggregates from persisted source tables over introducing cached summary tables too early.

## Page Design

Add a new route at `app/statistics.tsx` and expose it through the top-level drawer.

The page should be a compact dashboard for the active language with four pieces:

1. header
2. today summary cards
3. known-cards summary card
4. recent review-history chart

### Header

The header should make it clear this page is about study progress for the active language, not app-wide analytics.

Suggested structure:

- small uppercase label like `Statistics`
- title like `Study Progress`
- optional subtitle mentioning the current active language

### Summary Cards

Show two cards near the top:

- `New Today`
- `Total Today`

Show one additional card for:

- `Known Cards`

These should use the app’s existing dark card styling rather than a dense table layout.

## Data Semantics

### Scope

All metrics are scoped to the active language.

That means review counts should only include reviews linked to decks in the active language, and known-card counts should only include knowledge reachable through that language scope.

### New Reviewed Today

Definition:

- count today’s non-deleted `review_log` rows for the active language where the logged pre-review state was `New`

This matches the semantics already used by daily new-review limits.

### Total Reviewed Today

Definition:

- count today’s non-deleted `review_log` rows for the active language

Every completed review counts, including reviews of cards that are no longer new.

### Known Cards

Definition:

- count current `knowledge` rows in the active language where:
  - `state === "Review"`
  - `deleted === false`
  - `suspended === false`

This is intentionally a current-state metric, not a historical total.

It answers “how many cards are currently in stable review,” not “how many cards have ever been introduced.”

### Recent Review History

Default window:

- last 30 local days including today

The chart should support two series modes:

- total reviews per day
- new reviews per day

Only one mode needs to be visible at a time in v1, with a simple toggle above the chart.

## Chart Design

Use a simple custom bar chart built from React Native layout primitives for v1.

Reasons:

- avoids adding a chart dependency
- good enough for a 30-day histogram
- easier to keep visually consistent with the rest of the app

### Chart Behavior

For each day in the 30-day window:

- show a bar whose height is relative to the max value in the visible window
- include a small day label cadence that stays readable without labeling all 30 bars
- provide an empty-state message if all values are zero

The chart mode toggle should switch between:

- `Total`
- `New`

## Data-Layer Design

Add a small statistics query module, likely one of:

- `lib/stats/queries.ts`
- `lib/stats/store.ts`

Recommendation:

- use `lib/stats/queries.ts` for pure data access helpers

### Proposed Query Helpers

- `getTodayReviewStats(db, languageId)`
- `getReviewHistoryStats(db, languageId, days)`
- `getKnownCardsCount(db, languageId)`

### Today Stats Output

Return:

- `newReviewedToday`
- `totalReviewedToday`

### History Stats Output

Return an ordered array for the last N days with:

- local date key
- total review count
- new review count

The result should include zero-count days so the chart always has a continuous 30-day axis.

### Known Cards Query

This should count unique knowledge items in the active language with current state `Review`.

If the app’s language scoping makes deck-join queries simpler than direct language ownership on `knowledge`, follow the existing pattern used elsewhere in the repo for language-bound review queries.

## Refresh Behavior

The page should load stats:

- on first render
- when the screen regains focus
- when the active language changes

No background caching layer is required for v1.

Because data comes from persisted review history and current knowledge state, simply reloading on focus is enough to reflect new reviews and undos.

## Undo Behavior

Undo must automatically affect stats without any separate repair logic.

That should happen naturally because:

- undone review logs are marked deleted
- stats queries only count non-deleted review logs

Known-card totals should also reflect undo indirectly through restored knowledge state.

## UI States

The page should support:

- loading
- populated
- empty history
- query failure

### Empty History

If the user has no recent reviews:

- show zero-value summary cards
- show an empty chart state such as “No reviews yet in the last 30 days.”

## Testing

Add focused tests for the stats query module.

Required cases:

- today totals count new and total reviews correctly
- history results group by local day
- history fills zero-count days across the requested window
- deleted review logs from undo are excluded
- known-card count includes only current `Review` knowledge
- suspended and deleted knowledge are excluded from known-card totals
- language scoping excludes reviews and knowledge from other languages

## Non-Goals

- deck-by-deck analytics
- retention curves
- forecast charts
- streak systems
- heatmaps
- cached analytics tables
- export or sharing features
