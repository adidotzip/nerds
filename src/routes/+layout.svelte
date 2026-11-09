<script>
  import "../app.css";
  let { children } = $props();
</script>

<svelte:head>
  <link rel="preload" href="/fonts/GoogleSansRounded-Regular.ttf" as="font" type="font/ttf" crossorigin />
  <link rel="preload" href="/fonts/GoogleSansRounded-Medium.ttf" as="font" type="font/ttf" crossorigin />
  <link rel="preload" href="/fonts/GoogleSansRounded-Bold.ttf" as="font" type="font/ttf" crossorigin />
</svelte:head>

{@render children()}
