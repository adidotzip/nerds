<script>
  import { onMount } from "svelte";
  import { Button, Card, Chip, LoadingIndicator, ConnectedButtons } from "m3-svelte";
  import { AreaChart } from "layerchart";


  let data = $state(null);
  let domain = $state(null);
  let histories = $state({});
  let incidents = $state([]);
  let failed = $state(false);
  let dark = $state(false);
  let selected = $state("24h");
  let refreshing = $state(false);
  let initialLoading = $state(true);

  const monitoringEndsAt = Date.parse("2026-12-26T00:00:00.000Z");
  const configuredServices = [
    { id: "adi-rest", name: "adi.rest", description: "Main website", url: "https://adi.rest/" },
    { id: "lyrics-api", name: "lyrics.adi.rest", description: "Lyrics API endpoint", url: "https://lyrics.adi.rest/api/" },
    ...(Date.now() < monitoringEndsAt ? [{ id: "imreallyadi-space", name: "imreallyadi.space", description: "Secondary website", url: "https://imreallyadi.space/" }] : [])
  ];
  const unknownServiceList = () => configuredServices.map((service) => ({
    ...service, status: "unknown", statusLabel: "Unknown", latest: null,
    lastSuccessfulCheck: null, lastFailedCheck: null
  }));

  const expiryDate = "2026-12-25T00:00:00.000Z";
  const daysToExpiration = () => Math.ceil((Date.parse(expiryDate) - Date.now()) / 86400000);
  const statusText = { up: "All systems operational", partial: "Partial service disruption", degraded: "Degraded performance", down: "Major outage", unknown: "Status temporarily unavailable" };
  const time = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Awaiting first check";
  const latency = (value) => Number.isFinite(value) ? Math.round(value) + " ms" : "—";
  const percent = (value) => Number.isFinite(value) ? value.toFixed(2) + "%" : "Collecting data";
  const points = (history) => (history || []).filter((item) => Number.isFinite(item.responseTimeMs) && item.success);
  const chartPoints = (history) => points(history).map((item, index) => ({
    index: index + 1,
    timestamp: new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    responseTimeMs: item.responseTimeMs
  }));
  const pathFor = (history, width = 560, height = 120) => {
    const values = points(history);
    if (values.length < 2) return "";
    const max = Math.max(...values.map((p) => p.responseTimeMs), 1);
    const coords = values.map((p, i) => ({ x: (i / (values.length - 1)) * width, y: height - (p.responseTimeMs / max) * (height - 14) - 7 }));
    let path = `M ${coords[0].x} ${coords[0].y}`;
    for (let i = 1; i < coords.length; i++) {
      const prev = coords[i - 1], current = coords[i];
      const midX = (prev.x + current.x) / 2;
      path += ` Q ${midX} ${prev.y} ${midX} ${(prev.y + current.y) / 2}`;
      if (i === coords.length - 1) path += ` T ${current.x} ${current.y}`;
    }
    return path;
  };
  const areaPathFor = (history, width = 560, height = 120) => {
    const line = pathFor(history, width, height);
    if (!line) return "";
    return `${line} L ${width} ${height} L 0 ${height} Z`;
  };
  const bars = (history) => {
    const list = history || [];
    const bucketCount = 60;
    const now = Date.now();
    const duration = selected === "7d" ? 604800000 : selected === "30d" ? 2592000000 : 86400000;
    const from = now - duration;
    const step = duration / bucketCount;
    return Array.from({ length: bucketCount }, (_, i) => {
      const bucketStart = from + i * step;
      const bucketEnd = bucketStart + step;
      const group = list.filter((p) => {
        const stamp = Date.parse(p.timestamp);
        return Number.isFinite(stamp) && stamp >= bucketStart && stamp < bucketEnd;
      });
      if (!group.length) return { status: "unknown", count: 0, from: new Date(bucketStart).toISOString(), to: new Date(bucketEnd).toISOString() };
      return { status: group.some((p) => !p.success) ? "down" : group.some((p) => p.status === "degraded") ? "degraded" : "up", count: group.length, from: group[0]?.timestamp, to: group[group.length - 1]?.timestamp, checks: group.length };
    });
  };

  async function fetchJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("Request failed");
    return response.json();
  }
  async function refresh() {
    refreshing = true;
    try {
      const [status, incidentData, domainData] = await Promise.all([
        fetchJson("/api/current-status"),
        fetchJson("/api/incidents?period=24h").catch(() => ({ incidents: [] })),
        fetchJson("/api/domain-health").catch(() => null)
      ]);
      data = status;
      incidents = incidentData.incidents || [];
      domain = domainData;
      failed = false;
      const results = await Promise.all((data.services || []).map(async (service) => {
        try {
          const result = await fetchJson("/api/history/" + encodeURIComponent(service.id) + "?period=" + selected);
          return [service.id, result, true];
        } catch { return [service.id, { history: [], uptime: {} }, false]; }
      }));
      histories = Object.fromEntries(results.map(([id, result]) => [id, result]));
      data = { ...status, historyAvailable: results.length > 0 && results.every(([, , available]) => available) };
    } catch {
      failed = true;
      data = { status: "unknown", updatedAt: null, services: unknownServiceList(), configurationFallback: true };
    } finally { refreshing = false; initialLoading = false; }
  }
  function toggleTheme() {
    dark = !dark;
    const root = document.documentElement;
    root.dataset.theme = dark ? "dark" : "light";
    root.style.colorScheme = dark ? "dark" : "light";
    try { localStorage.setItem("adi-theme", dark ? "dark" : "light"); } catch {}
  }
  async function changePeriod(period) { selected = period; await refresh(); }

  onMount(() => {
    dark = document.documentElement.dataset.theme === "dark";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    refresh();
    const timer = setInterval(refresh, 60000);
    return () => clearInterval(timer);
  });
