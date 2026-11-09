<script>
  let { wavy = false, indeterminate = false, value = 0, max = 1, ...rest } = $props();
  const points = Array.from({ length: 144 }, (_, i) => {
    const angle = (i / 144) * Math.PI * 2 - Math.PI / 2;
    const radius = 19 + (wavy ? Math.sin((i / 144) * Math.PI * 16) * 1.35 : 0);
    return `${(24 + Math.cos(angle) * radius).toFixed(2)},${(24 + Math.sin(angle) * radius).toFixed(2)}`;
  });
  const path = `M ${points.join(" L ")} Z`;
</script>

<svg
  class:wavy
  class:indeterminate
  viewBox="0 0 48 48"
  role="progressbar"
  aria-label={rest["aria-label"] || "Loading"}
  aria-valuemin={indeterminate ? undefined : 0}
  aria-valuemax={indeterminate ? undefined : max}
  aria-valuenow={indeterminate ? undefined : value}
>
  <circle class="track" cx="24" cy="24" r="19" />
  {#if wavy}
    <path class="indicator wave" d={path} />
  {:else}
    <circle class="indicator" cx="24" cy="24" r="19" pathLength="100" stroke-dasharray={indeterminate ? "25 75" : `${Math.max(0, Math.min(1, value / max)) * 100} 100`} />
  {/if}
</svg>

<style>
  svg { display: block; width: var(--np-circular-progress-size, 3rem); height: var(--np-circular-progress-size, 3rem); overflow: visible; color: var(--np-circular-progress-color, var(--m3c-primary)); }
  circle, path { fill: none; stroke: currentColor; stroke-width: var(--np-circular-progress-active-indicator-width, 4); stroke-linecap: round; }
  .track { opacity: .16; }
  .indicator { transform-origin: 24px 24px; }
  .indeterminate .indicator:not(.wave) { animation: spin 1.1s linear infinite; }
  .wave { stroke-linejoin: round; stroke-dasharray: 68 32; animation: spin 1.5s linear infinite, wave-flow 1.8s ease-in-out infinite alternate; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes wave-flow { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -100; } }
  @media (prefers-reduced-motion: reduce) { .indicator { animation-duration: 8s !important; } }
</style>
