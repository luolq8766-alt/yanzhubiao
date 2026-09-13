export const CATEGORIES = [
  "差旅费",
  "版面费/文章开销",
  "试剂耗材费",
  "测试费",
  "测试加工费",
  "招待费",
  "其他",
];
export const COLORS = [
  "#178c79",
  "#679bd1",
  "#9b8cd5",
  "#edb966",
  "#e18b79",
  "#c48cac",
  "#a7b5bc",
];
export const KIND = {
  expense: "科研支出",
  salary: "固定工资",
  allowance: "月度补助",
  reward: "奖金",
  trip_salary: "出差工资",
};
export const BOOK_START = "2026-06-01";
export const isIncome = (e) => e.kind === "allowance" || e.kind === "reward";
export const gradeKey = (p, year) =>
  `${p.degree}_${p.grade + Number(year) - p.start_year}`;
export const recordStart = (p) =>
  [BOOK_START, `${p.start_year}-01-01`].sort().at(-1);
// Remove retired fields from cached version 1/2 entries before reusing them.
export function cleanEntry(e) {
  const { funding, reimbursed, salary_manual, ...entry } = e;
  return entry;
}
export const SALARY_GRADES = [
  "master_1",
  "master_2",
  "master_3",
  "doctor_1",
  "doctor_2",
  "doctor_3",
  "doctor_4",
  "doctor_5",
];
export const gradeLabel = (key) =>
  `${key.startsWith("master") ? "硕士" : "博士"} ${key.split("_")[1]} 年级`;
export const today = () =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
export const money = (value = 0) =>
  new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
  }).format(value / 100);
export function cents(value) {
  const s = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error("金额最多保留两位小数");
  const n = Math.round(Number(s) * 100);
  if (!Number.isSafeInteger(n) || n > 10000000000)
    throw new Error("金额超出范围");
  return n;
}
export function years(p) {
  if (!p?.degree) return [];
  return Array.from(
    { length: (p.degree === "master" ? 3 : 5) - p.grade + 1 },
    (_, i) => p.start_year + i,
  );
}
export function validDate(date) {
  return (
    typeof date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(Date.parse(date)) &&
    new Date(date).toISOString().slice(0, 10) === date
  );
}
export function tripPay(start, end, underground = 0) {
  if (!validDate(start) || !validDate(end) || end < start)
    throw new Error("结束日期不能早于开始日期，且必须为有效日期");
  const days = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
  if (!Number.isInteger(underground) || underground < 0 || underground > days)
    throw new Error("下井天数必须为整数，且不能超过出差天数");
  return {
    days,
    underground,
    base: days * 12000,
    extra: underground * 6000,
    amount: days * 12000 + underground * 6000,
  };
}
export function normalizeEntry(e) {
  const value = {
    ...cleanEntry(e),
    end_date: e.end_date || e.date,
    items: e.kind === "expense" ? e.items || [] : [],
    is_trip: e.kind === "expense" && !!e.is_trip,
    underground_days: e.is_trip ? Number(e.underground_days || 0) : 0,
  };
  if (value.items.length) {
    value.amount = value.items.reduce((n, i) => n + i.amount, 0);
    const cats = [...new Set(value.items.map((i) => i.category))];
    value.category = cats.length === 1 ? cats[0] : "多项费用";
  }
  value.trip_wage = value.is_trip
    ? tripPay(value.date, value.end_date, value.underground_days).amount
    : 0;
  return value;
}
export function validEntry(e, p) {
  if (!validDate(e.date) || !validDate(e.end_date || e.date))
    throw new Error("日期无效");
  if (
    !years(p).includes(Number(e.date.slice(0, 4))) ||
    !years(p).includes(Number((e.end_date || e.date).slice(0, 4)))
  )
    throw new Error("请选择在读年度内的日期");
  if ((e.end_date || e.date) < e.date)
    throw new Error("结束日期不能早于开始日期");
  if (!e.description?.trim() || e.description.trim().length > 200)
    throw new Error("具体事务请填写 1 至 200 字");
  if (!["expense", "salary", "allowance", "reward"].includes(e.kind))
    throw new Error("记录类型无效");
  if (!Number.isSafeInteger(e.amount) || e.amount < 0 || e.amount > 10000000000)
    throw new Error("金额必须为零或正数，且不超过一亿元");
  if (!Array.isArray(e.items || []) || (e.items || []).length > 50)
    throw new Error("一笔事务最多 50 项费用");
  for (const i of e.items || []) {
    if (
      !i.name?.trim() ||
      i.name.length > 80 ||
      !CATEGORIES.includes(i.category) ||
      !Number.isSafeInteger(i.amount) ||
      i.amount < 0 ||
      i.amount > 10000000000
    )
      throw new Error("请完整填写费用名称、分类和非负金额");
  }
  if (
    e.kind === "expense" &&
    !e.items?.length &&
    !CATEGORIES.includes(e.category)
  )
    throw new Error("费用分类无效");
  if (e.items?.length && e.items.reduce((n, i) => n + i.amount, 0) !== e.amount)
    throw new Error("明细与费用合计不一致");
  if (e.date < recordStart(p))
    throw new Error("记账从 2026 年 6 月及成员在读年度起始日期开始");
  if (e.is_trip)
    tripPay(e.date, e.end_date || e.date, Number(e.underground_days || 0));
  if ((e.note || "").length > 1000) throw new Error("备注不能超过 1000 字");
  return e;
}
// Derived wage rows are projections of a trip, never a second independently editable record.
export function ledgerEntries(entries) {
  const ids = new Set(entries.map((e) => e.id));
  return entries.flatMap((e) => {
    if (e.deleted || e.date < BOOK_START) return [];
    if (e.kind !== "expense" || !e.is_trip || ids.has(`trip-${e.id}`))
      return [e];
    const pay = tripPay(
      e.date,
      e.end_date || e.date,
      Number(e.underground_days || 0),
    );
    return [
      e,
      {
        ...e,
        id: `trip-${e.id}`,
        source_entry_id: e.id,
        kind: "trip_salary",
        category: "出差工资",
        description: `出差工资 · ${e.description}`.slice(0, 200),
        amount: pay.amount,
        items: [],
        is_trip: false,
        note: `${pay.days} 天 × 120 元 + 下井 ${pay.underground} 天 × 60 元；随原事务修改，不重复记账。`,
      },
    ];
  });
}
export const dateRange = (e) =>
  e.end_date && e.end_date !== e.date ? `${e.date} 至 ${e.end_date}` : e.date;