</script>

<svelte:head>
  <title>Status · adi.rest</title>
  <meta name="description" content="Live service status, historical uptime and response-time graphs for adi.rest." />
</svelte:head>

<div class="boot-screen" class:boot-screen-hidden={!initialLoading} role="status" aria-live="polite" aria-hidden={!initialLoading}>
  <span class="boot-brand">adi.rest</span>
  <LoadingIndicator />
  <p>Connecting to live monitoring</p>
  <span class="boot-caption">Checking services and recent results</span>
</div>

<div class:booting={initialLoading} class="shell">
  <header class="topbar">
    <a class="brand" href="/" aria-label="adi.rest status home">adi.rest</a>
    <div class="top-actions">
      <span class="live-indicator"><span></span> Live monitoring</span>
      <button class="theme-toggle" onclick={toggleTheme} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} title={dark ? "Switch to light theme" : "Switch to dark theme"}>{#if dark}<svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2 M12 20v2 M4.93 4.93l1.42 1.42 M17.65 17.65l1.42 1.42 M2 12h2 M20 12h2 M4.93 19.07l1.42-1.42 M17.65 6.35l1.42-1.42" stroke-linecap="round"/></svg>{:else}<svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" stroke-linecap="round" stroke-linejoin="round"/></svg>{/if}</button>
    </div>
  </header>

  <main>
    <section class="hero">
      <div class="status-line"><span class="status-dot {data?.status || 'unknown'}"></span><span>{statusText[data?.status || "unknown"]}</span></div>
      <h1>{data?.status === "up" ? "Everything is running smoothly." : data?.status === "down" || data?.status === "partial" ? "We're investigating a service disruption." : data?.status === "degraded" ? "Some services are running slowly." : "Service status at a glance."}</h1>
      <div class="hero-meta"><span>{failed ? "Live checks are unavailable. Configured services remain listed as Unknown." : data?.liveOnly ? "Showing fresh live checks. Historical data is currently unavailable." : data?.configurationFallback ? "Showing configured services while live results are unavailable." : "Monitoring the services that power adi.rest."}</span><span class="meta-divider"></span><span>Last checked {time(data?.updatedAt)}</span><Button variant="text" size="s" onclick={refresh} disabled={refreshing}>{refreshing ? "Updating…" : "Refresh"}</Button></div>
    </section>

    
    <section class="section summary-section">
      <div class="section-heading"><div><h2>Service health</h2></div><span class="subtle">{data?.services?.length ?? 0} monitored services</span></div>
      <div class="service-list">
        {#if !data}
          <Card variant="outlined"><div class="loading"><span>Checking services…</span></div></Card>
        {:else if !data.services?.length}
          <Card variant="outlined"><p class="empty">Live monitoring results are unavailable. These configured services are shown as Unknown until real check results can be loaded.</p></Card>
        {:else}
          {#each data.services as service, i (service.id)}
            {@const historyData = histories[service.id]}
            <Card variant="outlined">
              <article class="service-card" style={`--item-index:${i}`}>
                <div class="service-main">
                  <div class="service-name-line"><span class="status-dot small {service.status || 'unknown'}"></span><h3>{service.name}</h3>{#if service.status && service.status !== "unknown" && service.statusLabel}<span class="status-word {service.status}">{service.statusLabel}</span>{/if}</div>
                  <p class="service-description">{service.description}</p>
                  <a class="service-url" href={service.url} target="_blank" rel="noreferrer">{service.url} <span aria-hidden="true">↗</span></a>
                </div>
                <div class="service-metrics">
                  <div><span class="metric-label">Response time</span><strong>{latency(service.latest?.responseTimeMs)}</strong></div>
                  <div><span class="metric-label">HTTP status</span><strong>{service.latest?.statusCode ?? "—"}</strong></div>
                  <div><span class="metric-label">24h uptime</span><strong>{percent(historyData?.uptime?.["24h"]?.percentage)}</strong></div>
                </div>
                <div class="uptime-block">
                  <div class="uptime-title"><span>Uptime history</span><span>{historyData?.history?.length ? historyData.history.length + " checks" : "Collecting data"}</span></div>
                  <div class="uptime-bars" aria-label="Historical check results">
                    {#each bars(historyData?.history) as bar, i}
                      <span class="uptime-bar {bar.status}" title={bar.count ? `${bar.status}: ${bar.count} recorded check(s), ${time(bar.from)} – ${time(bar.to)}` : `Unknown: no recorded checks from ${time(bar.from)} to ${time(bar.to)}`} aria-label={bar.count ? `${bar.status}, ${bar.count} recorded checks` : "Unknown, no recorded checks"}></span>
                    {/each}
                  </div>
                  <div class="bar-labels"><span>{selected === "24h" ? "24 hours ago" : selected === "7d" ? "7 days ago" : "30 days ago"}</span><span>Now</span></div>
                </div>
                <div class="latency-graph">
                  <div class="uptime-title"><span>Response time</span><span>{historyData?.history?.length ? "milliseconds" : "No history yet"}</span></div>
                  {#if points(historyData?.history).length > 1}
                    <div class="area-chart" role="img" aria-label={"Area chart of recorded response times for " + service.name}>
                      <AreaChart
                        data={chartPoints(historyData.history)}
                        x="index"
                        y="responseTimeMs"
                        height={130}
                      />
                    </div>
                    <div class="chart-axis-labels"><span>Earlier</span><span>Most recent checks</span></div>
                  {:else}
                    <div class="graph-empty">A graph will appear as real monitoring history accumulates.</div>
                  {/if}
                </div>
                <div class="service-foot"><span>Last checked {time(service.latest?.timestamp)}</span><span>Last successful {time(service.lastSuccessfulCheck)}</span>{#if service.lastFailedCheck}<span>Last failed {time(service.lastFailedCheck)}</span>{/if}</div>
              </article>
            </Card>
          {/each}
        {/if}
      </div>
    </section>


    <section class="section history-section">
      <div class="section-heading"><div><p class="eyebrow">HISTORICAL DATA</p><h2>Uptime & response times</h2></div>
        <ConnectedButtons>
          <Button variant={selected === "24h" ? "filled" : "tonal"} square label>
            <input type="radio" name="history-period" value="24h" checked={selected === "24h"} onchange={() => changePeriod("24h")} disabled={refreshing} />24h
          </Button>
          <Button variant={selected === "7d" ? "filled" : "tonal"} square label>
            <input type="radio" name="history-period" value="7d" checked={selected === "7d"} onchange={() => changePeriod("7d")} disabled={refreshing} />7 days
          </Button>
          <Button variant={selected === "30d" ? "filled" : "tonal"} square label>
            <input type="radio" name="history-period" value="30d" checked={selected === "30d"} onchange={() => changePeriod("30d")} disabled={refreshing} />30 days
          </Button>
        </ConnectedButtons>
      </div>
      <Card variant="outlined">
        <div class="history-overview">
          {#each (data?.services || []) as service (service.id)}
            <div class="history-row">
              <div><strong>{service.name}</strong><span>{histories[service.id]?.history?.length || 0} recorded checks</span></div>
              <div class="history-stat"><span>Uptime</span><strong>{percent(histories[service.id]?.uptime?.[selected]?.percentage)}</strong></div>
              <div class="history-stat"><span>Average latency</span><strong>{latency(histories[service.id]?.uptime?.[selected]?.averageResponseTimeMs)}</strong></div>
            </div>
          {/each}
          {#if !data?.services?.length || data?.historyAvailable === false}<div class="empty">{data?.historyAvailable === false ? "Live checks are working, but saved history is unavailable. Uptime percentages are not guessed." : "Historical statistics appear after monitoring records are collected."}</div>{/if}
        </div>
        <p class="history-note">Only recorded checks count toward uptime. Missing intervals are unknown, not successful. When live-only mode is active, historical uptime cannot be verified.</p>
      </Card>
    </section>


    <section class="section incidents-section">
      <div class="section-heading"><div><p class="eyebrow">EVENT LOG</p><h2>Recent incidents</h2></div><span class="subtle">Recorded check failures</span></div>
      <Card variant="outlined">
        {#if data?.historyAvailable === false}
          <div class="empty-incidents"><strong>Incident history unavailable</strong><p>Live service checks are available, but past outages cannot be verified until history storage is restored.</p></div>
        {:else if incidents.length}
          <div class="incident-list">
            {#each incidents.slice(0, 12) as incident, i}
              <div class="incident-row" key={incident._id || incident.timestamp + i}>
                <span class="incident-mark"></span><div><strong>{incident.serviceName || incident.serviceId}</strong><p>{incident.error || (incident.statusCode ? "HTTP " + incident.statusCode : "Check failed")}</p></div><time>{time(incident.timestamp)}</time>
              </div>
            {/each}
          </div>
        {:else}
          <div class="empty-incidents"><span class="empty-check">✓</span><strong>No recorded incidents in this period</strong><p>This means no failures are recorded for the selected period, not that unmonitored time was healthy.</p></div>
        {/if}
      </Card>
    </section>


    <section class="section domain-section">
      <div class="section-heading"><div><p class="eyebrow">REGISTRATION</p><h2>imreallyadi.space</h2></div><Chip variant="general" disabled>Domain health</Chip></div>
      <Card variant="outlined">
        <div class="domain-row">
          <div class="domain-copy"><h3>Domain expiration</h3><p>imreallyadi.space expires on December 25, 2026.</p></div>
          <div class="countdown"><strong>{Math.max(0, daysToExpiration())}</strong><span>{daysToExpiration() < 0 ? "days past date" : "days remaining"}</span></div>
        </div>
      </Card>
    </section>
  </main>

  <footer><span class="footer-brand">adi.rest</span><span>Live checks. Historical data is shown only when available.</span><a href="/api/status">Status API ↗</a></footer>
</div>

<style>
  .shell{width:min(1040px,100%);margin:auto;padding:0 32px;animation:page-enter .28s ease both}.topbar{min-height:76px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--m3c-outline-variant)}.brand{font-size:20px;font-weight:700;letter-spacing:-.055em}.top-actions{display:flex;align-items:center;gap:20px}.live-indicator{display:flex;align-items:center;gap:8px;color:var(--m3c-on-surface-variant);font-size:12px}.live-indicator>span{width:7px;height:7px;border-radius:50%;background:#258653}.theme-toggle{width:40px;height:40px;border:1px solid var(--m3c-outline-variant);border-radius:50%;display:grid;place-items:center;background:var(--m3c-surface-container-low);color:var(--m3c-on-surface);cursor:pointer}.theme-toggle :global(svg){width:21px;height:21px;stroke-width:1.8;transform-origin:center;fill:none;stroke:currentColor}.contrast-fill{fill:currentColor;stroke:none}.hero{padding:58px 0 42px;border-bottom:1px solid var(--m3c-outline-variant)}.status-line{display:flex;align-items:center;gap:10px;font-size:14px;font-weight:600;margin-bottom:22px;text-transform:capitalize}.status-dot{width:10px;height:10px;border-radius:50%;background:var(--m3c-outline);flex-shrink:0}.status-dot.small{width:8px;height:8px}.status-dot.up{background:#258653}.status-dot.degraded,.status-dot.partial{background:#b87917}.status-dot.down{background:var(--m3c-error)}h1{font-size:clamp(36px,5.6vw,58px);font-weight:650;letter-spacing:-.055em;line-height:1.06;max-width:760px;margin:0;text-wrap:balance}.hero-meta{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-top:24px;color:var(--m3c-on-surface-variant);font-size:12px}.meta-divider{width:3px;height:3px;border-radius:50%;background:var(--m3c-outline)}.section{padding-top:40px}.section-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin-bottom:17px}.eyebrow{font-size:10px;font-weight:650;letter-spacing:.13em;color:var(--m3c-on-surface-variant);margin:0 0 7px}h2{margin:0;font-size:25px;letter-spacing:-.04em;font-weight:650}.subtle{font-size:12px;color:var(--m3c-on-surface-variant);padding-bottom:4px}.service-list{display:grid;gap:12px}.service-card{padding:2px}.service-main{min-width:0}.service-name-line{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.service-name-line h3{font-size:16px;font-weight:650;margin:0;letter-spacing:-.02em}.status-word{font-size:11px;color:var(--m3c-on-surface-variant);border:1px solid var(--m3c-outline-variant);border-radius:999px;padding:3px 8px}.status-word.up{color:#258653}.status-word.degraded,.status-word.partial{color:#b87917}.status-word.down{color:var(--m3c-error)}.service-description{font-size:12px;color:var(--m3c-on-surface-variant);margin:7px 0 3px}.service-url{font-size:11px;color:var(--m3c-primary);overflow-wrap:anywhere}.service-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:20px 0 18px;margin-top:16px;border-top:1px solid var(--m3c-outline-variant)}.service-metrics>div{display:grid;gap:6px}.metric-label,.history-stat>span{font-size:11px;color:var(--m3c-on-surface-variant)}.service-metrics strong{font-size:17px;font-weight:650;font-variant-numeric:tabular-nums}.uptime-title{display:flex;justify-content:space-between;gap:12px;font-size:11px;color:var(--m3c-on-surface-variant);margin-bottom:9px}.uptime-bars{display:grid;grid-template-columns:repeat(60,minmax(2px,1fr));gap:3px;height:31px;border-radius:999px;overflow:hidden}.uptime-bar{border-radius:999px;background:var(--m3c-outline-variant);min-width:0;min-height:100%}.uptime-bar.unknown{background:color-mix(in srgb,var(--m3c-outline-variant) 58%,transparent)}.uptime-bar.up{background:#2f9660}.uptime-bar.degraded{background:#d39a36}.uptime-bar.down{background:#c94d54}.bar-labels{display:flex;justify-content:space-between;margin-top:7px;color:var(--m3c-on-surface-variant);font-size:10px}.latency-graph{margin-top:22px}.latency-graph svg{width:100%;height:88px;overflow:visible;border:0;outline:0;box-shadow:none;border-radius:0;clip-path:none}.graph-grid{fill:none;stroke:var(--m3c-outline-variant);stroke-width:1;stroke-dasharray:3 5}.graph-line{fill:none;stroke:var(--m3c-primary);stroke-width:3.5;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}.graph-empty{height:72px;display:flex;align-items:center;color:var(--m3c-on-surface-variant);font-size:12px}.service-foot{display:flex;flex-wrap:wrap;gap:8px 18px;border-top:1px solid var(--m3c-outline-variant);padding-top:13px;margin-top:8px;color:var(--m3c-on-surface-variant);font-size:10px}.period-switch{display:flex;gap:3px;padding:3px;border:1px solid var(--m3c-outline-variant);border-radius:999px}.period-switch button{border:0;background:transparent;color:var(--m3c-on-surface-variant);padding:7px 11px;border-radius:999px;font-size:11px;cursor:pointer}.period-switch button.active{background:var(--m3c-secondary-container);color:var(--m3c-on-secondary-container)}.history-overview{display:grid}.history-row{display:grid;grid-template-columns:minmax(0,1fr) 150px 150px;align-items:center;gap:14px;padding:16px 0;border-bottom:1px solid var(--m3c-outline-variant)}.history-row:first-child{padding-top:0}.history-row:last-child{border-bottom:0;padding-bottom:0}.history-row>div:first-child{display:grid;gap:5px}.history-row strong{font-size:13px;font-weight:650}.history-row>div:first-child span{font-size:11px;color:var(--m3c-on-surface-variant)}.history-stat{display:grid;gap:5px}.history-note{margin:18px 0 0;padding-top:14px;border-top:1px solid var(--m3c-outline-variant);font-size:11px;color:var(--m3c-on-surface-variant);line-height:1.6}.incident-list{display:grid}.incident-row{display:grid;grid-template-columns:8px minmax(0,1fr) auto;align-items:start;column-gap:12px;padding:18px 0;border-bottom:1px solid var(--m3c-outline-variant)}.incident-row:last-child{border:0;padding-bottom:0}.incident-mark{width:8px;height:8px;border-radius:50%;background:var(--m3c-error);margin-top:5px;flex-shrink:0}.incident-row>div{min-width:0;grid-column:2;grid-row:1}.incident-row strong{display:block;font-size:13px;line-height:1.5}.incident-row p{margin:5px 0 0;font-size:12px;line-height:1.5;color:var(--m3c-on-surface-variant);overflow-wrap:anywhere}.incident-row time{grid-column:3;grid-row:1;font-size:10px;line-height:1.5;color:var(--m3c-on-surface-variant);text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.empty-incidents,.empty{padding:24px 4px;text-align:center;color:var(--m3c-on-surface-variant);font-size:12px;line-height:1.7}.empty-check{display:grid;place-items:center;width:34px;height:34px;margin:0 auto 12px;border-radius:50%;background:var(--m3c-secondary-container);color:var(--m3c-on-secondary-container);font-size:18px}.empty-incidents strong{display:block;color:var(--m3c-on-surface);font-size:13px}.empty-incidents p{max-width:460px;margin:7px auto 0}.domain-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:24px}.domain-copy h3{font-size:15px;margin:0 0 7px}.domain-copy p{font-size:12px;color:var(--m3c-on-surface-variant);line-height:1.7;margin:0 0 5px}.domain-meta{padding-top:6px}.countdown{text-align:right;min-width:100px}.countdown strong{display:block;font-size:32px;font-weight:650;letter-spacing:-.05em;font-variant-numeric:tabular-nums}.countdown span{font-size:11px;color:var(--m3c-on-surface-variant)}.loading{display:flex;align-items:center;justify-content:center;gap:12px;padding:25px;color:var(--m3c-on-surface-variant);font-size:13px}footer{margin-top:48px;min-height:78px;border-top:1px solid var(--m3c-outline-variant);display:flex;align-items:center;gap:12px;color:var(--m3c-on-surface-variant);font-size:11px}.footer-brand{font-size:14px;font-weight:700;letter-spacing:-.04em;color:var(--m3c-on-surface)}footer a{margin-left:auto;color:var(--m3c-primary)}@media(max-width:700px){.shell{padding:0 20px}.hero{padding:44px 0 34px}.section{padding-top:32px}.service-metrics{gap:8px}.history-row{grid-template-columns:minmax(0,1fr) 105px 105px;gap:9px}.section-heading{align-items:flex-start;flex-wrap:wrap}.period-switch{max-width:100%}.period-switch button{padding:7px 9px}.domain-row{gap:12px}}@media(max-width:440px){.shell{padding:0 14px}.topbar{min-height:66px}.live-indicator{font-size:10px}.top-actions{gap:10px}.hero{padding-top:38px}h1{font-size:36px}.hero-meta{gap:7px}.service-metrics strong{font-size:15px}.service-foot{gap:7px 12px}.history-row{grid-template-columns:minmax(0,1fr) 86px 86px}.history-row strong{font-size:11px}.history-row>div:first-child span,.history-stat>span{font-size:10px}.period-switch button{font-size:10px;padding:7px}.countdown strong{font-size:26px}.countdown{min-width:70px}.uptime-bars{gap:2px;height:25px}footer{flex-wrap:wrap;padding:16px 0}footer a{margin-left:auto}}

  .boot-screen{position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:var(--m3c-surface);color:var(--m3c-on-surface);text-align:center;padding:24px;opacity:1;visibility:visible;transition:opacity .38s cubic-bezier(.2,.8,.2,1),visibility .38s step-end}
  .shell{opacity:1;transition:opacity .38s cubic-bezier(.2,.8,.2,1)}
  .shell.booting{opacity:0;visibility:hidden}
  .boot-screen-hidden{opacity:0;visibility:hidden;pointer-events:none;transition:opacity .38s cubic-bezier(.2,.8,.2,1),visibility 0s linear .38s}
  .boot-brand{font-size:clamp(32px,6vw,44px);font-weight:700;letter-spacing:-.07em;animation:boot-arrive .65s cubic-bezier(.2,.8,.2,1) both}
  .boot-screen :global(*){transition:color .3s ease,background-color .3s ease}
  .boot-screen p{margin:0;font-size:14px;font-weight:600;letter-spacing:-.01em}
  .boot-caption{font-size:12px;color:var(--m3c-on-surface-variant);animation:soft-pulse 1.8s ease-in-out infinite}
  .booting{visibility:hidden;pointer-events:none}
  .boot-screen :global(.m3-loading-indicator){display:initial}
  @keyframes boot-arrive{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
  @keyframes soft-pulse{0%,100%{opacity:.5}50%{opacity:1}}
  .theme-toggle{overflow:hidden;flex-shrink:0;transition:transform .2s ease,background-color .24s ease,border-color .24s ease,color .24s ease}
  .theme-toggle :global(svg){transition:opacity .24s ease}
  .area-chart{box-sizing:border-box;height:132px;width:100%;overflow:hidden;border-radius:12px;border:1px solid color-mix(in srgb,var(--m3c-outline-variant) 75%,transparent);outline:0;box-shadow:none;background:transparent;padding:0}
  .area-chart svg{display:block;width:100%;height:100%;overflow:hidden;border:0;outline:0;box-shadow:none;background:transparent}
  .chart-grid{display:block;fill:none;stroke:color-mix(in srgb,var(--m3c-outline-variant) 38%,transparent);stroke-width:1;stroke-dasharray:3 6;vector-effect:non-scaling-stroke}
  .chart-area-fill{stroke:none}
  .chart-area-line{fill:none;stroke:var(--m3c-primary);stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke;stroke-dasharray:1400;stroke-dashoffset:1400;animation:draw-graph 1.1s cubic-bezier(.2,.8,.2,1) forwards;filter:none}
  .chart-axis-labels{display:flex;justify-content:space-between;margin-top:6px;color:var(--m3c-on-surface-variant);font-size:10px}
  .theme-toggle:active{transform:scale(.9)}
  button,a,[role="slider"],input,select,.service-card,.history-row,.incident-row,.uptime-bar,.graph-line,.status-word{transition:color .22s ease,background-color .22s ease,border-color .22s ease,transform .22s cubic-bezier(.2,.8,.2,1),opacity .22s ease,box-shadow .22s ease}
  button:not(:disabled){cursor:pointer}
  button:not(:disabled):hover{filter:brightness(1.025)}
  button:not(:disabled):active{transform:scale(.97)}
  button:disabled{opacity:.65;cursor:wait}
  a:hover{color:var(--m3c-primary)}
  .service-list :global(.m3-card){animation:none;box-shadow:none!important;overflow:hidden}
  .service-card{border-radius:22px;transition:background-color .22s ease,border-color .22s ease}
  .service-card:hover{transform:none}
  .uptime-bar{min-height:100%;transform-origin:center;animation:bar-grow .45s cubic-bezier(.2,.8,.2,1) both;border-radius:999px;min-width:0}
  .uptime-bar.unknown{background:color-mix(in srgb,var(--m3c-outline-variant) 58%,transparent)}
  .uptime-bar:hover{transform:scaleY(1.14);filter:saturate(1.15)}
  .graph-line{stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1400;stroke-dashoffset:1400;animation:draw-graph 1.1s cubic-bezier(.2,.8,.2,1) forwards;filter:drop-shadow(0 2px 2px color-mix(in srgb,var(--m3c-primary) 15%,transparent))}
  .graph-grid{display:none;stroke:none}.latency-graph svg{border:0;outline:0;box-shadow:none;border-radius:0;overflow:hidden;clip-path:none}
  .period-switch{transition:background-color .25s ease,border-color .25s ease}
  .period-switch button{border-radius:999px;transition:background-color .25s ease,color .25s ease,transform .2s cubic-bezier(.2,.8,.2,1)}
  .period-switch button.active{box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--m3c-primary) 18%,transparent)}
  .period-switch button:not(:disabled):hover{transform:translateY(-1px)}
  .incident-row:hover{padding-left:0}
  .status-dot.up{animation:status-breathe 2.4s ease-in-out infinite}
  @keyframes page-enter{from{opacity:0}to{opacity:1}}
    @keyframes card-arrive{from{opacity:0}to{opacity:1}}
  @keyframes bar-grow{from{transform:scaleY(.25);opacity:.4}to{transform:scaleY(1);opacity:1}}
  @keyframes draw-graph{to{stroke-dashoffset:0}}
  @keyframes status-breathe{0%,100%{box-shadow:0 0 0 0 rgb(37 134 83 / 0%)}50%{box-shadow:0 0 0 4px rgb(37 134 83 / 10%)}}
  @media(prefers-reduced-motion:reduce){.boot-brand,.boot-caption,.service-list :global(.m3-card),.uptime-bar,.graph-line,.chart-area-line,.status-dot.up{animation:none!important}.boot-screen,.shell{transition:none!important}.booting{visibility:hidden}button,a,[role="slider"],input,select,.service-card,.history-row,.incident-row,.uptime-bar,.graph-line,.status-word{transition:none!important}}


  /* LayerChart fills its container; constrain it to the same rounded frame as the rest of the UI. */
  .area-chart{position:relative;display:block;min-width:0;width:100%;height:132px;box-sizing:border-box;overflow:hidden;border:1px solid color-mix(in srgb,var(--m3c-outline-variant) 75%,transparent);border-radius:12px;background:transparent;padding:0}
  .area-chart :global(svg){display:block;width:100%!important;height:100%!important;max-width:100%;overflow:hidden;border:0!important;outline:0!important;box-shadow:none!important;border-radius:0!important;background:transparent}
  .area-chart :global(.chart-container),.area-chart :global(.chart-wrapper){width:100%;height:100%;min-width:0;max-width:100%}
  .latency-graph{min-width:0;width:100%;overflow:hidden}
  .latency-graph>*{min-width:0;max-width:100%}
  .chart-axis-labels{display:flex;justify-content:space-between;gap:12px;margin-top:6px;color:var(--m3c-on-surface-variant);font-size:10px}
  @media(max-width:560px){
    .shell{padding-inline:16px}
    .hero{padding-top:36px}
    .hero-meta{align-items:flex-start}
    .service-metrics{grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
    .metric-label{font-size:10px}
    .service-metrics strong{font-size:15px;overflow-wrap:anywhere}
    .uptime-bars{gap:2px}
    .area-chart{height:112px}
    .history-row{grid-template-columns:minmax(0,1fr) minmax(72px,.7fr) minmax(72px,.7fr);gap:8px}
    .history-row strong{overflow-wrap:anywhere}
    .incident-row time{max-width:35%;overflow-wrap:anywhere}
    footer{align-items:flex-start}
  }
  @media(max-width:560px){.incident-row{grid-template-columns:8px minmax(0,1fr);row-gap:5px}.incident-row time{grid-column:2;grid-row:2;text-align:left;white-space:normal;max-width:none}.incident-row>div{grid-column:2;grid-row:1}}
  @media(max-width:380px){
    .shell{padding-inline:12px}
    .live-indicator{gap:5px}
    .top-actions{gap:8px}
    h1{font-size:32px}
    .service-metrics{gap:5px}
    .history-row{grid-template-columns:minmax(0,1fr) 68px 68px}
    .history-row strong{font-size:10px}
  }


  .area-chart :global(svg text){display:none!important}
  .area-chart :global(.lc-root-container){width:100%;height:100%;overflow:hidden;border-radius:11px}
  .area-chart :global(.lc-axis text){display:none!important}
  .area-chart :global(svg){border-radius:0!important}
  .area-chart{border-radius:16px!important;background:color-mix(in srgb,var(--m3c-surface-container-low) 40%,transparent)!important}
  .latency-graph{min-width:0;width:100%;overflow:hidden}
  .uptime-title{align-items:center}
  @media(max-width:560px){.area-chart{height:112px}.service-metrics{grid-template-columns:repeat(3,minmax(0,1fr))}.service-metrics strong{overflow-wrap:anywhere}}

  /* Keep incident markers, labels and timestamps on a deliberate shared grid. */
  .incident-row{grid-template-columns:8px minmax(0,1fr) auto;align-items:start;column-gap:12px}
  .incident-row .incident-mark{grid-column:1;grid-row:1;align-self:start;margin-top:6px}
  .incident-row>div{grid-column:2;grid-row:1;min-width:0}
  .incident-row time{grid-column:3;grid-row:1;align-self:start;margin:0;padding-top:1px;line-height:1.5;text-align:right}
  @media(max-width:560px){
    .incident-row{grid-template-columns:8px minmax(0,1fr);column-gap:12px;row-gap:5px}
    .incident-row>div{grid-column:2;grid-row:1}
    .incident-row time{grid-column:2;grid-row:2;margin:0;padding-top:0;text-align:left;white-space:normal;max-width:none}
  }
</style>