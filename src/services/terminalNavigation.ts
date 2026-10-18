import { useUIStore } from "@/stores/uiStore";

/** Bring the terminal forward, closing panels that would cover it. */
export function goToTerminal(): void {
  const ui = useUIStore.getState();
  ui.setSidebarOpen(false);
  ui.setSftpPanelOpen(false);
  ui.setActiveNav("terminal");
  ui.setHomeView(false);
}
