# adi.rest Status

A minimalist, database-free status page for four configured targets. Built with static HTML/CSS/JS and Vercel serverless functions.

## Deploy to Vercel

1. Import `adidotzip/nerds` into Vercel.
2. Keep the project root as the repository root.
3. Use the default Node.js runtime. No database or environment variables are required.
4. Deploy the `main` branch.

The included `vercel.json` serves the static site from `public/` and the API from `api/`.

## Local checks

Use Node.js 20 or newer:

```sh
npm run check
```

## Monitored targets

Edit `services.json` to configure the URLs, expected HTTP status ranges, request timeouts, and latency thresholds.

- `GET /api/status` checks all configured targets and returns an overall status.
- `GET /api/status/:serviceId` checks one configured target.
- `GET /api/domain-health` looks up the registration expiration date for `imreallyadi.space` when RDAP provides it, plus DNS and HTTPS health.

## Important limitations

This deployment is deliberately database-free and uses live checks. Each API request performs a fresh HTTP check; the frontend refreshes every 30 seconds. There is no background worker, persistent history, uptime percentage, incident log, or alert system. Vercel serverless functions cannot guarantee a continuously running 60-second monitor, and their local filesystem is not durable storage. Historical uptime would require a persistent storage service or a separate monitoring worker.

The API only checks URLs declared in `services.json`; it does not accept arbitrary URLs from visitors.
