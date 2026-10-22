# adi.rest Status

A minimalist SvelteKit status page for adi.rest, deployed to Vercel. No database, notifications, or alerting integrations are used.

## Monitoring rules

The configured URLs in `services.json` are checked server-side. Checks measure elapsed response time, validate configured HTTP status ranges, apply per-service latency thresholds and redirect policy, and categorize DNS, TLS, timeout, connection, HTTP/server and API-payload failures separately.

The lyrics API check targets exactly `https://lyrics.adi.rest/api/`, requires JSON content type and a JSON object with at least one recognized API field. A dedicated health endpoint is preferable for monitoring; the lyrics service documents `GET https://lyrics.adi.rest/api/health` as returning `ok: true`, API name/version and provider information. That stable endpoint is a better health check than the root API router, which may have changing behavior. The actual `/api/` route remains the configured URL currently requested by the project requirement.

## Important runtime limitation

This repo currently runs live checks on Vercel, whose function filesystem and in-memory state are not durable across instances. The configuration lists consecutive-failure/recovery thresholds, but live-only mode does **not** enforce them without persisted prior results. Historical uptime and incident APIs therefore explicitly report history unavailable instead of fabricating values.

To support consecutive-failure hysteresis, genuine 24h/7d/30d uptime, and incidents while respecting the no-database requirement, use a scheduled runtime with persistent flat-file JSONL storage. Do not use ephemeral Vercel function memory or filesystem as durable history.

## Deploy

```sh
npm install
npm run check
npm run build
npx vercel --prod
```

No notifications, alerts, email, Discord or Telegram integrations are included.
