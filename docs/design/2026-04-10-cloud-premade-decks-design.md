# Cloud Premade Decks Design

## Goal

Store Tobira premade decks in the cloud database as canonical shared content, allow the client to fetch and cache that content locally, and let users create normal local decks and knowledge from the cached premade data.

The system should:

- store all premade deck metadata and premade row content in the backend database
- let the mobile client fetch premade content from the backend
- cache premade content into local SQLite for offline browse and copy flows
- keep premade content separate from user-owned study data
- preserve exact dictionary sense matches, all-senses fallback metadata, and textbook definition blobs

The system should not:

- represent premade rows as user-owned `knowledge`
- mix global premade content into the existing per-user sync snapshot protocol
- require online access to browse or copy premades after a successful local cache pull

## Scope

In scope:

- backend Postgres tables for premade decks and premade items
- backend API routes for listing and pulling premade content
- local SQLite cache tables for premade decks and premade items
- local premade sync state tracking
- client-side upsert flow for premade cache refresh
- copy-time use of cached premade items to create local `knowledge` and `cards`
- adapting the Tobira generator into a cloud ingestion path

Out of scope:

- final UI for browsing premade decks
- admin UI for editing premade content
- versioned immutable snapshots of premade data
- user-specific remote storage of copied decks through a new premade-specific sync model

## Product Model

Premade content is globally shared canonical content.

User study content remains user-owned.

There are two distinct layers:

- canonical premade content in cloud Postgres
- user-owned local decks, cards, and knowledge in client SQLite plus the existing user sync path

Premade items never become authoritative study records themselves. Copying a premade row creates one normal local knowledge/card pair using the same logic as any other deck creation path.

## Ownership Boundary

### Canonical cloud layer

Cloud stores:

- premade deck metadata
- premade item content
- dictionary link metadata
- exact sense match metadata
- textbook definition blobs

These records are shared across all users and can change centrally.

### User local layer

Client stores:

- cached premade content for browse and copy
- copied local decks
- copied local cards
- copied local knowledge
- FSRS state and review logs

Users do not directly edit the canonical premade rows.

## Backend Data Model

### `premade_decks`

Suggested columns:

- `id`
- `slug`
- `name`
- `book`
- `lesson`
- `language_id`
- `source`
- `is_published`
- `deleted_at`
- `created_at`
- `updated_at`

Semantics:

- one row per canonical premade lesson deck
- `slug` should be stable and human-readable, such as `tobira-2-l11`
- `id` should also be stable and text-based so ingestion can upsert deterministically
- `is_published` controls client visibility

### `premade_items`

Suggested columns:

- `id`
- `premade_deck_id`
- `sort_order`
- `source_tag`
- `kana`
- `kanji`
- `english`
- `front`
- `pronunciation`
- `source_definitions`
- `dictionary_entry_id`
- `dictionary_sense_ids` as `jsonb`
- `uses_all_senses`
- `match_status`
- `match_method`
- `deleted_at`
- `created_at`
- `updated_at`

Semantics:

- one row per canonical premade vocab row
- IDs should stay stable across reimports
- `dictionary_sense_ids` is empty when the row is linked to an entry but intentionally uses all senses
- item IDs should reuse the generator's stable source row IDs

## Local Cache Model

Add local SQLite cache tables for premade content.

### `premade_decks`

Mirror the canonical deck fields needed by the client:

- `id`
- `slug`
- `name`
- `book`
- `lesson`
- `language_id`
- `source`
- `is_published`
- `created_at`
- `updated_at`

### `premade_items`

Mirror the canonical item fields needed for copy and browse:

- `id`
- `premade_deck_id`
- `sort_order`
- `source_tag`
- `kana`
- `kanji`
- `english`
- `front`
- `pronunciation`
- `source_definitions`
- `dictionary_entry_id`
- `dictionary_sense_ids`
- `uses_all_senses`
- `match_status`
- `match_method`
- `created_at`
- `updated_at`

### `premade_sync_state`

Track pull state separately from user sync:

- `id`
- `last_pulled_at`
- `last_cursor`
- `last_successful_sync_at`
- `last_error`

