import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const frontendPort = 7777;
const backendTarget = "http://127.0.0.1:7778";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: frontendPort,
    strictPort: true,
    proxy: {
      "/api": backendTarget,
      "/health": backendTarget,
    },
  },
  preview: {
    host: "127.0.0.1",
    port: frontendPort,
    strictPort: true,
  },
});
