const $ = (selector, root = document) => root.querySelector(selector);
const statusCopy = {
  up: ["All Systems Operational", "Everything is responding within its expected range."],
  partial: ["Partial Service Disruption", "Some services are currently unavailable."],
  degraded: ["Degraded Performance", "All monitored services are responding, but some are slower than usual."],
  down: ["Major Outage", "All monitored services are currently unavailable."],
  unknown: ["Status Temporarily Unavailable", "We don’t have fresh monitoring data for every service yet."]
};
const template = $("#service-template");
const formatLatency = value => Number.isFinite(value) ? `${Math.round(value)} ms` : "—";
const formatTime = value => value ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(value)) : "Not yet checked";
const formatDate = value => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Unknown";
function setStatus(element, status) { element.className = element.className.replace(/\b(up|degraded|down|unknown|partial)\b/g, "").trim() + " " + status; }
function uptimeText(stats) { return stats?.percentage == null ? (stats?.checks ? "Collecting data" : "No history yet") : `${stats.percentage.toFixed(2)}% · 24h uptime`; }
function renderService(service) {
  const node = template.content.firstElementChild.cloneNode(true);
  node.href = `/api/status/${encodeURIComponent(service.id)}`;
  node.setAttribute("aria-label", `${service.name}, ${service.statusLabel}. Open service JSON status`);
  $(".service-name", node).textContent = service.name; $(".service-description", node).textContent = service.description;
  $(".service-latency", node).textContent = formatLatency(service.latest?.responseTimeMs);
  $(".service-uptime", node).textContent = uptimeText(service.uptime?.["24h"]);
  const pill = $(".state-pill", node); setStatus(pill, service.status);
  $(".status-dot", pill).classList.add(service.status); $(".service-symbol .status-dot", node).classList.add(service.status);
  $(".state-pill span:last-child", node).textContent = service.statusLabel;
  const bars = $(".uptime-bars", node), recent = service.history || [], count = 30, slice = recent.slice(-count), pad = count - slice.length;
  for (let i = 0; i < count; i++) {
    const row = i < pad ? null : slice[i - pad], bar = document.createElement("span");
    bar.className = "uptime-bar " + (row ? (row.success ? (row.responseTimeMs >= 1500 ? "degraded" : "up") : "down") : "unknown");
    bar.tabIndex = 0;
    bar.title = row ? `${formatDate(row.timestamp)} · ${row.success ? "Success" : "Failure"} · ${formatLatency(row.responseTimeMs)}${row.statusCode ? " · HTTP " + row.statusCode : ""}` : "No recorded check";
    bar.setAttribute("aria-label", bar.title); bars.append(bar);
  }
  $(".uptime-label", node).textContent = slice.length ? "Recent checks" : "Awaiting checks";
  return node;
}
function renderStatus(data) {
  const status = data.status || "unknown", copy = statusCopy[status] || statusCopy.unknown;
  $("#overall-label").textContent = copy[0]; $("#overall-title").textContent = copy[0]; $("#overall-description").textContent = copy[1];
  setStatus($("#overall-dot"), status); $("#overall-dot").classList.add(status);
  $("#updated-at").textContent = data.updatedAt ? "Last check " + formatTime(data.updatedAt) : "Waiting for the first monitoring result";
  $("#footer-refresh").textContent = data.updatedAt ? "Updated " + formatTime(data.updatedAt) : "No monitoring data yet";
  $("#service-count").textContent = `${data.services.length} targets`;
  $("#services").replaceChildren(...data.services.map(renderService));
}
async function loadDomain() {
  try {
    const response = await fetch("/api/domain-health", { cache: "no-store" });
    if (!response.ok) throw new Error("No domain data");
    const data = await response.json();
    if (data.expirationDate && !data.stale) {
      const date = new Date(data.expirationDate), days = data.daysRemaining;
      $("#domain-title").textContent = "Registration expiration date found";
      $("#domain-description").textContent = `Reported expiration: ${date.toLocaleDateString(undefined, { dateStyle: "long", timeZone: "UTC" })}. This is separate from whether the website responds over HTTP.`;
      $("#domain-days").textContent = days < 0 ? "Past" : String(days);
      $("#domain-days-label").textContent = days < 0 ? "expiration date" : days === 1 ? "day remaining" : "days remaining";
    } else {
      $("#domain-title").textContent = "Expiration date not verified";
      $("#domain-description").textContent = "No trustworthy registration expiration date is available yet. Nothing is guessed or counted down from an unverified date.";
      $("#domain-days").textContent = "—"; $("#domain-days-label").textContent = "days remaining";
    }
    const dns = data.dns ? (data.dns.ok ? "DNS resolves" : "DNS lookup failed") : "DNS status unavailable";
    const tls = data.tls ? (data.tls.valid ? "HTTPS certificate valid" : "HTTPS certificate not validated") : "TLS status unavailable";
    const cert = data.tls?.expiresAt ? ` · certificate expires ${new Date(data.tls.expiresAt).toLocaleDateString()}` : "";
    $("#domain-meta").textContent = `${dns} · ${tls}${cert}${data.checkedAt ? " · Checked " + formatTime(data.checkedAt) : ""}`;
  } catch { $("#domain-title").textContent = "Expiration date not verified"; }
}
async function loadIncidents() {
  try {
    const response = await fetch("/api/incidents", { cache: "no-store" }), data = await response.json();
    const list = $("#incidents"); if (!data.incidents?.length) return;
    list.replaceChildren(...data.incidents.slice(0, 8).map(incident => {
      const item = document.createElement("div"); item.className = `incident-item ${incident.event}`;
      const icon = document.createElement("span"); icon.className = "incident-icon"; icon.textContent = incident.event === "service_recovered" ? "✓" : "!";
      const copy = document.createElement("div"), heading = document.createElement("div"); heading.className = "incident-title";
      heading.textContent = `${incident.event === "service_recovered" ? "Service recovered" : "Service outage detected"} · ${incident.serviceName}`;
      const description = document.createElement("div"); description.className = "incident-description";
      description.textContent = incident.statusCode ? `HTTP ${incident.statusCode}${incident.errorCategory ? " · " + incident.errorCategory : ""}` : incident.errorCategory || "Monitoring event";
      copy.append(heading, description);
      const time = document.createElement("time"); time.className = "incident-time"; time.dateTime = incident.timestamp; time.textContent = formatDate(incident.timestamp);
      item.append(icon, copy, time); return item;
    }));
  } catch { /* Keep an honest empty state when no event records exist. */ }
}
async function refresh() {
  try {
    const response = await fetch("/api/status", { cache: "no-store" }); if (!response.ok) throw new Error("Status request failed");
    renderStatus(await response.json());
  } catch {
    $("#overall-label").textContent = "Status Temporarily Unavailable"; $("#overall-title").textContent = "Status Temporarily Unavailable";
    $("#overall-description").textContent = "The status service could not be reached. Try again shortly."; $("#updated-at").textContent = "Live data unavailable";
    setStatus($("#overall-dot"), "unknown");
  }
  await Promise.all([loadDomain(), loadIncidents()]);
}
const themeToggle = $("#theme-toggle");
const savedTheme = (() => { try { return localStorage.getItem("adi-theme"); } catch { return null; } })();
if (savedTheme === "dark" || savedTheme === "light") document.documentElement.dataset.theme = savedTheme;
function updateThemeButton() { const dark = document.documentElement.dataset.theme === "dark"; themeToggle.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode"); themeToggle.title = dark ? "Switch to light mode" : "Switch to dark mode"; }
themeToggle.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = next;
  try { localStorage.setItem("adi-theme", next); } catch {}
  updateThemeButton();
});
updateThemeButton(); refresh(); setInterval(refresh, 30000);