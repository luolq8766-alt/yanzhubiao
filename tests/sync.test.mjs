import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  seed,
  validEntry,
  today,
  normalizeEntry,
  salaryFor,
} from "../src/domain.js";
// Evaluate the production store with explicit database/network/browser test doubles.
let source = await readFile(
  new URL("../src/store.js", import.meta.url),
  "utf8",
);
source = source
  .replace(/^import[\s\S]*?;\r?$/gm, "")
  .replaceAll("export const ", "const ")
  .replaceAll("import.meta.env.VITE_SUPABASE_URL", "'https://example.invalid'")
  .replaceAll("import.meta.env.VITE_SUPABASE_ANON_KEY", "'test-only'");
const make = new Function(
  "createClient",
  "openDB",
  "seed",
  "validEntry",
  "today",
  "normalizeEntry",
  "salaryFor",
  "navigator",
  "window",
  "document",
  "setInterval",
  "setTimeout",
  source + ";return store;",
);
function harness() {
  const disk = new Map(),
    remote = [],
    receipts = new Map();
  let fail = false,
    loseAck = false,
    lock = Promise.resolve();
  const person = {
    id: "a",
    name: "甲",
    role: "student",
    degree: "master",
    grade: 2,
    start_year: 2026,
    end_year: 2027,
  };
  const data = {
    profiles: [person],
    entries: [],
    tasks: [],
    claims: [],
    settings: { team_name: "测试", monthly_limit: 300000, gap_limit: 1000000 },
    queue: [],
    lastSync: null,
  };
  const nav = {
    onLine: false,
    locks: {
      request(_key, fn) {
        const result = lock.then(fn);
        lock = result.catch(() => {});
        return result;
      },
    },
  };
  const database = {
    get: async (_, key) => structuredClone(disk.get(key)),
    put: async (_, value, key) => disk.set(key, structuredClone(value)),
    delete: async (_, key) => disk.delete(key),
  };
  const api = {
    from(table) {
      const q = {
        after: null,
        n: 500,
        select() {
          return q;
        },
        order() {
          return q;
        },
        limit(n) {
          q.n = n;
          return q;
        },
        gt(_, id) {
          q.after = id;
          return q;
        },
        maybeSingle() {
          q.single = true;
          return q;
        },
        then(resolve, reject) {
          if (fail)
            return Promise.reject(new Error("network down")).then(
              resolve,
              reject,
            );
          const value =
            table === "profiles"
              ? [person]
              : table === "entries"
                ? remote
                    .filter((e) => !q.after || e.id > q.after)
                    .sort((a, b) => a.id.localeCompare(b.id))
                    .slice(0, q.n)
                : table === "team_settings"
                  ? data.settings
                  : [];
          return Promise.resolve({
            data: structuredClone(value),
            error: null,
          }).then(resolve, reject);
        },
      };
      return q;
    },
    async rpc(name, args) {
      if (fail) return { error: { message: "network down" } };
      if (name === "list_tasks") return { data: [], error: null };
      if (name !== "save_entry") return { data: 0, error: null };
      if (receipts.has(args.p_operation))
        return { data: receipts.get(args.p_operation), error: null };
      const old = remote.find((e) => e.id === args.p_entry.id);
      if ((old?.version || 0) !== args.p_expected_version)
        return {
          error: { code: "P0001", message: "CONFLICT: newer cloud entry" },
        };
      const value = { ...args.p_entry, version: (old?.version || 0) + 1 };
      if (old) remote.splice(remote.indexOf(old), 1);
      remote.push(value);
      receipts.set(args.p_operation, value);
      if (loseAck) {
        loseAck = false;
        return { error: { message: "lost acknowledgement" } };
      }
      return { data: value, error: null };
    },
  };
  const build = () => {
    const store = make(
      () => api,
      async () => database,
      seed,
      validEntry,
      today,
      normalizeEntry,
      salaryFor,
      nav,
      { addEventListener() {} },
      { addEventListener() {}, hidden: false },
      () => {},
      () => {},
    );
    store.account = "a";
    store.set({ user: person, data: structuredClone(data), loading: false });
    return store;
  };
  return {
    build,
    remote,
    disk,
    nav,
    data,
    setFail: (v) => (fail = v),
    setLoseAck: (v) => (loseAck = v),
  };
}
const entry = (id = "e1") => ({
  id,
  owner_id: "a",
  date: "2026-09-11",
  kind: "expense",
  category: "差旅费",
  description: "离线野外采样",
  amount: 12850,
  reimbursed: 0,
  funding: "advance",
  note: "",
  deleted: false,
});
test("离线记录先持久写入，重开后仍在；联网发送并移出队列", async () => {
  const h = harness(),
    s = h.build();
  await s.saveEntry(entry());
  assert.equal(h.disk.get("a").queue.length, 1);
  const reopened = h.build();
  reopened.set({ data: h.disk.get("a") });
  h.nav.onLine = true;
  await reopened.sync();
  assert.equal(h.remote[0].amount, 12850);
  assert.equal(reopened.state.data.queue.length, 0);
  assert.equal(reopened.state.data.entries[0].version, 1);
});
test("云端成功但确认丢失，重试不重复入账", async () => {
  const h = harness(),
    s = h.build();
  await s.saveEntry(entry());
  h.setLoseAck(true);
  h.nav.onLine = true;
  await s.sync();
  assert.equal(s.state.data.queue.length, 1);
  await s.sync();
  assert.equal(h.remote.length, 1);
  assert.equal(h.remote[0].version, 1);
  assert.equal(s.state.data.queue.length, 0);
});
test("版本冲突保留本地副本，放弃副本后恢复云端", async () => {
  const h = harness(),
    s = h.build();
  await s.saveEntry(entry());
  h.remote.push({ ...entry(), description: "另一设备的修改", version: 2 });
  h.nav.onLine = true;
  await s.sync();
  assert.match(s.state.data.queue[0].error, /CONFLICT/);
  assert.equal(s.state.data.entries[0].description, "离线野外采样");
  await s.discard(s.state.data.queue[0].operation);
  assert.equal(s.state.data.entries[0].description, "另一设备的修改");
});
test("同浏览器两个页面写入时，通过锁合并持久队列", async () => {
  const h = harness(),
    a = h.build(),
    b = h.build();
  await Promise.all([a.saveEntry(entry("e1")), b.saveEntry(entry("e2"))]);
  assert.equal(h.disk.get("a").queue.length, 2);
  assert.equal(h.disk.get("a").entries.length, 2);
});
test("断网失败不会丢失草稿或覆盖本机记录", async () => {
  const h = harness(),
    s = h.build();
  await s.saveEntry(entry());
  h.nav.onLine = true;
  h.setFail(true);
  await s.sync();
  assert.equal(s.state.data.queue.length, 1);
  assert.equal(h.disk.get("a").entries[0].amount, 12850);
  assert.match(s.state.error, /同步未完成/);
});
test("账目分页超过默认上限也全部读取", async () => {
  const h = harness(),
    s = h.build();
  for (let i = 0; i < 1050; i++)
    h.remote.push({ ...entry(`e${String(i).padStart(4, "0")}`), version: 1 });
  h.nav.onLine = true;
  await s.sync();
  assert.equal(s.state.data.entries.length, 1050);
});
