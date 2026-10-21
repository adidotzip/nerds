# adi.rest Status

A minimalist, database-free status page and HTTP monitoring worker for adi.rest. No database, alerting, notifications, email, Discord, or Telegram integrations.

## Requirements

- Node.js 20+
- A host with persistent writable storage
- Cron or a systemd timer to run the monitoring worker

## Run

```sh
npm run check
npm start
```

Open http://localhost:3000. Run an actual check pass manually:

```sh
node monitor.mjs
```

The page intentionally shows Unknown until real check records exist.

## Architecture and storage

- `services.json` is the source-controlled service configuration. Service IDs, URLs, accepted HTTP codes, timeouts, redirects and latency thresholds are configurable.
- `monitor.mjs` appends UTC records to `data/history/<service-id>.jsonl`.
- `data/incidents.jsonl` captures outage/recovery transitions derived from recorded results.
- `data/domain-health.json` stores RDAP, DNS and TLS observations for `imreallyadi.space`.
- `server.mjs` serves the frontend and read-only API.
- Page visits never trigger checks. The monitoring process is scheduled independently.

Example cron entry (adjust paths):

```cron
* * * * * cd /srv/adi-rest-status && /usr/bin/node /srv/adi-rest-status/monitor.mjs >> /srv/adi-rest-status/worker.log 2>&1
```

Set `STATUS_DATA_DIR=/var/lib/adi-status` for storage outside the release directory. Ensure the directory is writable and persistent. Do not run the worker on an ephemeral filesystem and expect history to survive deployments. If the web host has no persistent volume, run the worker on a persistent flat-file host and expose the read API from a host that can read those same files. Do not replace JSONL with a database.

## Domain expiry

The worker attempts an RDAP lookup. If no trustworthy expiration event is found, the countdown remains blank. To provide a verified manual value, configure `domainHealth.imreallyadi.space.expirationDate` as an ISO date, e.g. `2030-01-31T00:00:00Z`. Never put an estimated date there.

## API

- `GET /api/status`
- `GET /api/status/:serviceId`
- `GET /api/uptime/:serviceId?period=24h|7d|30d`
- `GET /api/history/:serviceId?period=24h|7d|30d`
- `GET /api/incidents`
- `GET /api/domain-health`

Unknown or stale data stays unknown; uptime is computed from observed checks, not a fabricated timeline. The Lyrics endpoint currently validates HTTP status codes only. If it needs semantic JSON validation, add a service-specific response validator before treating it as fully healthy.

## Deploy

1. Provision Node.js 20+ and persistent writable storage.
2. Set `STATUS_DATA_DIR` and deploy the repository.
3. Start `npm start` as a service.
4. Schedule `node monitor.mjs` every minute.
5. Verify records are generated and survive restarts/deployments.
6. Confirm `/api/status` reflects real results.

No database, notifications or alerts are part of this project.
