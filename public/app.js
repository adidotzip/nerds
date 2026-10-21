const $ = (selector, root = document) => root.querySelector(selector);
const statusCopy = {
  up: ["All Systems Operational", "Everything is responding within its expected range."],
  partial: ["Partial Service Disruption", "Some services are currently unavailable."],
  degraded: ["Degraded Performance", "All monitored services are responding, but some are slower than usual."],
  down: ["Major Outage", "All monitored services are currently unavailable."],
  unknown: ["Status Temporarily Unavailable", "We don’t have fresh monitoring data for every service yet."]
};
const labels = { up: "Operational", degraded: "Degraded", down: "Outage", unknown: "Unknown" };
const range = "24h";
const template = $("#service-template");
const formatLatency = (value) => Number.isFinite(value) ? `${Math.round(value)} ms` : "—";
const formatTime = (value) => value ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(value)) : "Not yet checked";
const formatDate = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Unknown";
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" })[c]);
function setStatus(element, status) { element.className = element.className.replace(/\b(up|degraded|down|unknown|partial)\b/g, "").trim() + " " + status; }
function uptimeText(stats) { return stats?.percentage == null ? (stats?.checks ? "Collecting data" : "No history yet") : `${stats.percentage.toFixed(2)}% · 24h uptime`; }

function renderService(service) {
  const node = template.content.firstElementChild.cloneNode(true);
  node.href = `/?service=${encodeURIComponent(service.id)}`;
  node.setAttribute("aria-label", `${service.name}, ${service.statusLabel}. Open service details`);
  $(".service-name", node).textContent = service.name;
  $(".service-description", node).textContent = service.description;
  $(".service-latency", node).textContent = formatLatency(service.latest?.responseTimeMs);
  $(".service-uptime", node).textContent = uptimeText(service.uptime?.["24h"]);
  const pill = $(".state-pill", node);
  setStatus(pill, service.status);
  $(".status-dot", pill).classList.add(service.status);
  $(".status-dot", node).classList.add(service.status);
  $(".state-pill span:last-child", node).textContent = service.statusLabel;
  const bars = $(".uptime-bars", node);
  const recent = service.history || [];
  const barCount = 30;
  const slice = recent.slice(-barCount);
  const pad = Math.max(0, barCount - slice.length);
  for (let i = 0; i < barCount; i++) {
    const row = i < pad ? null : slice[i - pad];
    const bar = document.createElement("span");
    bar.className = "uptime-bar " + (row ? (row.success ? ((row.responseTimeMs >= 1500) ? "degraded" : "up") : "down") : "unknown");
    bar.tabIndex = 0;
    bar.title = row ? `${formatDate(row.timestamp)} · ${row.success ? "Success" : "Failure"} · ${formatLatency(row.responseTimeMs)}${row.statusCode ? " · HTTP " + row.statusCode : ""}` : "No recorded check";
    bar.setAttribute("aria-label", bar.title);
    bars.append(bar);
  }
  $(".uptime-label", node).textContent = slice.length ? "Recent checks" : "Awaiting checks";
  return node;
}

function renderStatus(data) {
  const status = data.status || "unknown";
  const copy = statusCopy[status] || statusCopy.unknown;
  $("#overall-label").textContent = copy[0];
  $("#overall-title").textContent = copy[0];
  $("#overall-description").textContent = copy[1];
  setStatus($("#overall-dot"), status);
  $("#overall-dot").classList.add(status);
  $("#updated-at").textContent = data.updatedAt ? "Last check " + formatTime(data.updatedAt) : "Waiting for the first monitoring result";
  $("#footer-refresh").textContent = data.updatedAt ? "Updated " + formatTime(data.updatedAt) : "No monitoring data yet";
  $("#service-count").textContent = `${data.services.length} targets`;
  const list = $("#services");
  list.replaceChildren(...data.services.map(renderService));
}

