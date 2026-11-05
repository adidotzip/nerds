import { json } from "@sveltejs/kit";
import config from "../../../../../services.json";
import { saveChecks } from "$lib/server/monitoring-db.js";

export const prerender = false;

export async function GET({ request }) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || authorization !== `Bearer ${secret}`) {
    return json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const results = await Promise.all(config.services.map(async (service) => {
    const started = performance.now();
    let statusCode = 0;
    let error = null;
    let errorCategory = null;
    try {
      const response = await fetch(service.url, {
        method: "GET",
        redirect: service.redirect === "manual" ? "manual" : service.redirect === "error" ? "error" : "follow",
        signal: AbortSignal.timeout(Math.min(service.timeoutMs || 10000, 15000)),
        headers: { "user-agent": "adi.rest-status/4.1", "accept": "*/*" }
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
      errorCategory = /timeout|abort/i.test(detail) ? "timeout" :
        /ENOTFOUND|EAI_AGAIN|DNS/i.test(detail) ? "dns" : "connection";
      error = "Request failed";
    }
    const responseTimeMs = Math.round((performance.now() - started) * 100) / 100;
    const success = error === null;
    const status = !success ? "down" :
      responseTimeMs >= (service.degradedMs || config.latencyDegradedMs || 1500) ? "degraded" : "up";
    return {
      serviceId: service.id,
      serviceName: service.name,
      serviceUrl: service.url,
      finalUrl: service.url,
      timestamp: new Date().toISOString(),
      statusCode,
      responseTimeMs,
      success,
      status,
      errorCategory,
      error
    };
  }));

  await saveChecks(results);
  return json({ ok: true, checked: results.length, updatedAt: new Date().toISOString() });
}
