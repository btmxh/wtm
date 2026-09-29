# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

wtm is a single-user, self-hosted "oshi clip organizer": it crawls YouTube clipper channels, links each clip to the VTubers ("oshis") it features, and serves a web UI to browse, tag, and watch clips in a swipeable feed. Watching a clip requires writing a takeaway.

## Commands

The dev shell comes from the Nix flake (`nix develop`, or direnv via `.envrc`). It provides node, pnpm, and sqlite. Secrets live in `.env` (`YOUTUBE_API_KEY`, `TYPESAFE_API_KEY`), and every script loads it with `--env-file=.env`.

- `pnpm dev`: start the server with `--watch` on port 4173 (override with `PORT`). Run it from the repo root, because static files are served from `./public`.
- `pnpm collect`: CLI import. It seeds oshis from `config/oshis.json`, resolves the channels in `config/clippers.json`, and imports their uploads.
- `pnpm verify-shorts`: CLI run of the short/video classify pass.
- `pnpm autotag`: CLI run of the LLM tagging pass.
- `pnpm lint`: Biome lint plus a format check over TS, JS, CSS and JSON (`biome.json`). `pnpm format` applies the formatting and the safe lint fixes.
- `pnpm typecheck`: `tsc` with no emit. The `tsconfig.json` sets `erasableSyntaxOnly` and `allowImportingTsExtensions`, so it enforces the rules below.
- `pnpm test`: the `node:test` suite in `test/*.test.ts`. DB tests use `openDb(":memory:")`, and no test calls the network or needs `.env`.
- `pnpm check`: lint, typecheck, then tests. The git pre-commit hook (`.githooks/pre-commit`, turned on by the `prepare` script at `pnpm install`) runs this, and so does CI (`.github/workflows/ci.yml`).

There is no build step or bundler. Node 24 runs TypeScript directly through its built-in type stripping, so type errors only appear at runtime unless you run `pnpm typecheck`. Imports must use explicit `.ts` extensions, and code must only use erasable TS syntax (no enums, namespaces, or parameter properties). The database is `data/wtm.sqlite` (gitignored). Inspect it with `sqlite3 data/wtm.sqlite`.

## Architecture

- **Server** (`src/server.ts`): a Hono app that holds all routes. There is one module-level `DatabaseSync` (`node:sqlite`, synchronous, no ORM). Pages are server-rendered HTML. Mutations are form POSTs that answer with a 303 redirect.
- **HTML** (`src/html.ts`): an `html` tagged template that auto-escapes interpolations and returns a `SafeString`. Nested `html` calls compose. `raw()` opts out of escaping. The view functions in `src/views/*.ts` return `SafeString`s, and `layout()` wraps them into the full page string.
- **Client JS** (`public/*.js`): plain browser scripts with no build step. `watch.js` runs the watch feed. It virtualizes the queue: only nearby slides are in the DOM, and at most 3 YouTube iframes exist at a time. Mutations from the feed sidebar use `fetch` with an `x-wtm-fetch` header, and the server answers those with 204 instead of a redirect (`mutationResponse`). This keeps the playing clip alive. Without that header, the same routes still work as plain forms.
- **Feed filters** (oshi, clipper, tag, kind, watched, order, seed) travel in the query string. The same `FilterQuery` builds the initial queue on `/watch/:id` and the replacement queue at `/api/queue`. `order=random` uses a seeded shuffle, so reloading the page gives the same order.
- **Data access** is split into two files. `src/db.ts` has `openDb`/migrations and the write-side helpers that the import, classify, and autotag pipelines use. `src/queries.ts` has the UI read queries and the UI mutations (tags, watches, stats).
- **Schema and migrations**: `src/schema.sql` contains only `CREATE ... IF NOT EXISTS` statements and runs on every `openDb()`. When you add a column to an existing table, also add a guarded `ALTER TABLE` to `migrate()` in `src/db.ts`. `migrate()` runs before `schema.sql`.
- **Provenance `source` columns**: `clip_oshis.source` is `heuristic`, `llm`, or `manual`, and `clip_tags.source` is `manual` or `llm`. Re-running heuristics must replace only rows that have `source = 'heuristic'` (see `setHeuristicClipOshis`). Never overwrite manual or LLM corrections. In the same way, `clips.kind` starts as a guess based on duration (60s or less means a short). Once `kind_verified = 1`, `upsertClip` no longer changes it.

### Background jobs

`src/jobs.ts` is an in-memory job registry. It keeps the last 20 jobs, which are lost when the server restarts. Each job is `createJob(type, (report, signal) => ...)`. The work function reports progress, log lines, and `metaDelta` counters through `report`. It must check `signal.aborted` itself for cancellation to work. The `/jobs` and `/jobs/:id` pages get live updates over SSE (`/jobs/events`, `/jobs/:id/events`), which send a new snapshot every 750ms.

Each job's logic is a `run*` function that takes a `(db, report, signal)` signature. The CLI scripts reuse the same functions and pass a `report` that just logs to the console.
- `importJob.ts` (`runImport`): fetches a clipper's uploads playlist through the YouTube Data API (`src/youtube.ts`), then matches oshis by case-insensitive alias substring against the title, or the title plus description. The description is first cleaned by per-clipper functions in `CLIPPER_DESCRIPTION_CLEANERS`, keyed by handle. When an import finishes, a classify job starts automatically.
- `classifyJob.ts` (`runClassify`): confirms short vs. video for unverified clips with the `youtube.com/shorts/{id}` redirect check. It uses 5 concurrent workers. A clip that fails is skipped and retried on the next run, and the failure does not stop the job.
- `autotagJob.ts` (`runAutotag`): for each clip, it asks the TypeSafe System One API (`src/typesafe.ts`) one batched yes/no question per unattached tag that has a `prompt`. Tags with a confidence of 0.7 or higher are attached with `source = 'llm'`.

### Product decisions to respect

- Tags are a fixed vocabulary that is managed only through the `/tags` web UI. Do not add a config-file seeding path for tags. Oshis can be added through the `/oshis` page and the import page, and also through `config/oshis.json` (for `pnpm collect`).
- There is no separate "groups" concept, because a group is just a tag. `migrate()` drops the old `groups`/`oshi_groups` tables.
- The app is used from a phone over Tailscale, and it has no auth. Treat it as private and do not expose it publicly.
