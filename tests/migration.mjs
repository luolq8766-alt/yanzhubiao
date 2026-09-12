import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite();
await db.exec(
  `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`,
);
await db.exec(
  await readFile(new URL("./fixtures/schema-v1.sql", import.meta.url), "utf8"),
);
const t = "00000000-0000-4000-8000-000000000001",
  s = "00000000-0000-4000-8000-000000000002";
await db.exec(
  `insert into auth.users values('${t}','teacher@test.edu',now()),('${s}','student@test.edu',now());insert into private.allowed_emails values('teacher@test.edu','teacher'),('student@test.edu','student');select set_config('request.jwt.claim.sub','${t}',false);select public.register_profile('老师','master',1,2026);select set_config('request.jwt.claim.sub','${s}',false);select public.register_profile('学生','master',2,2026);insert into public.entries(owner_id,date,kind,category,description,amount,funding,allowance_month) values('${s}','2026-09-01','allowance','研助补助','当月研助收入',200000,'team','2026-09-01');`,
);
const before = (await db.query("select * from public.entries")).rows[0];
const sql = await readFile(
  new URL("../supabase/migrations/202609120001_v2.sql", import.meta.url),
  "utf8",
);
await db.exec(sql);
await db.exec(sql);
const after = (await db.query("select * from public.entries")).rows[0];
for (const key of Object.keys(before))
  assert.deepEqual(after[key], before[key], `历史字段保留: ${key}`);
assert.equal((await db.query("select * from public.profiles")).rows.length, 2);
assert.equal(
  (await db.query("select * from private.allowed_emails")).rows.length,
  2,
);
assert.equal(
  (await db.query("select * from public.salary_rules")).rows.length,
  0,
);
await db.exec("select private.generate_allowances(null)");
assert.equal((await db.query("select * from public.entries")).rows.length, 1);
await db.exec(`select set_config('request.jwt.claim.sub','${t}',false)`);
await db.query("select public.save_monthly_payment($1,$2,$3,$4,$5,$6)", [
  s,
  "2026-09-01",
  "allowance",
  400000,
  1,
  crypto.randomUUID(),
]);
assert.equal(
  (await db.query("select * from public.entries")).rows[0].amount,
  400000,
);
assert.equal(
  (await db.query("select * from public.entries")).rows[0].id,
  before.id,
);
assert.equal(
  (await db.query("select * from private.audit_log")).rows.length,
  1,
);
await db.close();
console.log(
  "Migration QA passed: repeated upgrade preserves every legacy field, members and invites; old subsidy editable; no duplicate salary or subsidy.",
);
