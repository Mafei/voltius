// Shared test boundary: the browser may only reach the local fixture server.
export async function createFixtureContext(browser, options) {
  const context = await browser.newContext(options);
  await context.route("**/*", (route) => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  return context;
}
