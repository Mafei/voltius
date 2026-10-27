/** Content-free flight recorder. No arbitrary strings, error messages or persistence. */
const kinds = ["input_native", "input_received", "input_enqueue", "input_ack", "input_error", "input_rejected",
  "output_channel", "output_write", "output_processed", "pause_request", "pause_ack", "pause_error",
  "resize_request", "resize_ack", "resize_error", "mount", "connection", "dispose", "visible",
  "viewport", "focus", "native_state", "native_stale", "marker_input", "marker_render", "renderer", "attach", "close"] as const;
export type TraceKind = typeof kinds[number];
const fields = new Set(["bytes", "seq", "pending", "queued", "latency", "cols", "rows", "dpr", "focused",
  "connected", "visible", "epoch", "connection", "open", "imeVisible", "active", "accepting", "result",
  "renderer", "errors", "processingMs", "composing", "nativeReceived", "nativeWritten", "nativeOutput", "nativeRead", "nativeErrors",
  "nativePauseSeq", "nativePaused", "nativeResizeSeq", "nativeCols", "nativeRows", "nativeImeBytes", "nativeImeKeys", "nativeImeRejected",
  "nativeDpr", "nativeTextZoom", "width", "height", "cellWidth", "cellHeight", "fontSize", "lineHeight", "fontReady", "readOnly", "overlay", "locked", "transport"]);
export type TraceFields = Record<string, number | boolean>;
interface TraceEvent { at: number; session: number; kind: TraceKind; samples: number; values: TraceFields }
export class TerminalTrace {
  private ring: (TraceEvent | undefined)[];
  private start = 0;
  private size = 0;
  private aliases = new Map<string, number>();
  private aliasSeq = 0;
  private overwritten = 0;
  private hot = new Map<string, TraceEvent>();
  constructor(private capacity = 2048, private ttl = 15 * 60_000, private now = Date.now) {
    this.ring = new Array(capacity);
  }
  private removeOldest() {
    const event = this.ring[this.start];
    if (event) {
      const key = `${event.session}:${event.kind}`;
      if (this.hot.get(key) === event) this.hot.delete(key);
    }
    this.ring[this.start] = undefined;
    this.start = (this.start + 1) % this.capacity;
    this.size--;
  }
  prune() {
    while (this.size && this.now() - this.ring[this.start]!.at > this.ttl) this.removeOldest();
    if (!this.size) { this.aliases.clear(); this.hot.clear(); }
  }
  record(id: string | null, kind: TraceKind, input: TraceFields = {}) {
    if (!kinds.includes(kind)) return;
    this.prune();
    if (id && id.length > 128) id = null;
    if (kind === "marker_input" || kind === "marker_render") this.hot.clear();
    let session = 0;
    if (id) {
      session = this.aliases.get(id) ?? ++this.aliasSeq;
      this.aliases.delete(id); this.aliases.set(id, session);
      if (this.aliases.size > 128) this.aliases.delete(this.aliases.keys().next().value!);
    }
    const values: TraceFields = {};
    for (const [key, value] of Object.entries(input)) {
      if (!fields.has(key)) continue;
      if (typeof value === "boolean") values[key] = value;
      else if (typeof value === "number" && Number.isFinite(value)) values[key] = Math.max(-1e12, Math.min(1e12, value));
    }
    const at = this.now(), key = `${session}:${kind}`, previous = this.hot.get(key);
    // Markers and lifecycle transitions retain their exact order; only byte hot paths coalesce.
    const aggregate = ["input_native", "input_received", "input_enqueue", "input_ack", "output_channel", "output_write", "output_processed"].includes(kind);
    if (aggregate && previous && at - previous.at < 250) {
      const bytes = Number(previous.values.bytes ?? 0) + Number(values.bytes ?? 0);
      Object.assign(previous.values, values, { bytes }); previous.samples++;
      return;
    }
    if (this.size === this.capacity) { this.overwritten++; this.removeOldest(); }
    const event = { at, session, kind, samples: 1, values };
    this.ring[(this.start + this.size++) % this.capacity] = event;
    if (aggregate) {
      this.hot.delete(key); this.hot.set(key, event);
      if (this.hot.size > 256) this.hot.delete(this.hot.keys().next().value!);
    }
  }
  sessionIds() { return [...this.aliases.keys()]; }
  stats() { return { retained: this.size, overwritten: this.overwritten }; }
  snapshot() {
    this.prune();
    return Array.from({ length: this.size }, (_, i) => {
      const e = this.ring[(this.start + i) % this.capacity]!;
      return { ...e, values: { ...e.values } };
    });
  }
}
export const terminalTrace = new TerminalTrace();
export const traceTerminal = (id: string | null, kind: TraceKind, fields?: TraceFields) => terminalTrace.record(id, kind, fields);
