export const CATEGORIES = [
  "差旅费",
  "版面费/文章开销",
  "试剂耗材费",
  "测试费",
  "测试加工费",
  "其他",
];
export const COLORS = [
  "#178c79",
  "#679bd1",
  "#9b8cd5",
  "#edb966",
  "#e18b79",
  "#a7b5bc",
];
export const KIND = {
  expense: "科研支出",
  allowance: "研助补助",
  reward: "任务奖励",
};
export const FUNDING = {
  advance: "个人垫付",
  personal: "个人承担",
  team: "课题组支付",
};
export const today = () =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
export const money = (cents = 0) =>
  new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
  }).format(cents / 100);
export function cents(value) {
  const s = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error("金额最多保留两位小数");
  const n = Math.round(Number(s) * 100);
  if (!Number.isSafeInteger(n) || n > 10000000000)
    throw new Error("金额超出范围");
  return n;
}
export function years(profile) {
  if (!profile?.degree) return [];
  return Array.from(
    { length: (profile.degree === "master" ? 3 : 5) - profile.grade + 1 },
    (_, i) => profile.start_year + i,
  );
}
export function validEntry(e, p) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(e.date) ||
    Number.isNaN(Date.parse(e.date)) ||
    new Date(e.date).toISOString().slice(0, 10) !== e.date
  )
    throw new Error("日期无效");
  if (!years(p).includes(Number(e.date.slice(0, 4))))
    throw new Error("请选择在读年度内的日期");
  if (!e.description?.trim()) throw new Error("请填写具体事务");
  if (
    !Number.isSafeInteger(e.amount) ||
    e.amount <= 0 ||
    e.amount > 10000000000
  )
    throw new Error("金额必须大于零且不超过一亿元");
  if (e.kind === "expense" && !CATEGORIES.includes(e.category))
    throw new Error("费用分类无效");
  if (e.reimbursed < 0 || e.reimbursed > e.amount)
    throw new Error("报销金额不能超过垫付金额");
  if (e.funding !== "advance" && e.reimbursed !== 0)
    throw new Error("只有个人垫付可以报销");
  return e;
}
export function summary(entries, { owner, year, month } = {}) {
  const rows = entries.filter(
    (e) =>
      !e.deleted &&
      (!owner || e.owner_id === owner) &&
      (!year || e.date.startsWith(String(year))) &&
      (!month || e.date.slice(5, 7) === String(month).padStart(2, "0")),
  );
  const total = {
    income: 0,
    expense: 0,
    pending: 0,
    personal: 0,
    reimbursed: 0,
    team: 0,
    count: rows.length,
  };
  for (const e of rows) {
    if (e.kind !== "expense") total.income += e.amount;
    else {
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
export function monthly(entries, year, owner) {
  return Array.from({ length: 12 }, (_, i) => ({
    ...summary(entries, { owner, year, month: i + 1 }),
    month: i + 1,
  }));
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
        date: `${y}-${String(k).padStart(2, "0")}-01`,
        kind: "allowance",
        category: "研助补助",
        description: "当月研助收入",
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
        reward: "组会分享优先权 + 200 元学习奖励",
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
        reward: "300 元学习奖励",
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
        reward: "500 元学习奖励 + 优秀贡献记录",
        deadline: `${y}-12-30`,
        taken: false,
        status: "open",
        category: "团队共建",
      },
    ],
    claims: [{ task_id: "demo-task-2", student_id: "demo-3" }],
    settings: {
      id: 1,
      team_name: "科研课题组",
      monthly_limit: 300000,
      gap_limit: 1000000,
    },
    queue: [],
    lastSync: null,
  };
}
