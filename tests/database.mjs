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
  [{ ...entry, reimbursed: 100 }, crypto.randomUUID()],
  /只能由老师/,
);
await deny(
  alice,
  "select public.save_entry($1,1,$2)",
  [{ ...entry, kind: "reward" }, crypto.randomUUID()],
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
await ok("老师确认报销", async () => {
  const r = await as(teacher, "select public.save_entry($1,1,$2) e", [
    { ...entry, reimbursed: 10000 },
    crypto.randomUUID(),
  ]);
  assert.equal(r.rows[0].e.reimbursed, 10000);
});
await deny(
  alice,
  "select public.save_entry($1,1,$2)",
  [{ ...entry, description: "旧版本" }, crypto.randomUUID()],
  /CONFLICT/,
);
await deny(
  alice,
  "select public.save_entry($1,2,$2)",
  [{ ...entry, amount: 60000, reimbursed: 10000 }, crypto.randomUUID()],
  /已报销/,
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
  reward: "200 元",
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
await ok("定额重复运行不重发，生成后金额不随设置更改", async () => {
  await as(teacher, "select public.save_settings($1,$2)", [
    { team_name: "测试组", monthly_limit: 300000, gap_limit: 1000000 },
    [{ id: alice, monthly_stipend: 120000 }],
  ]);
  await as(teacher, "select public.ensure_allowances()");
  await as(teacher, "select public.ensure_allowances()");
  let r = await as(
    alice,
    "select * from public.entries where allowance_month is not null",
  );
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].amount, 120000);
  await as(teacher, "select public.save_settings($1,$2)", [
    { team_name: "测试组", monthly_limit: 300000, gap_limit: 1000000 },
    [{ id: alice, monthly_stipend: 180000 }],
  ]);
  r = await as(
    alice,
    "select * from public.entries where allowance_month is not null",
  );
  assert.equal(r.rows[0].amount, 120000);
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
