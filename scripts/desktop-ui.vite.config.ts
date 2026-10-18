import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { iconSubsets } from "../vite-plugin-icon-subsets";
const root = path.resolve(import.meta.dirname, "..");
export default defineConfig({
  root, plugins: [react(), svgr(), iconSubsets(), {
    name: "synthetic-delayed-terminal-font",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split("?")[0] !== "/tests/terminal-render/delayed-mono.woff2") return next();
        await new Promise((resolve) => setTimeout(resolve, 2500));
        try {
          const bytes = await readFile(path.join(root, "node_modules/@fontsource/source-code-pro/files/source-code-pro-latin-400-normal.woff2"));
          res.setHeader("Content-Type", "font/woff2"); res.end(bytes);
        } catch { res.statusCode = 500; res.end("Synthetic font fixture unavailable"); }
      });
    },
  }],
  resolve: { alias: [
    { find: "@/services/terminalInput", replacement: path.join(root, "tests/desktop-ui/mobileInput.ts") },
    { find: "@/services/tmuxPicker", replacement: path.join(root, "tests/desktop-ui/picker.ts") },
    { find: "@/components/terminal/connection-overlay/hooks", replacement: path.join(root, "tests/desktop-ui/native.ts") },
    { find: "@/lib/invoke", replacement: path.join(root, "tests/desktop-ui/native.ts") },
    { find: "@tauri-apps/api/event", replacement: path.join(root, "tests/desktop-ui/native.ts") },
    { find: "@voltius/ui", replacement: path.join(root, "src/plugins/ui.ts") },
    { find: "@voltius/tools", replacement: path.join(root, "src/plugins/toolSurface/index.ts") },
    { find: "@", replacement: path.join(root, "src") },
  ] },
  server: { host: "127.0.0.1", port: 1428, strictPort: true, watch: { ignored: ["**/target/**", "**/node_modules/**"] } },
  build: { outDir: path.join(root, "node_modules/.cache/voltius-desktop-ui"), rollupOptions: { input: ["tests/desktop-ui/index.html", ...["index", "font", "ambiguous", "keyboard", "context"].map((name) => `tests/terminal-render/${name}.html`)].map((p) => path.join(root, p)) } },
});
