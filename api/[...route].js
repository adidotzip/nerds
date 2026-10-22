import config from "../services.json";
import { readChecks, readRecentChecks, saveChecks } from "../src/lib/server/monitoring-db.js";

const services = config.services;
const validPeriods = ["24h", "7d", "30d"];
const STALE_AFTER_MS = Math.max(30000, config.staleAfterMs || 180000);

function headers(res, cache = "no-store") {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cache-Control", cache);
}
function send(res, status, body) { return res.status(status).json(body); }
function safePeriod(value) { return validPeriods.includes(value) ? value : "24h"; }
const PERIOD_MS = { "24h": 86400000, "7d": 604800000, "30d": 2592000000 };

async function persistChecks(records) {
  try { await saveChecks(records); return true; }
  catch (error) {
    console.error("Monitoring history could not be saved:", error?.message || error);
    return false;
  }
}

function makeIncidents(records) {
  const byService = new Map();
  for (const record of records) {
    if (!byService.has(record.serviceId)) byService.set(record.serviceId, []);
    byService.get(record.serviceId).push(record);
  }
  const incidents = [];
  for (const [serviceId, checks] of byService) {
    checks.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    let open = null;
    for (const record of checks) {
      if (record.status === "down" && !open) {
        open = {
          serviceId, serviceName: record.serviceName, timestamp: record.timestamp, startedAt: record.timestamp,
          lastFailureAt: record.timestamp, resolvedAt: null, status: "ongoing",
          errorCategory: record.errorCategory || null, error: record.error || null
        };
      } else if (record.status === "down" && open) {
        open.lastFailureAt = record.timestamp;
        open.errorCategory = record.errorCategory || open.errorCategory;
        open.error = record.error || open.error;
      } else if (record.status !== "down" && open) {
        open.resolvedAt = record.timestamp;
        open.status = "resolved";
        incidents.push(open);
        open = null;
      }
    }
    if (open) incidents.push(open);
  }
  return incidents.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

function classifyNetworkError(cause) {
  const detail = `${cause?.cause?.code || cause?.code || ""} ${cause?.message || ""}`;
  if (/timeout|abort|timed out/i.test(detail)) return ["timeout", "Request timed out"];
  if (/ENOTFOUND|EAI_AGAIN|ENODATA|DNS/i.test(detail)) return ["dns", "DNS lookup failed"];
  if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/i.test(detail)) return ["tls", "TLS certificate or handshake failed"];
  if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH/i.test(detail)) return ["connection", "Connection failed"];
  return ["request", "Request failed"];
}
function getJsonPath(value, path) {
  return path.split(".").reduce((current, key) => current && typeof current === "object" ? current[key] : undefined, value);
}
function validatePayload(service, response, payload) {
  const contentType = response.headers.get("content-type") || "";
  if (service.expectedContentType && !contentType.toLowerCase().includes(service.expectedContentType.toLowerCase())) {
    return { category: "content_type", message: `Expected content type ${service.expectedContentType}` };
  }
  const criteria = service.expectedJson;
  if (criteria && (payload === null || typeof payload !== "object" || Array.isArray(payload))) {
    return { category: "payload", message: "Expected a JSON object response" };
  }
  if (Array.isArray(criteria?.requiredAny) && criteria.requiredAny.length &&
      !criteria.requiredAny.some((key) => Object.hasOwn(payload, key))) {
    return { category: "payload", message: "API response is missing all recognized top-level fields" };
  }
  if (service.expectedJsonFields && service.expectedJsonFields.some((path) => {
    const value = getJsonPath(payload, path);
    return value === undefined || value === null;
  })) {
    return { category: "payload", message: "API health response is missing required fields" };
  }
  if (service.expectedJsonValues) {
    for (const [path, expected] of Object.entries(service.expectedJsonValues)) {
      if (JSON.stringify(getJsonPath(payload, path)) !== JSON.stringify(expected)) {
        return { category: "payload", message: "API health response did not match an expected field" };
      }
    }
  }
  const statusCriteria = service.expectedJsonStatusField;
  if (statusCriteria) {
    const value = getJsonPath(payload, statusCriteria.path);
    if (value !== undefined && !statusCriteria.acceptedValues.includes(String(value).toLowerCase())) {
      return { category: "payload", message: `API reported an unexpected ${statusCriteria.path} value` };
    }
  }
  return null;
}
async function check(service) {
  const timestamp = new Date().toISOString();
  const started = performance.now();
  let statusCode = null, error = null, errorCategory = null, finalUrl = service.url;
  try {
    const response = await fetch(service.url, {
      method: "GET",
      redirect: service.redirect === "manual" ? "manual" : service.redirect === "error" ? "error" : "follow",
      signal: AbortSignal.timeout(Math.min(service.timeoutMs || 10000, 15000)),
      headers: {
        "user-agent": "adi.rest-status/4.1",
        "accept": service.expectedContentType === "application/json" ? "application/json" : "*/*"
      }
    });
    statusCode = response.status;
    finalUrl = response.url || service.url;
    const [min, max] = service.expectedStatus || [200, 299];
    if (statusCode < min || statusCode > max) {
      errorCategory = statusCode >= 500 ? "server" : "http";
      error = `Unexpected HTTP status ${statusCode}`;
      await response.body?.cancel().catch(() => {});
    } else if (service.expectedContentType || service.expectedJson) {
      let payload = null;
      try {
        const bodyText = await response.text();
        if (bodyText.length > (service.maxBodyBytes || 1024 * 1024)) throw new Error("body_limit");
        if (service.expectedContentType === "application/json" || service.expectedJson) payload = JSON.parse(bodyText);
      } catch (cause) {
        errorCategory = "payload";
        error = cause?.message === "body_limit" ? "API response body exceeded validation limit" : "API returned an invalid or unreadable JSON response";
      }
      if (!error) {
        const validationError = validatePayload(service, response, payload);
        if (validationError) { errorCategory = validationError.category; error = validationError.message; }
      }
    } else {
      await response.body?.cancel().catch(() => {});
    }
  } catch (cause) {
    [errorCategory, error] = classifyNetworkError(cause);
  }
  const responseTimeMs = Math.round((performance.now() - started) * 100) / 100;
  const success = error === null;
  const status = !success ? "down"
    : responseTimeMs >= (service.degradedMs || config.latencyDegradedMs || 1500) ? "degraded" : "up";
  return {
    serviceId: service.id, serviceName: service.name, serviceUrl: service.url, finalUrl,
    timestamp, statusCode, responseTimeMs, success, status, errorCategory, error
  };
}
function view(service, record) {
  return {
    id: service.id, name: service.name, description: service.description, url: service.url,
    status: record.status,
    statusLabel: ({ up: "Operational", degraded: "Degraded", down: "Outage" })[record.status],
    latest: { timestamp: record.timestamp, statusCode: record.statusCode, responseTimeMs: record.responseTimeMs, success: record.success, errorCategory: record.errorCategory, error: record.error },
    lastSuccessfulCheck: record.success ? record.timestamp : null,
    lastFailedCheck: record.success ? null : record.timestamp,
    stale: Date.now() - Date.parse(record.timestamp) > STALE_AFTER_MS
  };
}
function summary(views) {
  if (views.some((item) => item.stale)) return { status: "unknown", message: "Status Temporarily Unavailable" };
  const down = views.filter((item) => item.status === "down").length;
  const degraded = views.some((item) => item.status === "degraded");
  const status = down === views.length ? "down" : down ? "partial" : degraded ? "degraded" : "up";
  return { status, message: ({ up: "All Systems Operational", partial: "Partial Service Disruption", down: "Major Outage", degraded: "Degraded Performance" })[status] };
}

