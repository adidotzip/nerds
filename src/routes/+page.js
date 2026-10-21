// The page loads all live status data in onMount. Serve the shell statically so
// a transient SSR/runtime issue cannot turn the entire status page into a Vercel 500.
export const ssr = false;
export const prerender = true;
