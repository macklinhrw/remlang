# Review Limits Design

## Goal

Add daily review caps at three scopes:

1. Global user settings across the active language
2. Deck settings for a specific deck
3. Folder settings for folder review sessions

The system must support separate caps for:

- New reviews
- Total reviews

Each cap can be enabled or disabled independently.

## Terms

- New review: a review of a knowledge item whose FSRS `state === "New"` at review time.
- Total review: any review shown in a review session, including new cards.
- Global limit: a per-day cap applied across all review sessions in the active language.
- Deck limit: a per-day cap applied to cards originating from a specific deck.
- Folder limit: a per-day cap applied when reviewing a folder as a folder session.

## Current Context

- Decks already have a settings tab in [app/deck/[id].tsx](../../app/deck/[id].tsx).
- Global settings already exist in [app/settings.tsx](../../app/settings.tsx).
- Folder settings do not currently have a dedicated page; folder actions already exist from the decks page.
- Review sessions are built in [lib/review/fsrs.ts](../../lib/review/fsrs.ts) and coordinated in [lib/store/deckReviewStore.ts](../../lib/store/deckReviewStore.ts).
- Persistent app-level settings already use the key-value `app_settings` table.

## Approaches

### Approach 1: Store all limits in `app_settings`

Use `app_settings` for global, deck, and folder limit payloads with namespaced keys.

Pros:

- No schema migration for decks or folders
- Fastest to implement

Cons:

- Harder to query and reason about
- Deck and folder settings become loosely structured blobs
- More fragile as settings grow

### Approach 2: Add explicit limit columns to `decks` and `decks_folders`, keep global in `app_settings`

Add dedicated nullable columns for limit enablement and values on `decks` and `decks_folders`. Store global limits in `app_settings`.

Pros:

- Clear ownership of settings
- Straightforward query logic during review filtering
- Better long-term maintainability

Cons:

- Requires schema migration
- Slightly more UI and store plumbing

### Approach 3: Add a new normalized `review_limits` table

Create one table with `scope_type`, `scope_id`, `language_id`, and limit fields.

Pros:

- Most flexible
- Easy to extend to more scopes later

Cons:

- More complexity than needed for current scope
- More joins and bookkeeping for a local-first app

## Recommendation

Use Approach 2.

The app already models deck and folder entities explicitly, and these limits are durable settings attached to those entities. Dedicated columns are the simplest and most legible way to implement per-deck and per-folder behavior. Global limits fit naturally in `app_settings` because that pattern already exists and the values are singleton-like per language.

## Behavior

### Precedence

For a single-deck review:

1. Filter by deck limits
2. Filter by global limits

For a folder review:

1. Filter each candidate card by its source deck limits
2. Apply folder limits over the remaining folder review pool
3. Apply global limits over the remaining pool

This matches the requested rule that deck cards are restricted by the deck first, then by the folder limit, and finally by the overall global limit.

### Limit Semantics

Each scope has two independent caps:

- `new`
- `total`

Each cap can be:

- Disabled: no cap at that scope for that category
- Enabled with a positive integer value

Examples:

- Deck cap: `new=10`, `total=off`
- Folder cap: `new=off`, `total=80`
- Global cap: `new=20`, `total=150`

### Daily Window

Use the user’s local device day boundary. Review counts reset at local midnight.

### What Counts Against a Limit

- A card counts against `new` only if `knowledge.state === "New"` at the moment it is selected into the session.
- Every shown review counts against `total`.
- Once a new card is reviewed and leaves `New`, later reviews on the same day count only against `total`.

### Folder Review Specifics

Folder limits apply only when the user launches a folder review. They do not affect reviewing a child deck directly.

## Data Model

### Deck Columns

Add nullable fields to `decks`:

- `dailyNewLimitEnabled` boolean
- `dailyNewLimit` integer
- `dailyReviewLimitEnabled` boolean
- `dailyReviewLimit` integer

### Folder Columns

Add nullable fields to `decks_folders`:

- `dailyNewLimitEnabled` boolean
- `dailyNewLimit` integer
- `dailyReviewLimitEnabled` boolean
- `dailyReviewLimit` integer

### Global Settings Keys

Store in `app_settings` using language-scoped keys:

- `review_limits:<languageId>:global:new_enabled`
- `review_limits:<languageId>:global:new_limit`
- `review_limits:<languageId>:global:total_enabled`
- `review_limits:<languageId>:global:total_limit`

