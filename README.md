# Nerds

<a href="https://madewithjev.com/free-tools/ai-slop-detector/report/nerds.adi.rest"><img src="https://madewithjev.com/free-tools/ai-slop-detector/badge/nerds.adi.rest" alt="26% AI slop, checked by Jev" height="20"></a>

Nerds is the SvelteKit status and monitoring app for [adi.rest](https://adi.rest/). It displays live service health, recorded uptime, response-time history, incidents, and the Arduino UNO R4 WiFi backup probe.

## Stack

- SvelteKit 2 and Svelte 5
- Vite 7 with the Vercel adapter
- Material 3 Svelte components and LayerChart
- MongoDB for persistent check history
- Arduino UNO R4 WiFi for an independent 60-second probe

## Local development

Requires Node.js 22.

```sh
npm install
npm run dev
```

Run the project checks and production build before making changes:

```sh
npm run check
npm run build
npm run preview
```

## Configuration

Set these as environment variables in the hosting project. Never commit their values.

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB connection string for monitoring history |
| `MONGODB_DB` | Optional database name; defaults to `adi_rest_status` |
| `ARDUINO_PING_TOKEN` | Authenticates the Arduino probe |
| `CRON_SECRET` | Authenticates scheduled monitoring requests |

Without MongoDB, live checks can still run, but historical data and incident history are unavailable.

## Monitored services

The configured services live in `services.json`. Each entry defines its URL, expected HTTP status range, timeout, latency threshold, and optional response-payload validation.

The Lyrics API monitor checks `https://lyrics.adi.rest/api/health` and validates the health response rather than treating the API root as proof of health.

## Monitoring API

The SvelteKit API routes are under `src/routes/api/`. The catch-all compatibility route delegates to `src/lib/server/legacy-api.js`.

The status page reads the latest persisted results from `/api/current-status`. Live checks, history, uptime, incidents, and domain-health data are exposed through the API routes.

MongoDB history is based on actual observations only. The initial history cleanup preserves only real outage records from the last 24 hours; it does not synthesize or backdate checks. Check records have a 30-day TTL.

## Arduino backup probe

The UNO R4 WiFi checks `https://adi.rest/` every 60 seconds and reports to `https://ping.adi.rest/api/arduino`. The Arduino is a secondary source for the main website's status when primary checks are stale; stale heartbeats are never treated as current health.

See [docs/arduino-pinger.md](docs/arduino-pinger.md) for board setup, Wi-Fi configuration, and deployment environment variables. Copy `arduino/nerds-pinger/arduino_secrets.h.example` to `arduino_secrets.h` locally and fill in credentials. The real secrets file is ignored by Git.

## Scheduled checks

GitHub Actions runs `.github/workflows/hourly-monitor.yml` every 5 minutes and calls `https://ping.adi.rest/api/monitor/run`. Add the GitHub Actions repository secret `CRON_SECRET` with the same value as the Vercel Production environment variable `CRON_SECRET`. The endpoint checks each configured service, validates JSON health responses, and stores real observations in MongoDB. The primary monitoring freshness window is 10 minutes, allowing a missed 5-minute run without masking an extended monitoring gap. The workflow can also be started manually from the GitHub Actions tab.

Vercel Hobby Cron does not support an hourly schedule, so GitHub Actions supplies the 5-minute trigger while the monitoring endpoint and app run on Vercel. The Arduino remains an independent backup probe.

## Deployment

The app uses `@sveltejs/adapter-vercel` and is configured for the Vercel project `nerds`. Deployments are currently paused in Vercel; the GitHub repository remains unchanged apart from reviewed cleanup commits.

No notification or alerting integrations are included.
