import { expect, test } from "vitest";
import { Terminal } from "@xterm/xterm";
import { createOutputDecoder } from "@/utils/terminalEncoding";

function snapshot(t: Terminal) {
  const b = t.buffer.active;
  return { lines: Array.from({ length: b.length }, (_, i) => b.getLine(i)?.translateToString(true)), x: b.cursorX, y: b.cursorY };
}
async function replay(chunks: Uint8Array[]) {
  const t = new Terminal({ cols: 40, rows: 12, allowProposedApi: true });
  const decode = createOutputDecoder("utf-8");
  await new Promise<void>((resolve) => chunks.forEach((c, i) => t.write(decode.decode(c), i === chunks.length - 1 ? resolve : undefined)));
  const result = snapshot(t); t.dispose(); return result;
}
test("real xterm preserves split Unicode, CSI/OSC/DCS and rapid write ordering", async () => {
  const text = "start\r\n\x1b[31m中文🙂é\x1b[0m\r\n\x1b]0;synthetic\x1b\\\x1bP$qm\x1b\\\x1b[2;1HXY\r\n".repeat(20);
  const bytes = new TextEncoder().encode(text), expected = await replay([bytes]);
  for (const size of [1, 2, 3, 7, 64]) {
    const chunks = Array.from({ length: Math.ceil(bytes.length / size) }, (_, i) => bytes.subarray(i * size, (i + 1) * size));
    expect(await replay(chunks)).toEqual(expected);
  }
});
