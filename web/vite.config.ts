import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const BFF = "http://localhost:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: BFF, changeOrigin: true, ws: true },
    },
  },
});
