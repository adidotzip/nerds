# adi.rest Status

A minimalist SvelteKit status page for the configured adi.rest services. Hosted on Cloudflare Workers, with MongoDB for real monitoring history. No notifications or alerts are implemented. Status, uptime, history, and incidents are based on recorded checks only.

## Deploy the web app to Cloudflare Workers

Requirements: Node.js 22+, a Cloudflare account, and a MongoDB connection string reachable from Cloudflare Workers.

1. Fork or clone this repository and install dependencies:

   ```sh
   git clone https://github.com/adidotzip/nerds.git
   cd nerds
   npm install
   ```

2. Sign in to Cloudflare and build/deploy the app:

   ```sh
   npx wrangler login
   npm run check
   npm run build
   npx wrangler deploy
   ```

   The SvelteKit Cloudflare adapter outputs the Worker bundle to `.svelte-kit/cloudflare`. The first deploy may ask you to confirm the Workers project or account details.

3. Add the MongoDB connection string as a Worker secret. Use the exact name `MONGODB_URI`:

   ```sh
   npx wrangler secret put MONGODB_URI
   ```

   Paste your MongoDB connection string when prompted. Optionally configure the database name with `npx wrangler secret put MONGODB_DATABASE`. Never commit credentials to Git.

4. Configure the cron endpoint secret on the app Worker:

   ```sh
   npx wrangler secret put CRON_SECRET
   ```

   Use a long random value. You will enter the same value for the monitor Worker below.

5. Copy the deployed app's `workers.dev` origin from the Wrangler output. Open `wrangler.monitor.jsonc` and replace `https://adi-rest-status.YOUR-SUBDOMAIN.workers.dev` with that exact origin.

6. Deploy the scheduled monitor Worker and set its secret:

   ```sh
   npm run deploy:monitor
   npx wrangler secret put CRON_SECRET --config wrangler.monitor.jsonc
   ```

   Paste the same `CRON_SECRET` value configured on the app Worker. The monitor Worker invokes `GET /api/cron/check` once per minute. If you use a custom domain, you can set `MONITOR_API_URL` to that site's origin instead.

## Deploy commands

- `npm run check`: type and Svelte checks.
- `npm run build`: production build.
- `npx wrangler deploy`: deploy the web app Worker.
- `npm run deploy:monitor`: deploy the separate scheduled monitor Worker.
- `npx wrangler tail adi-rest-status`: inspect app Worker logs.
- `npx wrangler tail adi-rest-status-monitor`: inspect monitor logs.

## Configure monitored services

Edit `services.json` to change the approved URLs, expected HTTP status ranges, request timeouts, and latency thresholds. Only configured URLs are checked; the API does not accept arbitrary targets from visitors.

The configured services are:

- `https://adi.rest/`
- `https://lyrics.adi.rest/api/`
- `https://imreallyadi.space/`

The expiration date shown for `imreallyadi.space` is a manually configured value and should be updated if verified registration data changes.

## Data and behavior

- Monitoring history is stored in MongoDB, with a 90-day TTL on check records.
- The monitor runs every minute using a Cloudflare Cron Trigger.
- Uptime percentages and incidents are derived only from recorded checks. No historical results are fabricated.
- If MongoDB is not configured or is unavailable, the API reports monitoring data as temporarily unavailable rather than inventing status.
- No notifications or alerting integrations are included.

## Troubleshooting

- If the site reports that monitoring data is unavailable, check the `MONGODB_URI` secret and MongoDB network access settings.
- If scheduled checks do not arrive, confirm both Workers have the same `CRON_SECRET`, that `MONITOR_API_URL` is the deployed app origin, and inspect monitor logs.
- To test the cron route manually, send a GET request to `/api/cron/check` with an `Authorization: Bearer <CRON_SECRET>` header.
