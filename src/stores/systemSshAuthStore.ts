import { create } from "zustand";
import { persist } from "zustand/middleware";
import { getPlatformSync } from "@/utils/platform";
import { normalizeSavedSystemSshAuth, type SavedSystemSshAuth, type SystemSshAuth } from "@/services/systemSshAuth";

interface State {
  byConnection: Record<string, SavedSystemSshAuth>;
  invalid: Record<string, boolean>;
  setInvalid: (connectionId: string, invalid: boolean) => void;
  set: (connectionId: string, value: SystemSshAuth | undefined) => void;
}

function normalizePolicies(value: unknown): Record<string, SavedSystemSshAuth> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([id, raw]) => {
    const policy = normalizeSavedSystemSshAuth(raw); return policy ? [[id, policy]] : [];
  }));
}

/** Account-scoped device preference. Excluded from vault, export and settings sync. No secrets. */
export const useSystemSshAuthStore = create<State>()(persist((set) => ({
  byConnection: {}, invalid: {},
  setInvalid: (id, invalid) => set((s) => ({ invalid: { ...s.invalid, [id]: invalid } })),
  set: (id, value) => set((s) => {
    const byConnection = { ...s.byConnection };
    const normalized = normalizeSavedSystemSshAuth(value);
    if (normalized) byConnection[id] = normalized; else delete byConnection[id];
    return { byConnection };
  }),
}), { name: "voltius-system-ssh-auth", version: 1,
  migrate: (state) => ({ byConnection: normalizePolicies((state as { byConnection?: unknown } | undefined)?.byConnection) }),
  partialize: (s) => ({ byConnection: normalizePolicies(s.byConnection) }),
}));

export function systemSshAuthFor(connectionId: string): SystemSshAuth | undefined {
  const stored = useSystemSshAuthStore.getState().byConnection[connectionId];
  if (stored === undefined) return;
  const platform = getPlatformSync();
  if (platform === "android" || platform === "ios") return;
  const policy = normalizeSavedSystemSshAuth(stored);
  if (policy?.mode === "removed-agent") throw new Error("SSH agent login has been removed. Explicitly choose system private key files or vault credentials before connecting.");
  if (policy?.mode === "invalid") throw new Error("Saved system SSH policy is invalid. Explicitly choose system private key files or vault credentials before connecting.");
  if (!policy || policy.mode !== "keys" || useSystemSshAuthStore.getState().invalid[connectionId]) throw new Error("System SSH identity paths are invalid. Enter up to three file paths.");
  return { ...policy, credentialId: connectionId };
}
