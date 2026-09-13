import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const r = new URL("../supabase/", import.meta.url);
for (const version of ["v1", "v2"]) {
  const db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`,
  );
  await db.exec(
    await readFile(
      new URL(`./fixtures/schema-${version}.sql`, import.meta.url),
      "utf8",
    ),
  );
  const t = "00000000-0000-4000-8000-000000000001",
    s = "00000000-0000-4000-8000-000000000002";
  await db.exec(
    `insert into auth.users values('${t}','teacher@test.edu',now()),('${s}','student@test.edu',now());insert into private.allowed_emails values('teacher@test.edu','teacher'),('student@test.edu','student');select set_config('request.jwt.claim.sub','${t}',false);select public.register_profile('老师','master',1,2026);select set_config('request.jwt.claim.sub','${s}',false);select public.register_profile('学生','master',2,2026);insert into public.entries(owner_id,date,kind,category,description,amount,funding,allowance_month) values('${s}','2026-08-01','allowance','研助补助','当月研助收入',200000,'team','2026-08-01');insert into public.entries(owner_id,date,kind,category,description,amount,funding,reimbursed) values('${s}','2026-07-19','expense','差旅费','历史出差',260000,'advance',20000);`,
  );
  if (version === "v2")
    await db.exec(
      `insert into public.salary_rules(effective_month,rates) values('2026-09-01','{"master_2":100000}');`,
    );
  const before = (
    await db.query("select to_jsonb(e) e from public.entries e")
  ).rows.map((r) => r.e);
  const upgrade = await readFile(new URL("upgrade-to-v2.1.sql", r), "utf8");
  await db.exec(upgrade);
  await db.exec(upgrade);
  await db.exec(
    await readFile(new URL("migrations/202609130001_v21.sql", r), "utf8"),
  );
  const after = (
    await db.query("select to_jsonb(e) e from public.entries e")
  ).rows.map((r) => r.e);
  for (const old of before) {
    const next = after.find((e) => e.id === old.id);
    assert(next);
    for (const k of [
      "owner_id",
      "date",
      "kind",
      "description",
      "amount",
      "note",
    ])
      assert.deepEqual(next[k], old[k], k);
    assert(!("funding" in next));
    assert(!("reimbursed" in next));
    const archive = (
      await db.query(
        "select payload from private.v21_archive where entity=$1 and id=$2",
        ["entries", old.id],
      )
    ).rows[0].payload;
    assert.equal(archive.funding, old.funding);
    assert.equal(archive.reimbursed, old.reimbursed);
  }
  assert.equal(
    (await db.query("select * from public.profiles")).rows.length,
    2,
  );
  assert.equal(
    (await db.query("select * from private.allowed_emails")).rows.length,
    2,
  );
  if (version === "v2") {
    const salary = after.filter((e) => e.kind === "salary");
    assert.equal(salary[0].date, "2026-06-01");
    assert(salary.every((e) => e.amount === 100000));
    assert.equal(
      new Set(salary.map((e) => e.salary_month)).size,
      salary.length,
    );
  }
  await db.exec(`select set_config('request.jwt.claim.sub','${t}',false)`);
  const old = before.find((e) => e.kind === "allowance");
  const changed = (
    await db.query(
      "select public.save_monthly_payment($1,'2026-08-01','allowance',400000,1,$2) e",
      [s, crypto.randomUUID()],
    )
  ).rows[0].e;
  assert.equal(changed.id, old.id);
  assert.equal(changed.amount, 400000);
  await db.close();
  console.log(
    `PASS ${version} → 2.1 cumulative upgrade twice, standalone migration repeat, legacy preservation, private snapshots, June salary backfill, editable allowance`,
  );
}
