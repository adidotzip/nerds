import { readFile, appendFile, mkdir, rename, stat, open, unlink, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { lookup } from "node:dns/promises";
import tls from "node:tls";

const config = JSON.parse(await readFile(resolve(process.env.STATUS_CONFIG || "./services.json"), "utf8"));
const storageDir = resolve(process.env.STATUS_DATA_DIR || config.storageDir || "./data");
const historyDir = join(storageDir, "history"), incidentFile = join(storageDir, "incidents.jsonl"), lockFile = join(storageDir, ".monitor.lock");
let running = false;
const nowIso = () => new Date().toISOString();
const historyPath = id => join(historyDir, `${id}.jsonl`);
const safeId = id => /^[a-z0-9-]+$/.test(id);

async function acquireLock() {
  try {
    const handle = await open(lockFile, "wx", 0o600);
    await handle.writeFile(JSON.stringify({ pid: process.pid, at: nowIso() }));
    return async () => { await handle.close(); await unlink(lockFile).catch(() => {}); };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    try {
      if (Date.now() - (await stat(lockFile)).mtimeMs > 120000) {
        await unlink(lockFile).catch(() => {});
        return acquireLock();
      }
    } catch {}
    return null;
  }
}
function errorCategory(error) {
  const code = error?.cause?.code || error?.code || "";
  if (["ENOTFOUND", "EAI_AGAIN", "ENODATA"].includes(code)) return "dns";
  if (["CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "ERR_TLS_CERT_ALTNAME_INVALID"].includes(code) || String(code).startsWith("ERR_TLS")) return "tls";
  if (["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "ABORT_ERR"].includes(code) || /timeout/i.test(error?.message || "")) return "timeout";
  if (["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH"].includes(code)) return "connection";
  return "request";
}
async function checkService(service) {
  const timestamp = nowIso(), start = performance.now();
  let statusCode = null, responseTimeMs = null, error = null, category = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), service.timeoutMs || config.requestTimeoutMs || 10000);
    try {
      const response = await fetch(service.url, {
        method: "GET", redirect: service.followRedirects === false ? "manual" : "follow",
        signal: controller.signal, headers: { "user-agent": "adi.rest-status/1.0 (+https://adi.rest)" }
      });
      statusCode = response.status;
      responseTimeMs = Math.round((performance.now() - start) * 100) / 100;
      await response.body?.cancel().catch(() => {});
      const expected = service.expectedStatus || [200, 299], min = expected[0] ?? 200, max = expected[1] ?? 299;
      if (statusCode < min || statusCode > max) {
        category = statusCode >= 500 ? "server" : "http";
        error = `Unexpected HTTP status ${statusCode}`;
      }
    } finally { clearTimeout(timer); }
  } catch (e) {
    responseTimeMs = Math.round((performance.now() - start) * 100) / 100;
    category = errorCategory(e);
    error = category === "timeout" ? "Request timed out" : category === "dns" ? "DNS lookup failed" : category === "tls" ? "TLS validation failed" : category === "connection" ? "Connection failed" : "Request failed";
  }
  return { timestamp, serviceId: service.id, statusCode, responseTimeMs, success: error === null, errorCategory: category, error };
}
async function readJsonLines(path) {
  try {
    const rows = [];
    for (const line of (await readFile(path, "utf8")).split("\n")) {
      if (!line.trim()) continue;
      try { rows.push(JSON.parse(line)); } catch { /* Ignore partial/corrupt rows without inventing data. */ }
    }
    return rows;
  } catch (e) { if (e.code === "ENOENT") return []; throw e; }
}
async function appendRecord(path, record) { await appendFile(path, JSON.stringify(record) + "\n", { encoding: "utf8", mode: 0o600 }); }
async function pruneHistory(path, cutoff) {
  const rows = await readJsonLines(path), keep = rows.filter(row => Date.parse(row.timestamp) >= cutoff);
  if (keep.length !== rows.length) {
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, keep.map(row => JSON.stringify(row)).join("\n") + (keep.length ? "\n" : ""), { mode: 0o600 });
    await rename(temp, path);
  }
}
async function appendIncident(service, event, check) {
  await appendRecord(incidentFile, { timestamp: check.timestamp, serviceId: service.id, serviceName: service.name, event, statusCode: check.statusCode, responseTimeMs: check.responseTimeMs, errorCategory: check.errorCategory });
}
async function runChecks() {
  if (running) return { skipped: true, reason: "previous check still running" };
  running = true;
  const release = await acquireLock();
  if (!release) { running = false; return { skipped: true, reason: "another worker holds the file lock" }; }
  try {
    await mkdir(historyDir, { recursive: true, mode: 0o700 });
    const cutoff = Date.now() - (config.historyRetentionDays || 30) * 86400000, summary = [];
    for (const service of config.services) {
      if (!safeId(service.id)) throw new Error(`Invalid service id: ${service.id}`);
      const rows = await readJsonLines(historyPath(service.id)), threshold = config.failureThreshold || 2;
      const tail = rows.slice(-threshold), wasDown = tail.length >= threshold && tail.every(r => r.success === false);
      const check = await checkService(service);
      await appendRecord(historyPath(service.id), check);
      const after = [...rows, check].slice(-threshold), nowDown = after.length >= threshold && after.every(r => r.success === false);
      if (nowDown && !wasDown) await appendIncident(service, "outage_started", check);
      if (check.success && wasDown) await appendIncident(service, "service_recovered", check);
      summary.push({ serviceId: service.id, success: check.success, responseTimeMs: check.responseTimeMs, statusCode: check.statusCode });
      await pruneHistory(historyPath(service.id), cutoff);
    }
    await pruneHistory(incidentFile, cutoff);
    await updateDomainHealth().catch(() => {});
    return { checkedAt: nowIso(), results: summary };
  } finally { await release(); running = false; }
}
async function updateDomainHealth() {
  const host = "imreallyadi.space", item = config.domainHealth?.[host];
  if (!item) return;
  let expirationDate = item.expirationDate || null, expirationSource = item.expirationDate ? "configured" : null;
  const checkedAt = nowIso();
  if (!expirationDate && item.expirationSource !== "manual-only") {
    try {
      const response = await fetch(`https://rdap.org/domain/${host}`, { signal: AbortSignal.timeout(5000), headers: { accept: "application/rdap+json" } });
      if (response.ok) {
        const data = await response.json();
        const event = (data.events || []).find(e => ["expiration", "expiry"].includes(String(e.eventAction).toLowerCase()));
        if (event?.eventDate && Number.isFinite(Date.parse(event.eventDate))) { expirationDate = new Date(event.eventDate).toISOString(); expirationSource = "rdap"; }
      }
    } catch {}
  }
  const dns = await lookup(host).then(x => ({ ok: true, address: x.address })).catch(() => ({ ok: false, address: null }));
  const tlsInfo = await new Promise(resolveTls => {
    const socket = tls.connect({ host, port: 443, servername: host, timeout: 4000 }, () => {
      const cert = socket.getPeerCertificate();
      resolveTls({ valid: socket.authorized, expiresAt: cert?.valid_to ? new Date(cert.valid_to).toISOString() : null }); socket.end();
    });
    socket.on("error", () => resolveTls({ valid: false, expiresAt: null }));
    socket.on("timeout", () => { socket.destroy(); resolveTls({ valid: false, expiresAt: null }); });
  }).catch(() => ({ valid: false, expiresAt: null }));
  await writeFile(join(storageDir, "domain-health.json"), JSON.stringify({
    checkedAt, expirationDate, expirationSource,
    daysRemaining: expirationDate ? Math.ceil((Date.parse(expirationDate) - Date.now()) / 86400000) : null, dns, tls: tlsInfo
  }, null, 2), { mode: 0o600 });
}
async function main() {
  await mkdir(historyDir, { recursive: true, mode: 0o700 });
  process.stdout.write(JSON.stringify(await runChecks()) + "\n");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
export { runChecks, checkService, config, storageDir, historyPath, incidentFile, readJsonLines };
