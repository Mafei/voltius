// Production MobileTerminalScreen/TopBar and CSS; synthetic sessions/native effects only.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createFixtureContext, launchFixtureBrowser } from "./desktop-ui-browser.mjs";

const output = path.resolve(process.env.VOLTIUS_UI_EVIDENCE ?? "mobile-ui-evidence");
await mkdir(output, { recursive: true });
const browser = await launchFixtureBrowser();
const viewports = [{ width: 393, height: 852 }, { width: 320, height: 640 }, { width: 844, height: 390 }, { width: 640, height: 360 }, { width: 344, height: 882 }, { width: 717, height: 512 }];
const dprs = [1, 2, 3], fontScales = [1, 1.3, 1.5, 2], fontModels = ["text-only", "root-rem"], layouts = ["single-short", "single-long", "single-plain", "many"];
const results = [];
const comparisons = [];
let latest;
let renderedFonts;

async function settle(page) {
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
}
async function measure(page) {
  return page.evaluate(() => {
    const box = (node) => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; };
    const canvas = document.createElement("canvas"), context = canvas.getContext("2d");
    const ink = (node) => {
      const range = document.createRange(); range.selectNodeContents(node); const fontBox = range.getBoundingClientRect();
      // A flex button positions an inline-block probe as another flex item;
      // its DOM Range is the correct conservative bound for that case.
      if (!node.textContent.trim() || getComputedStyle(node).display.includes("flex")) return { textTop: fontBox.top, textBottom: fontBox.bottom };
      // A DOM baseline plus actual canvas ink excludes unused fallback-font
      // ascent/descent. CJK font boxes can exceed a compact line while ink fits.
      const probe = document.createElement("span");
      probe.style.cssText = "display:inline-block;width:0;height:0;padding:0;margin:0;vertical-align:baseline";
      node.append(probe); const baseline = probe.getBoundingClientRect().top; probe.remove();
      const style = getComputedStyle(node); context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const metrics = context.measureText(node.textContent);
      return { textTop: baseline - metrics.actualBoundingBoxAscent, textBottom: baseline + metrics.actualBoundingBoxDescent, fontBoxTop: fontBox.top, fontBoxBottom: fontBox.bottom };
    };
    const header = document.querySelector("[data-mobile-terminal-topbar]"), strip = document.querySelector("[data-mobile-session-strip]"), keys = document.querySelector("[data-mobile-extra-keys]");
    const bounds = box(header), hs = getComputedStyle(header);
    return { viewportWidth: innerWidth, bodyWidth: document.body.scrollWidth, header: { ...bounds, contentBottom: bounds.bottom - parseFloat(hs.borderBottomWidth) },
      usableHeight: window.visualViewport.height, keyboardOpen: document.querySelector("main").dataset.keyboardOpen === "true",
      terminal: box(document.querySelector("[data-mobile-terminal-viewport]")),
      keys: { ...box(keys), clientHeight: keys.clientHeight, scrollHeight: keys.scrollHeight, clientWidth: keys.clientWidth, scrollWidth: keys.scrollWidth,
        modifiersPinned: keys.dataset.modifiersPinned === "true",
        controls: [...keys.querySelectorAll("button")].map((node) => ({ ...box(node), name: node.getAttribute("aria-label"), faceInset: parseFloat(getComputedStyle(node, "::before").top), ...ink(node) })) },
      strip: { ...box(strip), clientHeight: strip.clientHeight, scrollHeight: strip.scrollHeight, clientWidth: strip.clientWidth, scrollWidth: strip.scrollWidth, scrollTop: strip.scrollTop, overflowY: getComputedStyle(strip).overflowY },
      controls: [...header.querySelectorAll("button")].map((node) => ({ name: node.getAttribute("aria-label") ?? node.title, ...box(node) })),
      rows: [...header.querySelectorAll("[data-mobile-session-chip]")].map((chip) => {
        const label = chip.querySelector("[data-mobile-session-label]"), close = chip.querySelector("[data-mobile-session-close]");
        return { id: chip.dataset.mobileSessionChip, ...box(chip), title: label.title, accessible: label.getAttribute("aria-label"), label: box(label), close: box(close),
          decorations: [...chip.children].filter((node) => node !== label).map(box),
          lines: [...label.children].map((line) => { const style = getComputedStyle(line);
            return { value: line.textContent, ...box(line), ...ink(line), fontSize: parseFloat(style.fontSize), fontFamily: style.fontFamily, lineHeight: style.lineHeight, overflow: style.textOverflow, clientWidth: line.clientWidth, scrollWidth: line.scrollWidth }; }) };
      }) };
  });
}

