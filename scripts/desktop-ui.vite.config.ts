import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import path from "node:path";
import { realpathSync } from "node:fs";
import { iconSubsets } from "../vite-plugin-icon-subsets.ts";
const root = path.resolve(import.meta.dirname, "..");
export default defineConfig({
  root, plugins: [react(), svgr(), iconSubsets()],
  resolve: { alias: [
    { find: "@/utils/clipboard", replacement: path.join(root, "tests/desktop-ui/clipboard.ts") },
    { find: "@/services/terminalInput", replacement: path.join(root, "tests/desktop-ui/mobileInput.ts") },
    { find: "@/services/tmuxPicker", replacement: path.join(root, "tests/desktop-ui/picker.ts") },
    { find: "@/components/terminal/connection-overlay/hooks", replacement: path.join(root, "tests/desktop-ui/native.ts") },
    { find: "@/lib/invoke", replacement: path.join(root, "tests/desktop-ui/native.ts") },
    { find: "@tauri-apps/api/event", replacement: path.join(root, "tests/desktop-ui/native.ts") },
    { find: "@voltius/ui", replacement: path.join(root, "src/plugins/ui.ts") },
    { find: "@voltius/tools", replacement: path.join(root, "src/plugins/toolSurface/index.ts") },
    { find: "@", replacement: path.join(root, "src") },
  ] },
  server: { hmr: false, fs: { allow: [root, realpathSync(path.join(root, "node_modules"))] }, host: "127.0.0.1", port: 1428, strictPort: true, watch: { ignored: ["**/target/**", "**/node_modules/**"] } },
  build: { outDir: path.join(root, "node_modules/.cache/voltius-desktop-ui"), rolldownOptions: { input: path.join(root, "tests/desktop-ui/index.html") } },
});
