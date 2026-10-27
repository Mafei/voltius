/** FIFO per transport lane; rejection must not strand later operations. */
const tails = new Map<string, Promise<unknown>>();
export function orderedOperation<T>(lane: string, operation: () => Promise<T>): Promise<T> {
  const next = (tails.get(lane) ?? Promise.resolve()).then(operation, operation);
  tails.set(lane, next);
  const settled = () => { if (tails.get(lane) === next) tails.delete(lane); };
  void next.then(settled, settled);
  return next;
}