This should be a small local-only table, not part of the user-owned sync snapshot.

## Backend API Model

Premade content should use a separate pull-only API.

Recommended endpoints:

- `GET /premade-decks`
  Returns published premade deck metadata, optionally filtered by language.

- `GET /premade-decks/pull?cursor=<opaque>&limit=<n>`
  Returns changed premade decks and premade items after a stable server-issued cursor.

The response should include:

- server time
- cursor
- `hasMore`
- premade deck records
- premade item records

Pull records should include published updates and tombstones:

- deck rows with `deleted_at` set or `is_published = false` so clients can remove hidden decks from cache
- item rows with `deleted_at` set so clients can remove stale premade items from cache

`GET /premade-decks` is the simple browse endpoint.

`GET /premade-decks/pull` is the cache refresh endpoint and should be the only endpoint used for offline cache hydration.

This API should not require the client to upload premade state. It is a read-only shared content feed.

## Client Cache Refresh Flow

Refresh flow:

1. read local `premade_sync_state`
2. call premade pull endpoint with `cursor`
3. upsert active premade decks and premade items into local SQLite
4. delete or hide cached rows covered by tombstones or unpublished deck updates
5. update local `premade_sync_state`
6. browse and copy UI continue to read from local SQLite only

This allows:

- online refresh from canonical content
- offline browsing and copying after prior sync
- clean separation from the user sync engine

## Copy-To-Deck Rules

Copying a premade row should use cached premade item data from local SQLite.

### Exact dictionary match

If a cached premade item has:

- `dictionary_entry_id`
- non-empty `dictionary_sense_ids`
- `uses_all_senses = false`

then create dictionary-backed knowledge with:

- `entryId`
- exact `definitionConfig`
- dictionary definitions as primary review content
- `sourceDefinitions` preserved from the premade item

### All-senses fallback

If a cached premade item has:

- `dictionary_entry_id`
- empty `dictionary_sense_ids`
- `uses_all_senses = true`

then create dictionary-backed knowledge with:

- `entryId`
- default all-senses config
- textbook `definitions` as primary review content
- dictionary content available as secondary reference
- `sourceDefinitions` preserved

### No dictionary link

If a cached premade item has no trusted dictionary entry link:

- create custom local knowledge
- no `entryId`
- textbook content drives the review card
- `sourceDefinitions` preserved

## Ingestion Model

The Tobira generator should become a cloud ingestion tool.

Primary responsibility:

- normalize lesson data
- preserve dictionary link metadata
- upsert canonical premade deck and premade item rows into backend Postgres
- mark rows missing from a full import as deleted instead of silently leaving stale content published

Optional secondary responsibility:

- emit JSON audit artifacts for review

Canonical source of truth should be Postgres, not the generated JSON files.

## Update Semantics

Premade content is dynamic, not versioned immutable content.

Therefore:

- backend rows are upserted by stable IDs
- clients pull the current published state
- local cache is refreshed in place
- copied user knowledge does not automatically mutate when canonical premade content changes
- removed or unpublished premade content is removed from local cache on the next pull but does not mutate already copied user decks

This avoids retroactively changing user study state while still allowing centralized content maintenance.

## Safety And Constraints

- browse endpoints should return only published rows to clients
- pull endpoints may include unpublished or deleted records only as cache invalidation tombstones
- unpublished or draft content should remain hidden
- local cache refresh should be idempotent
- copy-time should never create duplicate review items for the same premade row within the same deck if equivalent knowledge already exists
- premade content should not leak into the user sync snapshot tables

## Testing Expectations

Implementation should include:

- backend schema tests or migration verification for premade tables
- backend route tests for full pull and incremental pull
- local cache upsert tests
- copy-time tests for exact match, all-senses fallback, and no-link fallback
- generator ingestion tests for upsert shape and stable IDs

## Open Questions Resolved

- cloud vs local source of truth: cloud
- offline availability after fetch: yes, via local cache
- premade content mutability: dynamic canonical rows
- premade storage ownership: globally shared, not user-owned
- copy-time destination: normal local decks and knowledge
