import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStaticServer } from "../../src/http/static-server.js";

let server: Server;
let base: string;
let port: number;
let outer: string;

// fetch() normalizes "../" and "%2e%2e" before sending, so traversal cases
// go through http.request, which sends the path as written.
function rawGet(path: string, method = "GET"): Promise<{ status: number; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    request({ host: "127.0.0.1", port, path, method }, (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0, headers: res.headers });
    }).on("error", reject).end();
  });
}

beforeAll(async () => {
  // root/ is served; outer/secret.txt sits next to it and must stay unreachable.
  outer = mkdtempSync(join(tmpdir(), "static-"));
  const root = join(outer, "root");
  mkdirSync(join(root, "assets"), { recursive: true });
  writeFileSync(join(root, "index.html"), "<h1>town</h1>");
  writeFileSync(join(root, "assets", "app.js"), "console.log(1)");
  writeFileSync(join(outer, "secret.txt"), "secret");
  server = createStaticServer(root);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;
  base = `http://127.0.0.1:${port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(outer, { recursive: true, force: true });
});

describe("static server", () => {
  it("serves index.html for /", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toBe("<h1>town</h1>");
  });

  it("serves assets with a content type", async () => {
    const res = await fetch(`${base}/assets/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
  });

  it("returns 404 for a missing file", async () => {
    expect((await fetch(`${base}/nope.js`)).status).toBe(404);
  });

  it("keeps dot segments inside the root: URL parsing resolves them first", async () => {
    // "/../x" and "/%2e%2e/x" both become "/x" under the root, which does not exist.
    for (const path of ["/../secret.txt", "/%2e%2e/secret.txt"]) {
      expect((await rawGet(path)).status, path).toBe(404);
    }
  });

  it("answers only GET and HEAD", async () => {
    expect((await rawGet("/", "HEAD")).status).toBe(200);
    const post = await rawGet("/", "POST");
    expect(post.status).toBe(405);
    expect(post.headers.allow).toBe("GET, HEAD");
  });

  it("refuses encoded paths that leave the root with 403", async () => {
    // An encoded slash survives URL parsing; decoding then yields "../".
    for (const path of ["/assets/..%2f..%2fsecret.txt", "/%2e%2e%2fsecret.txt", "/..%2fsecret.txt"]) {
      expect((await rawGet(path)).status, path).toBe(403);
    }
  });
});
