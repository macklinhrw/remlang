# Remlang

Remlang is an Expo Router app for Chinese study. The current implementation centers on:

- dictionary search over a bundled SQLite database
- word detail pages with definitions, example sentences, and stroke-order practice
- local deck creation backed by the same SQLite database
- an offline asset pipeline for dictionary data and example sentences, with stroke-order data stored in the bundled SQLite database

The full implementation guide lives here:

- [docs/REPO_ARCHITECTURE.md](./docs/REPO_ARCHITECTURE.md)

Quick start:

```bash
pnpm install
pnpm start
```

Useful scripts:

```bash
pnpm start
pnpm android
pnpm ios
pnpm web
```
