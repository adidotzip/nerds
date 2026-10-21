const $ = (selector, root = document) => root.querySelector(selector);
const statusCopy = {
  up: ["All Systems Operational", "Everything is responding within its expected range."],
  partial: ["Partial Service Disruption", "Some services are currently unavailable."],
  degraded: ["Degraded Performance", "All monitored services are responding, but some are slower than usual."],
  down: ["Service Disruption", "One or more monitored services are unavailable."],
  unknown: ["Status Temporarily Unavailable", "We couldn’t get a fresh result from every service."]
};
const formatLatency = value => Number.isFinite(value) ? `${Math.round(value)} ms` : "—";
const formatTime = value => value ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(value)) : "Not checked yet";
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;',"'":"&#39;" })[c]);
function setStatus(element, status) {
  element.classList.remove("up", "degraded", "down", "unknown", "partial");
  element.classList.add(status);
}
function renderService(service) {
  const node = $("#service-template").content.firstElementChild.cloneNode(true);
  node.href = `/?service=${encodeURIComponent(service.id)}`;
  node.setAttribute("aria-label", `${service.name}, ${service.statusLabel}. Open service details`);
  $(".service-name", node).textContent = service.name;
  $(".service-description", node).textContent = service.description;
  $(".service-latency", node).textContent = formatLatency(service.latest?.responseTimeMs);
  $(".service-uptime", node).textContent = formatTime(service.latest?.timestamp);
  const pill = $(".state-pill", node);
  setStatus(pill, service.status);
  $(".status-dot", pill).classList.add(service.status);
  $(".status-dot", node).classList.add(service.status);
  $(".state-pill span:last-child", node).textContent = service.statusLabel;
  return node;
}
function renderStatus(data) {
  const status = data.status || "unknown";
  const copy = statusCopy[status] || statusCopy.unknown;
  $("#overall-label").textContent = copy[0];
  $("#overall-title").textContent = copy[0];
  $("#overall-description").textContent = copy[1];
  setStatus($("#overall-dot"), status);
  $("#updated-at").textContent = data.updatedAt ? "Checked " + formatTime(data.updatedAt) : "Waiting for live results";
  $("#footer-refresh").textContent = data.updatedAt ? "Checked " + formatTime(data.updatedAt) : "No live result yet";
  $("#service-count").textContent = `${data.services.length} targets`;
  $("#services").replaceChildren(...data.services.map(renderService));
}
async function loadDomain() {
  try {
    const response = await fetch("/api/domain-health", { cache: "no-store" });
    if (!response.ok) throw new Error("Domain data unavailable");
    const data = await response.json();
    if (data.expirationDate) {
      const days = data.daysRemaining;
      $("#domain-title").textContent = "Configured expiration date";
      $("#domain-description").textContent = `Configured expiry: ${new Date(data.expirationDate).toLocaleDateString(undefined, { dateStyle: "long", timeZone: "UTC" })}. This date was provided manually and has not been independently verified. Website availability is tracked separately.`;
      $("#domain-days").textContent = days < 0 ? "Past" : String(days);
      $("#domain-days-label").textContent = days < 0 ? "expiration date" : days === 1 ? "day remaining" : "days remaining";
    } else {
      $("#domain-title").textContent = "Expiration date not verified";
      $("#domain-description").textContent = "No trustworthy registration expiration date is available. Nothing is guessed.";
      $("#domain-days").textContent = "—";
      $("#domain-days-label").textContent = "days remaining";
    }
    const dns = data.dns ? (data.dns.ok ? "DNS resolves" : "DNS lookup failed") : "DNS status unavailable";
    const tls = data.tls ? (data.tls.valid ? "HTTPS connection succeeded" : "HTTPS connection failed") : "HTTPS status unavailable";
    $("#domain-meta").textContent = `${dns} · ${tls}${data.tls?.expiresAt ? " · certificate expires " + new Date(data.tls.expiresAt).toLocaleDateString() : ""}${data.checkedAt ? " · Checked " + formatTime(data.checkedAt) : ""}`;
  } catch {
    $("#domain-title").textContent = "Expiration date not verified";
    $("#domain-meta").textContent = "Domain registration and HTTP availability are tracked separately.";
  }
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
  await loadDomain();
}

const themeToggle = $("#theme-toggle");
function readSavedTheme() {
  try { return localStorage.getItem("adi-theme"); } catch { return null; }
}
const savedTheme = readSavedTheme();
const systemDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false;
document.documentElement.dataset.theme = savedTheme === "dark" || savedTheme === "light" ? savedTheme : (systemDark ? "dark" : "light");

function updateThemeButton() {
  const dark = document.documentElement.dataset.theme === "dark";
  themeToggle.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  themeToggle.title = dark ? "Switch to light mode" : "Switch to dark mode";
  themeToggle.innerHTML = dark
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.2 15.1A8.3 8.3 0 0 1 8.9 3.8 8.4 8.4 0 1 0 20.2 15.1Z"/></svg>';
}
themeToggle.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("adi-theme", next); } catch {}
  updateThemeButton();
});
updateThemeButton();

async function renderServiceDetail(id) {
  if (!/^[a-z0-9-]+$/.test(id)) return;
  try {
    const response = await fetch(`/api/status/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Service not found");
    const service = await response.json();
    $("main").innerHTML = `
      <section class="detail-page">
        <a class="back-link" href="/">← All services</a>
        <div class="detail-heading"><p class="section-eyebrow">LIVE SERVICE CHECK</p><h1>${esc(service.name)}</h1><p>${esc(service.description || service.url)}</p>
        <div class="detail-status ${esc(service.status)}"><span class="status-dot ${esc(service.status)}"></span><strong>${esc(service.statusLabel)}</strong><span>·</span><span>${esc(formatLatency(service.latest?.responseTimeMs))}</span></div></div>
        <section class="detail-section"><div class="section-heading"><div><p class="section-eyebrow">LATEST RESULT</p><h2>Current response</h2></div></div>
        <div class="detail-stats">
          <div class="detail-stat"><span>HTTP status</span><strong>${service.latest?.statusCode ?? "—"}</strong><small>${service.latest?.success ? "Expected response" : esc(service.latest?.error || "No response")}</small></div>
          <div class="detail-stat"><span>Response time</span><strong>${esc(formatLatency(service.latest?.responseTimeMs))}</strong><small>Measured by this check</small></div>
          <div class="detail-stat"><span>Checked at</span><strong>${esc(formatTime(service.latest?.timestamp))}</strong><small>Live request, not stored history</small></div>
        </div></section>
        <section class="detail-meta"><div><span>Monitored URL</span><a href="${esc(service.url)}" rel="noopener noreferrer" target="_blank">${esc(service.url)} ↗</a></div></section>
      </section>`;
    document.title = `${service.name} · Status · adi.rest`;
  } catch {
    $("main").innerHTML = '<section class="detail-page"><a class="back-link" href="/">← All services</a><h1>Service unavailable</h1><p>We could not load a live result for this service.</p></section>';
  }
}
const selectedService = new URLSearchParams(location.search).get("service");
if (selectedService) renderServiceDetail(selectedService);
else {
  refresh();
  setInterval(refresh, 30_000);
}
