import config from "../services.json";
import { list, put } from "@vercel/blob";

const services = config.services;
const token = () => process.env.BLOB_READ_WRITE_TOKEN;
const validPeriods = ["24h", "7d", "30d"];

function headers(res, cache = "no-store") {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cache-Control", cache);
}
function send(res, status, body) { return res.status(status).json(body); }
function safePeriod(value) { return validPeriods.includes(value) ? value : "24h"; }
function cutoff(period) { return Date.now() - (period === "7d" ? 7 : period === "30d" ? 30 : 1) * 86400000; }

async function check(service) {
  const timestamp = new Date().toISOString();
  const started = performance.now();
  let statusCode = null, error = null, errorCategory = null;
  try {
    const response = await fetch(service.url, {
      method: "GET", redirect: "follow",
      signal: AbortSignal.timeout(Math.min(service.timeoutMs || 10000, 10000)),
      headers: { "user-agent": "adi.rest-status/4.0" }
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
  const responseTimeMs = Math.round((performance.now() - started) * 100) / 100;
  const success = error === null;
  const status = !success ? "down"
    : responseTimeMs >= (service.degradedMs || config.latencyDegradedMs || 1500) ? "degraded" : "up";
  return { serviceId: service.id, serviceName: service.name, serviceUrl: service.url, timestamp, statusCode, responseTimeMs, success, status, errorCategory, error };
}

async function saveChecks(records) {
  if (!token()) throw new Error("BLOB_READ_WRITE_TOKEN is not configured");
  const date = new Date().toISOString().slice(0, 10);
  for (const service of services) {
    const pathname = `history/${service.id}/${date}.jsonl`;
    const result = await list({ prefix: pathname, limit: 10, token: token() });
    const blob = result.blobs.find((item) => item.pathname === pathname);
    let previous = "";
    if (blob) {
      const response = await fetch(blob.url, { cache: "no-store" });
      if (!response.ok) throw new Error(`Unable to read existing history for ${service.id}`);
      previous = await response.text();
    }
    const record = records.find((item) => item.serviceId === service.id);
    if (!record) continue;
    await put(pathname, previous + JSON.stringify(record) + "\n", {
      access: "public", addRandomSuffix: false, allowOverwrite: true,
      contentType: "application/x-ndjson", token: token()
    });
  }
}

async function historyFor(serviceId, period) {
  if (!token()) throw new Error("BLOB_READ_WRITE_TOKEN is not configured");
  const start = cutoff(period);
  const result = await list({ prefix: `history/${serviceId}/`, limit: 100, token: token() });
  const records = [];
  for (const blob of result.blobs) {
    const day = blob.pathname.split("/").at(-1)?.replace(/\.jsonl$/, "");
    if (!day || Date.parse(day + "T23:59:59.999Z") < start) continue;
    const response = await fetch(blob.url, { cache: "no-store" });
    if (!response.ok) continue;
    for (const line of (await response.text()).split("\n")) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line);
        if (Date.parse(item.timestamp) >= start) records.push(item);
      } catch { /* Ignore corrupt lines without inventing replacement data. */ }
    }
  }
  return records.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

function stats(records) {
  if (!records.length) return { percentage: null, averageResponseTimeMs: null, successfulChecks: 0, failedChecks: 0, totalChecks: 0 };
  const successful = records.filter((item) => item.success);
  return {
    percentage: Math.round(successful.length / records.length * 10000) / 100,
    averageResponseTimeMs: successful.length ? Math.round(successful.reduce((sum, item) => sum + item.responseTimeMs, 0) / successful.length * 100) / 100 : null,
    successfulChecks: successful.length, failedChecks: records.length - successful.length, totalChecks: records.length
  };
}
function view(service, record) {
  return {
    id: service.id, name: service.name, description: service.description, url: service.url,
    status: record.status,
    statusLabel: ({ up: "Operational", degraded: "Degraded", down: "Outage" })[record.status],
    latest: { timestamp: record.timestamp, statusCode: record.statusCode, responseTimeMs: record.responseTimeMs, success: record.success, errorCategory: record.errorCategory, error: record.error },
    lastSuccessfulCheck: record.success ? record.timestamp : null,
    lastFailedCheck: record.success ? null : record.timestamp
  };
}
function summary(views) {
  const down = views.filter((item) => item.status === "down").length;
  const degraded = views.some((item) => item.status === "degraded");
  const status = down === views.length ? "down" : down ? "partial" : degraded ? "degraded" : "up";
  return { status, message: ({ up: "All Systems Operational", partial: "Partial Service Disruption", down: "Major Outage", degraded: "Degraded Performance" })[status] };
}
async function domainHealth() {
  const host = "imreallyadi.space";
  const expirationDate = "2026-12-25T00:00:00.000Z";
  const dns = await fetch("https://dns.google/resolve?name=" + encodeURIComponent(host) + "&type=A", { signal: AbortSignal.timeout(4000) })
    .then(async (response) => {
      if (!response.ok) throw new Error("DNS query failed");
      const data = await response.json();
      const answer = data.Answer?.find((item) => item.type === 1);
      return { ok: Boolean(answer), address: answer?.data || null };
    }).catch(() => ({ ok: false, address: null }));
  let tls = { valid: false, expiresAt: null };
  try {
    const response = await fetch("https://" + host + "/", { signal: AbortSignal.timeout(5000), redirect: "follow" });
    tls = { valid: response.ok, expiresAt: null };
    await response.body?.cancel().catch(() => {});
  } catch {}
  return { checkedAt: new Date().toISOString(), expirationDate, expirationSource: "configured", daysRemaining: Math.ceil((Date.parse(expirationDate) - Date.now()) / 86400000), dns, tls };
}

export default async function handler(req, res) {
  headers(res);
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return send(res, 405, { error: "Method not allowed" }); }
  const url = new URL(req.url, "https://status.adi.rest");
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "api") return send(res, 404, { error: "Not found" });

  if (parts[1] === "cron" && parts[2] === "check" && parts.length === 3) {
    if (!process.env.CRON_SECRET) return send(res, 503, { error: "CRON_SECRET is not configured" });
    if (req.headers.authorization !== "Bearer " + process.env.CRON_SECRET) return send(res, 401, { error: "Unauthorized" });
    try {
      const records = await Promise.all(services.map(check));
      await saveChecks(records);
      return send(res, 200, { recorded: records.length, checkedAt: new Date().toISOString() });
    } catch (error) {
      console.error("Scheduled monitoring failed:", error?.message || error);
      return send(res, 503, { error: "Checks ran, but history could not be saved. Check BLOB_READ_WRITE_TOKEN." });
    }
  }

  if (parts[1] === "ping" || (parts[1] === "status" && parts.length === 2)) {
    const records = await Promise.all(services.map(check));
    const views = records.map((record, index) => view(services[index], record));
    const result = summary(views);
    return send(res, 200, { ...result, updatedAt: records.map((item) => item.timestamp).sort().at(-1), liveOnly: true, historyAvailable: Boolean(token()), services: views });
  }

  if (parts[1] === "status" && parts.length === 3) {
    const service = services.find((item) => item.id === parts[2]);
    if (!service) return send(res, 404, { error: "Service not found" });
    try {
      const records = await historyFor(service.id, "24h");
      const latest = records.at(-1);
      if (!latest || Date.now() - Date.parse(latest.timestamp) > 180000) return send(res, 200, { id: service.id, name: service.name, description: service.description, url: service.url, status: "unknown", statusLabel: "Unknown", latest: null });
      return send(res, 200, view(service, latest));
    } catch { return send(res, 503, { error: "Monitoring history is unavailable" }); }
  }

  if ((parts[1] === "history" || parts[1] === "uptime") && parts.length === 3) {
    const service = services.find((item) => item.id === parts[2]);
    if (!service) return send(res, 404, { error: "Service not found" });
    const period = safePeriod(url.searchParams.get("period"));
    try {
      const [h24, h7, h30] = await Promise.all([historyFor(service.id, "24h"), historyFor(service.id, "7d"), historyFor(service.id, "30d")]);
      const uptime = { "24h": stats(h24), "7d": stats(h7), "30d": stats(h30) };
      return send(res, 200, parts[1] === "uptime" ? { serviceId: service.id, uptime } : { serviceId: service.id, period, history: period === "7d" ? h7 : period === "30d" ? h30 : h24, uptime });
    } catch (error) {
      console.error("History unavailable:", error?.message || error);
      return send(res, 503, { error: "Monitoring history is unavailable. Configure Vercel Blob storage." });
    }
  }

  if (parts[1] === "incidents" && parts.length === 2) {
    const period = safePeriod(url.searchParams.get("period"));
    try {
      const groups = await Promise.all(services.map((service) => historyFor(service.id, period)));
      const incidents = groups.flat().filter((item) => !item.success).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0, 100);
      return send(res, 200, { period, incidents });
    } catch { return send(res, 503, { error: "Incident history is unavailable. Configure Vercel Blob storage." }); }
  }

  if (parts[1] === "domain-health" && parts.length === 2) return send(res, 200, await domainHealth());
  return send(res, 404, { error: "Not found" });
}
