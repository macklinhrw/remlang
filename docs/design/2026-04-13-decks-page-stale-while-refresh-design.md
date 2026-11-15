# Decks Page Stale-While-Refresh Design

## Goal

Make `/decks` feel immediate when opening or returning to the page by rendering the last cached decks snapshot right away and refreshing in the background.

## Problem

The decks page currently feels laggy every time it is opened, including when navigating back to it from another screen. The current path rebuilds the decks store on focus and waits for the refresh path to complete before the page feels settled.

`refreshDecksStore()` currently:

- fetches all decks
- computes per-deck stats
- rebuilds folder stats
- rebuilds the combined collection list

That is acceptable as background work, but not as a blocking page-entry path when a previously loaded snapshot already exists.

## Non-Goals

- Reworking the deck/folder visual design
- Replacing the current decks store structure
- Deep query optimization in the first pass
- Making due counts exact before first paint on every page revisit

## Recommended Approach

Use stale-while-refresh behavior for the decks page.

When `/decks` opens:

- if a cached decks snapshot exists, render it immediately
- trigger `refreshDecksStore()` in the background
- keep the cached snapshot visible while the refresh runs
- replace the snapshot when the refresh completes

When no cached snapshot exists yet:

- keep the existing initial loading behavior

If refresh fails:

- keep the stale snapshot visible
- surface a lightweight error state if needed, but do not blank the page

## Changes

### 1. Decks Store Loading Semantics

Add explicit store state for refresh lifecycle so the page can distinguish:

- initial load with no cached data
- background refresh with cached data already available

This should be minimal state, for example:

- whether a refresh is currently running
- whether the store has ever loaded a snapshot for the active language
- optional last refresh error

The store should not clear `decks` or `collections` when a background refresh starts.

### 2. Decks Page Behavior

`app/decks.tsx` should:

- show full-page loading only when there is no cached snapshot yet
- otherwise render the current snapshot immediately
- trigger refresh on focus without blocking page rendering

Focus refresh should become:

- "show what we have now"
- "quietly fetch updated data"
- "swap in the result when ready"

The page may optionally show a subtle non-blocking refresh indicator later, but this is not required for the first pass.

### 3. Error Handling

If a background refresh fails:

- retain the existing rendered snapshot
- avoid resetting the page into a loading or empty state
- log the failure

This keeps the page usable even if refresh work fails transiently.

## Why This First

This directly addresses the reported lag pattern: the lag happens every time the page is revisited, which strongly suggests the blocking refresh path is the issue. Stale-while-refresh removes that blocking cost from navigation without needing a deeper storage or query refactor.

If the background refresh itself still proves too slow, the next step should be targeted optimization of `refreshDecksStore()` and the folder stats path. That should be treated as a second pass, not the first fix.

## Implementation Notes

- Preserve the existing data model and selectors where possible.
- Avoid introducing loader UI churn.
- Keep the stale snapshot stable until the refreshed snapshot is ready.
- Be careful with language changes: a cached snapshot should only be treated as valid for the matching active language.

## Testing

Verify:

- first visit to `/decks` still loads correctly with no cache
- revisiting `/decks` shows prior content immediately
- background refresh updates due counts and deck/folder totals
- failed refresh leaves the previous snapshot visible
- language switching does not show the wrong cached snapshot

## Rollout

1. Add minimal decks-store refresh state.
2. Switch `/decks` to render cached data immediately when available.
3. Keep focus refresh background-only.
4. Verify behavior on device in release mode.
