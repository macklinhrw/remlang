# Deck Folders And Premade Book Copy Design

## Goal

Add first-class deck folders to the app, let users organize decks into one-level folders, review all due cards across a folder's child decks as one merged queue, and support copying an entire premade book into a normal local folder that contains lesson decks.

The system should:

- treat folders as normal user-owned local organization
- allow decks to be moved into and out of folders
- render folders and standalone decks together on the decks page
- let users collapse or expand folder contents in the decks list
- let users review an entire folder as one merged review queue
- let premade book copy create a folder plus child lesson decks

The system should not:

- support nested folders beyond one level
- create a separate folder-only review data model
- make premade-created folders special after creation

## Scope

In scope:

- local folder creation and organization flows
- deck action for moving a deck into a folder
- decks page folder rendering and collapse state
- folder review queue support
- premade book-level copy into a folder
- sync participation for folders through the existing user sync model

Out of scope:

- arbitrary deep folder nesting
- folder sharing or public folder metadata
- folder-specific FSRS state
- editable premade-linked folder metadata beyond normal local rename or organization behavior

## Product Model

Folders are normal local user containers.

Decks may be:

- standalone
- inside one folder

Folders may contain:

- decks only

Folders may not contain:

- other folders

Premade book copy creates ordinary local folders and ordinary local lesson decks. After copy, they behave exactly like user-created folders and decks.

## User Flows

### Deck organization

- user opens deck actions from the decks page
- chooses `Add to folder`
- sees a modal with:
  - search field
  - matching folders
  - explicit `Remove from folder` action if the deck already belongs to one
- selecting a folder moves the deck into that folder

### Folder browsing

- decks page shows:
  - standalone decks
  - folders
- folders are collapsible
- when expanded, child decks render inline beneath the folder
- child decks remain individually reviewable and editable

### Folder review

- user taps folder review
- app immediately starts one merged review queue from all due cards in the folder's child decks

### Premade lesson copy

- user can still copy a single premade lesson into a deck using the existing premade lesson flow

### Premade book copy

- user can copy an entire premade book such as `Tobira 1`
- app creates:
  - one local folder named from the book
  - one local lesson deck per premade lesson in that book
  - copied premade items inside each lesson deck

## Data Model

### Existing foundation

Use the existing local folder model:

- `decks_folders`
- `decks.folder_id`

Use the existing sync model:

- `sync_deck_folders`
- `sync_decks.folder_id`

This feature should extend current behavior rather than introducing a second folder system.

### Folder constraints

- one level only
- `decks_folders.parent_id` should remain `null` for all folder rows after this feature
- application logic should block assigning a parent folder to another folder
- a deck may reference at most one folder via `folderId`

### Folder aggregates

Folder UI rows should compute:

- child deck count
- aggregated card count
- aggregated due count
- latest review timestamp across child decks

These can be derived in store queries rather than stored as separate columns.

## Store And Query Responsibilities

### Folder queries

Add store helpers for:

- listing folders with child decks
- listing eligible folders for move-to-folder modal
- loading one folder summary and its child decks

### Folder mutations

Add store helpers for:

- create folder
- move deck into folder
- remove deck from folder

These mutations should mark local change timestamps so existing sync behavior continues to work.

### Premade book copy helpers

Add store helpers for:

- grouping cached premade lesson decks by book
- copying all lessons in one book into a new local folder

Book copy should:

1. create the folder
2. create each lesson deck assigned to that folder
3. copy lesson items into each created deck
4. return real counts for created decks, added cards, and already-existing items

## Review Behavior

Folder review should reuse the existing deck review architecture with a wider deck scope.

### Queue construction

- find all non-deleted child decks in the folder
- gather all non-deleted due cards across those decks
- keep the same due-time sorting used by normal deck review
- include the same knowledge payload and entry detail loading behavior used by deck review

### Submission behavior

- review submissions update the underlying knowledge and cards exactly as they do today
- affected deck summaries should refresh for all child decks participating in the folder review

### Result model

- folder review is not a separate review target in storage
- it is a merged runtime queue over multiple decks

## UI Integration

### Decks page

The decks page should render a mixed list of:

- folder rows
- standalone deck rows

Folder row UI should include:

- folder name
- child deck count
- aggregated due count
- expand or collapse affordance
- review button
- folder actions entry point

Expanded child decks should visually nest under the folder row while still using familiar deck row affordances.

### Deck actions

Deck actions modal should include:

- `Review deck`
- `Edit deck`
- `Add to folder`
- existing actions such as delete or primary deck navigation where applicable

### Folder move modal

The move modal should:

- search folders by name
- allow selecting a destination folder
- allow removing the deck from its current folder
- avoid showing impossible targets

### Premades page

The premades page should gain book-level actions in addition to lesson-level actions.

For each premade book section:

- show the book label
- show lesson count
- show a `Copy book` action

Copy book should create the folder and its lesson decks in one operation.

## Error Handling

- if a deck move fails, keep the deck in its original location and show an error
- if folder review is triggered for an empty folder, show a clear empty-review state
- if book copy partially succeeds, report actual created counts rather than pretending it was atomic
- if a folder with the default premade book name already exists, create a deterministic non-conflicting name such as `Tobira 1 (2)` instead of silently merging
- if a deck is deleted, it should disappear from folder aggregates automatically

## Testing Expectations

Implementation should include:

- store tests for folder creation, move, and removal
- decks page data-shaping tests for mixed standalone and foldered deck rendering
- folder aggregate tests for child count, card count, due count, and latest review
- review tests for merged folder queues
- premade book copy tests for folder creation plus lesson deck creation
- sync verification for folder create and deck move behavior

## Open Questions Resolved

- nesting depth: one level only
- folder review entry: direct start, no summary screen first
- `Add to parent` meaning: move deck into folder
- premade book copy destination: normal local folder
