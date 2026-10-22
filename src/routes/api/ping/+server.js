import config from "../../../../services.json";
import { saveChecks } from "../../../lib/server/monitoring-db.js";

export const prerender = false;

const STALE_AFTER_MS = Math.max(30000, config.staleAfterMs || 180000);

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
  if (criteria && (!payload || typeof payload !== "object" || Array.isArray(payload))) {
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
  const started = performance.now();
  const timestamp = new Date().toISOString();
  let statusCode = null;
  let error = null;
  let errorCategory = null;
  let finalUrl = service.url;

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
        if (new TextEncoder().encode(bodyText).byteLength > (service.maxBodyBytes || 1024 * 1024)) throw new Error("body_limit");
        payload = JSON.parse(bodyText);
      } catch (cause) {
        errorCategory = "payload";
        error = cause?.message === "body_limit" ? "API response body exceeded validation limit" : "API returned an invalid or unreadable JSON response";
      }
      if (!error) {
        const validationError = validatePayload(service, response, payload);
        if (validationError) {
          errorCategory = validationError.category;
          error = validationError.message;
        }
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
    id: service.id, name: service.name, description: service.description, url: service.url, finalUrl,
    status, statusLabel: ({ up: "Operational", degraded: "Degraded", down: "Outage" })[status],
    latest: { timestamp, statusCode, responseTimeMs, success, errorCategory, error },
    lastSuccessfulCheck: success ? timestamp : null,
    lastFailedCheck: success ? null : timestamp,
    stale: false
  };
}

export async function GET() {
  const checks = await Promise.all(config.services.map(check));
  let historyAvailable = false;
  try {
    await saveChecks(checks.map((service) => ({
      serviceId: service.id,
      serviceName: service.name,
      serviceUrl: service.url,
      finalUrl: service.finalUrl,
      timestamp: service.latest.timestamp,
      statusCode: service.latest.statusCode,
      responseTimeMs: service.latest.responseTimeMs,
      success: service.latest.success,
      status: service.status,
      errorCategory: service.latest.errorCategory,
      error: service.latest.error
    })));
    historyAvailable = true;
  } catch (cause) {
    console.error("Monitoring history could not be saved:", cause?.message || cause);
  }
  const updatedAt = checks.map((service) => service.latest.timestamp).sort().at(-1) || null;
  const stale = !updatedAt || Date.now() - Date.parse(updatedAt) > STALE_AFTER_MS;
  const down = checks.filter((service) => service.status === "down").length;
  const degraded = checks.some((service) => service.status === "degraded");
  const status = stale ? "unknown" : down === checks.length ? "down" : down ? "partial" : degraded ? "degraded" : "up";

  return new Response(JSON.stringify({
    status,
    message: ({
      up: "All Systems Operational",
      partial: "Partial Service Disruption",
      down: "Major Outage",
      degraded: "Degraded Performance",
      unknown: "Status Temporarily Unavailable"
    })[status],
    updatedAt,
    stale,
    liveOnly: !historyAvailable,
    historyAvailable,
    monitoringPolicy: {
      statefulHysteresisAvailable: false,
      note: "Consecutive-failure and recovery thresholds require persisted previous check results. Live-only checks do not claim to apply hysteresis."
    },
    services: checks.map((service) => stale ? { ...service, status: "unknown", statusLabel: "Unknown", stale: true } : service)
  }), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin"
    }
  });
}
