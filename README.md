# adi.rest Status

A lightweight status page and HTTP monitor for the four configured adi.rest services. Built with Node.js and static HTML/CSS/JS. No database, notification system, or alert integrations.

## Requirements

- Node.js 20 or newer
- A host that permits outbound HTTPS requests and writable storage

## Run locally

```sh
npm run check
npm start
``

Open `http://localhost:3000`. The server performs a check on startup and schedules subsequent checks using `checkIntervalSeconds` in `services.json`. Monitoring runs on the server, not in response to page visits. You can also run a single check with `npm run monitor`.

## Configuration

Edit `services.json` to add or remove targets and tune request timeouts, expected HTTP status ranges, degraded-latency thresholds, retention, and stale-data rules. Service IDs must be unique lowercase letters, digits, and hyphens. Targets are explicitly configured; there is no public arbitrary-URL fetch endpoint.

The `imreallyadi.space` registration date is only shown when discovered through RDAP or supplied as a verified ISO date in `domainHealth.imreallyadi.space.expirationDate`. An unavailable RDAP result is not replaced with a guess.

## Data and deployment

History is stored as append-only JSON Lines under `./data/history/`, with incident events in `./data/incidents.jsonl`. Set `STATUS_DATA_DIR` to a writable, persistent directory outside the application release directory when your host supports it. Set `STATUS_CONFIG` to use another config file and `PORT` to choose the HTTP port.

**Important:** the data directory must survive process restarts and deployments if you want continuous history. Many serverless platforms provide ephemeral filesystems, and a process that sleeps or scales to zero cannot guarantee 60-second monitoring. On those platforms, run `node monitor.mjs` from a compatible scheduled worker with persistent disk, or choose a host that keeps the Node process alive and persists `STATUS_DATA_DIR`. Do not treat ephemeral local files as durable history.

## Read-only API

- `GET /api/status`
- `GET /api/status/:serviceId`
- `GET /api/uptime/:serviceId?period=24h|7d|30d`
- `GET /api/history/:serviceId?period=24h|7d|30d`
- `GET /api/incidents`
- `GET /api/domain-health`

Missing history is returned as unknown/collecting data, never fabricated. Uptime percentages are based only on recorded checks. Unknown time between checks is not counted as successful time.

## Security and scope

The public API is read-only. The monitor only requests URLs in the source-controlled service configuration. No database, user accounts, notifications, alerts, email, Discord, or Telegram integrations are included.
