// Controlled browser test. Native IPC and SSH are fixture-only; no user host/key is accessed.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const { chromium } = await import(pathToFileURL(path.join(process.env.VOLTIUS_BROWSER_TOOLS, "node_modules/playwright/index.mjs")));
const output = path.resolve(process.env.VOLTIUS_UI_EVIDENCE ?? "desktop-ui-evidence"); await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, chromiumSandbox: true,
  ...(process.env.VOLTIUS_BROWSER_EXECUTABLE && { executablePath: process.env.VOLTIUS_BROWSER_EXECUTABLE }) });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.route("**/*", (route) => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
const page = await context.newPage(); const errors = []; page.on("pageerror", (error) => errors.push(String(error)));
const checks = [];
try {
  await page.goto("http://127.0.0.1:1428/tests/desktop-ui/index.html");
  await page.getByRole("button", { name: "Connect", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Session Type").inputValue(), "none");
  assert.equal(await page.locator("#ssh-session-list").count(), 0); checks.push("None: no multiplexer fields");
  await page.getByLabel("Session Type").selectOption("zellij"); await page.locator("#ssh-session-list:not([disabled])").waitFor();
  const options = await page.locator("#ssh-session-list option").evaluateAll((nodes) => nodes.map((node) => ({ value: node.value, disabled: node.disabled, text: node.textContent })));
  assert.equal(options.filter((o) => !o.disabled)[0].value, "create-new"); assert(options.some((o) => o.value === "separator" && o.disabled));
  await page.getByLabel("Session List").selectOption("existing:0"); assert(await page.getByLabel("Session Name").isDisabled());
  await page.screenshot({ path: path.join(output, "desktop-existing-session.png") });
  await page.getByRole("button", { name: "Connect", exact: true }).click(); await page.locator("[data-opened]").filter({ hasText: "zellij:New" }).waitFor();
  assert.equal(await page.evaluate(() => window.__desktopTest.metrics.opens), 1); checks.push("Literal New attaches; name disabled; one Connect");
  await page.getByRole("button", { name: "Choose connection" }).click(); await page.getByLabel("Session List").selectOption("create-new");
  const connect = page.getByRole("button", { name: "Connect", exact: true }); assert(await connect.isDisabled());
  await page.getByLabel("Session Name").fill("New"); assert(await connect.isDisabled());
  await page.getByLabel("Session Name").fill("desktop-work"); await page.screenshot({ path: path.join(output, "desktop-new-session.png") });
  await connect.evaluate((button) => { button.click(); button.click(); });
  await page.locator("[data-opened]").filter({ hasText: "zellij:new:desktop-work" }).waitFor();
  assert.equal(await page.evaluate(() => window.__desktopTest.metrics.opens), 2); checks.push("New validates empty/duplicate names and repeated click creates once");
  await page.waitForFunction(() => !!window.__desktopTest);
  const terminal = page.locator(".xterm-helper-textarea"); await terminal.focus();
  for (const [key, expected] of [["Control+c", "\x03"], ["Control+k", "\x0b"], ["Control+b", "\x02"], ["Control+f", "\x06"], ["Control+w", "\x17"], ["Control+a", "\x01"]]) {
    await page.evaluate(() => window.__desktopTest.reset()); await page.keyboard.press(key);
    await page.waitForFunction(() => window.__desktopTest.data.length > 0);
    assert.equal(await page.evaluate(() => window.__desktopTest.data.join("")), expected, key);
    assert.equal(await page.evaluate(() => window.__desktopTest.state().omniOpen), false);
  }
  await page.evaluate(() => { window.__desktopTest.reset(); window.__desktopTest.term.selectAll(); }); await page.keyboard.press("Control+c");
  assert.equal(await page.evaluate(() => window.__desktopTest.data.join("")), "\x03"); checks.push("Real xterm sends Ctrl+C/K/B/F/W/A; selection never swallows Ctrl+C");
  for (const key of ["Alt+b", "Control+Alt+d", "Control+Shift+s", "Alt+Shift+b", "Control+Shift+ArrowRight", "F1"]) {
    await page.evaluate(() => window.__desktopTest.reset()); await page.keyboard.press(key);
    assert.deepEqual(await page.evaluate(() => window.__desktopTest.state()), { omniOpen: false, rightPanelOpen: false });
  }
  checks.push("Ctrl/Alt/Ctrl+Alt/Ctrl+Shift/Alt+Shift/function keys do not invoke app operations");
  await page.evaluate(() => window.__desktopTest.reset()); await page.keyboard.insertText("中文é€");
  await page.waitForFunction(() => window.__desktopTest.data.join("") === "中文é€"); checks.push("Unicode text insertion reaches real xterm");
  const input = page.getByLabel("Ordinary input"); await input.focus(); await page.keyboard.press("Control+a"); await page.keyboard.insertText("normal editing");
  assert.equal(await input.inputValue(), "normal editing"); await page.keyboard.press("Control+k"); assert.equal(await page.evaluate(() => window.__desktopTest.state().omniOpen), false);
  await terminal.focus(); await page.evaluate(() => { window.__desktopTest.reset(); window.__desktopTest.allow("omni", true); }); await page.keyboard.press("Control+k");
  assert.equal(await page.evaluate(() => window.__desktopTest.state().omniOpen), true); checks.push("Normal inputs keep editing; explicit terminal opt-in works");
  await page.evaluate(() => { window.__desktopTest.reset(); window.__desktopTest.allow("snippets", true); }); await page.keyboard.press("Control+Shift+s");
  assert.equal(await page.evaluate(() => window.__desktopTest.state().rightPanelOpen), true); checks.push("Explicit panel binding executes once across xterm/window handlers");
  await page.screenshot({ path: path.join(output, "desktop-terminal.png") }); assert.deepEqual(errors, []);
  await writeFile(path.join(output, "UI-VALIDATION.json"), JSON.stringify({ source_sha: process.env.GITHUB_SHA ?? null, browser: browser.version(), platform: os.platform(), chromium_sandbox: true, checks, scope: "Browser fixture with real shared React form/shortcut handlers/xterm; simulated SSH listing and blocked native IPC. Not a native OS/IME/remote-SSH test." }, null, 2));
  console.log(JSON.stringify({ passed: checks, sandbox: true }));
} finally { await context.close(); await browser.close(); }
