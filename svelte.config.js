import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({ fallback: "200.html" }),
    alias: { $lib: "./src/lib" },
    prerender: { handleHttpError: "warn" }
  }
};
export default config;
