import { json } from "@sveltejs/kit";
import { saveChecks, readChecks } from "$lib/server/monitoring-db.js";

export const prerender = false;

const DEVICE_ID = "arduino-r4-wifi";
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function authorized(request) {
  const expected = process.env.ARDUINO_PING_TOKEN;
  const supplied = request.headers.get("x-device-token");
  return Boolean(expected && supplied && supplied.length === expected.length &&
    // Constant-time comparison without external dependencies.
    [...expected].reduce((diff, char, i) =>
      diff | (char.charCodeAt(0) ^ supplied.charCodeAt(i)), 0) === 0);
}

export async function GET() {
  try {
    const records = await readChecks({ serviceId: DEVICE_ID, since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), limit: 10000 });
    const latest = records.at(-1) ?? null;
    const stale = !latest || Date.now() - Date.parse(latest.timestamp) > 3 * 60 * 1000;
    return json({
      ok: true,
      device: DEVICE_ID,
      status: stale ? "unknown" : latest.status,
      lastSeen: latest?.timestamp ?? null,
      latencyMs: latest?.responseTimeMs ?? null,
      lastHttpStatus: latest?.statusCode ?? null,
      stale
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Arduino status read failed:", error);
    return json({ ok: false, error: "status_unavailable" }, { status: 503 });
  }
}

export async function POST({ request }) {
  if (!authorized(request)) return json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const timestamp = typeof body.timestamp === "string" ? new Date(body.timestamp) : new Date();
  const statusCode = Number(body.statusCode);
  const responseTimeMs = Number(body.responseTimeMs);
  const success = body.success === true;

  if (!Number.isFinite(timestamp.getTime()) ||
      Math.abs(Date.now() - timestamp.getTime()) > MAX_CLOCK_SKEW_MS ||
      !Number.isInteger(statusCode) || statusCode < 0 || statusCode > 599 ||
      !Number.isFinite(responseTimeMs) || responseTimeMs < 0 || responseTimeMs > 120000) {
    return json({ ok: false, error: "invalid_measurement" }, { status: 422 });
  }

  const status = !success ? "down" : responseTimeMs >= 1500 ? "degraded" : "up";
  try {
    await saveChecks([{
      serviceId: DEVICE_ID,
      serviceName: "Arduino R4 WiFi probe",
      serviceUrl: "https://adi.rest",
      finalUrl: "https://adi.rest",
      timestamp: timestamp.toISOString(),
      statusCode,
      responseTimeMs,
      success,
      status,
      errorCategory: success ? null : "probe",
      error: success ? null : "Arduino reported a failed check"
    }]);

    return json({ ok: true, device: DEVICE_ID, status, receivedAt: new Date().toISOString() }, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    console.error("Arduino heartbeat persistence failed:", error);
    return json({ ok: false, error: "storage_unavailable" }, { status: 503 });
  }
}
