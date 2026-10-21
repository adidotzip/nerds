# adi.rest Status

A minimalist SvelteKit status page for adi.rest services, deployed to Vercel. No notifications or alerts are implemented. Status, uptime, history, and incidents must be based on real recorded checks only.

## Deploy to Vercel

1. Install dependencies and verify the app:

   ```sh
   npm install
   npm run check
   npm run build
   ```

2. Deploy using the Vercel CLI:

   ```sh
   npx vercel login
   npx vercel
   ```

3. For production:

   ```sh
   npx vercel --prod
   ```

You can also import the GitHub repository `adidotzip/nerds` in the Vercel dashboard and let Vercel detect SvelteKit.

## Important storage limitation

Live checks run in the Vercel server-side `/api/ping` endpoint. Historical monitoring is handled by a separate Cloudflare Worker using R2 object storage and newline-delimited JSON files, not a database. Create an R2 bucket named `adi-rest-status-history`, then deploy the monitor with `npx wrangler deploy --config wrangler.monitor.jsonc`. Ensure `monitor.adi.rest` is available as a Cloudflare custom domain. The Worker checks configured targets every minute and serves `/api/history/:serviceId`, `/api/incidents`, and `/api/status`. History begins accumulating only after the Worker is deployed; no historical uptime is fabricated.

## Monitored services

Configured targets are in `services.json`. Monitoring history, uptime, and incidents must use real recorded checks only. Missing history intervals are unknown, never healthy. No notification or alerting integrations are included.