export function categoryTotals(entries) {
  const result = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  entries
    .filter((e) => !e.deleted && e.kind === "expense")
    .forEach((e) => {
      for (const i of e.items?.length ? e.items : [e])
        result[i.category] = (result[i.category] || 0) + i.amount;
    });
  return result;
}
export function summary(entries, { owner, year, month } = {}) {
  const rows = ledgerEntries(entries).filter(
    (e) =>
      (!owner || e.owner_id === owner) &&
      (!year || e.date.startsWith(String(year))) &&
      (!month || e.date.slice(5, 7) === String(month).padStart(2, "0")),
  );
  const total = {
    income: 0,
    expense: 0,
    research: 0,
    salary: 0,
    allowance: 0,
    reward: 0,
    trip_salary: 0,
    count: rows.length,
  };
  for (const e of rows) {
    if (isIncome(e)) total.income += e.amount;
    else total.expense += e.amount;
    if (e.kind === "expense") total.research += e.amount;
    else if (Object.hasOwn(total, e.kind)) total[e.kind] += e.amount;
  }
  return {
    ...total,
    teamOutlay: total.income,
    gap: total.income - total.expense,
  };
}
export function warning(s, all, settings) {
  if (s.expense >= settings.monthly_limit || all.gap <= -settings.gap_limit)
    return "red";
  if (
    s.expense >= settings.monthly_limit * 0.8 ||
    all.gap <= -settings.gap_limit * 0.8
  )
    return "yellow";
  return "green";
}
export const monthly = (entries, year, owner) =>
  Array.from({ length: 12 }, (_, i) => ({
    ...summary(entries, { owner, year, month: i + 1 }),
    month: i + 1,
  }));
