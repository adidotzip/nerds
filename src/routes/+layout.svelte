<script>
  import "../app.css";
  let { children } = $props();
</script>

<svelte:head>
  <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin="anonymous" />
  <link rel="preconnect" href="https://raw.githubusercontent.com" crossorigin="anonymous" />
</svelte:head>

{@render children()}
