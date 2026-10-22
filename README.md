# adi.rest Status
[![Netlify Status](https://api.netlify.com/api/v1/badges/652c5595-4ed9-44e2-bb23-afb1ffda529e/deploy-status)](https://app.netlify.com/projects/magical-kashata-b89e3a/deploys)
A minimalist SvelteKit status page for adi.rest, deployed to Netlify. No database, notifications, or alerting integrations are used.

## Monitoring rules

The configured URLs in `services.json` are checked server-side. Checks measure elapsed response time, validate configured HTTP status ranges, apply per-service latency thresholds and redirect policy, and categorize DNS, TLS, timeout, connection, HTTP/server and API-payload failures separately.

The Lyrics API monitor targets `https://lyrics.adi.rest/api/health` rather than treating the root API router as proof of health. The documented health endpoint returns `ok: true`, `name: Adi Lyrics`, a version, and provider information. The checker validates its JSON content type, object response, required fields and expected `ok`/name values. Other service checks target their exact configured URLs.

## Current runtime limitations

Checks are live request results, not persisted history. Netlify's serverless function filesystem and memory are not durable across invocations. The consecutive-failure/recovery thresholds remain configured, but **live-only mode cannot enforce them without persisted prior records**. Historical uptime and incident APIs therefore explicitly report history unavailable instead of inventing values.

To provide real 24h/7d/30d uptime, consecutive-failure hysteresis, last-success/last-failure continuity and incidents while respecting the no-database requirement, use a scheduled runtime with persistent flat-file JSONL storage. Do not treat Vercel's temporary local filesystem as durable.

## Deploy to Netlify

Netlify uses the SvelteKit Netlify adapter. The repository includes `netlify.toml`; set the Netlify build command to `npm run build` and publish directory to `build/client` (or let Netlify read the config file). Install dependencies with `npm install`, run `npm run check` and `npm run build`, then deploy through the connected Git repository. No Vercel CLI or Vercel cron configuration is required for the build.

No notifications, alerts, email, Discord or Telegram integrations are included.