export default async function handler(req, res) {
  headers(res);
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return send(res, 405, { error: "Method not allowed" }); }
  const url = new URL(req.url, "https://status.adi.rest");
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "api") return send(res, 404, { error: "Not found" });

  if (parts[1] === "ping" || (parts[1] === "status" && parts.length === 2)) {
    const records = await Promise.all(services.map(check));
    const historyAvailable = await persistChecks(records);
    const views = records.map((record, index) => view(services[index], record));
    const result = summary(views);
    return send(res, 200, {
      ...result,
      updatedAt: records.map((item) => item.timestamp).sort().at(-1),
      liveOnly: !historyAvailable,
      historyAvailable,
      services: views
    });
  }
  if (parts[1] === "status" && parts.length === 3) {
    const service = services.find((item) => item.id === parts[2]);
    if (!service) return send(res, 404, { error: "Service not found" });
    const record = await check(service);
    const historyAvailable = await persistChecks([record]);
    return send(res, 200, { ...view(service, record), historyAvailable });
  }
  if ((parts[1] === "history" || parts[1] === "uptime") && parts.length === 3) {
    const service = services.find((item) => item.id === parts[2]);
    if (!service) return send(res, 404, { error: "Service not found" });
    const period = safePeriod(url.searchParams.get("period"));
    try {
      const allRecords = await readChecks({ serviceId: service.id, since: new Date(Date.now() - PERIOD_MS["30d"]), limit: 50000 });
      const uptimeFor = (duration) => {
        const since = Date.now() - PERIOD_MS[duration];
        const subset = allRecords.filter((record) => Date.parse(record.timestamp) >= since);
        const successfulChecks = subset.filter((record) => record.success === true).length;
        const failedChecks = subset.filter((record) => record.success === false).length;
        const responseTimes = subset.map((record) => record.responseTimeMs).filter(Number.isFinite);
        return {
          percentage: successfulChecks > 0 && successfulChecks + failedChecks > 0
            ? Math.round(successfulChecks / (successfulChecks + failedChecks) * 10000) / 100
            : null,
          averageResponseTimeMs: responseTimes.length
            ? Math.round(responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length * 100) / 100
            : null,
          successfulChecks, failedChecks, totalChecks: successfulChecks + failedChecks
        };
      };
      const periodStart = Date.now() - PERIOD_MS[period];
      const periodRecords = allRecords.filter((record) => Date.parse(record.timestamp) >= periodStart);
      // Keep response payloads bounded while preserving real timestamped samples.
      const maxSamples = 3000;
      const history = periodRecords.length <= maxSamples ? periodRecords
        : Array.from({ length: maxSamples }, (_, index) => periodRecords[Math.floor(index * (periodRecords.length - 1) / (maxSamples - 1))]);
      const uptime = {
        "24h": uptimeFor("24h"),
        "7d": uptimeFor("7d"),
        "30d": uptimeFor("30d")
      };
      const successfulChecks = uptime[period].successfulChecks;
      const failedChecks = uptime[period].failedChecks;
      return send(res, 200, {
        serviceId: service.id, period, historyAvailable: true, history, uptime,
        coverage: periodRecords.length === 0 ? "collecting" : successfulChecks === 0 ? "outage-records-only" : "observed",
        message: periodRecords.length === 0
          ? "Collecting real monitoring data. No checks are available for this period yet."
          : successfulChecks === 0
            ? "Only actual outage checks are available after the history reset. Earlier uptime is unknown, not assumed."
            : "Statistics use recorded checks only. Missing intervals are not counted as successful."
      });
    } catch {
      return send(res, 503, {
        serviceId: service.id, period, historyAvailable: false, history: [],
        uptime: { "24h": { percentage: null }, "7d": { percentage: null }, "30d": { percentage: null } },
        message: "MongoDB history is unavailable. Configure MONGODB_URI in Netlify to enable history."
      });
    }
  }
  if (parts[1] === "incidents" && parts.length === 2) {
    const period = safePeriod(url.searchParams.get("period"));
    try {
      const records = await readRecentChecks(new Date(Date.now() - PERIOD_MS[period]));
      return send(res, 200, {
        historyAvailable: true, period, incidents: makeIncidents(records),
        message: "Incidents are derived from real recorded failed and successful checks. Missing start times are not invented."
      });
    } catch {
      return send(res, 503, { historyAvailable: false, period, incidents: [], message: "MongoDB history is unavailable. Configure MONGODB_URI in Netlify to enable incidents." });
    }
  }
  if (parts[1] === "domain-health" && parts.length === 2) {
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
      tls = { valid: response.status >= 200 && response.status < 400, expiresAt: null };
      await response.body?.cancel().catch(() => {});
    } catch {}
    return send(res, 200, { checkedAt: new Date().toISOString(), expirationDate, expirationSource: "configured", daysRemaining: Math.ceil((Date.parse(expirationDate) - Date.now()) / 86400000), dns, tls });
  }
  return send(res, 404, { error: "Not found" });
}