If no active language is available, use the current app convention for language-scoped settings and default to active language resolution in the settings layer.

### Review Count Source

Do not persist a separate daily counter table initially.

Instead, derive “reviews completed today” from `review_log` joined to `knowledge` and `cards` as needed:

- Global counts: count today’s reviews for the active language
- Deck counts: count today’s reviews for knowledge reachable from that deck
- Folder counts: count today’s reviews for the folder review scope by child deck membership

This avoids introducing a second mutable source of truth.

## Review Selection Algorithm

### Deck Review

When building a deck review session:

1. Build the candidate due queue as today
2. Count how many reviews from this deck have already been completed today
3. Count how many of those were `New` at review time
4. Count today’s global totals for the active language
5. Compute remaining allowance:
   - remaining deck new
   - remaining deck total
   - remaining global new
   - remaining global total
6. Filter the queue in order:
   - drop cards that would exceed any active new limit
   - drop cards that would exceed any active total limit
7. Stop when no more cards fit

### Folder Review

When building a folder review session:

1. Build the candidate due queue from child decks
2. For each candidate card, determine its source deck
3. Load today’s counts for:
   - each involved deck
   - the folder scope
   - the active language global scope
4. Walk the queue in order and admit a card only if:
   - its deck still has room
   - the folder still has room
   - global still has room
5. Update the simulated counters as cards are admitted so later cards see the reduced allowance

This keeps folder review from bypassing stricter child-deck caps.

### Bucketed Review Interaction

The existing bucketed review flow must keep limits stable across refills.

When a review session starts:

- compute today’s already-consumed counts
- include session-admitted cards as provisional consumption when refilling later buckets

This prevents the second or third bucket from ignoring cards already admitted earlier in the same session.

## UI

### Deck Settings

Add a “Daily Review Limits” section to the deck settings tab.

Fields:

- Cap new reviews: toggle
- New review limit: numeric input when enabled
- Cap total reviews: toggle
- Total review limit: numeric input when enabled

Support values:

- disabled
- positive integer

### Folder Settings

Add folder settings access from the existing folder actions flow.

Fields mirror deck settings:

- Cap new reviews
- New review limit
- Cap total reviews
- Total review limit

This applies only to folder review sessions, not child deck review launched directly.

### Global Settings

Add a “Daily Review Limits” section to [app/settings.tsx](../../app/settings.tsx).

Fields:

- Cap new reviews globally
- Global new review limit
- Cap total reviews globally
- Global total review limit

### Review Screen Messaging

If limits reduce the queue, the review screen should still behave normally.

Optional small status copy may be added later, but initial implementation does not need a complex explanation banner. It is sufficient that:

- the resulting queue length reflects the cap
- “Nothing due” also covers “no cards available under current daily limits”

## Validation Rules

- Limit values must be integers greater than 0 when enabled.
- Empty value while enabled is invalid.
- Disabling a cap should ignore its stored numeric value.
- Linked decks use their own deck settings; they are not exempt.

## Error Handling

- Invalid saved values should fall back to disabled rather than crashing.
- If limit counts cannot be computed, review loading should fail closed only for that session and show the existing review error state.
- Migration defaults should be nullable/disabled so existing users experience no change until they opt in.

## Testing

### Data Tests

- deck with no limits returns current queue behavior
- deck new limit filters only `state === "New"` items
- deck total limit filters all items
- folder review respects deck caps before folder caps
- global cap applies after deck or folder filtering
- bucket refill does not exceed caps mid-session

### UI Tests

- deck settings save and reload limit values
- folder settings save and reload limit values
- global settings save and reload limit values
- disabled caps hide or disable number inputs correctly

### Regression Tests

- reviewing a deck directly is unchanged when all limits are off
- reviewing a folder directly is unchanged when all limits are off
- sync/export/import remain stable after schema additions

## Implementation Notes

- Prefer adding typed helpers for parsing and saving review limit settings instead of ad hoc string handling in screens.
- Keep review-limit logic in the review session builder layer, not in the UI layer.
- Use one shared “effective review limits” helper so deck and folder review do not drift.

## Out of Scope

- Different limits by review type
- Weekly or monthly caps
- Per-linked-deck inheritance rules beyond standard deck settings
- Explanatory analytics dashboards for how many cards were hidden by limits

