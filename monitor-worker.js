export default {
  async scheduled(_controller, env) {
    if (!env.MONITOR_API_URL) {
      throw new Error("Set MONITOR_API_URL to the deployed status site's origin.");
    }
    if (!env.CRON_SECRET) {
      throw new Error("Set the CRON_SECRET secret on the monitor Worker.");
    }

    const endpoint = new URL("/api/cron/check", env.MONITOR_API_URL);
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
      signal: AbortSignal.timeout(55000)
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Scheduled status check failed (${response.status}): ${detail.slice(0, 200)}`);
    }
  }
};
