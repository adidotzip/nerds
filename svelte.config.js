import adapter from "@sveltejs/adapter-netlify";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    alias: { $lib: "./src/lib" },
    prerender: { handleHttpError: "warn" }
  }
};

export default config;
