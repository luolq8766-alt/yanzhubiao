import test from "node:test";
import assert from "node:assert/strict";
import { cents, years, summary, warning, validEntry } from "../src/domain.js";
test("硕二只生成两年；博士五年级只生成一年", () => {
  assert.deepEqual(
    years({ degree: "master", grade: 2, start_year: 2026 }),
    [2026, 2027],
  );
  assert.deepEqual(
    years({ degree: "doctor", grade: 1, start_year: 2026 }),
    [2026, 2027, 2028, 2029, 2030],
  );
  assert.deepEqual(
    years({ degree: "doctor", grade: 5, start_year: 2026 }),
    [2026],
  );
});
test("金额用整数分，拒绝负数和三位小数", () => {
  assert.equal(cents("0.29"), 29);
  assert.equal(cents("1250.01"), 125001);
  assert.throws(() => cents("-1"));
  assert.throws(() => cents("1.001"));
});
const entries = [
  {
    id: "1",
    owner_id: "a",
    date: "2026-09-01",
    kind: "allowance",
    amount: 120000,
  },
  {
    id: "2",
    owner_id: "a",
    date: "2026-09-05",
    kind: "expense",
    funding: "advance",
    amount: 50000,
    reimbursed: 20000,
  },
  {
    id: "3",
    owner_id: "a",
    date: "2026-09-06",
    kind: "expense",
    funding: "personal",
    amount: 10000,
    reimbursed: 0,
  },
  {
    id: "4",
    owner_id: "a",
    date: "2026-09-06",
    kind: "expense",
    funding: "team",
    amount: 30000,
    reimbursed: 0,
  },
  {
    id: "5",
    owner_id: "b",
    date: "2025-10-01",
    kind: "allowance",
    amount: 999999,
  },
  {
    id: "6",
    owner_id: "a",
    date: "2026-09-06",
    kind: "expense",
    funding: "advance",
    amount: 99999,
    reimbursed: 0,
    deleted: true,
  },
];
test("报销不重复增加收入，正确计算个人净收入", () => {
  const s = summary(entries, { owner: "a", year: 2026, month: 9 });
  assert.equal(s.income, 120000);
  assert.equal(s.expense, 90000);
  assert.equal(s.gap, 30000);
  assert.equal(s.pending, 30000);
  assert.equal(s.net, 80000);
  assert.equal(s.count, 4);
});
test("年月、归属与软删除筛选", () => {
  assert.equal(summary(entries, { year: 2025 }).income, 999999);
  assert.equal(summary(entries, { month: 10, owner: "a" }).count, 0);
});
test("预算警戒在80%与100%生效；正结余不报警", () => {
  const settings = { monthly_limit: 100000, gap_limit: 200000 };
  assert.equal(
    warning({ expense: 80000 }, { gap: 300000 }, settings),
    "yellow",
  );
  assert.equal(warning({ expense: 0 }, { gap: -200000 }, settings), "red");
  assert.equal(warning({ expense: 0 }, { gap: 400000 }, settings), "green");
});
test("拒绝无效日期、越界年度与超额报销", () => {
  const p = { degree: "master", grade: 2, start_year: 2026 };
  const e = {
    date: "2026-09-01",
    kind: "expense",
    category: "差旅费",
    description: "测试",
    amount: 100,
    reimbursed: 0,
    funding: "advance",
  };
  assert.equal(validEntry(e, p), e);
  assert.throws(() => validEntry({ ...e, date: "2026-02-30" }, p));
  assert.throws(() => validEntry({ ...e, date: "2028-01-01" }, p));
  assert.throws(() => validEntry({ ...e, reimbursed: 101 }, p));
});
