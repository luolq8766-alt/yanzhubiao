import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite();
let checks = 0;
const teacher = "00000000-0000-4000-8000-000000000001",
  alice = "00000000-0000-4000-8000-000000000002",
  bob = "00000000-0000-4000-8000-000000000003";
await db.exec(
  `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`,
);
await db.exec(
  await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8"),
);
const y = Number(new Date().toISOString().slice(0, 4));
await db.exec(
  `insert into auth.users values('${teacher}','teacher@test.edu',now()),('${alice}','alice@test.edu',now()),('${bob}','bob@test.edu',now());insert into private.allowed_emails values('teacher@test.edu','teacher'),('alice@test.edu','student'),('bob@test.edu','student');`,
);
async function as(id, sql, params = []) {
  await db.exec(
    `reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id}',false);`,
  );
  return db.query(sql, params);
}
async function deny(id, sql, params = [], match) {
  await assert.rejects(() => as(id, sql, params), match);
  checks++;
}
async function ok(name, fn) {
  await fn();
  checks++;
  console.log("PASS", name);
}
await ok("邀请邮箱决定老师角色", async () => {
  const r = await as(teacher, "select public.register_profile($1,$2,$3,$4) p", [
    "老师",
    "master",
    1,
    y,
  ]);
  assert.equal(r.rows[0].p.role, "teacher");
});
await as(alice, "select public.register_profile($1,$2,$3,$4)", [
  "甲",
  "master",
  2,
  y,
]);
await as(bob, "select public.register_profile($1,$2,$3,$4)", [
  "乙",
  "doctor",
  1,
  y,
]);
await ok("硕二只保留当前和下一年度", async () => {
  const r = await as(alice, "select * from public.profiles");
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].end_year, y + 1);
});
const entry = {
  id: crypto.randomUUID(),
  owner_id: alice,
  date: `${y}-09-01`,
  kind: "expense",
  category: "差旅费",
  description: "采样交通",
  amount: 50000,
  funding: "advance",
  reimbursed: 0,
  note: "测试",
  deleted: false,
};
const op = crypto.randomUUID();
await ok("学生保存自己的账目", async () => {
  const r = await as(alice, "select public.save_entry($1,0,$2) e", [entry, op]);
  assert.equal(r.rows[0].e.version, 1);
});
await ok("断网重试具有幂等性", async () => {
  const r = await as(alice, "select public.save_entry($1,0,$2) e", [entry, op]);
  assert.equal(r.rows[0].e.version, 1);
});
await ok("其他学生看不到账目及成员身份", async () => {
  assert.equal((await as(bob, "select * from public.entries")).rows.length, 0);
  assert.equal((await as(bob, "select * from public.profiles")).rows.length, 1);
});
await deny(
  bob,
  "select public.save_entry($1,1,$2)",
  [{ ...entry, description: "越权" }, crypto.randomUUID()],
  /无权/,
);

await deny(
  alice,
  "select public.save_entry($1,1,$2)",
  [{ ...entry, kind: "allowance" }, crypto.randomUUID()],
  /只能由老师/,
);
await deny(
  alice,
  `update public.profiles set role='teacher' where id='${alice}'`,
  [],
  /permission denied/,
);
await deny(
  alice,
  "select * from private.allowed_emails",
  [],
  /permission denied/,
);
await ok("学生可修改历史费用，服务器剥离旧字段", async () => {
  const r = await as(alice, "select public.save_entry($1,1,$2) e", [
    { ...entry, amount: 60000 },
    crypto.randomUUID(),
  ]);
  assert.equal(r.rows[0].e.amount, 60000);
  assert(!("funding" in r.rows[0].e));
  assert(!("reimbursed" in r.rows[0].e));
});
await deny(
  alice,
  "select public.save_entry($1,1,$2)",
  [{ ...entry, description: "旧版本" }, crypto.randomUUID()],
  /CONFLICT/,
);
await deny(
  teacher,
  "select public.save_entry($1,2,$2)",
  [{ ...entry, date: "2026-05-31" }, crypto.randomUUID()],
  /日期|年度/,
);
await deny(
  teacher,
  "select public.save_entry($1,2,$2)",
  [{ ...entry, date: `${y + 2}-01-01` }, crypto.randomUUID()],
  /在读年度/,
);
const task = {
  id: crypto.randomUUID(),
  title: "精读论文",
  content: "整理证据链",
  reward: "精读奖励",
  reward_amount: 20000,
  category: "文献精读",
  deadline: `${y + 1}-01-01`,
};
await as(teacher, "select public.save_task($1)", [task]);
await as(alice, "select public.claim_task($1)", [task.id]);
await ok("其他学生只能看已被领取，不能读取领取人", async () => {
  const r = await as(bob, "select * from public.list_tasks()");
  assert.equal(r.rows[0].taken, true);
  assert.equal(r.rows[0].my_claim, false);
  assert(!("student_id" in r.rows[0]));
  assert.equal(
    (await as(bob, "select * from public.task_claims")).rows.length,
    0,
  );
  assert.equal(
    (await as(teacher, "select * from public.task_claims")).rows[0].student_id,
    alice,
  );
});
await deny(bob, "select public.claim_task($1)", [task.id], /已被领取/);
await deny(bob, "select public.complete_task($1)", [task.id], /仅老师/);
await as(teacher, "select public.complete_task($1)", [task.id]);
await deny(alice, "select public.claim_task($1,true)", [task.id], /已完成/);
const nowMonth =
  new Date()
    .toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" })
    .slice(0, 7) + "-01";