async function loadDomain() {
  try {
    const response = await fetch("/api/domain-health", { cache: "no-store" });
    if (!response.ok) throw new Error("No domain data");
    const data = await response.json();
    if (data.expirationDate && !data.stale) {
      const date = new Date(data.expirationDate);
      const days = data.daysRemaining;
      $("#domain-title").textContent = "Registration expiration date found";
      $("#domain-description").textContent = `Reported expiration: ${date.toLocaleDateString(undefined, { dateStyle: "long", timeZone: "UTC" })}. This is separate from whether the website responds over HTTP.`;
      $("#domain-days").textContent = days < 0 ? "Past" : String(days);
      $("#domain-days-label").textContent = days < 0 ? "expiration date" : (days === 1 ? "day remaining" : "days remaining");
    } else {
      $("#domain-title").textContent = "Expiration date not verified";
      $("#domain-description").textContent = "No trustworthy registration expiration date is available yet. Nothing is guessed or counted down from an unverified date.";
      $("#domain-days").textContent = "—";
      $("#domain-days-label").textContent = "days remaining";
    }
    const dns = data.dns ? (data.dns.ok ? "DNS resolves" : "DNS lookup failed") : "DNS status unavailable";
    const tls = data.tls ? (data.tls.valid ? "HTTPS certificate valid" : "HTTPS certificate not validated") : "TLS status unavailable";
    const cert = data.tls?.expiresAt ? ` · certificate expires ${new Date(data.tls.expiresAt).toLocaleDateString()}` : "";
    $("#domain-meta").textContent = `${dns} · ${tls}${cert}${data.checkedAt ? " · Checked " + formatTime(data.checkedAt) : ""}`;
  } catch {
    $("#domain-title").textContent = "Expiration date not verified";
    $("#domain-meta").textContent = "Domain registration and HTTP availability are tracked separately.";
  }
}
async function loadIncidents() {
  try {
    const response = await fetch("/api/incidents", { cache: "no-store" });
    const data = await response.json();
    const list = $("#incidents");
    if (!data.incidents?.length) return;
    list.replaceChildren(...data.incidents.slice(0, 8).map(incident => {
      const item = document.createElement("div");
      item.className = `incident-item ${incident.event}`;
      const symbol = incident.event === "service_recovered" ? "✓" : "!";
      const title = incident.event === "service_recovered" ? "Service recovered" : "Service outage detected";
      const icon = document.createElement("span");
      icon.className = "incident-icon";
      icon.textContent = symbol;
      const copy = document.createElement("div");
      const heading = document.createElement("div");
      heading.className = "incident-title";
      heading.textContent = `${title} · ${incident.serviceName}`;
      const description = document.createElement("div");
      description.className = "incident-description";
      description.textContent = incident.statusCode ? `HTTP ${incident.statusCode}${incident.errorCategory ? " · " + incident.errorCategory : ""}` : (incident.errorCategory || "Monitoring event");
      copy.append(heading, description);
      const time = document.createElement("time");
      time.className = "incident-time";
      time.dateTime = incident.timestamp;
      time.textContent = formatDate(incident.timestamp);
      item.append(icon, copy, time);
      return item;
    }));
  } catch { /* Keep the honest empty state when there is no incident feed. */ }
}
async function refresh() {
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    if (!response.ok) throw new Error("Status request failed");
    renderStatus(await response.json());
  } catch {
    $("#overall-label").textContent = "Status Temporarily Unavailable";
    $("#overall-title").textContent = "Status Temporarily Unavailable";
    $("#overall-description").textContent = "The status service could not be reached. Try again shortly.";
    $("#updated-at").textContent = "Live data unavailable";
    setStatus($("#overall-dot"), "unknown");
  }
  await Promise.all([loadDomain(), loadIncidents()]);
}
const themeToggle = $("#theme-toggle");
const savedTheme = (() => { try { return localStorage.getItem("adi-theme"); } catch { return null; } })();
if (savedTheme === "dark" || savedTheme === "light") document.documentElement.dataset.theme = savedTheme;
function updateThemeButton() {
  const dark = document.documentElement.dataset.theme === "dark";
  themeToggle.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  themeToggle.title = dark ? "Switch to light mode" : "Switch to dark mode";
}
themeToggle.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("adi-theme", next); } catch {}
  updateThemeButton();
});
updateThemeButton();
refresh();
setInterval(refresh, 30_000);

