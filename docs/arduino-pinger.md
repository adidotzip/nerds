# Arduino R4 WiFi pinger for Nerds

This sketch checks \`https://adi.rest/\` every 60 seconds and sends the result to the Nerds API at \`https://ping.adi.rest/api/arduino\`.

## 1. Configure Vercel

The GitHub repository is linked to the Vercel project named \`nerds\`.

Already configured in Vercel as sensitive environment variables:

- \`ARDUINO_PING_TOKEN\`: authenticates reports from the board.
- \`CRON_SECRET\`: authenticates the scheduled monitoring route.

Also add \`MONGODB_URI\` under Project → Settings → Environment Variables (Production, Preview, Development). Copy the value from the existing hosting environment. It is not stored in this repository. Without it, live checks can work but historical check storage and charts are unavailable.

## 2. Configure Cloudflare DNS

The domain's authoritative nameservers are Cloudflare. Do not change nameservers for this setup.

In Cloudflare → DNS, add these records:

| Type | Name | Target |
| --- | --- | --- |
| A | \`@\` | \`216.198.79.1\` |
| A | \`@\` | \`64.29.17.1\` |
| CNAME | \`ping\` | \`f2aad0c104c7d6f7.vercel-dns-017.com\` |

For the apex migration, remove the old GitHub Pages A records from \`@\` (currently \`185.199.108.153\`, \`185.199.109.153\`, \`185.199.110.153\`, and \`185.199.111.153\`) once you are ready for \`adi.rest\` to serve the Vercel deployment. Do not remove MX, TXT, or unrelated subdomain records. Set the \`ping\` CNAME to DNS only (Cloudflare proxy off) while verifying Vercel.

Vercel's project domain settings show the exact current records. DNS changes can take time to propagate.

## 3. Install Arduino libraries

1. Install Arduino IDE 2.
2. In Boards Manager, install **Arduino UNO R4 Boards** by Arduino.
3. In Library Manager, install **ArduinoHttpClient** by Arduino.
4. Select **Arduino UNO R4 WiFi** under Tools → Board.

The \`WiFiS3\` and \`WiFiSSLClient\` libraries come with the UNO R4 board package. The board's Wi-Fi firmware includes a root CA bundle used by its SSL client.

## 4. Add the credentials locally

1. Open \`arduino/nerds-pinger/nerds-pinger.ino\`.
2. Copy \`arduino_secrets.h.example\` in the same folder and name the copy \`arduino_secrets.h\`.
3. Set \`SECRET_SSID\` and \`SECRET_PASS\` to your Wi-Fi credentials.
4. Set \`SECRET_DEVICE_TOKEN\` to the value of the Vercel \`ARDUINO_PING_TOKEN\` environment variable supplied separately. Do not upload this secrets file to GitHub.

## 5. Upload and test

1. Connect the UNO R4 WiFi to your computer over USB.
2. Select its serial port under Tools → Port.
3. Upload the sketch.
4. Open Serial Monitor at **115200 baud**.

Every minute it should print the HTTP status and response time from \`adi.rest\`, followed by the response status from \`ping.adi.rest\`. A successful report returns HTTP 200.

Check the latest stored probe status at:

\`https://ping.adi.rest/api/arduino\`

The GET response is read-only. It reports \`status\`, \`lastSeen\`, \`latencyMs\`, \`lastHttpStatus\`, and \`stale\`.

## 6. Scheduling note

The connected Vercel team is on the Hobby plan. Its Cron Jobs can run only once per day, so \`vercel.json\` uses a daily schedule. The Arduino itself still checks and reports every 60 seconds. On a Vercel Pro or Enterprise plan, the cron schedule can be changed to \`* * * * *\` for one-minute server-side checks as well.

The Arduino is an independent probe, not the server hosting the status site. It can continue detecting outages even when the Nerds page is not open, provided the board has power and internet access.
