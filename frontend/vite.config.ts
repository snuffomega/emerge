import path from "node:path";
import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { hostedPreviewPlugins, hostedPreviewServer } from "./vite.hosted-preview.ts";

const apiProxy = process.env.WORKRATE_API_PROXY;

export default defineConfig({
  plugins: [react(), tailwindcss(), ...(hostedPreviewPlugins() as PluginOption[])],
  envPrefix: ["VITE_", "REACT_APP_"],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: {
    host: "0.0.0.0",
    port: 3000,
    ...(apiProxy ? { proxy: { "/api": { target: apiProxy, changeOrigin: true } } } : {}),
    ...hostedPreviewServer(),
  },
});