async function renderServiceDetail(id) {
  if (!/^[a-z0-9-]+$/.test(id)) return;
  try {
    const response = await fetch(`/api/status/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!response.ok) return;
    const service = await response.json();
    const main = $("main");
    const history = (service.history || []).slice(-36).reverse();
    const periodCards = ["24h", "7d", "30d"].map(period => {
      const item = service.uptime?.[period];
      return `<div class="detail-stat"><span>${period} uptime</span><strong>${item?.percentage == null ? "Collecting data" : esc(item.percentage.toFixed(2) + "%")}</strong><small>${item?.checks || 0} recorded checks</small></div>`;
    }).join("");
    const bars = (service.history || []).slice(-60).map(row => {
      const state = row.success ? ((row.responseTimeMs >= 1500) ? "degraded" : "up") : "down";
      return `<span class="uptime-bar ${state}" title="${esc(formatDate(row.timestamp) + " · " + (row.success ? "Success" : "Failure") + " · " + formatLatency(row.responseTimeMs))}"></span>`;
    }).join("");
    const checks = history.map(row => `<div class="detail-check"><span class="status-dot ${row.success ? ((row.responseTimeMs >= 1500) ? "degraded" : "up") : "down"}"></span><span><strong>${row.success ? "Successful check" : "Failed check"}</strong><small>${esc(formatDate(row.timestamp))}${row.statusCode ? " · HTTP " + esc(row.statusCode) : ""}${row.errorCategory ? " · " + esc(row.errorCategory) : ""}</small></span><b>${esc(formatLatency(row.responseTimeMs))}</b></div>`).join("");
    const status = service.status || "unknown";
    main.innerHTML = `
      <section class="detail-page">
        <a class="back-link" href="/">← All services</a>
        <div class="detail-heading"><p class="section-eyebrow">SERVICE DETAILS</p><h1>${esc(service.name)}</h1><p>${esc(service.description || service.url)}</p>
        <div class="detail-status ${esc(status)}"><span class="status-dot ${esc(status)}"></span><strong>${esc(service.statusLabel || "Unknown")}</strong><span>·</span><span>${esc(formatLatency(service.latest?.responseTimeMs))}</span></div></div>
        <div class="detail-stats">${periodCards}</div>
        <section class="detail-section"><div class="section-heading"><div><p class="section-eyebrow">RECENT PERFORMANCE</p><h2>Uptime history</h2></div><span class="section-meta">Latest recorded checks</span></div><div class="detail-bars">${bars || '<p class="detail-empty">Collecting data. History will appear after checks have been recorded.</p>'}</div><div class="detail-legend"><span><i class="up"></i>Successful</span><span><i class="degraded"></i>Degraded latency</span><span><i class="down"></i>Failed</span></div></section>
        <section class="detail-section"><div class="section-heading"><div><p class="section-eyebrow">CHECK LOG</p><h2>Recent checks</h2></div><span class="section-meta">${service.dataPoints || 0} total records</span></div><div class="detail-check-list">${checks || '<p class="detail-empty">No checks recorded yet.</p>'}</div></section>
        <section class="detail-meta"><div><span>Last successful check</span><strong>${esc(formatDate(service.lastSuccessfulCheck))}</strong></div><div><span>Last failed check</span><strong>${esc(formatDate(service.lastFailedCheck))}</strong></div><div><span>Monitored URL</span><a href="${esc(service.url)}" rel="noopener noreferrer" target="_blank">${esc(service.url)} ↗</a></div></section>
      </section>`;
    document.title = `${service.name} · Status · adi.rest`;
  } catch { /* The main status page remains available if detail data cannot load. */ }
}
const selectedService = new URLSearchParams(location.search).get("service");
if (selectedService) renderServiceDetail(selectedService);
