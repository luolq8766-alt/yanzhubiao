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
export const FUNDING = {
  advance: "个人垫付",
  personal: "个人承担",
  team: "课题组支付",
};
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
    ...e,
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
  if (
    !Number.isSafeInteger(e.reimbursed) ||
    e.reimbursed < 0 ||
    e.reimbursed > e.amount
  )
    throw new Error("报销金额不能超过垫付金额");
  if (!Object.hasOwn(FUNDING, e.funding)) throw new Error("支付方式无效");
  if (e.funding !== "advance" && e.reimbursed !== 0)
    throw new Error("只有个人垫付可以报销");
  if (e.kind !== "expense" && (e.funding !== "team" || e.reimbursed !== 0))
    throw new Error("工资、补助与奖金由课题组支付");
  if (e.is_trip)
    tripPay(e.date, e.end_date || e.date, Number(e.underground_days || 0));
  if ((e.note || "").length > 1000) throw new Error("备注不能超过 1000 字");
  return e;
}
// Derived wage rows are projections of a trip, never a second independently editable record.
export function ledgerEntries(entries) {
  const ids = new Set(entries.map((e) => e.id));
  return entries.flatMap((e) => {
    if (e.deleted) return [];
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
        funding: "team",
        reimbursed: 0,
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
    salary: 0,
    allowance: 0,
    reward: 0,
    trip_salary: 0,
    pending: 0,
    personal: 0,
    reimbursed: 0,
    team: 0,
    count: rows.length,
  };
  for (const e of rows) {
    if (e.kind !== "expense") {
      total.income += e.amount;
      if (Object.hasOwn(total, e.kind)) total[e.kind] += e.amount;
    } else {
      total.expense += e.amount;
      if (e.funding === "advance") {
        total.pending += e.amount - e.reimbursed;
        total.reimbursed += e.reimbursed;
      }
      if (e.funding === "personal") total.personal += e.amount;
      if (e.funding === "team") total.team += e.amount;
    }
  }
  return {
    ...total,
    teamOutlay: total.income + total.team + total.reimbursed,
    teamCost: total.income + total.team + total.reimbursed + total.pending,
    gap: total.income - total.expense,
    net: total.income - total.pending - total.personal,
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
export function salaryFor(p, month, settings) {
  const grade = p.grade + Number(month.slice(0, 4)) - p.start_year;
  return Number(settings.salary_rates?.[`${p.degree}_${grade}`] || 0);
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
      start_month: `${y}-01-01`,
      email: `member${i + 1}@example.edu`,
    })),
  ];
  const entries = [];
  for (const [i, p] of profiles.slice(1).entries())
    for (let k = 1; k <= m; k++) {
      entries.push({
        id: `allow-${p.id}-${k}`,
        owner_id: p.id,
        salary_month: `${y}-${String(k).padStart(2, "0")}-01`,
        date: `${y}-${String(k).padStart(2, "0")}-01`,
        kind: "salary",
        category: "固定工资",
        description: "当月固定工资",
        amount: p.monthly_stipend,
        reimbursed: 0,
        funding: "team",
        note: "定额自动记账 · 演示数据",
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
          reimbursed: k < m && j === 0 ? amount : 0,
          funding: j === 0 ? "advance" : i % 3 === 0 ? "personal" : "team",
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
