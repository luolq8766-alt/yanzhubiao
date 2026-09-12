import React, { useState } from "react";
import { store } from "./store.js";
import {
  today,
  money,
  cents,
  years,
  SALARY_GRADES,
  gradeLabel,
  salaryFor,
} from "./domain.js";
const Field = ({ label, children }) => (
  <label className="field">
    <span>{label}</span>
    {React.cloneElement(children, {
      "aria-label": children.props["aria-label"] || label,
    })}
  </label>
);

export default function Payroll({ members, data, run, busy }) {
  const [owner, setOwner] = useState(members[0]?.id || ""),
    [month, setMonth] = useState(today().slice(0, 7)),
    [kind, setKind] = useState("allowance");
  const [effective, setEffective] = useState(today().slice(0, 7));
  const [operation, setOperation] = useState(() => crypto.randomUUID());
  const person = members.find((p) => p.id === owner),
    column = kind === "salary" ? "salary_month" : "allowance_month";
  const existing = data.entries.find(
    (e) => e.owner_id === owner && e[column] === `${month}-01`,
  );
  const manual = data.entries.filter(
    (e) =>
      !e.deleted &&
      e.owner_id === owner &&
      e.kind === kind &&
      e.date.startsWith(month) &&
      !e[column],
  );
  const rules = data.salaryRules || [];
  const exact = rules.find((r) => r.effective_month === `${effective}-01`);
  const previous = rules
    .filter((r) => r.effective_month <= `${effective}-01`)
    .sort((a, b) => a.effective_month.localeCompare(b.effective_month))
    .at(-1);
  const rates =
    exact?.rates || previous?.rates || data.settings.salary_rates || {};
  const selectedRule = rules
    .filter((r) => r.effective_month <= `${month}-01`)
    .sort((a, b) => a.effective_month.localeCompare(b.effective_month))
    .at(-1);
  const change = (setter, value) => {
    setter(value);
    setOperation(crypto.randomUUID());
  };
  return (
    <>
      <section className="panel settings-panel payroll-panel">
        <div className="panel-heading">
          <div>
            <h2>按月发放与更正</h2>
            <p>选择成员和年月，直接填写该月总额。再次保存会替换原金额。</p>
          </div>
        </div>
        <div className="form-grid">
          <Field label="成员">
            <select
              value={owner}
              onChange={(e) => change(setOwner, e.target.value)}
            >
              {members.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="所属年月">
            <input
              type="month"
              value={month}
              min={person ? `${years(person)[0]}-01` : undefined}
              max={person ? `${years(person).at(-1)}-12` : undefined}
              onChange={(e) => change(setMonth, e.target.value)}
            />
          </Field>
          <Field label="发放类型">
            <select
              value={kind}
              onChange={(e) => change(setKind, e.target.value)}
            >
              <option value="allowance">月度补助（每月单独填写）</option>
              <option value="salary">固定工资（本月单独更正）</option>
            </select>
          </Field>
        </div>
        {kind === "salary" && person && (
          <p className="subtle-note">
            此月年级标准：
            {money(
              salaryFor(person, month, {
                salary_rates: selectedRule?.rates || {},
              }),
            )}
            。本月单独更正后，调整年级标准不会覆盖这笔记录。
          </p>
        )}
        <form
          key={`${owner}-${month}-${kind}-${existing?.version || 0}`}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(async () => {
              if (
                !person ||
                !/^\d{4}-\d{2}$/.test(month) ||
                !years(person).includes(Number(month.slice(0, 4)))
              )
                throw new Error("请选择成员在读年度内的月份");
              await store.action("save_monthly_payment", {
                p_owner: owner,
                p_month: `${month}-01`,
                p_kind: kind,
                p_amount: cents(f.get("amount")),
                p_expected_version: existing?.version || 0,
                p_operation: operation,
              });
              setOperation(crypto.randomUUID());
            }, `${month} 月账目已保存，总览与报表已刷新`);
          }}
        >
          <Field label={`${month} 月总金额 / 元`}>
            <input
              name="amount"
              type="number"
              min="0"
              max="100000000"
              step="0.01"
              inputMode="decimal"
              required
              defaultValue={
                existing && !existing.deleted ? existing.amount / 100 : ""
              }
            />
          </Field>
          <p className="subtle-note">
            当前记录：
            {existing && !existing.deleted
              ? money(existing.amount)
              : "尚未填写"}
            。例如 2,000 改成 4,000，请填 4,000；0 表示该月无发放。
          </p>
          {manual.length > 0 && (
            <div className="notice">
              该月还有 {manual.length} 笔单独录入的同类款项，共{" "}
              {money(manual.reduce((n, e) => n + e.amount, 0))}
              ，也会计入汇总。请先在财务报表核对，避免重复填写。
            </div>
          )}
          <button className="primary" disabled={busy || !owner}>
            保存该月金额
          </button>
        </form>
      </section>
      <section className="panel settings-panel payroll-panel">
        <div className="panel-heading">
          <div>
            <h2>按年级设置固定工资</h2>
            <p>每月自动生成“固定工资”，月度补助另行填写。</p>
          </div>
        </div>
        <Field label="标准生效年月">
          <input
            type="month"
            min="2000-01"
            max="2100-12"
            required
            value={effective}
            onChange={(e) => setEffective(e.target.value)}
          />
        </Field>
        <form
          key={`${effective}-${exact?.version || 0}-${JSON.stringify(rates)}`}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(async () => {
              if (!/^\d{4}-\d{2}$/.test(effective))
                throw new Error("请选择标准生效月份");
              const values = Object.fromEntries(
                SALARY_GRADES.map((k) => [k, cents(f.get(k))]),
              );
              await store.action("save_salary_rules", {
                p_month: `${effective}-01`,
                p_rates: values,
                p_expected_version: exact?.version || 0,
              });
            }, "工资标准已保存，适用月份的自动工资已更新");
          }}
        >
          <div className="form-grid">
            {SALARY_GRADES.map((k) => (
              <Field key={k} label={`${gradeLabel(k)} / 元·月`}>
                <input
                  name={k}
                  type="number"
                  inputMode="decimal"
                  required
                  min="0"
                  max="100000000"
                  step="0.01"
                  defaultValue={(rates[k] || 0) / 100}
                />
              </Field>
            ))}
          </div>
          <div className="notice">
            按现有自然年度档案，每年 1 月年级加
            1。生效月以前的工资保持不变；生效月起至下一条标准前的自动工资会重算，老师单独更正过的月份保留。0
            表示该年级无固定工资。
          </div>
          <p className="subtle-note">
            自动记账从成员记账起始月开始。更早的在读月份可用上方“本月单独更正”补录。旧版已生成的研助补助保留为“月度补助”，不自动改成工资。
          </p>
          <button className="primary" disabled={busy}>
            保存工资标准并更新账单
          </button>
        </form>
        {rules.length > 0 && (
          <details className="rate-history">
            <summary>查看已保存的工资标准（{rules.length} 条）</summary>
            {[...rules]
              .sort((a, b) =>
                b.effective_month.localeCompare(a.effective_month),
              )
              .map((r) => (
                <button
                  key={r.effective_month}
                  className="text-button"
                  onClick={() => setEffective(r.effective_month.slice(0, 7))}
                >
                  {r.effective_month.slice(0, 7)} 起 · 查看 / 修改
                </button>
              ))}
          </details>
        )}
      </section>
    </>
  );
}
