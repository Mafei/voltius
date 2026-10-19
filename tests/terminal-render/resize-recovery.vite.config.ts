import { defineConfig } from "vite";
import { realpathSync } from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../..");
export default defineConfig({
  root, resolve: { alias: { "@": path.join(root, "src") } },
  cacheDir: process.env.VOLTIUS_DIAGNOSTIC_CACHE,
  server: { host: "127.0.0.1", port: 1431, strictPort: true,
    fs: { allow: [root, realpathSync(path.join(root, "node_modules"))] } },
});
