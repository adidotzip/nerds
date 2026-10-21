import { readFile, appendFile, mkdir, rename, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { lookup } from "node:dns/promises";
import tls from "node:tls";

const configPath = resolve(process.env.STATUS_CONFIG || "./services.json");
const config = JSON.parse(await readFile(configPath, "utf8"));
const storageDir = resolve(process.env.STATUS_DATA_DIR || config.storageDir || "./data");
const historyDir = join(storageDir, "history");
const incidentFile = join(storageDir, "incidents.jsonl");
const lockFile = join(storageDir, ".monitor.lock");
let running = false;

const nowIso = () => new Date().toISOString();
const historyPath = (id) => join(historyDir, `${id}.jsonl`);
const safeId = (id) => /^[a-z0-9-]+$/.test(id);

async function acquireLock() {
  try {
    const { open } = await import("node:fs/promises");
    const handle = await open(lockFile, "wx");
    await handle.writeFile(JSON.stringify({ pid: process.pid, at: nowIso() }));
    return async () => { await handle.close(); await import("node:fs/promises").then(fs => fs.unlink(lockFile).catch(() => {})); };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    try {
      const age = Date.now() - (await stat(lockFile)).mtimeMs;
      if (age > 120_000) {
        const fs = await import("node:fs/promises");
        await fs.unlink(lockFile).catch(() => {});
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
  const timestamp = nowIso();
  const start = performance.now();
  let statusCode = null;
  let responseTimeMs = null;
  let error = null;
  let category = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), service.timeoutMs || config.requestTimeoutMs || 10000);
    try {
      const response = await fetch(service.url, {
        method: "GET",
        redirect: service.followRedirects === false ? "manual" : "follow",
        signal: controller.signal,
        headers: { "user-agent": "adi.rest-status/1.0 (+https://adi.rest)" }
      });
      statusCode = response.status;
      responseTimeMs = Math.round((performance.now() - start) * 100) / 100;
      await response.body?.cancel().catch(() => {});
      const criteria = service.expectedStatus || [200, 299];
      const min = Array.isArray(criteria) ? criteria[0] : 200;
      const max = Array.isArray(criteria) ? criteria[1] : 299;
      if (statusCode < min || statusCode > max) {
        category = statusCode >= 500 ? "server" : "http";
        error = `Unexpected HTTP status ${statusCode}`;
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    responseTimeMs = Math.round((performance.now() - start) * 100) / 100;
    category = errorCategory(e);
    error = category === "timeout" ? "Request timed out" : category === "dns" ? "DNS lookup failed" : category === "tls" ? "TLS validation failed" : category === "connection" ? "Connection failed" : "Request failed";
  }
  return {
    timestamp, serviceId: service.id, statusCode, responseTimeMs,
    success: error === null, errorCategory: category, error
  };
}

async function readJsonLines(path) {
  try {
    const content = await readFile(path, "utf8");
    const rows = [];
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try { rows.push(JSON.parse(line)); } catch { /* Ignore a partial/corrupt record, never invent a replacement. */ }
    }
    return rows;
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}

async function appendRecord(path, record) {
  await appendFile(path, JSON.stringify(record) + "\n", { encoding: "utf8", mode: 0o600 });
}

async function pruneHistory(path, cutoff) {
  const rows = await readJsonLines(path);
  const keep = rows.filter(row => Date.parse(row.timestamp) >= cutoff);
  if (keep.length !== rows.length) {
    const temp = `${path}.${process.pid}.tmp`;
    await import("node:fs/promises").then(fs => fs.writeFile(temp, keep.map(row => JSON.stringify(row)).join("\n") + (keep.length ? "\n" : ""), { mode: 0o600 }));
    await rename(temp, path);
  }
}

async function appendIncident(service, event, check) {
  await appendRecord(incidentFile, {
    timestamp: check.timestamp, serviceId: service.id, serviceName: service.name,
    event, statusCode: check.statusCode, responseTimeMs: check.responseTimeMs,
    errorCategory: check.errorCategory
  });
}

async function runChecks() {
  if (running) return { skipped: true, reason: "previous check still running" };
  running = true;
  // Create the storage directory before creating the lock file on a fresh install.
  await mkdir(storageDir, { recursive: true, mode: 0o700 });
  const release = await acquireLock();
  if (!release) {
    running = false;
    return { skipped: true, reason: "another worker holds the file lock" };
  }
  try {
    await mkdir(historyDir, { recursive: true, mode: 0o700 });
    const cutoff = Date.now() - (config.historyRetentionDays || 30) * 86400_000;
    const summary = [];
    for (const service of config.services) {
      if (!safeId(service.id)) throw new Error(`Invalid service id: ${service.id}`);
      const rows = await readJsonLines(historyPath(service.id));
      const prior = rows.filter(r => r.serviceId === service.id).at(-1);
      const check = await checkService(service);
      await appendRecord(historyPath(service.id), check);
      const recentRows = [...rows, check].slice(-(config.failureThreshold || 2));
      const threshold = config.failureThreshold || 2;
      const nowDown = recentRows.length >= threshold && recentRows.every(r => r.success === false);
      const wasDown = rows.slice(-threshold).length >= threshold && rows.slice(-threshold).every(r => r.success === false);
      if (nowDown && !wasDown) await appendIncident(service, "outage_started", check);
      if (check.success && prior && prior.success === false && wasDown) await appendIncident(service, "service_recovered", check);
      summary.push({ serviceId: service.id, success: check.success, responseTimeMs: check.responseTimeMs, statusCode: check.statusCode });
      await pruneHistory(historyPath(service.id), cutoff);
    }
    await pruneHistory(incidentFile, cutoff);
    await updateDomainHealth().catch(() => {});
    return { checkedAt: nowIso(), results: summary };
  } finally {
    await release();
    running = false;
  }
}

async function updateDomainHealth() {
  const host = "imreallyadi.space";
  const item = config.domainHealth?.[host];
  if (!item) return;
  const file = join(storageDir, "domain-health.json");
  let expirationDate = item.expirationDate || null;
  let expirationSource = item.expirationDate ? "configured" : null;
  let rdapCheckedAt = nowIso();
  if (!expirationDate && item.expirationSource !== "manual-only") {
    try {
      const response = await fetch(`https://rdap.org/domain/${host}`, { signal: AbortSignal.timeout(5000), headers: { accept: "application/rdap+json" } });
      if (response.ok) {
        const data = await response.json();
        const event = (data.events || []).find(e => ["expiration", "expiry"].includes(String(e.eventAction).toLowerCase()));
        if (event?.eventDate && Number.isFinite(Date.parse(event.eventDate))) {
          expirationDate = new Date(event.eventDate).toISOString();
          expirationSource = "rdap";
        }
      }
    } catch {}
  }
  const dns = await lookup(host).then(x => ({ ok: true, address: x.address })).catch(() => ({ ok: false, address: null }));
  let tlsInfo = { valid: false, expiresAt: null };
  try {
    tlsInfo = await new Promise((resolveTls) => {
      const socket = tls.connect({ host, port: 443, servername: host, timeout: 4000 }, () => {
        const cert = socket.getPeerCertificate();
        resolveTls({ valid: socket.authorized, expiresAt: cert?.valid_to ? new Date(cert.valid_to).toISOString() : null });
        socket.end();
      });
      socket.on("error", () => resolveTls({ valid: false, expiresAt: null }));
      socket.on("timeout", () => { socket.destroy(); resolveTls({ valid: false, expiresAt: null }); });
    });
  } catch {}
  await import("node:fs/promises").then(fs => fs.writeFile(file, JSON.stringify({
    checkedAt: rdapCheckedAt, expirationDate, expirationSource,
    daysRemaining: expirationDate ? Math.ceil((Date.parse(expirationDate) - Date.now()) / 86400_000) : null,
    dns, tls: tlsInfo
  }, null, 2), { mode: 0o600 }));
}

async function main() {
  await mkdir(historyDir, { recursive: true, mode: 0o700 });
  const result = await runChecks();
  process.stdout.write(JSON.stringify(result) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

export { runChecks, checkService, config, storageDir, historyPath, incidentFile, readJsonLines };
