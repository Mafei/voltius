import SessionConnectionForm from "@/components/connections/SessionConnectionForm";
import type { Connection } from "@/types";

/** Android keeps its existing sheet; both shells share the controller and form. */
export default function TmuxSessionSheet(props: { connection: Connection; onClose: () => void; onOpened: () => void }) {
  return <SessionConnectionForm {...props} presentation="sheet" />;
}
