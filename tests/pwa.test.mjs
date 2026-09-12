import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import vm from "node:vm";

test("构建后的离线脚本可在 GitHub 仓库子路径下返回缓存首页，并跳过云数据库请求", async () => {
  const root = await mkdtemp(join(tmpdir(), "yanzhu-pwa-"));
  try {
    await mkdir(join(root, "dist", "assets"), { recursive: true });
    await writeFile(
      join(root, "dist", "index.html"),
      "<main>研助表离线可打开</main>",
    );
    await writeFile(
      join(root, "dist", "assets", "app.js"),
      'console.log("app")',
    );
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("../scripts/build-sw.mjs", import.meta.url))],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const callbacks = {},
      buckets = new Map(),
      base = "https://example.github.io/yanzhubiao/";
    const caches = {
      async open(name) {
        if (!buckets.has(name)) buckets.set(name, new Map());
        const data = buckets.get(name);
        const key = (r) =>
          new URL(typeof r === "string" ? r : r.url, base).href;
        return {
          async addAll(files) {
            for (const file of files)
              data.set(
                key(file),
                new Response(
                  file.endsWith("index.html") ? "研助表离线可打开" : "asset",
                ),
              );
          },
          async match(r) {
            return data.get(key(r))?.clone();
          },
          async put(r, response) {
            data.set(key(r), response);
          },
        };
      },
      async keys() {
        return [...buckets.keys()];
      },
      async delete(name) {
        return buckets.delete(name);
      },
    };
    vm.runInNewContext(await readFile(join(root, "dist", "sw.js"), "utf8"), {
      URL,
      Response,
      caches,
      fetch: async () => {
        throw new Error("offline");
      },
      self: {
        location: { origin: new URL(base).origin },
        clients: { claim: async () => {} },
        skipWaiting: async () => {},
        addEventListener: (name, callback) => (callbacks[name] = callback),
      },
    });
    let pending;
    callbacks.install({ waitUntil: (p) => (pending = p) });
    await pending;
    let response;
    callbacks.fetch({
      request: { url: base, method: "GET", mode: "navigate" },
      respondWith: (p) => (response = p),
    });
    assert.equal(await (await response).text(), "研助表离线可打开");
    let intercepted = false;
    callbacks.fetch({
      request: {
        url: "https://example.supabase.co/rest/v1/entries",
        method: "GET",
      },
      respondWith: () => (intercepted = true),
    });
    assert.equal(intercepted, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
