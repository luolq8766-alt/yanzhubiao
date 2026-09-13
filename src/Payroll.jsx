import React, { useState } from "react";
import { store } from "./store.js";
import {
  today,
  money,
  cents,
  years,
  SALARY_GRADES,
  gradeLabel,
  gradeKey,
  BOOK_START,
} from "./domain.js";
const Field = ({ label, children }) => (
  <label className="field">
    <span>{label}</span>
    {React.cloneElement(children, {
      "aria-label": children.props["aria-label"] || label,
    })}
  </label>
);
export default function Payroll({ members, data, run, busy, onSaved }) {
  const [scope, setScope] = useState("person"),
    [owner, setOwner] = useState(members[0]?.id || ""),
    [month, setMonth] = useState(today().slice(0, 7)),
    [grade, setGrade] = useState("master_1"),
    [include, setInclude] = useState(false);
  const [year, setYear] = useState(Number(today().slice(0, 4))),
    [amount, setAmount] = useState(""),
    [operation, setOperation] = useState(() => crypto.randomUUID()),
    [result, setResult] = useState("");
  const rules = (data.salaryRules || []).filter((r) => r.year),
    exact = rules.find((r) => r.year === year),
    rates = exact?.rates || {};
  const current = (e) =>
    data.entries.find(
      (x) => x.owner_id === e.id && x.allowance_month === `${month}-01`,
    );
  const eligible = members.filter((p) =>
    years(p).includes(Number(month.slice(0, 4))),
  );
  const targets =
    scope === "person"
      ? eligible.filter((p) => p.id === owner)
      : eligible.filter(
          (p) => gradeKey(p, Number(month.slice(0, 4))) === grade,
        );
  const willChange = targets.filter(
    (p) =>
      scope === "person" ||
      include ||
      !current(p)?.allowance_manual ||
      current(p)?.deleted,
  );
  const reset = (fn, value) => {
    fn(value);
    setOperation(crypto.randomUUID());
    setResult("");
  };
  const first = targets[0] && current(targets[0]);
  return (
    <>
      <section className="panel settings-panel payroll-panel">
        <div className="panel-heading">
          <div>
            <h2>实际月度补助</h2>
            <p>
              填实际发放总额，已包含固定工资。可按个人设置，也可按年级统一设置。
            </p>
          </div>
        </div>
        <div className="form-grid">
          <Field label="所属年月">
            <input
              type="month"
              required
              min={BOOK_START.slice(0, 7)}
              max="2100-12"
              value={month}
              onChange={(e) => reset(setMonth, e.target.value)}
            />
          </Field>
          <Field label="设置方式">
            <select
              value={scope}
              onChange={(e) => reset(setScope, e.target.value)}
            >
              <option value="person">按个人设置</option>
              <option value="grade">按年级统一设置</option>
            </select>
          </Field>
          {scope === "person" ? (
            <Field label="成员">
              <select
                value={owner}
                onChange={(e) => reset(setOwner, e.target.value)}
              >
                {members.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="补助年级">
              <select
                value={grade}
                onChange={(e) => reset(setGrade, e.target.value)}
              >
                {SALARY_GRADES.map((k) => (
                  <option key={k} value={k}>
                    {gradeLabel(k)}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        <form
          key={`${scope}-${owner}-${month}-${grade}-${first?.version || 0}`}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(async () => {
              if (
                !/^\d{4}-\d{2}$/.test(month) ||
                `${month}-01` < BOOK_START ||
                !targets.length
              )
                throw new Error("请选择 2026 年 6 月起有在读成员的月份");
              const value = cents(f.get("amount"));
              if (scope === "person")
                await store.action("save_monthly_payment", {
                  p_owner: owner,
                  p_month: `${month}-01`,
                  p_kind: "allowance",
                  p_amount: value,
                  p_expected_version: first?.version || 0,
                  p_operation: operation,
                });
              else {
                const r = await store.action("save_grade_allowance", {
                  p_month: `${month}-01`,
                  p_grade: grade,
                  p_amount: value,
                  p_versions: Object.fromEntries(
                    targets.map((p) => [p.id, current(p)?.version || 0]),
                  ),
                  p_include_individual: include,
                  p_operation: operation,
                });
                setResult(
                  `已更新 ${r.changed} 人，保留个人金额 ${r.preserved} 人。`,
                );
              }
              setOperation(crypto.randomUUID());
              onSaved?.(
                Number(month.slice(0, 4)),
                Number(month.slice(5, 7)),
                scope === "person" ? owner : "",
              );
            }, `${month} 补助已保存，总览和账单已更新`);
          }}
        >
          <Field label="实际补助总额 / 元（含固定工资）">
            <input
              name="amount"
              type="number"
              inputMode="decimal"
              min="0"
              max="100000000"
              step="0.01"
              required
              defaultValue={
                scope === "person" && first && !first.deleted
                  ? first.amount / 100
                  : amount
              }
              onChange={(e) => {
                setAmount(e.target.value);
                setOperation(crypto.randomUUID());
              }}
            />
          </Field>
          <p className="subtle-note">
            例如固定工资 1,000 元，实际补助发 2,000 元，这里填
            2,000。再次填写会替换该月总额，不会累加。
          </p>
          {scope === "grade" && (
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={include}
                onChange={(e) => reset(setInclude, e.target.checked)}
              />
              同时覆盖该年级已单独设置的个人金额
            </label>
          )}
          <div className="allowance-preview">
            <strong>
              {month} · 将更新 {willChange.length} 人
            </strong>
            {targets.map((p) => (
              <div key={p.id}>
                <span>{p.name}</span>
                <span>
                  {current(p) && !current(p).deleted
                    ? money(current(p).amount)
                    : "尚未填写"}
                  {scope === "grade" &&
                  current(p)?.allowance_manual &&
                  !current(p).deleted &&
                  !include
                    ? " · 保留个人金额"
                    : ""}
                </span>
              </div>
            ))}
            {!targets.length && <p>该年月没有匹配的在读成员。</p>}
          </div>
          <button className="primary" disabled={busy || !willChange.length}>
            保存补助金额
          </button>
          {result && (
            <p role="status" className="positive">
              {result}
            </p>
          )}
        </form>
      </section>
      <section className="panel settings-panel payroll-panel">
        <div className="panel-heading">
          <div>
            <h2>年度固定工资标准</h2>
            <p>
              按年度、年级确定每月金额，该年度内统一执行；在学生账单中列为支出。
            </p>
          </div>
        </div>
        <Field label="工资年度">
          <input
            type="number"
            min="2026"
            max="2100"
            required
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          />
        </Field>
        <form
          key={`${year}-${exact?.version || 0}`}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(async () => {
              if (!Number.isInteger(year) || year < 2026 || year > 2100)
                throw new Error("请选择有效年度");
              await store.action("save_annual_salary", {
                p_year: year,
                p_rates: Object.fromEntries(
                  SALARY_GRADES.map((k) => [k, cents(f.get(k))]),
                ),
                p_expected_version: exact?.version || 0,
              });
              onSaved?.(year, 0, "");
            }, `${year} 年工资标准已保存，该年度账单已统一更新`);
          }}
        >
          <div className="form-grid">
            {SALARY_GRADES.map((k) => (
              <Field key={k} label={`${gradeLabel(k)}每月固定工资 / 元`}>
                <input
                  name={k}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="100000000"
                  step="0.01"
                  required
                  defaultValue={(rates[k] || 0) / 100}
                />
              </Field>
            ))}
          </div>
          <div className="notice">
            固定工资包含在补助内，不额外增加学生收入或教师发放额。2026 年从 6
            月记账，此后按各年度标准每月记一笔工资支出。修改年度标准会统一更正该年度已生成的工资，未来月份到月后生成。
          </div>
          <button className="primary" disabled={busy}>
            保存年度工资标准
          </button>
        </form>
        {!!rules.length && (
          <details className="rate-history">
            <summary>查看历年标准</summary>
            {[...rules]
              .sort((a, b) => b.year - a.year)
              .map((r) => (
                <button
                  key={r.year}
                  className="text-button"
                  onClick={() => setYear(r.year)}
                >
                  {r.year} 年 · 查看 / 修改
                </button>
              ))}
          </details>
        )}
      </section>
    </>
  );
}