export function salaryFor(p, year, rates) {
  return Number(rates?.[gradeKey(p, String(year).slice(0, 4))] || 0);
}
export function generateSalaries(data, at = today()) {
  const d = structuredClone(data);
  for (const rule of d.salaryRules || [])
    for (const p of d.profiles.filter(
      (p) => p.role === "student" && years(p).includes(rule.year),
    )) {
      for (let month = 1; month <= 12; month++) {
        const date = `${rule.year}-${String(month).padStart(2, "0")}-01`;
        if (date < recordStart(p) || date > at) continue;
        const amount = salaryFor(p, rule.year, rule.rates);
        const old = d.entries.find(
          (e) => e.owner_id === p.id && e.salary_month === date,
        );
        if (old) {
          if (old.amount !== amount || old.deleted) {
            old.amount = amount;
            old.deleted = false;
            old.version = (old.version || 0) + 1;
          }
        } else
          d.entries.push({
            id: crypto.randomUUID(),
            owner_id: p.id,
            date,
            end_date: date,
            salary_month: date,
            kind: "salary",
            category: "固定工资",
            description: "当月固定工资（支出）",
            amount,
            note: "年度年级标准自动记账；已包含在实际补助中",
            version: 1,
            deleted: false,
          });
      }
    }
  return d;
}
export function seed() {
  const y = Number(today().slice(0, 4)),
    m = Number(today().slice(5, 7));
  const teacher = {
    id: "demo-teacher",
    name: "陈老师",
    role: "teacher",
    email: "teacher@example.edu",
  };
  const names = [
    "林知远",
    "陈思涵",
    "周予安",
    "许明澈",
    "苏亦宁",
    "陆星河",
    "沈嘉禾",
    "顾清和",
    "唐沐言",
  ];
  const profiles = [
    teacher,
    ...names.map((name, i) => ({
      id: `demo-${i + 1}`,
      name,
      role: "student",
      degree: i < 5 ? "master" : "doctor",
      grade: (i % 3) + 1,
      start_year: y,
      end_year: y + (i < 5 ? 3 : 5) - ((i % 3) + 1),
      monthly_stipend: i < 5 ? 120000 : 180000,
      start_month: [BOOK_START, `${y}-01-01`].sort().at(-1),
      email: `member${i + 1}@example.edu`,
    })),
  ];
  const entries = [];
  for (const [i, p] of profiles.slice(1).entries())
    for (let k = y === 2026 ? 6 : 1; k <= m; k++) {
      entries.push({
        id: `allow-${p.id}-${k}`,
        owner_id: p.id,
        salary_month: `${y}-${String(k).padStart(2, "0")}-01`,
        date: `${y}-${String(k).padStart(2, "0")}-01`,
        kind: "salary",
        category: "固定工资",
        description: "当月固定工资",
        amount: p.monthly_stipend,
        note: "定额自动记账 · 演示数据",
        version: 1,
        deleted: false,
      });
      entries.push({
        id: `subsidy-${p.id}-${k}`,
        owner_id: p.id,
        date: `${y}-${String(k).padStart(2, "0")}-01`,
        kind: "allowance",
        category: "月度补助",
        description: "实际月度补助（含固定工资）",
        amount: p.monthly_stipend + 100000,
        allowance_month: `${y}-${String(k).padStart(2, "0")}-01`,
        allowance_manual: false,
        note: "演示数据",
        version: 1,
        deleted: false,
      });
      for (let j = 0; j < 2; j++) {
        const amount = (170 + ((i * 163 + k * 79 + j * 457) % 1500)) * 100;
        entries.push({
          id: `exp-${i}-${k}-${j}`,
          owner_id: p.id,
          date: `${y}-${String(k).padStart(2, "0")}-${j ? "08" : "03"}`,
          kind: "expense",
          category: CATEGORIES[(i + k + j) % 5],
          description: [
            "野外采样与往返交通",
            "课题实验样品检测",
            "研究论文开放获取费用",
            "实验试剂与耗材采购",
            "材料测试加工",
          ][(i + k + j) % 5],
          amount,
          note: "科研项目日常支出",
          version: 1,
          deleted: false,
        });
      }
    }
  return {
    profiles,
    entries,
    tasks: [
      {
        id: "demo-task-1",
        title: "读懂一篇 Nature：从问题到证据",
        content:
          "选择一篇与你研究方向相关的论文，梳理科学问题、关键证据与研究局限，整理 5 页组会分享。",
        reward: "组会分享优先权",
        reward_amount: 20000,
        deadline: `${y}-12-20`,
        taken: false,
        status: "open",
        category: "文献精读",
      },
      {
        id: "demo-task-2",
        title: "Python 科研数据可视化",
        content:
          "完成一份真实实验数据的清洗，绘制可复用的多面板图，提交代码与简短说明。",
        reward: "完成技能训练",
        reward_amount: 30000,
        deadline: `${y}-12-25`,
        taken: true,
        status: "open",
        category: "技能提升",
        my_claim: false,
      },
      {
        id: "demo-task-3",
        title: "建立课题组实验 SOP",
        content:
          "整理常用实验的操作流程与质量控制清单，形成可供新成员复用的操作文档。",
        reward: "优秀贡献记录",
        reward_amount: 50000,
        deadline: `${y}-12-30`,
        taken: false,
        status: "open",
        category: "团队共建",
      },
    ],
    claims: [{ task_id: "demo-task-2", student_id: "demo-3" }],
    salaryRules: [
      {
        year: y,
        rates: {
          master_1: 120000,
          master_2: 120000,
          master_3: 120000,
          doctor_1: 180000,
          doctor_2: 180000,
          doctor_3: 180000,
          doctor_4: 180000,
          doctor_5: 180000,
        },
        version: 1,
      },
    ],
    settings: {
      id: 1,
      salary_rates: {
        master_1: 120000,
        master_2: 120000,
        master_3: 120000,
        doctor_1: 180000,
        doctor_2: 180000,
        doctor_3: 180000,
        doctor_4: 180000,
        doctor_5: 180000,
      },
      salary_effective_month: `${y}-01-01`,
      team_name: "科研课题组",
      monthly_limit: 300000,
      gap_limit: 1000000,
    },
    queue: [],
    lastSync: null,
  };
}
