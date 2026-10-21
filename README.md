# adi.rest Status

A minimalist SvelteKit status page for adi.rest services, deployed to Cloudflare Workers. No notifications or alerts are implemented. Status, uptime, history, and incidents must be based on real recorded checks only.

## Deploy to Cloudflare Workers

Requirements: Node.js 22+, a Cloudflare account.

1. Clone and install:

   ```sh
   git clone https://github.com/adidotzip/nerds.git
   cd nerds
   npm install
   ```

2. Authenticate and deploy the web app:

   ```sh
   npx wrangler login
   npm run check
   npm run build
   npx wrangler deploy
   ```

3. Deploy the scheduled monitor Worker:

   ```sh
   ```

The current monitoring API still uses MongoDB for records and locking. Configure `MONGODB_URI` and `CRON_SECRET` on the app Worker and use the same `CRON_SECRET` on the monitor Worker. Set `MONITOR_API_URL` in `wrangler.monitor.jsonc` to the deployed app origin, then run:

   ```sh
   npm run deploy:monitor
   npx wrangler secret put CRON_SECRET --config wrangler.monitor.jsonc
   ```

**Important:** this repo does not yet satisfy a strict no-database requirement. The current API code imports the MongoDB client. To honour a no-database architecture, the API/worker storage must be migrated to append-only JSONL on a platform with persistent writable storage, or another explicitly approved flat-file mechanism. Do not claim local files will persist on Cloudflare Workers without configuring a supported persistent storage target.

## Monitored services

Edit `services.json` to configure approved URLs, expected HTTP status ranges, timeouts, and latency thresholds. The configured targets are:

- `https://adi.rest/`
- `https://lyrics.adi.rest/api/`
- `https://imreallyadi.space/`

The expiration date for `imreallyadi.space` is manually configured in the API and should only be displayed as configured/unverified unless verified using registration data.

## Data integrity

- Monitoring history, uptime, and incidents must be based on actual check results.
- Historical visualizations show empty time buckets as unknown, never healthy.
- Do not fabricate historical checks or uptime percentages.
- No notifications or alerting integrations are included.
- The UI supports reduced-motion preferences and animates controls, graphs, history bars, and theme changes.
