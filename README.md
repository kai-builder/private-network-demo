# Private Network Demo for Server Compass

A multi-app demo repository built to validate the **Connect Apps / Link Apps** workflow in `docs/user-feedback/sakarias.md`.

This repo contains four **separate app stacks**. Deploy each folder as its own App in Server Compass, then link them through the UI.

## Apps in this demo

| Folder | Role | Main service | Default public port |
|---|---|---|---|
| `redis-producer` | Producer | `redis` | `6379` |
| `postgres-producer` | Producer | `postgres` | `5432` |
| `node-consumer-api` | Consumer + UI | `app` | `18081` |
| `worker-consumer` | Consumer | `worker` | `18082` |

## Why this repo exists

It gives you predictable test data for Sakarias issue #1:

1. Consumer app connects to producer app on private Docker network.
2. Suggested env var is injected (`REDIS_URL`, `DATABASE_URL`, `CACHE_URL`).
3. Optional producer public-port removal can be verified.
4. One producer can be linked to multiple consumers (multi-instance support).
5. Unlink should restore expected compose behavior.

## Deploy in Server Compass

Create four Apps from these folders:

1. `redis-producer/docker-compose.yml`
2. `postgres-producer/docker-compose.yml`
3. `node-consumer-api/docker-compose.yml`
4. `worker-consumer/docker-compose.yml`

Recommended deploy order:

1. `redis-producer` (producer)
2. `postgres-producer` (producer)
3. `node-consumer-api` (consumer)
4. `worker-consumer` (consumer)

Keep defaults on first deploy.
If consumers are deployed first, that is still valid, but dependency checks will fail until links are configured.

`node-consumer-api` now includes a frontend demo UI at `/`:

- add/update Redis record
- load Redis record by key
- delete key
- bulk-load demo records
- list records by pattern

Sample env files are included:

- root: `.env.example` (all stacks in one file)
- per app: `<app-folder>/.env.example` (copy to `.env` when running that folder directly)

## Test plan (Sakarias flow)

### 1) Link `node-consumer-api` -> `redis-producer`

Use Connect Apps with:

- consumer: `node-consumer-api`
- producer: `redis-producer`
- network: `shared` (or default suggested)
- env key/value: `REDIS_URL=redis://redis:6379`
- remove producer public port: **ON**

Verify from `node-consumer-api` endpoint:

- `GET /dependencies`
- expected: `redis.tcp.ok=true` and `redis.ping.ok=true`

### 2) Link `node-consumer-api` -> `postgres-producer`

Use Connect Apps with:

- consumer: `node-consumer-api`
- producer: `postgres-producer`
- env key/value: `DATABASE_URL=postgres://demo_user:demo_password@postgres:5432/demo_app`

Verify:

- `GET /dependencies`
- expected: `postgres.tcp.ok=true`

### 3) Multi-consumer check: link `worker-consumer` -> `redis-producer`

Use Connect Apps again with:

- consumer: `worker-consumer`
- producer: `redis-producer`
- env key/value: `CACHE_URL=redis://redis:6379`

Verify:

- `GET /status` on `worker-consumer`
- expected: `cache.tcp.ok=true` and `cache.ping.ok=true`

This validates one producer linked to multiple consumers.

### 4) Unlink behavior

Remove `node-consumer-api` -> `redis-producer` link.

Validate:

- connection row removed from UI
- `REDIS_URL` removed from consumer (if unlink flow is configured to remove)
- producer port restored when restore option is selected

## Local smoke run (optional)

You can run each app folder independently:

```bash
cd redis-producer && docker compose up -d
cd ../postgres-producer && docker compose up -d
cd ../node-consumer-api && docker compose up -d --build
cd ../worker-consumer && docker compose up -d --build
```

Stop:

```bash
cd redis-producer && docker compose down -v
cd ../postgres-producer && docker compose down -v
cd ../node-consumer-api && docker compose down -v
cd ../worker-consumer && docker compose down -v
```

## Notes

- Consumers default to `localhost` dependency URLs on purpose, so they fail before linking and become healthy after linking.
- Producer service names are intentionally simple (`redis`, `postgres`) to match auto-suggestion logic.
