import config from "./services.json";

const MAX_HISTORY_DAYS = 30;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS_HEADERS }
  });
}

function dateKey(value) {
  return new Date(value).toISOString().slice(0, 10);
}

async function check(service) {
  const timestamp = new Date().toISOString();
  const started = Date.now();
  let statusCode = null, error = null, errorCategory = null;
  try {
    const response = await fetch(service.url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(Math.min(service.timeoutMs || 10000, 10000)),
      headers: { "user-agent": "adi.rest-status-monitor/4.0" }
    });
    statusCode = response.status;
    await response.body?.cancel().catch(() => {});
    const [min, max] = service.expectedStatus || [200, 299];
    if (statusCode < min || statusCode > max) {
      errorCategory = statusCode >= 500 ? "server" : "http";
      error = `Unexpected HTTP status ${statusCode}`;
    }
  } catch (cause) {
    const detail = `${cause?.cause?.code || cause?.code || ""} ${cause?.message || ""}`;
    errorCategory = /timeout|abort/i.test(detail) ? "timeout"
      : /ENOTFOUND|EAI_AGAIN|ENODATA/i.test(detail) ? "dns"
      : /ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH/i.test(detail) ? "connection" : "request";
    error = errorCategory === "timeout" ? "Request timed out"
      : errorCategory === "dns" ? "DNS lookup failed"
      : errorCategory === "connection" ? "Connection failed" : "Request failed";
  }
  const responseTimeMs = Math.round((Date.now() - started) * 100) / 100;
  const success = error === null;
  const status = !success ? "down"
    : responseTimeMs >= (service.degradedMs || config.latencyDegradedMs || 1500) ? "degraded" : "up";
  return {
    serviceId: service.id, serviceName: service.name, serviceUrl: service.url,
    timestamp, statusCode, responseTimeMs, success, status, errorCategory, error
  };
}

async function storeCheck(bucket, record) {
  const key = `history/${record.serviceId}/${dateKey(record.timestamp)}.jsonl`;
  const previous = await bucket.get(key);
  const existing = previous ? await previous.text() : "";
  const next = existing + JSON.stringify(record) + "\n";
  await bucket.put(key, next, { httpMetadata: { contentType: "application/x-ndjson" } });
}

async function allHistory(bucket, serviceId, period) {
  const days = period === "7d" ? 7 : period === "30d" ? 30 : 1;
  const cutoff = Date.now() - days * 86400000;
  const listed = await bucket.list({ prefix: `history/${serviceId}/`, limit: 1000 });
  const selected = listed.objects.filter((object) => {
    const keyDate = object.key.split("/").at(-1)?.replace(/\.jsonl$/, "");
    return Date.parse(keyDate + "T00:00:00Z") >= Date.now() - MAX_HISTORY_DAYS * 86400000;
  });
  const rows = [];
  for (const object of selected) {
    const stored = await bucket.get(object.key);
    if (!stored) continue;
    const text = await stored.text();
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (Date.parse(row.timestamp) >= cutoff) rows.push(row);
      } catch {}
    }
  }
  return rows.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

function stats(rows) {
  if (!rows.length) return { percentage: null, averageResponseTimeMs: null, successfulChecks: 0, failedChecks: 0, totalChecks: 0 };
  const good = rows.filter((row) => row.success);
  return {
    percentage: Math.round(good.length / rows.length * 10000) / 100,
    averageResponseTimeMs: good.length ? Math.round(good.reduce((sum, row) => sum + row.responseTimeMs, 0) / good.length * 100) / 100 : null,
    successfulChecks: good.length, failedChecks: rows.length - good.length, totalChecks: rows.length
  };
}

export default {
  async scheduled(_controller, env, ctx) {
    if (!env.STATUS_HISTORY) throw new Error("Bind an R2 bucket as STATUS_HISTORY in wrangler.monitor.jsonc");
    const records = await Promise.all(config.services.map(check));
    ctx.waitUntil(Promise.all(records.map((record) => storeCheck(env.STATUS_HISTORY, record))));
  },

  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
    if (!env.STATUS_HISTORY) return json({ error: "Monitoring history storage is not configured" }, 503);

    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== "api") return json({ error: "Not found" }, 404);
    const period = ["24h", "7d", "30d"].includes(url.searchParams.get("period")) ? url.searchParams.get("period") : "24h";

    if (parts[1] === "status" && parts.length === 2) {
      const records = await Promise.all(config.services.map(async (service) => {
        const history = await allHistory(env.STATUS_HISTORY, service.id, "24h");
        const latest = history.at(-1) || null;
        const stale = !latest || Date.now() - Date.parse(latest.timestamp) > 180000;
        const status = stale ? "unknown" : latest.status;
        const good = history.filter((row) => row.success).at(-1);
        const bad = history.filter((row) => !row.success).at(-1);
        return {
          id: service.id, name: service.name, description: service.description, url: service.url,
          status, statusLabel: ({ up: "Operational", degraded: "Degraded", down: "Outage", unknown: "Unknown" })[status],
          latest: stale ? null : latest, lastSuccessfulCheck: good?.timestamp || null, lastFailedCheck: bad?.timestamp || null
        };
      }));
      const down = records.filter((row) => row.status === "down").length;
      const unknown = records.some((row) => row.status === "unknown");
      const degraded = records.some((row) => row.status === "degraded");
      const status = unknown ? "unknown" : down === records.length ? "down" : down ? "partial" : degraded ? "degraded" : "up";
      return json({ status, message: ({ up: "All Systems Operational", partial: "Partial Service Disruption", down: "Major Outage", degraded: "Degraded Performance", unknown: "Status Temporarily Unavailable" })[status], updatedAt: records.map((row) => row.latest?.timestamp).filter(Boolean).sort().at(-1) || null, historyAvailable: true, services: records });
    }

    if ((parts[1] === "history" || parts[1] === "uptime") && parts.length === 3) {
      const service = config.services.find((row) => row.id === parts[2]);
      if (!service) return json({ error: "Service not found" }, 404);
      const [h24, h7, h30] = await Promise.all([
        allHistory(env.STATUS_HISTORY, service.id, "24h"),
        allHistory(env.STATUS_HISTORY, service.id, "7d"),
        allHistory(env.STATUS_HISTORY, service.id, "30d")
      ]);
      const uptime = { "24h": stats(h24), "7d": stats(h7), "30d": stats(h30) };
      return json(parts[1] === "uptime" ? { serviceId: service.id, uptime } : { serviceId: service.id, period, history: period === "7d" ? h7 : period === "30d" ? h30 : h24, uptime });
    }

    if (parts[1] === "incidents" && parts.length === 2) {
      const rows = [];
      for (const service of config.services) {
        const history = await allHistory(env.STATUS_HISTORY, service.id, period);
        rows.push(...history.filter((row) => !row.success));
      }
      rows.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
      return json({ period, incidents: rows.slice(0, 100) });
    }
    return json({ error: "Not found" }, 404);
  }
};
