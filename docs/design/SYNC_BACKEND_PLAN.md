# Sync Backend Plan

## Architecture

- The app remains local-first on SQLite.
- A separate Bun/Hono backend accepts sync traffic and talks to PlanetScale Postgres.
- The mobile app never ships raw Postgres credentials.
- The backend uses Drizzle schema definitions and Drizzle CLI migrations for Postgres ownership.
- Clerk is the source of user identity. Sync ownership is derived from the verified Clerk user ID.

## Postgres model

The backend owns these remote tables:

- `sync_users`
- `sync_devices`
- `sync_deck_folders`
- `sync_decks`
- `sync_knowledge`
- `sync_cards`
- `sync_review_logs`

All user data tables use `(owner_id, id)` composite primary keys. That keeps local IDs reusable per user and makes tenant filtering explicit.

## Merge rules

- Deck folders, decks, and cards use last-write-wins by local `updated_at` / `created_at`.
- Knowledge uses FSRS-aware merge logic:
  - newer `last_review` wins
  - if `last_review` ties, newer `updated_at` wins
- Review logs are append-mostly:
  - conflict on the same row ID keeps the newer `review` timestamp
- Deletions should stay as tombstones instead of hard deletes so other devices can pull them.

## API

### `POST /api/v1/sync/register`

Registers or refreshes a device row.

### `POST /api/v1/sync/push`

Accepts a snapshot or partial snapshot:

- `deckFolders`
- `decks`
- `knowledge`
- `cards`
- `reviewLogs`

### `POST /api/v1/sync/pull`

Returns rows with `server_updated_at > since`.

## Sync modes

- `manual`: queue local changes and sync only on explicit user action
- `automatic`: trigger sync after local writes with debounce and retry

The right hybrid model is:

1. Keep `manual` as the default so the app stays cheap to run offline.
2. Let users opt into `automatic`.
3. Use the same backend API for both modes.
4. Store stable `sync_device_id` and `sync_mode` in local app settings.

## Next client step

The app now has enough local metadata to produce a sync snapshot. The next client-side work is:

- add a network client for the Hono API
- call `register` on first connect
- send the Clerk session token with sync requests
- push local snapshot batches
- pull remote deltas and merge them into SQLite
