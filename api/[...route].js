import config from "../services.json";
import { MongoClient } from "mongodb";

const services = config.services;
const uri = process.env.mongo_MONGODB_URI || process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DATABASE || "adi_status";
let clientPromise = globalThis.__adiStatusMongo;
async function database() {
  if (!uri) throw new Error("MongoDB connection string is not configured");
  if (!clientPromise) {
    clientPromise = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, maxPoolSize: 5 }).connect();
    globalThis.__adiStatusMongo = clientPromise;
  }
  return (await clientPromise).db(dbName);
}
async function collection() {
  const c = (await database()).collection("checks");
  await c.createIndex({ serviceId: 1, timestamp: -1 });
  await c.createIndex({ createdAt: 1 }, { expireAfterSeconds: 7776000 });
  return c;
}
async function check(service) {
  const timestamp = new Date().toISOString(), started = performance.now();
  let statusCode = null, error = null, errorCategory = null;
  try {
    const response = await fetch(service.url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(Math.min(service.timeoutMs || 4000, 10000)), headers: { "user-agent": "adi.rest-status/3.0" } });
    statusCode = response.status;
    await response.body?.cancel().catch(() => {});
    const [min, max] = service.expectedStatus || [200, 299];
    if (statusCode < min || statusCode > max) {
      errorCategory = statusCode >= 500 ? "server" : "http";
      error = `Unexpected HTTP status ${statusCode}`;
    }
  } catch (e) {
    const code = e?.cause?.code || e?.code || "";
    errorCategory = /timeout|ABORT_ERR/i.test(String(code) + " " + String(e?.message)) ? "timeout"
      : ["ENOTFOUND", "EAI_AGAIN", "ENODATA"].includes(code) ? "dns"
      : ["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH"].includes(code) ? "connection" : "request";
    error = errorCategory === "timeout" ? "Request timed out" : errorCategory === "dns" ? "DNS lookup failed" : errorCategory === "connection" ? "Connection failed" : "Request failed";
  }
  const responseTimeMs = Math.round((performance.now() - started) * 100) / 100;
  const success = error === null;
  const status = !success ? "down" : responseTimeMs >= (service.degradedMs || config.latencyDegradedMs || 1500) ? "degraded" : "up";
  return { serviceId: service.id, serviceName: service.name, serviceUrl: service.url, timestamp, createdAt: new Date(timestamp), statusCode, responseTimeMs, success, status, errorCategory, error };
}
async function recordChecks() {
  const records = await Promise.all(services.map(check));
  if (records.length) await (await collection()).insertMany(records);
  return records;
}
async function latestResults() {
  const c = await collection();
  return Promise.all(services.map(async (s) => {
    const [record, good, bad] = await Promise.all([
      c.findOne({ serviceId: s.id }, { sort: { timestamp: -1 } }),
      c.findOne({ serviceId: s.id, success: true }, { sort: { timestamp: -1 }, projection: { timestamp: 1 } }),
      c.findOne({ serviceId: s.id, success: false }, { sort: { timestamp: -1 }, projection: { timestamp: 1 } })
    ]);
    const stale = !record || Date.now() - Date.parse(record.timestamp) > Number(process.env.MONITOR_STALE_AFTER_MS || 180000);
    const status = stale ? "unknown" : record.status;
    return { id: s.id, name: s.name, description: s.description, url: s.url, status,
      statusLabel: ({ up: "Operational", degraded: "Degraded", down: "Outage", unknown: "Unknown" })[status],
      latest: stale ? null : { timestamp: record.timestamp, statusCode: record.statusCode, responseTimeMs: record.responseTimeMs, success: record.success, errorCategory: record.errorCategory, error: record.error },
      lastSuccessfulCheck: good?.timestamp || null, lastFailedCheck: bad?.timestamp || null };
  }));
}
function start(period) { return Date.now() - (period === "7d" ? 604800000 : period === "30d" ? 2592000000 : 86400000); }
function stats(records, from) {
  const rows = records.filter(r => Date.parse(r.timestamp) >= from);
  if (!rows.length) return { percentage: null, averageResponseTimeMs: null, successfulChecks: 0, failedChecks: 0, totalChecks: 0 };
  const ok = rows.filter(r => r.success);
  return { percentage: Math.round(ok.length / rows.length * 10000) / 100,
    averageResponseTimeMs: ok.length ? Math.round(ok.reduce((sum, r) => sum + r.responseTimeMs, 0) / ok.length * 100) / 100 : null,
    successfulChecks: ok.length, failedChecks: rows.length - ok.length, totalChecks: rows.length };
}
async function domainHealth() {
  const host = "imreallyadi.space", checkedAt = new Date().toISOString(), expirationDate = "2026-12-25T00:00:00.000Z";
  const dns = await fetch("https://dns.google/resolve?name=" + encodeURIComponent(host) + "&type=A", { signal: AbortSignal.timeout(4000) })
    .then(async r => { if (!r.ok) throw new Error("DNS query failed"); const data = await r.json(); const answer = data.Answer?.find(item => item.type === 1); return { ok: Boolean(answer), address: answer?.data || null }; })
    .catch(() => ({ ok: false, address: null }));
  let tls = { valid: false, expiresAt: null };
  try { const r = await fetch("https://" + host + "/", { signal: AbortSignal.timeout(5000), redirect: "follow" }); tls = { valid: true, expiresAt: null }; await r.body?.cancel().catch(() => {}); } catch {}
  return { checkedAt, expirationDate, expirationSource: "configured", daysRemaining: Math.ceil((Date.parse(expirationDate) - Date.now()) / 86400000), dns, tls };
}
function headers(res, cache = "no-store") {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cache-Control", cache);
}
export default async function handler(req, res) {
  headers(res);
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "Method not allowed" }); }
  const url = new URL(req.url, "https://status.adi.rest"), parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "api") return res.status(404).json({ error: "Not found" });
  try {
    if (parts[1] === "cron" && parts[2] === "check" && parts.length === 3) {
      if (!process.env.CRON_SECRET) return res.status(503).json({ error: "CRON_SECRET is not configured" });
      if (req.headers.authorization !== "Bearer " + process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });
      const locks = (await database()).collection("monitor_locks"), now = new Date();
      const active = await locks.findOne({ _id: "check", expiresAt: { $gt: now } });
      if (active) return res.status(409).json({ skipped: true, reason: "Check already running" });
      await locks.updateOne({ _id: "check" }, { $set: { expiresAt: new Date(Date.now() + 55000), startedAt: now } }, { upsert: true });
      try { const rows = await recordChecks(); return res.status(200).json({ recorded: rows.length, checkedAt: new Date().toISOString() }); }
      finally { await locks.updateOne({ _id: "check" }, { $set: { expiresAt: new Date(0), completedAt: new Date() } }); }
    }
    if (parts[1] === "domain-health" && parts.length === 2) { headers(res, "public, s-maxage=300, stale-while-revalidate=600"); return res.status(200).json(await domainHealth()); }
    if (parts[1] === "status" && parts.length === 2) {
      let results = await latestResults();
      if (results.every(r => !r.latest)) { await recordChecks(); results = await latestResults(); }
      const unknown = results.some(r => r.status === "unknown"), down = results.filter(r => r.status === "down").length, degraded = results.some(r => r.status === "degraded");
      const status = unknown ? "unknown" : down === results.length ? "down" : down ? "partial" : degraded ? "degraded" : "up";
      const updatedAt = results.reduce((v, r) => r.latest?.timestamp && (!v || r.latest.timestamp > v) ? r.latest.timestamp : v, null);
      headers(res, "public, s-maxage=10, stale-while-revalidate=10");
      return res.status(200).json({ status, message: ({ up: "All Systems Operational", partial: "Partial Service Disruption", down: "Major Outage", degraded: "Degraded Performance", unknown: "Status Temporarily Unavailable" })[status], updatedAt, services: results });
    }
    if (parts[1] === "status" && parts.length === 3) {
      if (!services.some(s => s.id === parts[2])) return res.status(404).json({ error: "Service not found" });
      const result = (await latestResults()).find(r => r.id === parts[2]);
      headers(res, "public, s-maxage=10, stale-while-revalidate=10"); return res.status(200).json(result);
    }
    if ((parts[1] === "history" || parts[1] === "uptime") && parts.length === 3) {
      const service = services.find(s => s.id === parts[2]);
      if (!service) return res.status(404).json({ error: "Service not found" });
      const period = ["24h", "7d", "30d"].includes(url.searchParams.get("period")) ? url.searchParams.get("period") : "24h";
      const c = await collection(), all = await c.find({ serviceId: service.id, timestamp: { $gte: new Date(start("30d")).toISOString() } }, { projection: { _id: 0 } }).sort({ timestamp: 1 }).toArray();
      const uptime = { "24h": stats(all, start("24h")), "7d": stats(all, start("7d")), "30d": stats(all, start("30d")) };
      return res.status(200).json(parts[1] === "uptime" ? { serviceId: service.id, uptime } : { serviceId: service.id, period, history: all.filter(r => Date.parse(r.timestamp) >= start(period)), uptime });
    }
    if (parts[1] === "incidents" && parts.length === 2) {
      const period = ["24h", "7d", "30d"].includes(url.searchParams.get("period")) ? url.searchParams.get("period") : "24h";
      const records = await (await collection()).find({ success: false, timestamp: { $gte: new Date(start(period)).toISOString() } }, { projection: { _id: 0 } }).sort({ timestamp: -1 }).limit(100).toArray();
      return res.status(200).json({ period, incidents: records.map(r => ({ serviceId: r.serviceId, serviceName: r.serviceName, timestamp: r.timestamp, statusCode: r.statusCode, errorCategory: r.errorCategory, error: r.error })) });
    }
    return res.status(404).json({ error: "Not found" });
  } catch (error) {
    console.error("Status API error:", error?.message || error);
    return res.status(503).json({ error: "Monitoring data is temporarily unavailable", status: "unknown" });
  }
}