try {
  for (const viewport of viewports) for (const dpr of dprs) {
    const context = await createFixtureContext(browser, { viewport, deviceScaleFactor: dpr, isMobile: true, hasTouch: true, locale: "en-US",
      userAgent: "Mozilla/5.0 (Linux; Android 13; Synthetic Mobile) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36" });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    try {
      await page.goto("http://127.0.0.1:1428/tests/desktop-ui/index.html?mobile-tabs=1");
      await page.locator("[data-mobile-session-close] svg").first().waitFor();
      await page.locator("[data-mobile-terminal-new] svg").waitFor();
      await settle(page);
      assert.equal(await page.evaluate(() => devicePixelRatio), dpr);
      assert.equal(await page.evaluate(() => innerWidth), viewport.width, "mobile viewport meta must use actual device width");
      if (!renderedFonts) {
        const session = await context.newCDPSession(page); await session.send("DOM.enable"); await session.send("CSS.enable");
        const { root } = await session.send("DOM.getDocument");
        const { nodeId } = await session.send("DOM.querySelector", { nodeId: root.nodeId, selector: '[data-mobile-session-chip="long-cn"] [data-mobile-session-primary]' });
        renderedFonts = (await session.send("CSS.getPlatformFontsForNode", { nodeId })).fonts;
        assert(renderedFonts.some((font) => /Noto.*CJK/i.test(font.familyName) && font.glyphCount > 0), "CJK cases must use real CJK glyphs");
        await session.detach();
      }
      if (viewport.width === 844 && dpr === 1) {
        await page.evaluate(() => { window.__mobileTabFixture.setLayout("single-long"); document.querySelector("main").setAttribute("data-mobile-legacy", ""); });
        await settle(page); const before = await measure(page);
        assert(before.rows.some((row) => row.top < before.header.top - 1 || row.bottom > before.header.contentBottom + 1), "legacy mobile chip must exceed its fixed header");
        assert(before.strip.scrollHeight > before.strip.clientHeight, "legacy horizontal scroller must reproduce vertical overflow");
        await page.screenshot({ path: path.join(output, "mobile-before-landscape-legacy-styles.png") });
        results.push({ legacy_reproduction: true, viewport, dpr, measurements: before });
        await page.evaluate(() => document.querySelector("main").removeAttribute("data-mobile-legacy"));
      }
      for (const fontModel of fontModels) for (const fontScale of fontScales) for (const keyboardOpen of [false, true]) for (const layout of layouts) {
        await page.evaluate(({ fontModel, fontScale, layout, keyboardOpen }) => {
          document.documentElement.style.fontSize = `${15 * (fontModel === "root-rem" ? fontScale : 1)}px`;
          document.querySelector("main").style.setProperty("--fixture-font-scale", String(fontModel === "text-only" ? fontScale : 1));
          window.__mobileTabFixture.setLayout(layout);
          window.__mobileTabFixture.setKeyboard(keyboardOpen);
          document.querySelector("[data-mobile-session-strip]").scrollLeft = 0;
        }, { fontModel, fontScale, layout, keyboardOpen });
        await settle(page);
        await page.waitForFunction((open) => document.querySelector("main").dataset.keyboardOpen === String(open), keyboardOpen);
        const m = await measure(page), entry = { viewport, dpr, font_model: fontModel, font_scale: fontScale, keyboard_open: keyboardOpen, layout, measurements: m };
        latest = entry;
        await writeFile(path.join(output, "MOBILE-LAST-MEASUREMENTS.json"), JSON.stringify(entry, null, 2));
        const tag = `${viewport.width}x${viewport.height}/dpr${dpr}/${fontModel}${fontScale}/ime${keyboardOpen}/${layout}`;
        const target = 40;
        assert(m.header.right <= viewport.width + 1 && m.bodyWidth <= viewport.width + 1, `page width overflow ${tag}`);
        assert.notEqual(m.strip.overflowY, "hidden", "the fix must not hide vertical clipping");
        assert(m.strip.scrollHeight <= m.strip.clientHeight + 1 && m.strip.scrollTop === 0, `vertical scroll range ${tag}: ${JSON.stringify(m.strip)}`);
        for (const control of m.controls) {
          assert(control.width >= target - 0.5 && control.height >= target - 0.5, `touch target too small ${tag}: ${JSON.stringify(control)}`);
          assert(control.top >= m.header.top - 0.75 && control.bottom <= m.header.contentBottom + 0.75, `control outside header ${tag}`);
        }
        assert.equal(m.keyboardOpen, keyboardOpen);
        assert(m.keys.scrollHeight <= m.keys.clientHeight + 1, `key row vertical scroll ${tag}`);
        assert(Math.abs(m.keys.bottom - m.usableHeight) < 1, `key row must sit above visual keyboard inset ${tag}`);
        assert(m.terminal.height > 30 && m.terminal.top >= m.header.bottom - 0.75 && m.terminal.bottom <= m.keys.top + 0.75, `terminal area overlap ${tag}`);
        for (const control of m.keys.controls) {
          assert(control.width >= target - 0.5 && control.height >= target - 0.5, `key target too small ${tag}: ${JSON.stringify(control)}`);
          assert.equal(control.faceInset, 2, "visual face keeps 2 CSSpx vertical separation inside its hit target");
          assert(control.textTop >= control.top - 0.75 && control.textBottom <= control.bottom + 0.75, `key glyph outside touch target ${tag}`);
        }
        for (const row of m.rows) {
          assert(row.top >= m.header.top - 0.75 && row.bottom <= m.header.contentBottom + 0.75, `chip outside header ${tag}: ${JSON.stringify(row)}`);
          assert.equal(row.lines.length, row.id === "plain" ? 1 : 2);
          assert.equal(row.title, row.accessible);
          for (const line of row.lines) {
            assert(line.top >= row.top - 0.75 && line.bottom <= row.bottom + 0.75, `line outside chip ${tag}`);
            assert(line.textTop >= line.top - 0.75 && line.textBottom <= line.bottom + 0.75, `glyph cropped by own line ${tag}: ${JSON.stringify(line)}`);
            assert(line.textTop >= m.header.top - 0.75 && line.textBottom <= m.header.contentBottom + 0.75, `glyph outside header ${tag}`);
            assert(row.title.includes(line.value), "full identity remains accessible despite ellipsis");
          }
          for (const icon of row.decorations) assert(icon.top >= row.top - 0.75 && icon.bottom <= row.bottom + 0.75, `status/close outside chip ${tag}`);
          if (row.lines.length === 2) {
            const gap = row.lines[1].textTop - row.lines[0].textBottom;
            assert(gap >= -0.75 && gap <= row.lines[0].fontSize * 0.75, `two-line gap/overlap ${tag}: ${gap}`);
          }
          if (row.id.includes("long")) assert(row.lines[0].scrollWidth > row.lines[0].clientWidth && row.lines[0].overflow === "ellipsis", `long primary must ellipsize ${tag}`);
        }
        if (layout === "many") {
          assert(m.strip.scrollWidth > m.strip.clientWidth + 20, `many tabs retain horizontal overflow ${tag}`);
          const moved = await page.locator("[data-mobile-session-strip]").evaluate((strip) => { strip.scrollLeft = strip.scrollWidth; return strip.scrollLeft; });
          assert(moved > 0, `horizontal scrolling remains usable ${tag}`);
        }
        results.push(entry);
        await page.evaluate(() => document.querySelector("main").setAttribute("data-mobile-legacy", ""));
        await settle(page); const old = await measure(page);
        const gapOf = (row) => row.lines.length === 2 ? row.lines[1].textTop - row.lines[0].textBottom : null;
        if (fontScale === 1) for (const row of m.rows.filter((row) => row.lines.length === 2)) {
          const previous = old.rows.find((item) => item.id === row.id);
          assert(gapOf(row) < gapOf(previous) - 0.5, `default double-line ink gap must shrink ${tag}`);
        }
        comparisons.push({ viewport, dpr, font_model: fontModel, font_scale: fontScale, keyboard_open: keyboardOpen, layout, unit: "CSS px",
          before: { header: old.header.height, keys: old.keys.height, terminal: old.terminal.height, first_tab_ink_gap: gapOf(old.rows[0]), tab_overflow: old.strip.scrollHeight > old.strip.clientHeight || old.rows.some((row) => row.top < old.header.top - 0.75 || row.bottom > old.header.contentBottom + 0.75) },
          after: { header: m.header.height, keys: m.keys.height, terminal: m.terminal.height, first_tab_ink_gap: gapOf(m.rows[0]), tab_overflow: false }, terminal_gain: m.terminal.height - old.terminal.height });
        if (dpr === 1 && [393, 844].includes(viewport.width) && fontModel === "text-only" && fontScale === 1 && layout === "many") console.log(JSON.stringify({ height_example_css_px: comparisons.at(-1) }));
        await page.evaluate(() => document.querySelector("main").removeAttribute("data-mobile-legacy")); await settle(page);
        if (dpr === 1 && [393, 844].includes(viewport.width) && fontModel === "text-only" && [1, 2].includes(fontScale) && layout === "many") {
          await page.locator("[data-mobile-session-strip]").evaluate((strip) => { strip.scrollLeft = 0; });
          await page.screenshot({ path: path.join(output, `mobile-fixed-${viewport.width}x${viewport.height}-font${fontScale}-ime${keyboardOpen}.png`) });
        }
      }
      await page.evaluate(() => { document.documentElement.style.fontSize = "15px"; document.querySelector("main").style.setProperty("--fixture-font-scale", "1"); window.__mobileTabFixture.setLayout("many"); window.__mobileTabFixture.setKeyboard(false); window.__mobileTabFixture.resetInput(); });
      await settle(page);
      await page.locator('[data-mobile-session-chip="chinese"] [data-mobile-session-label]').click();
      assert.equal(await page.evaluate(() => window.__mobileTabFixture.state().active), "chinese");
      assert.equal(await page.locator('[data-mobile-session-chip="chinese"] [data-mobile-session-label]').getAttribute("aria-pressed"), "true");
      await page.locator('[data-mobile-session-close="long"]').click();
      assert.equal(await page.locator('[data-mobile-session-chip="long"]').count(), 0);
      await page.locator("[data-mobile-terminal-new]").click();
      assert.equal(await page.evaluate(() => window.__mobileTabFixture.state().tab), "hosts");
      const row = page.locator('[data-mobile-key-scroll="true"]');
      await row.evaluate((node) => { node.scrollLeft = 0; });
      await page.getByRole("button", { name: "Esc", exact: true }).tap();
      assert.equal(await page.evaluate(() => window.__mobileTabFixture.inputMetrics.length), 1);
      await page.evaluate(() => window.__mobileTabFixture.resetInput());
      const ctrl = await page.getByRole("button", { name: "Ctrl", exact: true }).boundingBox();
      const cdp = await context.newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: ctrl.x + ctrl.width / 2, y: ctrl.y + ctrl.height / 2 }] });
      await page.waitForTimeout(475);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      assert.equal(await page.evaluate(() => window.__mobileTabFixture.state().ctrl), "locked");
      await page.getByRole("button", { name: "Esc", exact: true }).tap();
      assert.equal(await page.evaluate(() => window.__mobileTabFixture.inputMetrics.at(-1).mods.ctrl), true);
      await page.evaluate(() => window.__mobileTabFixture.resetInput());
      await row.evaluate((node) => { node.scrollLeft = 0; });
      const esc = await page.getByRole("button", { name: "Esc", exact: true }).boundingBox(), x = esc.x + esc.width / 2, y = esc.y + esc.height / 2;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (const delta of [20, 40, 60, 80]) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - delta, y }] }); await page.waitForTimeout(30); }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      const panRange = await row.evaluate((node) => node.scrollWidth - node.clientWidth);
      if (panRange > 1) await page.waitForFunction((threshold) => document.querySelector('[data-mobile-key-scroll="true"]').scrollLeft > threshold, Math.min(5, panRange / 2), { timeout: 5000 });
      assert.equal(await page.evaluate(() => window.__mobileTabFixture.inputMetrics.length), 0, "scroll drag must not emit a key");
      const escape = page.getByRole("button", { name: "Esc", exact: true });
      await escape.focus(); await page.keyboard.press("Space");
      assert.equal(await page.evaluate(() => window.__mobileTabFixture.inputMetrics.length), 1, "keyboard activation on a touch device must send once");
      assert.equal(await escape.evaluate((node) => getComputedStyle(node).outlineOffset), "-2px", "focus indicator remains inside the compact target");
      assert.deepEqual(errors, []);
    } catch (error) {
      console.error(JSON.stringify({ page_errors: errors }));
      await page.screenshot({ path: path.join(output, "mobile-failure.png") }).catch(() => {});
      throw error;
    } finally { await context.close(); }
  }
  const cursorContext = await createFixtureContext(browser, { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
  try {
    const page = await cursorContext.newPage();
    await page.goto("http://127.0.0.1:1428/tests/desktop-ui/index.html?android-cursor=1");
    await page.waitForFunction(() => window.__androidCursorFixture);
    const cursor = await page.evaluate(() => window.__androidCursorFixture.run());
    for (const result of cursor.results) {
      assert.equal(result.cursor, result.expected, `cursor state ${JSON.stringify(result)}`);
      if (result.phase === "native-ime-open" || result.phase === "user-style-reset") {
        assert.equal(result.focused, true); assert.equal(result.dom_terminal_focus, false, "proxy focus must never focus the DOM IME editor");
      }
      if (result.phase === "remote-blinking-bar") { assert.equal(result.blink_enabled, true); assert.equal(result.blink_paused, false); }
      if (result.phase === "remote-blink-blurred") assert.equal(result.blink_paused, true);
    }
    await writeFile(path.join(output, "ANDROID-CURSOR-FOCUS.json"), JSON.stringify(cursor, null, 2));
    await page.screenshot({ path: path.join(output, "android-cursor-synthetic.png") });
    console.log(JSON.stringify({ cursor_focus: "passed", cases: cursor.results.length, native_focus: "simulated" }));
  } finally { await cursorContext.close(); }
  const measured = results.filter((result) => !result.legacy_reproduction);
  const report = { source_sha: process.env.GITHUB_SHA ?? null, browser: browser.version(), chromium_sandbox: true,
    production_components: ["MobileTerminalScreen", "MobileTerminalTopBar", "MobileExtraKeysRow", "useVisualViewport"], rendered_fonts: renderedFonts,
    matrix: { viewports, dpr: dprs, font_scales: fontScales, font_models: fontModels, keyboard_states: [false, true], layouts },
    scenarios: measured.length, tab_checks: measured.reduce((total, result) => total + result.measurements.rows.length, 0),
    scope: "Real mobile React components/CSS and useVisualViewport hook in touch/mobile Chromium. Font scaling and visual keyboard insets are simulations, not actual Android WebView textZoom/system font/IME. No device/emulator/native popup/real SSH tested. Legacy styles emulate previous components. All dimensions are CSS px, distinct from screenshot device pixels/DPR. Synthetic data only.", results };
  await writeFile(path.join(output, "MOBILE-TAB-VALIDATION.json"), JSON.stringify(report, null, 2));
  await writeFile(path.join(output, "MOBILE-HEIGHT-COMPARISON.json"), JSON.stringify({ source_sha: process.env.GITHUB_SHA ?? null, unit: "CSS px", baseline: "Previous styles applied to production components; baseline tabs may overflow", comparisons }, null, 2));
  console.log(JSON.stringify({ height_examples_css_px: comparisons.filter((entry) => entry.dpr === 1 && [393, 844, 717].includes(entry.viewport.width) && [1, 2].includes(entry.font_scale) && entry.layout === "many") }));
  console.log(JSON.stringify({ mobile_tabs: "passed", scenarios: report.scenarios, tab_checks: report.tab_checks, legacy_overflow_reproduced: true, sandbox: true }));
} catch (error) {
  const failure = { error: String(error), completed: results.length, latest };
  await writeFile(path.join(output, "MOBILE-FAILURE.json"), JSON.stringify(failure, null, 2));
  console.error(JSON.stringify(failure));
  throw error;
} finally { await browser.close(); }
