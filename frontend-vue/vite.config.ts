import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

/** Dev server proxies API + static assets to FastAPI (default :8000). */
export default defineConfig({
  plugins: [vue()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/static": { target: "http://127.0.0.1:8000", changeOrigin: true },
    },
  },
});
