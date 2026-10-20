// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import { useMobilePasteConfirmStore } from "@/stores/mobilePasteConfirmStore";
import { useModifierLatchStore, consumeLatchForChar } from "@/stores/modifierLatchStore";
import { isTerminalPaste, pasteTerminalClipboard } from "./terminalPastePolicy";
vi.mock("@/hooks/useTerminal", () => ({ getTerminalApi: () => null }));
beforeEach(() => { useMobilePasteConfirmStore.getState().finish(false); useModifierLatchStore.setState({ ctrl: "locked", alt: "armed" }); });
function harness() {
  const bytes: string[] = [];
  const term = { paste: (text: string) => bytes.push(isTerminalPaste(term as unknown as Terminal) ? text : consumeLatchForChar(text) ?? text) };
  return { term: term as unknown as Terminal, bytes };
}
test("empty/control-only clips do nothing; Chinese and single characters bypass modifiers without consuming them", async () => {
  const { term, bytes } = harness();
  for (const text of ["", "\x1b\x00", "你好", "c"]) await pasteTerminalClipboard(term, "s1", text, true, () => true);
  expect(bytes).toEqual(["你好", "c"]);
  expect(useModifierLatchStore.getState()).toMatchObject({ ctrl: "locked", alt: "armed" });
  expect(isTerminalPaste(term)).toBe(false);
});
test.each([false, true])("multiline requires explicit confirmation=%s and does not append Enter", async accepted => {
  const { term, bytes } = harness();
  const done = pasteTerminalClipboard(term, "s1", "你好\r\necho test", true, () => true);
  expect(bytes).toEqual([]); expect(useMobilePasteConfirmStore.getState().pending?.text).toBe("你好\necho test");
  useMobilePasteConfirmStore.getState().finish(accepted); await done;
  expect(bytes).toEqual(accepted ? ["你好\necho test"] : []);
});
test("changing active session or connection while confirming drops the old paste", async () => {
  const { term, bytes } = harness(); let active = true;
  const done = pasteTerminalClipboard(term, "s1", "one\ntwo", true, () => active);
  active = false; useMobilePasteConfirmStore.getState().finish(true); await done; expect(bytes).toEqual([]);
});
