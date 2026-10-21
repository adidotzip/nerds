import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { config, storageDir, historyPath, incidentFile, readJsonLines } from "./monitor.mjs";

const ROOT = fileURLToPath(new URL(".", import.meta.url)), PUBLIC = join(ROOT, "public");
const PORT = Number(process.env.PORT || 3000), STALE_MS = (config.staleAfterSeconds || 180) * 1000;
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json; charset=utf-8" };
const periods = { "24h": 86400000, "7d": 7 * 86400000, "30d": 30 * 86400000 };
function json(res, status, data) { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=15, stale-while-revalidate=30", "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin", "x-frame-options": "DENY" }); res.end(JSON.stringify(data)); }
function statusLabel(status) { return ({ up: "Operational", degraded: "Degraded performance", down: "Outage", unknown: "Unknown" })[status] || "Unknown"; }
function serviceStatus(rows) {
  if (!rows.length) return "unknown";
  const latest = rows.at(-1);
  if (!latest?.timestamp || Date.now() - Date.parse(latest.timestamp) > STALE_MS) return "unknown";
  if (latest.success !== true) return "down";
  const service = config.services.find(s => s.id === latest.serviceId);
  if (latest.responseTimeMs != null && latest.responseTimeMs >= (service?.degradedMs || config.latencyDegradedMs || 1500)) return "degraded";
  return "up";
}
function uptime(rows, period) {
  const since = Date.now() - (periods[period] || periods["24h"]), relevant = rows.filter(row => Date.parse(row.timestamp) >= since);
  if (!relevant.length) return { percentage: null, checks: 0, successfulChecks: 0, period, since: new Date(since).toISOString() };
  const ok = relevant.filter(row => row.success === true).length;
  return { percentage: Math.round(ok / relevant.length * 10000) / 100, checks: relevant.length, successfulChecks: ok, period, since: new Date(since).toISOString() };
}
async function getDomainHealth() {
  try { const data = JSON.parse(await readFile(join(storageDir, "domain-health.json"), "utf8")); return { ...data, stale: Date.now() - Date.parse(data.checkedAt) > 86400000 }; }
  catch {
    const configured = config.domainHealth?.["imreallyadi.space"];
    if (configured?.expirationDate && Number.isFinite(Date.parse(configured.expirationDate))) return { expirationDate: new Date(configured.expirationDate).toISOString(), expirationSource: "configured", daysRemaining: Math.ceil((Date.parse(configured.expirationDate) - Date.now()) / 86400000), stale: false };
    return { expirationDate: null, daysRemaining: null, stale: true };
  }
}
async function getServices(period = "24h", id = null) {
  const services = id ? config.services.filter(s => s.id === id) : config.services, results = [];
  for (const service of services) {
    let rows = [];
    try { rows = (await readJsonLines(historyPath(service.id))).filter(r => r.serviceId === service.id).sort((a,b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)); } catch {}
    const latest = rows.at(-1) || null, status = serviceStatus(rows);
    const stats = Object.fromEntries(Object.keys(periods).map(p => [p, uptime(rows, p)]));
    const recent = rows.filter(r => Date.parse(r.timestamp) >= Date.now() - (periods[period] || periods["24h"]));
    results.push({
      id: service.id, name: service.name, description: service.description, url: service.url, status, statusLabel: statusLabel(status),
      latest: latest ? { timestamp: latest.timestamp, statusCode: latest.statusCode, responseTimeMs: latest.responseTimeMs, success: latest.success, errorCategory: latest.errorCategory, error: latest.error } : null,
      lastSuccessfulCheck: [...rows].reverse().find(r => r.success)?.timestamp || null, lastFailedCheck: [...rows].reverse().find(r => !r.success)?.timestamp || null,
      uptime: stats, history: recent.slice(-500), availableSince: rows[0]?.timestamp || null, dataPoints: rows.length
    });
  }
  return results;
}
function aggregateStatus(services) {
  if (!services.length || services.some(s => s.status === "unknown")) return { status: "unknown", message: "Status Temporarily Unavailable" };
  const down = services.filter(s => s.status === "down").length, degraded = services.filter(s => s.status === "degraded").length;
  if (down === services.length) return { status: "down", message: "Major Outage" };
  if (down) return { status: "partial", message: "Partial Service Disruption" };
  if (degraded) return { status: "degraded", message: "Degraded Performance" };
  return { status: "up", message: "All Systems Operational" };
}
async function lastRefresh() {
  let latest = null;
  for (const service of config.services) { try { const stamp = (await readJsonLines(historyPath(service.id))).at(-1)?.timestamp; if (stamp && (!latest || Date.parse(stamp) > Date.parse(latest))) latest = stamp; } catch {} }
  return latest;
}
async function endpoint(pathname, url, res) {
  if (pathname === "/api/status") { const services = await getServices("24h"); return json(res, 200, { ...aggregateStatus(services), updatedAt: await lastRefresh(), services }); }
  if (pathname === "/api/incidents") { try { return json(res, 200, { incidents: (await readJsonLines(incidentFile)).slice(-100).reverse() }); } catch { return json(res, 200, { incidents: [] }); } }
  if (pathname === "/api/domain-health") return json(res, 200, await getDomainHealth());
  let match = pathname.match(/^\/api\/status\/([a-z0-9-]+)$/);
  if (match) { const services = await getServices("24h", match[1]); return services.length ? json(res, 200, services[0]) : json(res, 404, { error: "Service not found" }); }
  match = pathname.match(/^\/api\/(uptime|history)\/([a-z0-9-]+)$/);
  if (match) {
    const period = url.searchParams.get("period") || (match[1] === "history" ? "24h" : "30d");
    if (!periods[period]) return json(res, 400, { error: "period must be 24h, 7d, or 30d" });
    const services = await getServices(period, match[2]);
    if (!services.length) return json(res, 404, { error: "Service not found" });
    const s = services[0];
    return json(res, 200, match[1] === "uptime" ? { serviceId: s.id, period, uptime: s.uptime[period] } : { serviceId: s.id, period, history: s.history });
  }
  return json(res, 404, { error: "Not found" });
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (req.method === "GET" && url.pathname.startsWith("/api/")) return await endpoint(url.pathname, url, res);
    if (!["GET", "HEAD"].includes(req.method)) return json(res, 405, { error: "Method not allowed" });
    const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const target = resolve(PUBLIC, requested);
    if (!target.startsWith(PUBLIC + "/")) return json(res, 403, { error: "Forbidden" });
    let info; try { info = await stat(target); } catch { return json(res, 404, { error: "Not found" }); }
    if (!info.isFile()) return json(res, 404, { error: "Not found" });
    const body = await readFile(target);
    res.writeHead(200, {
      "content-type": MIME[extname(target)] || "application/octet-stream",
      "cache-control": extname(target) === ".html" ? "no-cache" : "public, max-age=3600",
      "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin", "x-frame-options": "DENY",
      "content-security-policy": "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"
    });
    if (req.method === "HEAD") return res.end();
    return res.end(body);
  } catch { if (!res.headersSent) json(res, 500, { error: "Internal server error" }); else res.end(); }
});
server.listen(PORT, () => console.log(`adi.rest status listening on :${PORT}`));
