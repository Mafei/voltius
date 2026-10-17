import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SessionType } from "@/services/ssh";

interface State {
  types: Record<string, SessionType>;
  setType: (connectionId: string, type: SessionType) => void;
}

/** Device-local host preference; tab snapshots retain their own independent backend/target. */
export const useSshSessionTypeStore = create<State>()(persist((set) => ({
  types: {},
  setType: (connectionId, type) => set((s) => ({ types: { ...s.types, [connectionId]: type } })),
}), { name: "voltius-ssh-session-types", partialize: (s) => ({ types: s.types }) }));

export function sessionTypeForHost(connectionId: string): SessionType {
  const value = useSshSessionTypeStore.getState().types[connectionId];
  return value === "tmux" || value === "zellij" ? value : "none";
}
