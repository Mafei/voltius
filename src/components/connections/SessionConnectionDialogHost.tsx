import { useEffect, useRef } from "react";
import { useSessionConnectionStore } from "@/stores/sessionConnectionStore";
import SessionConnectionForm from "./SessionConnectionForm";

export function SessionConnectionDialogHost() {
  const request = useSessionConnectionStore((s) => s.pending[0]);
  const mount = useRef(0);
  useEffect(() => {
    const generation = ++mount.current;
    return () => queueMicrotask(() => { if (mount.current === generation) useSessionConnectionStore.getState().cancel(); });
  }, []);
  if (!request) return null;
  return <SessionConnectionForm key={request.token} connection={request.connection} direct={request.direct} presentation="dialog"
    onClose={() => useSessionConnectionStore.getState().cancel(request.token)}
    onOpened={(id) => useSessionConnectionStore.getState().finish(request.token, id)} />;
}
