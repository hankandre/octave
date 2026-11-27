// T17-01 items 1 and 2: the one built web form (apps/web/dist) draws its root at `/` and at a second prefix, asks for
// nothing outside that prefix, and runs under the plan's Content-Security-Policy with no violation, no other origin
// and no service worker.
import { readFile, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const CSP = "default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self'";
const SECOND_PREFIX = "/second/prefix/";
const PREFIXES = ["/", SECOND_PREFIX];
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

let server: Server;
let origin = "";
// Every path the server was asked for, which includes requests the browser does not report to the page (favicons).
const servedPaths: string[] = [];

async function readBuildFile(buildDirectory: string, path: string): Promise<{ body: Buffer; type: string } | null> {
  const mount = path.startsWith(SECOND_PREFIX) ? SECOND_PREFIX : "/";
  const relative = decodeURIComponent(path.slice(mount.length)) || "index.html";
  const file = join(buildDirectory, relative);
  if (!file.startsWith(`${buildDirectory}${sep}`)) return null;
  try {
    return { body: await readFile(file), type: CONTENT_TYPES[extname(file)] ?? "application/octet-stream" };
  } catch {
    return null;
  }
}

test.beforeAll(async ({}, testInfo) => {
  const buildDirectory = resolve(testInfo.project.testDir, "..", "dist");
  await stat(join(buildDirectory, "index.html"));
  server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    servedPaths.push(path);
    const found = await readBuildFile(buildDirectory, path);
    response.writeHead(found ? 200 : 404, {
      "Content-Security-Policy": CSP,
      "X-Content-Type-Options": "nosniff",
      "Content-Type": found?.type ?? "text/plain",
    });
    response.end(found?.body ?? "Not found");
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("the test server has no port");
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
});

test.beforeEach(() => {
  servedPaths.length = 0;
});

async function openRoot(page: Page, prefix: string): Promise<{ url: string; type: string }[]> {
  const requests: { url: string; type: string }[] = [];
  page.context().on("request", (request) => requests.push({ url: request.url(), type: request.resourceType() }));
  await page.goto(`${origin}${prefix}`);
  await expect(page.getByRole("heading", { level: 1, name: "Octave" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  return requests;
}

for (const prefix of PREFIXES) {
  test(`T17-01 item 1: the one build draws its root at ${prefix} with every request inside the prefix`, async ({ page }) => {
    const requests = await openRoot(page, prefix);

    expect(requests.map((request) => request.type)).toContain("script");
    const outside = requests.filter(({ url }) => new URL(url).origin !== origin || !new URL(url).pathname.startsWith(prefix));
    expect(outside).toEqual([]);
    expect(servedPaths.filter((path) => !path.startsWith(prefix))).toEqual([]);
  });

  test(`T17-01 item 2: at ${prefix} the build runs under the CSP with no violation, other origin or service worker`, async ({ page }) => {
    const violations: string[] = [];
    await page.exposeFunction("reportViolation", (violation: string) => violations.push(violation));
    // An init script is not governed by the page's CSP, and it listens before any of the page's own scripts run.
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (event) => {
        const report: unknown = Reflect.get(window, "reportViolation");
        if (typeof report === "function") report(`${event.violatedDirective} ${event.blockedURI}`);
      });
    });

    const requests = await openRoot(page, prefix);
    const registrations = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);

    expect(violations).toEqual([]);
    expect(requests.filter(({ url }) => new URL(url).origin !== origin)).toEqual([]);
    expect(registrations).toBe(0);
  });
}
