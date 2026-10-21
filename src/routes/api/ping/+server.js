import config from "../../../../services.json";

export const prerender = false;

async function check(service) {
  const started = performance.now();
  const timestamp = new Date().toISOString();
  let statusCode = null;
  let error = null;
  let errorCategory = null;

  try {
    const response = await fetch(service.url, {
      method: "GET",
      redirect: "follow",
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
    const code = cause?.cause?.code || cause?.code || "";
    const detail = `${code} ${cause?.message || ""}`;
    errorCategory = /timeout|abort/i.test(detail) ? "timeout"
      : /ENOTFOUND|EAI_AGAIN|ENODATA/i.test(detail) ? "dns"
      : /ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH/i.test(detail) ? "connection"
      : "request";
    error = errorCategory === "timeout" ? "Request timed out"
      : errorCategory === "dns" ? "DNS lookup failed"
      : errorCategory === "connection" ? "Connection failed"
      : "Request failed";
  }

  const responseTimeMs = Math.round((performance.now() - started) * 100) / 100;
  const success = error === null;
  const status = !success ? "down"
    : responseTimeMs >= (service.degradedMs || config.latencyDegradedMs || 1500) ? "degraded"
    : "up";

  return {
    id: service.id,
    name: service.name,
    description: service.description,
    url: service.url,
    status,
    statusLabel: ({ up: "Operational", degraded: "Degraded", down: "Outage" })[status],
    latest: { timestamp, statusCode, responseTimeMs, success, errorCategory, error },
    lastSuccessfulCheck: success ? timestamp : null,
    lastFailedCheck: success ? null : timestamp
  };
}

export async function GET() {
  const checks = await Promise.all(config.services.map(check));
  const down = checks.filter((service) => service.status === "down").length;
  const degraded = checks.some((service) => service.status === "degraded");
  const status = down === checks.length ? "down" : down ? "partial" : degraded ? "degraded" : "up";
  const updatedAt = checks.reduce((latest, service) =>
    !latest || service.latest.timestamp > latest ? service.latest.timestamp : latest, null);

  return new Response(JSON.stringify({
    status,
    message: ({ up: "All Systems Operational", partial: "Partial Service Disruption", down: "Major Outage", degraded: "Degraded Performance" })[status],
    updatedAt,
    liveOnly: true,
    historyAvailable: false,
    services: checks
  }), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY"
    }
  });
}
