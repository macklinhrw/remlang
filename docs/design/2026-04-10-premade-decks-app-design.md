# Premade Decks App Design

## Goal

Expose cloud-backed premade decks inside the app as a separate sidebar destination, let users browse cached premade lesson decks offline after sync, preview lesson items, and copy a full premade lesson into either a new local deck or an existing local deck.

The system should:

- add a first-class `Premade Decks` page to the app drawer
- refresh premade content from the cloud automatically on page open
- keep premade browsing usable from local cache when offline
- let users preview lesson contents before copying
- let users choose between creating a new local deck or copying into an existing deck
- let users choose the review type used for copied knowledge

The system should not:

- make premade content editable in the client
- mutate already-copied local decks when cloud premades change later
- require online access once premades have already been cached locally

## Scope

In scope:

- drawer navigation entry for premades
- premade deck list screen
- premade lesson detail screen
- auto-refresh plus manual refresh for the premade cache
- copy flow for full-lesson import into local decks
- success and failure states for browsing and copy operations

Out of scope:

- per-row selective copy
- editing premade content from the app
- surfacing premades in the existing `Decks` page
- push or sync of premade cache through the user sync engine

## User Flow

### Entry point

- add `Premade Decks` to the app sidebar
- selecting it opens a dedicated premade deck list page

### Premade deck list

- render cached premade decks for the active language
- group lesson decks by book:
  - `Tobira 1`
  - `Tobira 2`
- show lesson name and item count
- show last successful premade refresh time
- trigger an automatic background refresh on page open
- include a manual refresh action

### Premade lesson detail

- tapping a lesson opens a dedicated detail page
- render the lesson metadata and full item preview from local cache
- each row should show:
  - front
  - pronunciation when available
  - textbook definition blob
  - a lightweight match badge such as `Exact`, `All senses`, or `Custom`
- primary action is `Copy to My Decks`

### Copy flow

When the user taps `Copy to My Decks`, the app prompts for:

1. destination mode
   - `Create new deck`
   - `Copy into existing deck`
2. review type

If the user chooses `Create new deck`:

- default the new deck name to the premade lesson name
- create a normal local deck in the active language

If the user chooses `Copy into existing deck`:

- show a local deck picker filtered to the active language
- use the selected local deck as the copy target

After confirmation:

- copy every item in the premade lesson using the existing premade item copy logic
- report how many items were added and how many already existed

## Data Behavior

### Source of truth in the app

- UI screens should read premade data from local SQLite cache tables only
- cloud fetches update that cache in the background
- screens rerender after cache writes succeed

### Refresh behavior

On premades page open:

1. load cached premade decks immediately
2. start a background refresh from `/api/v1/premade-decks/pull`
3. write pulled data into local premade cache tables
4. apply tombstones and unpublished deck removals locally
5. update premade sync state and visible last-sync metadata

Manual refresh reuses the same flow.

### Offline behavior

- if cached premades exist, browsing and lesson preview should still work offline
- if no cache exists and refresh fails, show an explicit offline or unavailable empty state

## Copy Rules

Copying a premade lesson uses the existing premade item copy path, item by item.

### Exact linked items

- create dictionary-backed knowledge using exact selected senses
- preserve textbook `sourceDefinitions`

### All-senses linked items

- create dictionary-backed knowledge with all-senses definition config
- preserve textbook `sourceDefinitions`
- textbook definitions remain the primary visible definitions in review

### Unlinked items

- create custom local knowledge
- preserve textbook definitions and pronunciation

### Duplicate handling

- copying must remain conservative and avoid duplicate cards in the target deck
- if a matching local item already exists in the target deck, skip creating a duplicate
- final copy summary should distinguish added items from already-existing items

### Mutation boundary

- copied decks and copied knowledge become normal local user data
- later cloud premade updates do not rewrite already-copied local content

## UI States

### Premade list page

- first-load loading state when there is no cache yet
- cached-content state with background refresh indicator
- empty state when no premades exist for the active language
- inline refresh failure state without hiding cached content

### Lesson detail page

- loading state if the local lesson cache lookup is still resolving
- empty state if the lesson no longer exists locally
- visible item count
- match badges per row
- fixed primary copy action

### Copy flow

- destination selection step
- review type selection step
- success summary with real counts
- clear failure message if the operation cannot complete

## Error Handling

- if background refresh fails, keep cached content visible and show a small error message
- if copy into an existing deck targets the wrong language, block that target or show the existing language mismatch error
- if refresh fails mid-pagination, preserve already-written cache rows and the latest successful cursor
- if copy partially succeeds, show the true counts rather than pretending the operation was atomic

## Navigation Integration

### Drawer

- add `Premade Decks` to `DRAWER_ITEMS`
- register a dedicated route in the root drawer

### Routes

Suggested routes:

- `app/premade-decks.tsx`
- `app/premade-decks/[id].tsx`

The list page owns cache refresh and grouping.

The detail page owns item preview and copy initiation.

## Components And Responsibilities

### Premade list screen

Responsibilities:

- read cached premade deck summaries
- trigger refresh on focus or open
- display grouped lesson cards
- navigate to lesson detail

### Premade detail screen

Responsibilities:

- read one premade deck and its cached items
- render item preview
- launch copy flow

### Copy flow UI

Responsibilities:

- collect destination mode
- collect deck choice when needed
- collect review type
- execute copy and show result summary

### Premade cache store helpers

Responsibilities:

- expose cached deck list queries
- expose lesson detail queries
- expose cache refresh operation
- expose full-lesson copy operation

## Testing Expectations

Implementation should include:

- local premade cache refresh tests for initial pull, multi-page pull, and tombstone cleanup
- store tests for cached deck grouping and lesson item loading
- copy tests for create-new-deck flow and existing-deck flow
- copy tests for exact, all-senses, and unlinked item handling
- duplicate suppression verification with result counts
- route-level smoke verification for drawer entry, premade list page, and lesson detail page

## Open Questions Resolved

- entry point: separate sidebar page
- premade list refresh behavior: auto refresh plus manual refresh
- lesson preview before copy: yes
- default copy scope: full lesson
- destination choice: ask each time between new deck and existing deck
