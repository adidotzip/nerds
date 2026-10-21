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

The current monitoring API still imports MongoDB for records and locking. Configure `MONGODB_URI` and `CRON_SECRET` in Vercel project environment variables if using the existing monitoring API. This repository does **not** yet satisfy a strict no-database requirement. Do not assume local files persist across Vercel deployments; migrate monitoring storage to an explicitly configured persistent flat-file-compatible environment before removing MongoDB.

## Monitored services

Configured targets are in `services.json`. Monitoring history, uptime, and incidents must use real recorded checks only. Missing history intervals are unknown, never healthy. No notification or alerting integrations are included.
