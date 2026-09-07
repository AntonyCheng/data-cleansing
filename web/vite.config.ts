import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const BFF = "http://localhost:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: BFF, changeOrigin: true, ws: true },
    },
  },
});
