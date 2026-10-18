// Production tab components and CSS, synthetic sessions only. No native/SSH calls.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const url = "http://127.0.0.1:1428/tests/desktop-ui/index.html?tab-labels=1";
async function measurements(page) {
  return page.locator("[data-tab-case]").evaluateAll((cases) => cases.map((fixture) => {
    const tab = fixture.querySelector("button");
    const bounds = tab.getBoundingClientRect();
    const style = getComputedStyle(tab);
    const scale = bounds.height / parseFloat(style.height);
    const top = bounds.top + parseFloat(style.borderTopWidth) * scale;
    const bottom = bounds.bottom - parseFloat(style.borderBottomWidth) * scale;
    const label = fixture.querySelector("[data-session-label]");
    const lines = [...label.children].map((line) => {
      const box = line.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(line);
      const text = range.getBoundingClientRect();
      return { value: line.textContent, top: box.top, bottom: box.bottom, textTop: text.top, textBottom: text.bottom,
        lineHeight: getComputedStyle(line).lineHeight, overflow: getComputedStyle(line).textOverflow,
        width: box.width, scrollWidth: line.scrollWidth, clientWidth: line.clientWidth };
    });
    return { id: fixture.dataset.tabCase, selected: fixture.dataset.selected, top, bottom, scale, labelTop: label.getBoundingClientRect().top,
      labelBottom: label.getBoundingClientRect().bottom, title: label.title, lines,
      decorations: [tab.children[0], tab.lastElementChild].map((node) => {
        const box = node.getBoundingClientRect(); return { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
      }) };
  }));
}

export async function verifyTabLabels(browser, createContext, output) {
  const results = [];
  for (const dpr of [1, 1.25, 2]) {
    const context = await createContext(browser, { viewport: { width: 1280, height: 1000 }, deviceScaleFactor: dpr });
    try {
      const page = await context.newPage(); const errors = []; page.on("pageerror", (error) => errors.push(String(error)));
      await page.goto(url); await page.locator("[data-tab-case]").first().waitFor(); await page.evaluate(() => document.fonts.ready);
      if (dpr === 1) {
        await page.locator("main").evaluate((node) => node.setAttribute("data-legacy-tab-lines", ""));
        const legacy = await measurements(page);
        const dual = legacy.filter((row) => row.lines.length === 2);
        assert(dual.length === 10 && dual.every((row) => row.labelTop < row.top - 1 && row.labelBottom > row.bottom + 1), "previous inherited two-line styles must reproduce vertical clipping");
        assert(legacy.filter((row) => row.lines.length === 1).every((row) => row.labelTop >= row.top && row.labelBottom <= row.bottom), "legacy single-line tabs stay inside");
        await page.screenshot({ path: path.join(output, "tab-labels-before-inherited-lines.png"), fullPage: true });
        results.push({ reproduction: "previous inherited font/line-height applied to production components", dpr, rows: legacy });
        await page.locator("main").evaluate((node) => node.removeAttribute("data-legacy-tab-lines"));
      }
      for (const zoom of [0.75, 1, 1.25, 1.5, 2]) {
        await page.evaluate((zoom) => { document.body.style.zoom = String(zoom); }, zoom);
        const rows = await measurements(page);
        for (const row of rows) {
          const tolerance = 0.5 * row.scale;
          for (const line of row.lines) {
            assert(line.top >= row.top - tolerance && line.bottom <= row.bottom + tolerance, `line clipped at ${dpr}/${zoom}: ${row.id}/${row.selected}`);
            assert(line.textTop >= row.top - tolerance && line.textBottom <= row.bottom + tolerance, `text bounds clipped at ${dpr}/${zoom}: ${row.id}`);
            assert(row.title.includes(line.value), "tooltip retains the complete primary and host text");
          }
          for (const icon of row.decorations) assert(icon.top >= row.top - tolerance && icon.bottom <= row.bottom + tolerance, "icon/close stays inside the tab");
          if (row.id.includes("long") && row.lines.length === 2) assert(row.lines[0].scrollWidth > row.lines[0].clientWidth && row.lines[0].overflow === "ellipsis", "long names must ellipsize horizontally");
        }
        assert.equal(rows.length, 14);
        results.push({ dpr, css_zoom: zoom, rows });
        if ((dpr === 1 && zoom === 1) || (dpr === 2 && zoom === 1.25)) {
          await page.screenshot({ path: path.join(output, `tab-labels-fixed-dpr${dpr}-zoom${zoom}.png`), fullPage: true });
        }
      }
      await page.evaluate(() => { document.body.style.zoom = "1"; });
      const tab = page.locator('[data-tab-case="tmux-long"][data-selected="true"] button');
      await tab.hover(); await tab.locator("[data-session-label]").hover();
      assert.match(await tab.getAttribute("title") ?? await tab.locator("[data-session-label]").getAttribute("title"), /Deploy-gjpqy/);
      // CSS ellipsis preserves the full accessible name; close remains reachable.
      assert.equal(await page.getByRole("button", { name: /Deploy-gjpqy.*Synthetic host/ }).count(), 2);
      await tab.locator(":scope > span").last().click(); assert.equal(await page.locator("[data-close-count]").textContent(), "1");
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
  await writeFile(path.join(output, "TAB-LABEL-VALIDATION.json"), JSON.stringify({ source_sha: process.env.GITHUB_SHA ?? null,
    browser: browser.version(), matrix: { dpr: [1, 1.25, 2], css_zoom: [0.75, 1, 1.25, 1.5, 2], cases: 7, selected_states: 2 },
    scope: "Real production TitlebarTab/SessionTabLabel/CSS in normally sandboxed Chromium; synthetic hosts only. Before image emulates previous inherited font/line-height. CSS zoom/DPR are not native macOS/WebView zoom or OS IME proof.", results }, null, 2));
  console.log(JSON.stringify({ tab_labels: "passed", combinations: 210, legacy_clipping_reproduced: true, sandbox: true }));
}
