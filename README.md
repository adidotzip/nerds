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

## Vercel monitoring setup

The site, live checks, scheduled monitor, and history API run on Vercel. MongoDB stores real HTTP check records; Cloudflare Workers and R2 are not required.

1. Set `MONGODB_URI` in the Vercel project environment variables to your MongoDB connection string.
2. Optionally set `MONGODB_DB` (defaults to `adi_rest_status`).
3. Set `CRON_SECRET` in Vercel. Use a long random secret.
4. Confirm the Vercel project is configured to deploy `vercel.json`, which schedules `/api/cron/check` every minute.
5. Redeploy after setting environment variables.

The cron route requires the `Authorization: Bearer <CRON_SECRET>` header. Each run performs real HTTP checks against the exact URLs in `services.json` and stores results in MongoDB. Records older than 31 days are removed. Live status checks run through the backend as well. Historical uptime is calculated only from recorded checks, so new history starts accumulating after the cron job is successfully running.

## Monitored services

Configured targets are in `services.json`. Monitoring history, uptime, and incidents must use real recorded checks only. Missing history intervals are unknown, never healthy. No notification or alerting integrations are included.
