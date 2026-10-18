import { create } from "zustand";
import { persist } from "zustand/middleware";
import { getPlatformSync } from "@/utils/platform";
import { normalizeSystemSshAuth, type SystemSshAuth } from "@/services/systemSshAuth";

interface State {
  byConnection: Record<string, SystemSshAuth>;
  invalid: Record<string, boolean>;
  setInvalid: (connectionId: string, invalid: boolean) => void;
  set: (connectionId: string, value: SystemSshAuth | undefined) => void;
}

/** Account-scoped device preference. Excluded from vault, export and settings sync. No secrets. */
export const useSystemSshAuthStore = create<State>()(persist((set) => ({
  byConnection: {}, invalid: {},
  setInvalid: (id, invalid) => set((s) => ({ invalid: { ...s.invalid, [id]: invalid } })),
  set: (id, value) => set((s) => {
    const byConnection = { ...s.byConnection };
    const normalized = normalizeSystemSshAuth(value);
    if (normalized) byConnection[id] = normalized; else delete byConnection[id];
    return { byConnection };
  }),
}), { name: "voltius-system-ssh-auth", partialize: (s) => ({ byConnection: Object.fromEntries(Object.entries(s.byConnection).flatMap(([id, value]) => {
  const normalized = normalizeSystemSshAuth(value); return normalized ? [[id, normalized]] : [];
})) }) }));

export function systemSshAuthFor(connectionId: string): SystemSshAuth | undefined {
  const stored = useSystemSshAuthStore.getState().byConnection[connectionId];
  if (stored === undefined) return;
  const platform = getPlatformSync();
  if (platform === "android" || platform === "ios") return;
  const policy = normalizeSystemSshAuth(stored);
  if (!policy || useSystemSshAuthStore.getState().invalid[connectionId]) throw new Error("System SSH identity paths are invalid. Enter up to three file paths.");
  return { ...policy, credentialId: connectionId };
}
