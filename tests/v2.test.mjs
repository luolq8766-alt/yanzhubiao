import test from "node:test";
import assert from "node:assert/strict";
import { buildExcel } from "../src/exports.js";
import ExcelJS from "exceljs";
import {
  tripPay,
  normalizeEntry,
  validEntry,
  summary,
  ledgerEntries,
  categoryTotals,
  salaryFor,
} from "../src/domain.js";
const p = { degree: "master", grade: 2, start_year: 2026 };
const trip = normalizeEntry({
  id: "trip-source",
  owner_id: "alice",
  date: "2026-07-19",
  end_date: "2026-07-30",
  kind: "expense",
  description: "矿区出差",
  funding: "advance",
  reimbursed: 0,
  is_trip: true,
  underground_days: 3,
  items: [
    { name: "机票", category: "差旅费", amount: 200000 },
    { name: "住宿", category: "差旅费", amount: 20000 },
    { name: "餐饮", category: "招待费", amount: 20000 },
    { name: "打车", category: "差旅费", amount: 20000 },
  ],
});
test("含往返当天，跨月/跨年/闰年和下井边界", () => {
  assert.deepEqual(tripPay("2026-07-19", "2026-07-30", 3), {
    days: 12,
    underground: 3,
    base: 144000,
    extra: 18000,
    amount: 162000,
  });
  assert.equal(tripPay("2026-07-19", "2026-07-19", 1).amount, 18000);
  assert.equal(tripPay("2026-07-31", "2026-08-01").days, 2);
  assert.equal(tripPay("2026-12-31", "2027-01-01").days, 2);
  assert.equal(tripPay("2028-02-28", "2028-03-01").days, 3);
  for (const days of [-1, 1.5, 13])
    assert.throws(() => tripPay("2026-07-19", "2026-07-30", days));
});
test("多项费用和工资各统计一次，重建投影不重复", () => {
  validEntry(trip, p);
  assert.equal(trip.amount, 260000);
  assert.equal(trip.category, "多项费用");
  const rows = ledgerEntries([trip]);
  assert.equal(rows.length, 2);
  assert.equal(ledgerEntries(rows).length, 2);
  const s = summary(rows);
  assert.equal(s.expense, 422000);
  assert.equal(s.income, 0);
  assert.equal(s.trip_salary, 162000);
  assert.equal(s.gap, -422000);
  assert.equal(s.teamOutlay, 0);
  assert.equal(s.research, 260000);
  const cats = categoryTotals(rows);
  assert.equal(cats["差旅费"], 240000);
  assert.equal(cats["招待费"], 20000);
});
test("修改出差日期/下井次数重算，删除原事务同时去掉工资", () => {
  const edited = normalizeEntry({
    ...trip,
    end_date: "2026-07-20",
    underground_days: 0,
  });
  assert.equal(summary([edited]).trip_salary, 24000);
  assert.equal(summary([{ ...trip, deleted: true }]).income, 0);
  assert.equal(summary([{ ...trip, deleted: true }]).expense, 0);
});
test("工资、月度补助、奖金在对应年月与成员汇总中一致", () => {
  const common = {
    owner_id: "alice",
    date: "2026-08-01",
    funding: "team",
    reimbursed: 0,
  };
  const rows = [
    { ...common, id: "salary", kind: "salary", amount: 100000 },
    { ...common, id: "monthly", kind: "allowance", amount: 400000 },
    { ...common, id: "bonus", kind: "reward", amount: 20000 },
    trip,
  ];
  const august = summary(rows, { owner: "alice", year: 2026, month: 8 });
  assert.equal(august.income, 420000);
  assert.equal(august.salary, 100000);
  assert.equal(august.allowance, 400000);
  assert.equal(august.reward, 20000);
  assert.equal(august.teamOutlay, 420000);
  assert.equal(summary(rows, { owner: "bob", month: 8 }).income, 0);
  assert.equal(summary(rows, { year: 2026 }).income, 420000);
});
test("支持零元，拒绝负数金额、六月以前日期和非整分", () => {
  const zero = normalizeEntry({
    ...trip,
    items: [{ name: "免费测试", category: "测试费", amount: 0 }],
    is_trip: false,
    underground_days: 0,
  });
  assert.equal(validEntry(zero, p).amount, 0);
  assert.throws(() => validEntry({ ...zero, amount: -1 }, p));
  assert.throws(() => validEntry({ ...zero, date: "2026-05-31" }, p));
  assert.throws(() => validEntry({ ...zero, amount: 1.5 }, p));
});
test("自然年培养档案随年度使用对应年级标准", () => {
  const settings = { salary_rates: { master_2: 100000, master_3: 120000 } };
  assert.equal(salaryFor(p, "2026-12", settings.salary_rates), 100000);
  assert.equal(salaryFor(p, "2027-01", settings.salary_rates), 120000);
});
test("Excel 日期范围、四项费用和工资金额为数值且不重复", async () => {
  const bytes = await buildExcel(
    [trip],
    [{ id: "alice", name: "学生甲", role: "student" }],
    "出差报表",
  );
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  assert.equal(wb.worksheets.length, 3);
  const ledger = wb.getWorksheet("财务明细"),
    details = wb.getWorksheet("费用分项"),
    totals = wb.getWorksheet("成员汇总");
  assert.equal(ledger.rowCount, 4);
  assert.equal(ledger.getCell("F3").value, 2600);
  assert.equal(ledger.getCell("F4").value, 1620);
  assert.equal(ledger.getCell("K3").value, "2026-07-30");
  assert.equal(ledger.getCell("L3").value, 12);
  assert.equal(details.rowCount, 5);
  assert.equal(details.getCell("G2").type, ExcelJS.ValueType.Number);
  assert.equal(totals.getCell("F2").value, 1620);
  assert.equal(totals.getCell("G2").value, 2600);
});