const rates = {
  master_1: 80000,
  master_2: 100000,
  master_3: 120000,
  doctor_1: 150000,
  doctor_2: 160000,
  doctor_3: 170000,
  doctor_4: 180000,
  doctor_5: 190000,
};
await ok("年度工资回填六月到当月；全年度统一改价，不允许按月覆盖", async () => {
  await as(teacher, "select public.save_annual_salary($1,$2,0)", [y, rates]);
  await as(teacher, "select public.ensure_allowances()");
  await as(teacher, "select public.ensure_allowances()");
  let r = await as(
    alice,
    "select * from public.entries where salary_month is not null order by date",
  );
  assert.equal(r.rows[0].date.toISOString().slice(0, 10), "2026-06-01");
  assert.equal(r.rows.length, Number(nowMonth.slice(5, 7)) - 5);
  assert(r.rows.every((e) => e.amount === 100000));
  await as(teacher, "select public.save_annual_salary($1,$2,1)", [
    y,
    { ...rates, master_2: 150000 },
  ]);
  r = await as(
    alice,
    "select * from public.entries where salary_month is not null order by date",
  );
  assert(r.rows.every((e) => e.amount === 150000));
  assert.equal(new Set(r.rows.map((e) => e.salary_month)).size, r.rows.length);
  await deny(
    teacher,
    "select public.save_monthly_payment($1,$2,$3,$4,$5,$6)",
    [alice, nowMonth, "salary", 999, 2, crypto.randomUUID()],
    /年度/,
  );
  await deny(
    teacher,
    "select public.save_entry($1,2,$2)",
    [{ ...r.rows[0], amount: 999 }, crypto.randomUUID()],
    /年度/,
  );
  await deny(
    alice,
    "select public.save_annual_salary($1,$2,2)",
    [y, rates],
    /仅老师/,
  );
  await deny(
    teacher,
    "select public.save_annual_salary($1,$2,1)",
    [y, rates],
    /CONFLICT/,
  );
});
await ok("老师指定8月补助2000改4000，重试不重复入账", async () => {
  let r = await as(
    teacher,
    "select public.save_monthly_payment($1,$2,$3,$4,$5,$6) e",
    [alice, `${y}-08-01`, "allowance", 200000, 0, crypto.randomUUID()],
  );
  const first = r.rows[0].e,
    op = crypto.randomUUID();
  const args = [alice, `${y}-08-01`, "allowance", 400000, first.version, op];
  r = await as(
    teacher,
    "select public.save_monthly_payment($1,$2,$3,$4,$5,$6) e",
    args,
  );
  assert.equal(r.rows[0].e.id, first.id);
  assert.equal(r.rows[0].e.amount, 400000);
  await as(
    teacher,
    "select public.save_monthly_payment($1,$2,$3,$4,$5,$6)",
    args,
  );
  r = await as(alice, "select * from public.entries where allowance_month=$1", [
    `${y}-08-01`,
  ]);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].amount, 400000);
  await deny(
    teacher,
    "select public.save_monthly_payment($1,$2,$3,$4,$5,$6)",
    [alice, `${y}-08-01`, "allowance", 500000, 1, crypto.randomUUID()],
    /CONFLICT/,
  );
  await deny(
    bob,
    "select public.save_monthly_payment($1,$2,$3,$4,$5,$6)",
    [bob, `${y}-08-01`, "allowance", 1, 0, crypto.randomUUID()],
    /仅老师/,
  );
  await deny(
    alice,
    "select public.save_entry($1,2,$2)",
    [{ ...r.rows[0], amount: 999 }, crypto.randomUUID()],
    /只能由老师/,
  );
});
await ok("零元、招待费、多项出差费用，服务端重算12天工资", async () => {
  const trip = {
    ...entry,
    id: crypto.randomUUID(),
    date: `${y}-07-19`,
    end_date: `${y}-07-30`,
    is_trip: true,
    underground_days: 3,
    trip_wage: 99999999,
    amount: 260000,
    items: [
      { name: "机票", category: "差旅费", amount: 200000 },
      { name: "住宿", category: "差旅费", amount: 20000 },
      { name: "餐饮", category: "招待费", amount: 20000 },
      { name: "打车", category: "差旅费", amount: 20000 },
    ],
  };
  const r = await as(alice, "select public.save_entry($1,0,$2) e", [
    trip,
    crypto.randomUUID(),
  ]);
  assert.equal(r.rows[0].e.trip_wage, 162000);
  assert.equal(r.rows[0].e.items.length, 4);
  assert.equal(r.rows[0].e.category, "多项费用");
  await deny(
    alice,
    "select public.save_entry($1,1,$2)",
    [{ ...trip, underground_days: 13 }, crypto.randomUUID()],
    /下井/,
  );
  await deny(
    alice,
    "select public.save_entry($1,1,$2)",
    [{ ...trip, amount: 1 }, crypto.randomUUID()],
    /合计/,
  );
  await deny(
    alice,
    "select public.save_entry($1,1,$2)",
    [{ ...trip, end_date: `${y}-07-18` }, crypto.randomUUID()],
    /日期/,
  );
  await deny(alice, "select public.save_entry($1,1,$2)", [
    { ...trip, underground_days: 1.5 },
    crypto.randomUUID(),
  ]);
  await as(alice, "select public.save_entry($1,0,$2)", [
    { ...entry, id: crypto.randomUUID(), category: "招待费", amount: 0 },
    crypto.randomUUID(),
  ]);
});
await ok("学生可自行录入奖金；任务验收仅生成一次奖金", async () => {
  await as(alice, "select public.save_entry($1,0,$2)", [
    {
      ...entry,
      id: crypto.randomUUID(),
      kind: "reward",
      funding: "team",
      category: "奖金",
      amount: 50000,
    },
    crypto.randomUUID(),
  ]);
  await as(teacher, "select public.complete_task($1)", [task.id]);
  const r = await as(alice, "select * from public.entries where task_id=$1", [
    task.id,
  ]);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].amount, 20000);
  await deny(
    alice,
    "select public.save_entry($1,1,$2)",
    [{ ...r.rows[0], amount: 999 }, crypto.randomUUID()],
    /不能单独修改/,
  );
  assert.equal(
    (await as(bob, "select * from public.entries where task_id=$1", [task.id]))
      .rows.length,
    0,
  );
});
const carol = "00000000-0000-4000-8000-000000000004";
await db.exec(
  `reset role;insert into auth.users values('${carol}','carol@test.edu',now());insert into private.allowed_emails values('carol@test.edu','student')`,
);
await as(carol, "select public.register_profile('丙','master',2,2026)");
await ok("六月七月八月补助均进入年度总额，工资不再加到团队发放", async () => {
  for (const m of ["06", "07"])
    await as(
      teacher,
      "select public.save_monthly_payment($1,$2,'allowance',200000,0,$3)",
      [alice, `2026-${m}-01`, crypto.randomUUID()],
    );
  const rows = (
    await as(teacher, "select to_jsonb(e) e from public.entries e")
  ).rows.map((r) => r.e);
  const { summary } = await import("../src/domain.js");
  assert.equal(
    summary(rows, { owner: alice, year: 2026, month: 6 }).allowance,
    200000,
  );
  assert.equal(
    summary(rows, { owner: alice, year: 2026, month: 7 }).allowance,
    200000,
  );
  const all = summary(rows, { owner: alice, year: 2026 });
  assert.equal(all.allowance, 800000);
  assert.equal(all.teamOutlay, all.allowance + all.reward);
});
await ok("年级统一补助保留个人设置，明确覆盖且重复请求幂等", async () => {
  const op = crypto.randomUUID();
  const args = [
    "2026-08-01",
    "master_2",
    300000,
    { [alice]: 2, [carol]: 0 },
    false,
    op,
  ];
  const sql = "select public.save_grade_allowance($1,$2,$3,$4,$5,$6) r";
  const a = (await as(teacher, sql, args)).rows[0].r;
  assert.equal(a.changed, 1);
  assert.equal(a.preserved, 1);
  assert.deepEqual((await as(teacher, sql, args)).rows[0].r, a);
  const b = (
    await as(teacher, sql, [
      "2026-08-01",
      "master_2",
      350000,
      { [alice]: 2, [carol]: 1 },
      true,
      crypto.randomUUID(),
    ])
  ).rows[0].r;
  assert.equal(b.changed, 2);
  assert(b.entries.every((e) => e.amount === 350000));
  await deny(
    teacher,
    sql,
    [
      "2026-08-01",
      "master_2",
      500000,
      { [alice]: 3, [carol]: 0 },
      true,
      crypto.randomUUID(),
    ],
    /CONFLICT/,
  );
  const after = await as(
    teacher,
    "select * from public.entries where allowance_month='2026-08-01'",
  );
  assert(after.rows.every((e) => e.amount === 350000));
  await deny(bob, sql, args, /仅老师/);
  await deny(
    alice,
    "select * from private.v21_archive",
    [],
    /permission denied/,
  );
});
await ok("老师能汇总学生记录", async () => {
  assert((await as(teacher, "select * from public.entries")).rows.length >= 2);
});
await db.exec(
  "reset role;set role anon;select set_config('request.jwt.claim.sub','',false)",
);
await assert.rejects(
  () => db.query("select * from public.entries"),
  /permission denied/,
);
checks++;
await db.close();
console.log(
  `Database checks passed: ${checks}. PostgreSQL auth stub; real Supabase Auth/network/cron must still be validated on deployment.`,
);
