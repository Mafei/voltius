export interface FingerPoint { identifier: number; clientX: number; clientY: number }
type Intent = "pending" | "scroll" | "pinch" | "cancelled";
const sample = (a: FingerPoint, b: FingerPoint) => ({ x: (a.clientX + b.clientX) / 2,
  y: (a.clientY + b.clientY) / 2, span: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) });

/** Resolve once per contact sequence. Centroid translation wins over small span
 * jitter; ambiguous motion waits. Never reinterpret a locked scroll as zoom. */
export class TwoFingerGesture {
  private origin;
  private previousY: number;
  private intent: Intent = "pending";
  private ids: number[];
  constructor(a: FingerPoint, b: FingerPoint) {
    this.origin = sample(a, b); this.previousY = this.origin.y;
    this.ids = [a.identifier, b.identifier].sort();
  }
  cancel(): void { this.intent = "cancelled"; }
  move(points: ArrayLike<FingerPoint>) {
    if (points.length !== 2 || [points[0].identifier, points[1].identifier].sort().some((id, i) => id !== this.ids[i])) this.cancel();
    if (this.intent === "cancelled") return { intent: this.intent, dy: 0, ratio: 1, x: this.origin.x, y: this.origin.y };
    const now = sample(points[0], points[1]);
    const translation = Math.hypot(now.x - this.origin.x, now.y - this.origin.y), span = Math.abs(now.span - this.origin.span);
    if (this.intent === "pending") {
      if (translation >= 10 && translation >= span * 1.2) this.intent = "scroll";
      else if (span >= Math.max(12, this.origin.span * .08) && span > translation * 1.2) this.intent = "pinch";
    }
    const dy = now.y - this.previousY;
    // Include the threshold-crossing translation in the first scroll step.
    if (this.intent !== "pending") this.previousY = now.y;
    return { intent: this.intent, dy, ratio: this.origin.span > 0 ? now.span / this.origin.span : 1, x: now.x, y: now.y };
  }
}
