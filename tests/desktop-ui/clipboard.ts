/** Synthetic browser-only clipboard. Never reads the host/system clipboard. */
export const clipboardFixture = { text: "", reads: 0, delay: 0 };
export async function readClipboard() { clipboardFixture.reads++; const text = clipboardFixture.text; if (clipboardFixture.delay) await new Promise(r => setTimeout(r, clipboardFixture.delay)); return text; }
export async function writeClipboard(text: string) { clipboardFixture.text = text; }
export async function writeClipboardImage() { throw Error("Synthetic fixture has no image clipboard"); }
