import { createClient } from "@supabase/supabase-js";
import { openDB } from "idb";
import {
  seed,
  validEntry,
  today,
  normalizeEntry,
  salaryFor,
} from "./domain.js";
const url = import.meta.env.VITE_SUPABASE_URL?.trim()
    .replace(/\/(rest|auth|storage)\/v1\/?$/, "")
    .replace(/\/$/, ""),
  key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const cloud = Boolean(url && key);
export const supabase = cloud ? createClient(url, key) : null;
const db = openDB("yanzhubiao-v1", 1, {
  upgrade(d) {
    d.createObjectStore("accounts");
  },
});
const empty = () => ({
  profiles: [],
  entries: [],
  tasks: [],
  claims: [],
  salaryRules: [],
  settings: {
    team_name: "科研课题组",
    monthly_limit: 300000,
    gap_limit: 1000000,
  },
  queue: [],
  lastSync: null,
});
async function allEntries() {
  const rows = [];
  let after = null;
  for (;;) {
    let query = supabase.from("entries").select("*").order("id").limit(500);
    if (after) query = query.gt("id", after);
    const result = await query;
    if (result.error) return result;
    rows.push(...result.data);
    if (result.data.length < 500) return { data: rows, error: null };
    after = result.data.at(-1).id;
  }
}
class Store {
  state = {
    loading: true,
    cloud,
    user: null,
    data: empty(),
    online: navigator.onLine,
    syncing: false,
    error: "",
  };
  listeners = new Set();
  write = Promise.resolve();
  account = null;
  refreshVersion = 0;
  subscribe = (fn) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.state;
  set = (patch) => {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((f) => f());
  };
  persist = async (data) => {
    const account = this.account;
    await (await db).put("accounts", data, account);
    if (this.account === account) this.set({ data });
  };
  transaction = (fn) => {
    const account = this.account;
    const task = async () => {
      if (account !== this.account) return;
      const latest = await (await db).get("accounts", account);
      if (latest) this.set({ data: latest });
      return fn();
    };
    const next = this.write.then(() =>
      navigator.locks
        ? navigator.locks.request("yanzhu-write-" + account, task)
        : task(),
    );
    this.write = next.catch(() => {});
    return next;
  };
  async init() {
    try {
      if (!cloud) {
        this.account = "demo";
        const data = (await (await db).get("accounts", "demo")) || seed();
        const id = localStorage.getItem("yanzhu-demo-user") || "demo-teacher";
        this.set({
          data,
          user: data.profiles.find((p) => p.id === id) || data.profiles[0],
          loading: false,
        });
      } else {
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();
        if (error) throw error;
        await this.session(session);
        supabase.auth.onAuthStateChange((event, s) => {
          if (event === "SIGNED_OUT") this.session(null);
          else if (s?.user?.id !== this.state.user?.id)
            setTimeout(() => this.session(s), 0);
        });
      }
    } catch (e) {
      this.set({ loading: false, error: "无法读取本机数据：" + e.message });
    }
    window.addEventListener("online", () => {
      this.set({ online: true });
      this.sync();
    });
    window.addEventListener("offline", () => this.set({ online: false }));
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) this.sync();
    });
    setInterval(() => {
      if (!document.hidden) this.sync();
    }, 60000);
  }
  async session(session) {
    if (!session) {
      this.account = null;
      this.set({ user: null, data: empty(), loading: false });
      return;
    }
    this.account = session.user.id;
    const data = (await (await db).get("accounts", this.account)) || empty();
    this.set({ user: session.user, data, loading: false });
    await this.sync();
  }
  async refresh() {
    const account = this.account;
    const revision = ++this.refreshVersion;
    const [p, e, t, c, s, rules] = await Promise.all([
      supabase.from("profiles").select("*"),
      allEntries(),
      supabase.rpc("list_tasks"),
      supabase.from("task_claims").select("*"),
      supabase.from("team_settings").select("*").maybeSingle(),
      supabase.from("salary_rules").select("*").order("effective_month"),
    ]);
    for (const r of [p, e, t, c, s, rules]) if (r.error) throw r.error;
    if (account !== this.account) return;
    await this.transaction(async () => {
      if (account !== this.account || revision !== this.refreshVersion) return;
      const current = this.state.data;
      const ids = new Set(current.queue.map((q) => q.entry.id));
      await this.persist({
        ...current,
        profiles: p.data,
        salaryRules: rules.data,
        entries: [
          ...e.data.filter((x) => !ids.has(x.id)),
          ...current.queue.map((q) => q.entry),
        ],
        tasks: t.data,
        claims: c.data,
        settings: s.data || current.settings,
        lastSync: new Date().toISOString(),
      });
    });
  }
  async sync() {
    if (!cloud || !this.account || !navigator.onLine || this.state.syncing)
      return;
    const account = this.account;
    this.set({ syncing: true, error: "" });
    try {
      for (const item of [...this.state.data.queue]) {
        if (item.error) continue;
        const { data, error } = await supabase.rpc("save_entry", {
          p_entry: item.entry,
          p_expected_version: item.expected,
          p_operation: item.operation,
        });
        if (account !== this.account) return;
        if (error) {
          if (
            !error.code ||
            ["PGRST000", "PGRST001", "PGRST002"].includes(error.code)
          )
            throw error;
          await this.transaction(async () =>
            this.persist({
              ...this.state.data,
              queue: this.state.data.queue.map((q) =>
                q.operation === item.operation
                  ? { ...q, error: error.message }
                  : q,
              ),
            }),
          );
          continue;
        }
        await this.transaction(async () =>
          this.persist({
            ...this.state.data,
            entries: this.state.data.entries.map((e) =>
              e.id === data.id ? data : e,
            ),
            queue: this.state.data.queue.filter(
              (q) => q.operation !== item.operation,
            ),
          }),
        );
      }
      if (account !== this.account) return;
      if (this.state.data.profiles.length) {
        const { error } = await supabase.rpc("ensure_allowances");
        if (error) throw error;
      }
      await this.refresh();
    } catch (e) {
      this.set({
        error:
          "同步未完成：" + (e.message || "网络暂不可用") + "。本机记录已保留。",
      });
    } finally {
      if (account === this.account) this.set({ syncing: false });
    }
  }
  async saveEntry(entry) {
    entry = normalizeEntry(entry);
    return this.transaction(async () => {
      const data = this.state.data,
        p = data.profiles.find((p) => p.id === entry.owner_id);
      validEntry(entry, p);
      if (data.queue.some((q) => q.entry.id === entry.id))
        throw new Error("这笔记录正在等待同步，请同步后再编辑");
      const old = data.entries.find((e) => e.id === entry.id);
      const saved = { ...entry, version: old?.version || 0 };
      await this.persist({
        ...data,
        entries: [...data.entries.filter((e) => e.id !== saved.id), saved],
        queue: cloud
          ? [
              ...data.queue,
              {
                operation: crypto.randomUUID(),
                expected: old?.version || 0,
                entry: saved,
              },
            ]
          : data.queue,
      });
      if (cloud) setTimeout(() => this.sync(), 0);
    });
  }
  async discard(operation) {
    await this.transaction(async () => {
      const q = this.state.data.queue.find((q) => q.operation === operation);
      await this.persist({
        ...this.state.data,
        queue: this.state.data.queue.filter((q) => q.operation !== operation),
        entries: this.state.data.entries.filter((e) => e.id !== q.entry.id),
      });
    });
    await this.sync();
  }
  async action(name, args) {
    if (cloud) {
      if (this.state.syncing) throw new Error("正在同步，请完成后再操作");
      if (!navigator.onLine)
        throw new Error("此操作需要联网确认，请恢复网络后重试");
      const { data, error } = await supabase.rpc(name, args);
      if (error) throw error;
      await this.refresh();
      return data;
    }
    await this.transaction(async () => {
      let d = structuredClone(this.state.data);
      if (name === "claim_task") {
        const task = d.tasks.find((t) => t.id === args.p_id);
        if (args.p_cancel) {
          d.claims = d.claims.filter(
            (c) =>
              !(c.task_id === task.id && c.student_id === this.state.user.id),
          );
          task.taken = false;
        } else {
          if (task.taken) throw new Error("任务已被领取");
          if (task.deadline < today()) throw new Error("任务已截止");
          task.taken = true;
          d.claims.push({ task_id: task.id, student_id: this.state.user.id });
        }
      }
      if (name === "complete_task") {
        const task = d.tasks.find((t) => t.id === args.p_id);
        const claim = d.claims.find((c) => c.task_id === task.id);
        if (!claim) throw new Error("任务尚未被领取");
        if (
          task.status !== "completed" &&
          task.reward_amount > 0 &&
          !d.entries.some((e) => e.task_id === task.id)
        )
          d.entries.push({
            id: crypto.randomUUID(),
            owner_id: claim.student_id,
            date: today(),
            end_date: today(),
            kind: "reward",
            category: "任务奖金",
            description: `任务奖金 · ${task.title}`,
            amount: task.reward_amount,
            funding: "team",
            reimbursed: 0,
            note: "老师验收后自动记账",
            version: 1,
            task_id: task.id,
            deleted: false,
          });
        task.status = "completed";
      }
      if (name === "save_task") {
        const old = d.tasks.find((t) => t.id === args.p_task.id);
        if (old?.status === "completed") throw new Error("已完成任务不能修改");
        d.tasks = [
          {
            ...old,
            ...args.p_task,
            status: "open",
            taken: old?.taken || false,
          },
          ...d.tasks.filter((t) => t.id !== args.p_task.id),
        ];
      }
      if (name === "save_settings")
        d.settings = { ...d.settings, ...args.p_settings };
      if (name === "save_monthly_payment") {
        const column =
          args.p_kind === "salary" ? "salary_month" : "allowance_month";
        const old = d.entries.find(
          (e) => e.owner_id === args.p_owner && e[column] === args.p_month,
        );
        if ((old?.version || 0) !== args.p_expected_version)
          throw new Error("CONFLICT:该月份已修改，请重新打开表单");
        const saved = {
          ...old,
          id: old?.id || crypto.randomUUID(),
          owner_id: args.p_owner,
          date: args.p_month,
          end_date: args.p_month,
          kind: args.p_kind,
          category: args.p_kind === "salary" ? "固定工资" : "月度补助",
          description: args.p_kind === "salary" ? "当月固定工资" : "当月补助",
          amount: args.p_amount,
          funding: "team",
          reimbursed: 0,
          note: "老师按指定年月确认",
          [column]: args.p_month,
          salary_manual: args.p_kind === "salary",
          version: (old?.version || 0) + 1,
          deleted: false,
        };
        d.entries = [...d.entries.filter((e) => e.id !== saved.id), saved];
      }
      if (name === "save_salary_rules") {
        const old = d.salaryRules?.find(
          (r) => r.effective_month === args.p_month,
        );
        if ((old?.version || 0) !== args.p_expected_version)
          throw new Error("CONFLICT:工资标准已修改");
        d.salaryRules = [
          ...(d.salaryRules || []).filter(
            (r) => r.effective_month !== args.p_month,
          ),
          {
            effective_month: args.p_month,
            rates: args.p_rates,
            version: (old?.version || 0) + 1,
          },
        ].sort((a, b) => a.effective_month.localeCompare(b.effective_month));
        for (const p of d.profiles.filter((p) => p.role === "student")) {
          for (
            let y = p.start_year;
            y <= Math.min(p.end_year, Number(today().slice(0, 4)));
            y++
          )
            for (let month = 1; month <= 12; month++) {
              const m = `${y}-${String(month).padStart(2, "0")}-01`;
              if (m < p.start_month || m > today() || m < args.p_month)
                continue;
              const rule = d.salaryRules
                .filter((r) => r.effective_month <= m)
                .at(-1);
              if (!rule) continue;
              const amount = salaryFor(p, m, { salary_rates: rule.rates });
              const existing = d.entries.find(
                (e) =>
                  e.owner_id === p.id &&
                  (e.salary_month === m ||
                    (e.kind === "salary" &&
                      e.date === m &&
                      e.id.startsWith("allow-"))),
              );
              if (existing) {
                if (!existing.salary_manual && !existing.deleted) {
                  existing.amount = amount;
                  existing.version++;
                  existing.salary_month = m;
                }
              } else if (amount > 0)
                d.entries.push({
                  id: crypto.randomUUID(),
                  owner_id: p.id,
                  date: m,
                  end_date: m,
                  kind: "salary",
                  category: "固定工资",
                  description: "当月固定工资",
                  amount,
                  funding: "team",
                  reimbursed: 0,
                  note: "按年级标准自动记账",
                  salary_month: m,
                  version: 1,
                  deleted: false,
                });
            }
        }
      }
      await this.persist(d);
    });
  }
  selectDemo(id) {
    localStorage.setItem("yanzhu-demo-user", id);
    this.set({ user: this.state.data.profiles.find((p) => p.id === id) });
  }
  async logout() {
    if (this.state.syncing) throw new Error("正在同步，请稍后退出");
    if (this.state.data.queue.length)
      throw new Error("还有未同步记录，请先完成同步；遇到冲突时请备份后处理");
    if (cloud) {
      await (await db).delete("accounts", this.account);
      await supabase.auth.signOut();
    } else this.selectDemo("demo-teacher");
  }
}
export const store = new Store();
