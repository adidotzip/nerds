import { lookup } from "node:dns/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const config = require("../services.json");

const services = config.services;
const statusNames = { up: "Operational", degraded: "Degraded", down: "Outage", unknown: "Unknown" };

async function checkService(service) {
  const timestamp = new Date().toISOString();
  const started = performance.now();
  let statusCode = null;
  let error = null;
  let errorCategory = null;
  try {
    const response = await fetch(service.url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(Math.min(service.timeoutMs || 4000, 4000)),
      headers: { "user-agent": "adi.rest-status/2.0 (+https://adi.rest)" }
    });
    statusCode = response.status;
    await response.body?.cancel().catch(() => {});
    const [min, max] = service.expectedStatus || [200, 299];
    if (statusCode < min || statusCode > max) {
      errorCategory = statusCode >= 500 ? "server" : "http";
      error = `Unexpected HTTP status ${statusCode}`;
    }
  } catch (cause) {
    const code = cause?.cause?.code || cause?.code || "";
    errorCategory = /timeout|ABORT_ERR/i.test(String(code) + " " + String(cause?.message)) ? "timeout"
      : ["ENOTFOUND", "EAI_AGAIN", "ENODATA"].includes(code) ? "dns"
      : ["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH"].includes(code) ? "connection"
      : "request";
    error = errorCategory === "timeout" ? "Request timed out"
      : errorCategory === "dns" ? "DNS lookup failed"
      : errorCategory === "connection" ? "Connection failed" : "Request failed";
  }
  const responseTimeMs = Math.round((performance.now() - started) * 100) / 100;
  const success = error === null;
  const status = !success ? "down" : responseTimeMs >= (service.degradedMs || config.latencyDegradedMs || 1500) ? "degraded" : "up";
  return {
    id: service.id, name: service.name, description: service.description, url: service.url,
    status, statusLabel: statusNames[status],
    latest: { timestamp, statusCode, responseTimeMs, success, errorCategory, error },
    lastSuccessfulCheck: success ? timestamp : null,
    lastFailedCheck: success ? null : timestamp,
    uptime: {}, history: [], dataPoints: 0
  };
}

async function domainHealth() {
  const host = "imreallyadi.space";
  const checkedAt = new Date().toISOString();
  let expirationDate = null;
  try {
    const response = await fetch(`https://rdap.org/domain/${host}`, {
      signal: AbortSignal.timeout(3000),
      headers: { accept: "application/rdap+json" }
    });
    if (response.ok) {
      const data = await response.json();
      const event = (data.events || []).find(item => ["expiration", "expiry"].includes(String(item.eventAction).toLowerCase()));
      if (event?.eventDate && Number.isFinite(Date.parse(event.eventDate))) expirationDate = new Date(event.eventDate).toISOString();
    }
  } catch {}
  const dns = await lookup(host).then(result => ({ ok: true, address: result.address })).catch(() => ({ ok: false, address: null }));
  let tls = { valid: false, expiresAt: null };
  try {
    const response = await fetch(`https://${host}/`, { signal: AbortSignal.timeout(5000), redirect: "follow" });
    tls = { valid: true, expiresAt: null };
    await response.body?.cancel().catch(() => {});
  } catch {}
  return {
    checkedAt, expirationDate,
    daysRemaining: expirationDate ? Math.ceil((Date.parse(expirationDate) - Date.now()) / 86400000) : null,
    dns, tls
  };
}

export default async function handler(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const url = new URL(req.url, "https://status.adi.rest");
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "api") return res.status(404).json({ error: "Not found" });

  if (parts[1] === "domain-health" && parts.length === 2) {
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json(await domainHealth());
  }
  if (parts[1] === "status" && parts.length === 2) {
    res.setHeader("Cache-Control", "public, s-maxage=15, stale-while-revalidate=15");
    const results = await Promise.all(services.map(checkService));
    const down = results.filter(item => item.status === "down").length;
    const degraded = results.some(item => item.status === "degraded");
    const unknown = results.some(item => item.status === "unknown");
    const status = unknown ? "unknown" : down === results.length ? "down" : down ? "partial" : degraded ? "degraded" : "up";
    return res.status(200).json({
      status,
      message: status === "up" ? "All Systems Operational" : status === "partial" ? "Partial Service Disruption" : status === "down" ? "Major Outage" : "Degraded Performance",
      updatedAt: new Date().toISOString(),
      services: results
    });
  }
  if (parts[1] === "status" && parts.length === 3) {
    res.setHeader("Cache-Control", "public, s-maxage=15, stale-while-revalidate=15");
    const service = services.find(item => item.id === parts[2]);
    if (!service) return res.status(404).json({ error: "Service not found" });
    return res.status(200).json(await checkService(service));
  }
  return res.status(404).json({ error: "Not found" });
}
