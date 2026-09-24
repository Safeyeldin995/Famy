import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { issue68MockPlugin } from "./mock-plugin.mjs";
import { DEFAULT_HARNESS_PORT, HARNESS_HOST } from "./constants.mjs";

const hostDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(hostDir, "../..");

export default defineConfig({
  root: hostDir,
  envDir: hostDir,
  envPrefix: "VITE_",
  plugins: [react(), tailwindcss(), issue68MockPlugin(repoRoot)],
  resolve: {
    alias: {
      "@": path.join(repoRoot, "src"),
    },
  },
  appType: "spa",
  server: {
    host: HARNESS_HOST,
    port: DEFAULT_HARNESS_PORT,
    strictPort: true,
    fs: { allow: [repoRoot] },
  },
});
