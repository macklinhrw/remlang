# Remlang Sync Backend

This service is the network-facing sync layer for the Expo app. The mobile app should not connect to PlanetScale Postgres directly.

## Stack

- Bun runtime
- Hono HTTP server
- Drizzle ORM + Drizzle Kit for Postgres

## Required env

- `DATABASE_URL`: PlanetScale Postgres connection string
- `PORT`: optional, defaults to `8787`
- `CLERK_SECRET_KEY`: Clerk backend secret key
- `CLERK_PUBLISHABLE_KEY`: Clerk publishable key
- `CLERK_JWT_KEY`: optional JWT verification key for networkless verification
- `PREMADE_DECK_USER_IDS`: optional comma-separated Clerk user ids allowed to read premade decks; unset means any signed-in user

## Run

```bash
cd backend
bun install
bun run db:generate
bun run db:push
bun run dev
```

## Endpoints

- `GET /health`
- `POST /api/v1/sync/register`
- `POST /api/v1/sync/push`
- `POST /api/v1/sync/pull`
- `GET /api/v1/premade-decks`
- `GET /api/v1/premade-decks/pull`

`push` accepts partial or full snapshots of local user data. `pull` returns rows changed since the provided server cursor.

The sync and premade-deck routes are protected with Clerk session verification. The backend derives the sync owner from the authenticated Clerk user, not from client-provided payload data. Premade decks can hold textbook-derived vocabulary, so they are never served anonymously; set `PREMADE_DECK_USER_IDS` to limit them to specific accounts.
