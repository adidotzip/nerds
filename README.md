# adi.rest Status

A minimalist SvelteKit status page for adi.rest services, deployed to Vercel. Monitoring is read-only: no database, notifications, email/Discord/Telegram integrations, or alerting.

## Deploy to Vercel

```sh
npm install
npm run check
npm run build
npx vercel --prod
```

You can also import `adidotzip/nerds` in Vercel and let it detect SvelteKit.

## Monitoring behavior

Monitoring targets and checks are configured in `services.json`. The backend requests the exact configured URLs, measures request time, validates expected HTTP status codes, supports per-service latency limits and redirect behavior, and separately classifies HTTP/server, DNS, TLS, timeout, connection, and API-payload errors. Request timeouts are capped by the checker.

The Lyrics API check validates JSON content type, requires a JSON object, and requires at least one recognized top-level field. The accepted field list is deliberately configurable. Confirm it against the API's actual response contract and tighten it to the exact expected schema once known; a generic field allow-list is not a substitute for a documented health response.

Stale live responses are marked unknown. Thresholds for consecutive failures/recovery are present in configuration for future stateful monitoring, but **are not enforced by live-only checks** because the repository currently has no permitted durable monitoring-history store. The API reports checks performed during the current request and explicitly says history is unavailable rather than inventing uptime or incident records.

## Persistence limitation

Vercel function memory is ephemeral, and this project intentionally does not use a database. To provide genuine historical uptime, consecutive-failure hysteresis, last-success/last-failure continuity, and incident history, attach a persistent flat-file JSONL store on a compatible scheduled runtime or implement a suitable file-backed worker. Do not treat Vercel's temporary local filesystem as durable.

No external notifications, alerts, or domain-expiration notifications are implemented.
