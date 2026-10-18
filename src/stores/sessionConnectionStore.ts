import { create } from "zustand";
import type { Connection } from "@/types";

type Request = { token: string; connection: Connection; direct: boolean };
interface State {
  pending: Request[];
  opened: string[];
  complete?: (ids: string[]) => void;
  request: (connections: Connection[], complete: (ids: string[]) => void, direct?: boolean) => void;
  finish: (token: string, sessionId: string) => void;
  cancel: (token?: string) => void;
}

/** Transient desktop dialog queue. Credentials and host preferences are never persisted here. */
export const useSessionConnectionStore = create<State>((set, get) => ({
  pending: [], opened: [],
  request: (connections, complete, direct = false) => {
    if (!connections.length) return;
    const current = get().pending;
    if (connections.length === 1 && current.length === 1 && current[0].connection.id === connections[0].id) return;
    set({ pending: connections.map((connection) => ({ token: crypto.randomUUID(), connection, direct })), opened: [], complete });
  },
  finish: (token, sessionId) => {
    const state = get();
    if (state.pending[0]?.token !== token) return;
    const pending = state.pending.slice(1), opened = [...state.opened, sessionId];
    set({ pending, opened: pending.length ? opened : [], complete: pending.length ? state.complete : undefined });
    if (!pending.length) state.complete?.(opened);
  },
  cancel: (token) => {
    if (token && get().pending[0]?.token !== token) return;
    set({ pending: [], opened: [], complete: undefined });
  },
}));
