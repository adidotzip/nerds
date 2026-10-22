# adi.rest Status
[![Netlify Status](https://api.netlify.com/api/v1/badges/652c5595-4ed9-44e2-bb23-afb1ffda529e/deploy-status)](https://app.netlify.com/projects/magical-kashata-b89e3a/deploys)
A minimalist SvelteKit status page for adi.rest, deployed to Netlify. MongoDB stores real monitoring checks; no notifications or alerting integrations are used.

## Monitoring rules

The configured URLs in `services.json` are checked server-side. Checks measure elapsed response time, validate configured HTTP status ranges, apply per-service latency thresholds and redirect policy, and categorize DNS, TLS, timeout, connection, HTTP/server and API-payload failures separately.

The Lyrics API monitor targets `https://lyrics.adi.rest/api/health` rather than treating the root API router as proof of health. The documented health endpoint returns `ok: true`, `name: Adi Lyrics`, a version, and provider information. The checker validates its JSON content type, object response, required fields and expected `ok`/name values. Other service checks target their exact configured URLs.

## Monitoring history and MongoDB

Set `MONGODB_URI` in Netlify's environment variables to a MongoDB connection string. Optionally set `MONGODB_DB`; the default database name is `adi_rest_status`. Never commit the connection string to the repository. The app records real check results when its status endpoints are requested and derives history, uptime, and incidents from those records. If MongoDB is missing or unavailable, live checks still respond, but history is reported as unavailable.

On the first database access, a one-time cleanup removes prior records outside the last 24 hours and non-outage records, preserving only genuine outage checks from the last 24 hours. It does not create fake or backdated checks. A currently failing service without an earlier recorded failure is shown as down from its first observed failure; its earlier start time and uptime are unknown. Fresh checks are then stored normally. Check records expire after 30 days.

Monitoring runs when the status API is requested; it is not a guaranteed background schedule. The frontend refreshes while visitors are on the page, so unattended minute-by-minute monitoring requires a separate scheduled function or worker.

## Deploy to Netlify

Netlify uses the SvelteKit Netlify adapter. The repository includes `netlify.toml`; set the Netlify build command to `npm run build` and publish directory to `build` (or let Netlify read the config file). Install dependencies with `npm install`, run `npm run check` and `npm run build`, then deploy through the connected Git repository. No Vercel CLI or Vercel cron configuration is required for the build.

No notifications, alerts, email, Discord or Telegram integrations are included.
