import { json } from "@sveltejs/kit";
import config from "../../../../../services.json";
import { saveChecks } from "$lib/server/monitoring-db.js";

export const prerender = false;
export const maxDuration = 60;

function validateJson(service, response, payload) {
  const contentType = response.headers.get("content-type") || "";
  if (service.expectedContentType && !contentType.toLowerCase().includes(service.expectedContentType.toLowerCase())) {
    return { category: "content_type", message: `Expected content type ${service.expectedContentType}` };
  }
  const criteria = service.expectedJson;
  if (criteria && (!payload || typeof payload !== "object" || Array.isArray(payload))) {
    return { category: "payload", message: "Expected a JSON object response" };
  }
  if (criteria?.requiredAny?.length && !criteria.requiredAny.some((key) => Object.hasOwn(payload, key))) {
    return { category: "payload", message: "API response is missing recognized health fields" };
  }
  for (const path of service.expectedJsonFields || []) {
    const value = path.split(".").reduce((current, key) => current && typeof current === "object" ? current[key] : undefined, payload);
    if (value === undefined || value === null) return { category: "payload", message: "API health response is missing required fields" };
  }
  for (const [path, expected] of Object.entries(service.expectedJsonValues || {})) {
    const actual = path.split(".").reduce((current, key) => current && typeof current === "object" ? current[key] : undefined, payload);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      return { category: "payload", message: `API health field ${path} did not match the expected value` };
    }
  }
  return null;
}

function classifyError(cause) {
  const detail = `${cause?.cause?.code || cause?.code || ""} ${cause?.message || ""}`;
  if (/timeout|abort|timed out/i.test(detail)) return ["timeout", "Request timed out"];
  if (/ENOTFOUND|EAI_AGAIN|ENODATA|DNS/i.test(detail)) return ["dns", "DNS lookup failed"];
  if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/i.test(detail)) return ["tls", "TLS certificate or handshake failed"];
  if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH/i.test(detail)) return ["connection", "Connection failed"];
  return ["request", "Request failed"];
}

async function check(service) {
  const started = performance.now();
  const timestamp = new Date().toISOString();
  let statusCode = null;
  let finalUrl = service.url;
  let error = null;
  let errorCategory = null;
  try {
    const response = await fetch(service.url, {
      method: "GET",
      redirect: service.redirect === "manual" ? "manual" : service.redirect === "error" ? "error" : "follow",
      signal: AbortSignal.timeout(Math.min(service.timeoutMs || 10000, 20000)),
      headers: {
        "user-agent": "adi.rest-status/4.2",
        accept: service.expectedContentType === "application/json" ? "application/json" : "*/*"
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
      try {
        const body = await response.text();
        if (new TextEncoder().encode(body).byteLength > (service.maxBodyBytes || 1024 * 1024)) throw new Error("body_limit");
        const payload = service.expectedJson || service.expectedContentType === "application/json" ? JSON.parse(body) : null;
        const invalid = validateJson(service, response, payload);
        if (invalid) { errorCategory = invalid.category; error = invalid.message; }
      } catch (cause) {
        errorCategory = "payload";
        error = cause?.message === "body_limit" ? "API response body exceeded validation limit" : "API returned an invalid or unreadable JSON response";
      }
    } else {
      await response.body?.cancel().catch(() => {});
    }
  } catch (cause) {
    [errorCategory, error] = classifyError(cause);
  }

  const responseTimeMs = Math.round((performance.now() - started) * 100) / 100;
  const success = error === null;
  const status = !success ? "down" : responseTimeMs >= (service.degradedMs || config.latencyDegradedMs || 1500) ? "degraded" : "up";
  return {
    serviceId: service.id, serviceName: service.name, serviceUrl: service.url, finalUrl,
    timestamp, statusCode, responseTimeMs, success, status, errorCategory, error
  };
}

export async function GET({ request }) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const results = await Promise.all(config.services.map(check));
  try {
    await saveChecks(results);
  } catch (error) {
    console.error("Scheduled monitoring checks could not be saved:", error?.message || error);
    return json({ ok: false, error: "history_storage_unavailable", checked: results.length }, { status: 503 });
  }
  return json({
    ok: true, checked: results.length, updatedAt: new Date().toISOString(),
    results: results.map(({ serviceId, status, statusCode, responseTimeMs, errorCategory }) => ({
      serviceId, status, statusCode, responseTimeMs, errorCategory
    }))
  }, { headers: { "Cache-Control": "no-store" } });
}
