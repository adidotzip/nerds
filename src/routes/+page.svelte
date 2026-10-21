<script>
  import { onMount } from "svelte";
  import { Button, Card, Chip } from "m3-svelte";

  let data = $state(null);
  let domain = $state(null);
  let failed = $state(false);
  let dark = $state(false);
  let selected = $state("24h");

  const statusText = {
    up: "All systems operational",
    partial: "Partial service disruption",
    degraded: "Degraded performance",
    down: "Service disruption",
    unknown: "Status temporarily unavailable"
  };
  const time = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Awaiting first check";
  const latency = (value) => Number.isFinite(value) ? Math.round(value) + " ms" : "Not available";

  async function refresh() {
    try {
      const response = await fetch("/api/status", { cache: "no-store" });
      if (!response.ok) throw new Error("Status unavailable");
      data = await response.json();
      failed = false;
    } catch {
      failed = true;
      data = { status: "unknown", updatedAt: null, services: [] };
    }
    try {
      const response = await fetch("/api/domain-health", { cache: "no-store" });
      if (response.ok) domain = await response.json();
    } catch { domain = null; }
  }
  function toggleTheme() {
    dark = !dark;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try { localStorage.setItem("adi-theme", dark ? "dark" : "light"); } catch {}
  }
  onMount(() => {
    try {
      const saved = localStorage.getItem("adi-theme");
      dark = saved ? saved === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    } catch {}
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => clearInterval(timer);
  });
</script>

<svelte:head>
  <title>Status · adi.rest</title>
  <meta name="description" content="Live availability for adi.rest services." />
</svelte:head>

