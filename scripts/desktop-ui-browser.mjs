// Shared test boundary: the browser may only reach the local fixture server.
import { pathToFileURL } from "node:url";
import path from "node:path";

export async function launchFixtureBrowser(processScale = 1) {
  const { chromium } = await import(pathToFileURL(path.join(process.env.VOLTIUS_BROWSER_TOOLS, "node_modules/playwright/index.mjs")));
  return chromium.launch({ headless: true, chromiumSandbox: true,
    ...(processScale !== 1 && { args: [`--force-device-scale-factor=${processScale}`] }),
    ...(process.env.VOLTIUS_BROWSER_EXECUTABLE && { executablePath: process.env.VOLTIUS_BROWSER_EXECUTABLE }) });
}

export async function createFixtureContext(browser, options) {
  const context = await browser.newContext(options);
  await context.route("**/*", (route) => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  return context;
}
