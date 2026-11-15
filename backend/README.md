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

`push` accepts partial or full snapshots of local user data. `pull` returns rows changed since the provided server cursor.

The sync routes are protected with Clerk session verification. The backend derives the sync owner from the authenticated Clerk user, not from client-provided payload data.