<div class="shell">
  <header class="topbar">
    <a class="brand" href="/" aria-label="adi.rest status home"><span class="brand-icon">a.</span><span>adi.rest</span></a>
    <div class="top-actions"><span class="overline">SYSTEM STATUS</span><Button variant="outlined" size="s" onclick={toggleTheme}>{dark ? "Light theme" : "Dark theme"}</Button></div>
  </header>

  <main>
    <section class="hero">
      <div class="status-line"><span class="status-dot {data?.status || 'unknown'}"></span><span>{statusText[data?.status || "unknown"]}</span></div>
      <h1>{data?.status === "up" ? "Everything is in its place." : data?.status === "down" || data?.status === "partial" ? "A service needs attention." : "A clear view of what’s up."}</h1>
      <p class="intro">{failed ? "We couldn't reach the live status endpoint. No status is being assumed." : "The services behind adi.rest, checked live. Just the signal, no noise."}</p>
      <div class="refresh"><span>Updated {time(data?.updatedAt)}</span><span class="dot-sep">•</span><span>Live checks · 30 second refresh</span><Button variant="text" size="s" onclick={refresh}>Refresh now</Button></div>
    </section>

    <section class="section">
      <div class="section-title"><div><p class="eyebrow">LIVE MONITORING</p><h2>Services</h2></div><span class="subtle">{data?.services?.length ?? 0} monitored targets</span></div>
      <div class="service-list">
        {#if !data}
          <Card variant="outlined"><p>Checking configured services…</p></Card>
        {:else if data.services.length === 0}
          <Card variant="outlined"><p>Live results are unavailable. Try refreshing in a moment.</p></Card>
        {:else}
          {#each data.services as service (service.id)}
            <Card variant="outlined">
              <div class="service-row">
                <div class="service-icon" aria-hidden="true">{service.id === "adi-rest" ? "language" : service.id === "lyrics-api" ? "data_object" : "public"}</div>
                <div class="service-info"><h3>{service.name}</h3><p>{service.description}</p><a href={service.url} target="_blank" rel="noreferrer">{service.url} ↗</a></div>
                <div class="metric"><strong>{latency(service.latest?.responseTimeMs)}</strong><span>Response time</span></div>
                <div class="service-state"><Chip variant="general" disabled>{service.statusLabel || "Unknown"}</Chip><span class="checked">Checked {time(service.latest?.timestamp)}</span></div>
              </div>
            </Card>
          {/each}
        {/if}
      </div>
    </section>

    <section class="section">
      <div class="section-title"><div><p class="eyebrow">DOMAIN HEALTH</p><h2>imreallyadi.space</h2></div><Chip variant="general" disabled>Registration</Chip></div>
      <Card variant="outlined">
        <div class="domain-row">
          <div class="domain-copy"><h3>{domain?.expirationDate ? "Configured expiration date" : "Expiration date not verified"}</h3><p>{domain?.expirationDate ? "The date was supplied manually and has not been independently verified. Domain registration and website availability are separate." : "No trustworthy registration date is available. Nothing is guessed."}</p><p class="domain-meta">{domain?.dns ? (domain.dns.ok ? "DNS resolves" : "DNS lookup failed") : "DNS status unavailable"} · {domain?.tls ? (domain.tls.valid ? "HTTPS connection succeeded" : "HTTPS connection failed") : "HTTPS status unavailable"}</p></div>
          <div class="countdown"><strong>{domain?.daysRemaining ?? "—"}</strong><span>days remaining</span></div>
        </div>
      </Card>
    </section>

    <section class="section method">
      <div class="section-title"><div><p class="eyebrow">HOW IT WORKS</p><h2>Simple by design</h2></div></div>
      <div class="method-grid">
        <Card variant="outlined"><span class="method-number">01</span><h3>Live HTTP checks</h3><p>Results come from requests to the configured service URLs.</p></Card>
        <Card variant="outlined"><span class="method-number">02</span><h3>No invented history</h3><p>This deployment shows live results, not fabricated uptime percentages or incidents.</p></Card>
        <Card variant="outlined"><span class="method-number">03</span><h3>No alerting</h3><p>No notifications, alerts, or database. Just a public status view.</p></Card>
      </div>
    </section>
  </main>

  <footer><span class="brand-icon small">a.</span><span>Quietly keeping an eye on things.</span><a href="/api/status">Public API ↗</a></footer>
</div>

<style>
  .shell { width:min(1040px,100%); margin:auto; padding:0 32px; }
  .topbar { min-height:76px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--m3c-outline-variant); }
  .brand { display:flex; align-items:center; gap:12px; font-weight:650; letter-spacing:-.03em; }
  .brand-icon { display:grid; place-items:center; width:32px; height:32px; background:var(--m3c-primary-container); color:var(--m3c-on-primary-container); border-radius:12px 12px 12px 4px; font-size:17px; font-weight:750; }
  .brand-icon.small { width:24px; height:24px; border-radius:9px 9px 9px 3px; font-size:12px; }
  .top-actions { display:flex; align-items:center; gap:16px; }
  .overline,.eyebrow { font-size:11px; font-weight:650; letter-spacing:.12em; color:var(--m3c-on-surface-variant); }
  .hero { padding:64px 0 50px; border-bottom:1px solid var(--m3c-outline-variant); }
  .status-line { display:flex; align-items:center; gap:10px; font-size:14px; font-weight:600; margin-bottom:24px; text-transform:capitalize; }
  .status-dot { width:10px; height:10px; border-radius:50%; background:var(--m3c-outline); flex-shrink:0; }
  .status-dot.up { background:#247747; } .status-dot.degraded,.status-dot.partial { background:#89510b; } .status-dot.down { background:var(--m3c-error); }
  h1 { font-size:clamp(38px,6vw,62px); font-weight:650; letter-spacing:-.055em; line-height:1.05; max-width:750px; margin:0; text-wrap:balance; }
  .intro { font-size:16px; line-height:1.7; color:var(--m3c-on-surface-variant); max-width:590px; margin:18px 0 24px; }
  .refresh { display:flex; align-items:center; flex-wrap:wrap; gap:10px; color:var(--m3c-on-surface-variant); font-size:12px; }
  .dot-sep { color:var(--m3c-outline); }
  .section { padding-top:42px; }
  .section-title { display:flex; align-items:flex-end; justify-content:space-between; gap:18px; margin-bottom:18px; }
  .eyebrow { margin:0 0 7px; font-size:10px; }
  h2 { margin:0; font-size:26px; letter-spacing:-.04em; font-weight:650; }
  .subtle { color:var(--m3c-on-surface-variant); font-size:12px; padding-bottom:4px; }
  .service-list { display:grid; gap:12px; }
  .service-row { display:grid; grid-template-columns:44px minmax(0,1fr) minmax(100px,.45fr) auto; align-items:center; gap:18px; }
  .service-icon { display:grid; place-items:center; width:42px; height:42px; border-radius:14px; background:var(--m3c-secondary-container); color:var(--m3c-on-secondary-container); font-size:10px; font-weight:700; overflow-wrap:anywhere; }
  .service-info h3,.domain-copy h3,.method-grid h3 { margin:0 0 5px; font-size:16px; font-weight:650; letter-spacing:-.02em; }
  .service-info p,.domain-copy p,.method-grid p { margin:0 0 5px; font-size:12px; color:var(--m3c-on-surface-variant); line-height:1.6; }
  .service-info a { display:inline-block; font-size:11px; color:var(--m3c-primary); overflow-wrap:anywhere; }
  .metric strong { display:block; font-size:17px; font-weight:650; font-variant-numeric:tabular-nums; }
  .metric span,.checked { display:block; margin-top:4px; font-size:11px; color:var(--m3c-on-surface-variant); }
  .service-state { display:grid; justify-items:end; gap:8px; }
  .domain-row { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:28px; }
  .domain-meta { padding-top:7px; }
  .countdown { min-width:100px; text-align:right; }
  .countdown strong { display:block; font-size:32px; font-weight:650; letter-spacing:-.05em; font-variant-numeric:tabular-nums; }
  .countdown span { font-size:11px; color:var(--m3c-on-surface-variant); }
  .method-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }
  .method-number { display:block; font-size:11px; letter-spacing:.08em; color:var(--m3c-primary); margin-bottom:18px; }
  .method-grid h3 { font-size:14px; }
  footer { margin-top:50px; min-height:78px; border-top:1px solid var(--m3c-outline-variant); display:flex; align-items:center; gap:10px; color:var(--m3c-on-surface-variant); font-size:12px; }
  footer a { margin-left:auto; color:var(--m3c-primary); }
  @media(max-width:700px) { .shell{padding:0 20px}.hero{padding:48px 0 38px}.service-row{grid-template-columns:38px minmax(0,1fr) auto;gap:12px}.service-icon{width:36px;height:36px}.metric{grid-column:2;grid-row:2}.service-state{grid-column:3;grid-row:1/3}.service-info a{max-width:100%}.method-grid{grid-template-columns:1fr}.domain-row{gap:12px}.countdown{min-width:75px}.section{padding-top:34px} }
  @media(max-width:420px) { .shell{padding:0 14px}.topbar{min-height:68px}.overline{display:none}h1{font-size:38px}.refresh{gap:7px}.service-row{gap:9px}.service-state .checked{max-width:96px;text-align:right;font-size:9px}.countdown strong{font-size:26px} }
</style>
