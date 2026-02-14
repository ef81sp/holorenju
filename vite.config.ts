import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";
import { URL, fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import svgLoader from "vite-svg-loader";

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), svgLoader()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@scripts": fileURLToPath(new URL("./scripts", import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        editor: resolve(__dirname, "editor.html"),
      },
    },
  },
});
