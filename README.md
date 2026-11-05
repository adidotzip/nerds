# adi.rest Status

A minimalist SvelteKit status page for adi.rest, deployed to Vercel. MongoDB stores real monitoring checks; no notifications or alerting integrations are used.

## Monitoring rules

The configured URLs in \`services.json\` are checked server-side. Checks measure elapsed response time, validate configured HTTP status ranges, apply per-service latency thresholds and redirect policy, and categorize DNS, TLS, timeout, connection, HTTP/server and API-payload failures separately.

The Lyrics API monitor targets \`https://lyrics.adi.rest/api/health\` rather than treating the root API router as proof of health. The documented health endpoint returns \`ok: true\`, \`name: Adi Lyrics\`, a version, and provider information. The checker validates its JSON content type, object response, required fields and expected \`ok\`/name values. Other service checks target their exact configured URLs.

## Monitoring history and MongoDB

Set \`MONGODB_URI\` in Vercel's environment variables to a MongoDB connection string. Optionally set \`MONGODB_DB\`; the default database name is \`adi_rest_status\`. Never commit the connection string to the repository. The app records real check results when its status endpoints are requested and derives history, uptime, and incidents from those records. If MongoDB is missing or unavailable, live checks still respond, but history is reported as unavailable.

On the first database access, a one-time cleanup removes prior records outside the last 24 hours and non-outage records, preserving only genuine outage checks from the last 24 hours. It does not create fake or backdated checks. A currently failing service without an earlier recorded failure is shown as down from its first observed failure; its earlier start time and uptime are unknown. Fresh checks are then stored normally. Check records expire after 30 days.

## Arduino R4 WiFi probe

The Arduino checks \`adi.rest\` every 60 seconds and posts the result to \`https://ping.adi.rest/api/arduino\`. Configure \`ARDUINO_PING_TOKEN\` as a sensitive Vercel environment variable and use the same value only in the local, git-ignored Arduino secrets header. See [docs/arduino-pinger.md](docs/arduino-pinger.md) for setup, DNS records, and the sketch.

## Scheduled monitoring

Vercel Cron invokes \`/api/monitor/run\` with \`CRON_SECRET\`. The connected Hobby team is limited to one cron execution per day; the Arduino remains the minute-by-minute external probe. On Pro or Enterprise, change the schedule in \`vercel.json\` to \`* * * * *\` for minute-by-minute server checks.

## Deploy to Vercel

The app uses \`@sveltejs/adapter-vercel\`. Vercel detects SvelteKit automatically. Install dependencies with \`npm install\`, run \`npm run check\` and \`npm run build\`, then deploy through the connected Git repository.

No notifications, alerts, email, Discord or Telegram integrations are included.
