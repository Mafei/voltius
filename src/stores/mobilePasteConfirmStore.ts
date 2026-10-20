import { create } from "zustand";

interface Pending { sessionId: string; text: string; resolve: (ok: boolean) => void }
export const useMobilePasteConfirmStore = create<{ pending: Pending | null; request: (sessionId: string, text: string) => Promise<boolean>; finish: (ok: boolean) => void }>((set, get) => ({
  pending: null,
  request: (sessionId, text) => {
    if (get().pending) return Promise.resolve(false);
    return new Promise(resolve => set({ pending: { sessionId, text, resolve } }));
  },
  finish: ok => { const pending = get().pending; set({ pending: null }); pending?.resolve(ok); },
}));
