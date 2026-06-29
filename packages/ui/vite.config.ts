import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const HOST = "http://localhost:4319";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: HOST, changeOrigin: true },
      "/ws": { target: HOST, ws: true, changeOrigin: true },
    },
  },
});
