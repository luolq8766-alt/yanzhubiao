import { createClient } from "@supabase/supabase-js";
import { openDB } from "idb";
import {
  seed,
  validEntry,
  today,
  normalizeEntry,
  salaryFor,
  cleanEntry,
  generateSalaries,
  gradeKey,
  years,
  BOOK_START,
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
        let data = (await (await db).get("accounts", "demo")) || seed();
        if (data.version !== "2.1") {
          const rules = new Map();
          for (const r of [...(data.salaryRules || [])].sort((a, b) =>
            (a.effective_month || "").localeCompare(b.effective_month || ""),
          )) {
            const year = r.year || Number(r.effective_month?.slice(0, 4));
            if (year >= 2026)
              rules.set(year, {
                year,
                rates: r.rates,
                version: r.version || 1,
              });
          }
          data = {
            ...data,
            version: "2.1",
            salaryRules: [...rules.values()],
            entries: data.entries.map((e) => ({
              ...cleanEntry(e),
              allowance_manual: e.allowance_manual ?? !!e.allowance_month,
            })),
          };
        }
        data = generateSalaries(data);
        await this.persist(data);
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
      supabase.from("annual_salary_rules").select("*").order("year"),
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
          ...e.data.filter((x) => !ids.has(x.id)).map(cleanEntry),
          ...current.queue.map((q) => cleanEntry(q.entry)),
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
          p_entry: cleanEntry(item.entry),
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
              e.id === data.id ? cleanEntry(data) : e,
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
      if (entry.kind === "salary" || old?.kind === "salary")
        throw new Error("固定工资由年度年级标准统一维护");
      if (old?.task_id) throw new Error("任务奖励不能单独修改");
      if (
        old?.allowance_month &&
        (entry.date !== old.date || entry.kind !== old.kind)
      )
        throw new Error("月度补助不能改变月份或类型");
      const saved = {
        ...entry,
        allowance_manual:
          !!old?.allowance_month || entry.allowance_manual || false,
        version: cloud ? old?.version || 0 : (old?.version || 0) + 1,
      };
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
    let actionResult;
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
      const setAllowance = (person, amount, expected, manual) => {
        const month = args.p_month;
        if (
          !person ||
          !years(person).includes(Number(month.slice(0, 4))) ||
          month < BOOK_START
        )
          throw new Error("请选择 2026 年 6 月起的在读月份");
        const old = d.entries.find(
          (e) => e.owner_id === person.id && e.allowance_month === month,
        );
        if ((old?.version || 0) !== expected)
          throw new Error("CONFLICT:该月补助已修改，请同步后重新打开");
        const saved = {
          ...old,
          id: old?.id || crypto.randomUUID(),
          owner_id: person.id,
          date: month,
          end_date: month,
          kind: "allowance",
          category: "月度补助",
          description: "实际月度补助（含固定工资）",
          amount,
          allowance_month: month,
          allowance_manual: manual,
          note: manual ? "老师按个人设置" : "老师按年级统一设置",
          version: (old?.version || 0) + 1,
          deleted: false,
        };
        d.entries = [...d.entries.filter((e) => e.id !== saved.id), saved];
        return saved;
      };
      if (name === "save_monthly_payment") {
        if (args.p_kind !== "allowance")
          throw new Error("固定工资按年度年级设置");
        actionResult = setAllowance(
          d.profiles.find((p) => p.id === args.p_owner),
          args.p_amount,
          args.p_expected_version,
          true,
        );
      }
      if (name === "save_grade_allowance") {
        const targets = d.profiles.filter(
          (p) =>
            p.role === "student" &&
            years(p).includes(Number(args.p_month.slice(0, 4))) &&
            gradeKey(p, Number(args.p_month.slice(0, 4))) === args.p_grade,
        );
        if (!targets.length) throw new Error("该年月没有此年级的学生");
        if (targets.length !== Object.keys(args.p_versions).length)
          throw new Error("CONFLICT:成员名单已变化");
        for (const p of targets) {
          const old = d.entries.find(
            (e) => e.owner_id === p.id && e.allowance_month === args.p_month,
          );
          if ((old?.version || 0) !== args.p_versions[p.id])
            throw new Error("CONFLICT:成员补助已修改");
        }
        const changed = [];
        for (const p of targets) {
          const old = d.entries.find(
            (e) => e.owner_id === p.id && e.allowance_month === args.p_month,
          );
          if (
            old?.allowance_manual &&
            !old.deleted &&
            !args.p_include_individual
          )
            continue;
          changed.push(
            setAllowance(p, args.p_amount, args.p_versions[p.id], false),
          );
        }
        actionResult = {
          changed: changed.length,
          preserved: targets.length - changed.length,
          entries: changed,
        };
      }
      if (name === "save_annual_salary") {
        const old = d.salaryRules?.find((r) => r.year === args.p_year);
        if ((old?.version || 0) !== args.p_expected_version)
          throw new Error("CONFLICT:年度标准已修改");
        d.salaryRules = [
          ...(d.salaryRules || []).filter((r) => r.year !== args.p_year),
          {
            year: args.p_year,
            rates: args.p_rates,
            version: (old?.version || 0) + 1,
          },
        ];
        d = generateSalaries(d);
      }
      await this.persist(d);
    });
    return actionResult;
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
