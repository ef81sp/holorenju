import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";
import { URL, fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import svgLoader from "vite-svg-loader";

import { analysisDataPlugin } from "./vite-plugins/analysisDataPlugin";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    svgLoader(),
    analysisDataPlugin(),
    // eslint-disable-next-line new-cap
    VitePWA({
      registerType: "prompt",
      injectRegister: null,
      manifest: {
        name: "ホロ連珠 - フブみこさんと学ぶ五目並べ",
        short_name: "ホロ連珠",
        description: "フブみこさんと学ぶ五目並べ",
        lang: "ja",
        theme_color: "#5fdeec",
        background_color: "#5fdeec",
        display: "fullscreen",
        display_override: ["fullscreen"],
        orientation: "landscape",
        scope: "/",
        start_url: "/",
        icons: [
          {
            src: "holorenju-logo-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "holorenju-logo-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "holorenju-logo-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg}"],
        globIgnores: ["editor.html", "**/editor-*"],
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/editor\.html/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "google-fonts-stylesheets",
              expiration: { maxEntries: 5, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-webfonts",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /\/scenarios\/index\.json$/,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "scenario-index",
              expiration: { maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
          {
            urlPattern: /\/scenarios\/.*\.json$/,
            handler: "CacheFirst",
            options: {
              cacheName: "scenario-data",
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
          {
            urlPattern: /\.opus$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "audio-cache",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 90,
              },
              cacheableResponse: { statuses: [0, 200] },
              rangeRequests: true,
            },
          },
        ],
      },
    }),
  ],
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
