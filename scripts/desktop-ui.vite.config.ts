import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import path from "node:path";
import { iconSubsets } from "../vite-plugin-icon-subsets";
const root = path.resolve(import.meta.dirname, "..");
export default defineConfig({
  root, plugins: [react(), svgr(), iconSubsets()],
  resolve: { alias: [
    { find: "@/services/tmuxPicker", replacement: path.join(root, "tests/desktop-ui/picker.ts") },
    { find: "@/components/terminal/connection-overlay/hooks", replacement: path.join(root, "tests/desktop-ui/native.ts") },
    { find: "@/lib/invoke", replacement: path.join(root, "tests/desktop-ui/native.ts") },
    { find: "@tauri-apps/api/event", replacement: path.join(root, "tests/desktop-ui/native.ts") },
    { find: "@voltius/ui", replacement: path.join(root, "src/plugins/ui.ts") },
    { find: "@voltius/tools", replacement: path.join(root, "src/plugins/toolSurface/index.ts") },
    { find: "@", replacement: path.join(root, "src") },
  ] },
  server: { host: "127.0.0.1", port: 1428, strictPort: true, watch: { ignored: ["**/target/**", "**/node_modules/**"] } },
  build: { outDir: path.join(root, "node_modules/.cache/voltius-desktop-ui"), rollupOptions: { input: path.join(root, "tests/desktop-ui/index.html") } },
});
