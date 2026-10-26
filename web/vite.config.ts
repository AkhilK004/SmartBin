import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The server has no CORS on its HTTP routes, so the browser talks to it through this proxy:
// /api/* -> http://localhost:4000/* and the Socket.io path as is.
const target = process.env.SERVER_URL ?? "http://localhost:4000";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, "") },
      "/socket.io": { target, ws: true, changeOrigin: true },
    },
  },
  preview: {
    proxy: {
      "/api": { target, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, "") },
      "/socket.io": { target, ws: true, changeOrigin: true },
    },
  },
});
