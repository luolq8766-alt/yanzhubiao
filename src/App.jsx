import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  LayoutDashboard,
  BookOpen,
  ChartNoAxesCombined,
  GraduationCap,
  Settings2,
  Plus,
  ArrowUpRight,
  ArrowDownLeft,
  Download,
  ChevronRight,
  CalendarDays,
  Wallet,
  Coins,
  Users,
  Cloud,
  CloudOff,
  RefreshCw,
  Search,
  X,
  Check,
  AlertTriangle,
  ArrowRight,
  LogOut,
  FileSpreadsheet,
  FileText,
  ShieldCheck,
  Smartphone,
  FlaskConical,
  Pencil,
  Trash2,
  Gift,
  Clock,
  NotebookPen,
  WifiOff,
  Info,
  CloudUpload,
} from "lucide-react";
import Payroll from "./Payroll.jsx";
import { store, cloud, supabase } from "./store.js";
import {
  CATEGORIES,
  COLORS,
  KIND,
  isIncome,
  BOOK_START,
  recordStart,
  today,
  money,
  cents,
  years,
  summary,
  monthly,
  warning,
  ledgerEntries,
  categoryTotals,
  dateRange,
  tripPay,
  normalizeEntry,
  validEntry,
  salaryFor,
} from "./domain.js";
import { exportExcel, exportPDF, exportBackup } from "./exports.js";
const nav = [
  ["dashboard", "总览", LayoutDashboard],
  ["ledger", "财务报表", BookOpen],
  ["analysis", "数据分析", ChartNoAxesCombined],
  ["tasks", "学习任务", GraduationCap],
  ["settings", "设置", Settings2],
];
const degree = (p) =>
  `${p.degree === "master" ? "硕士" : "博士"} ${p.grade} 年级`;
function Badge({ children, tone = "green" }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function Avatar({ p, size = "" }) {
  return (
    <span
      className={`avatar ${size} ${p?.role === "teacher" ? "teacher" : ""}`}
    >
      {p?.name?.slice(-2) || "研"}
    </span>
  );
}
function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef();
  useEffect(() => {
    ref.current.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog className={wide ? "wide" : ""} ref={ref} onCancel={onClose}>
      <div className="dialog-heading">
        <h2>{title}</h2>
        <button className="icon-btn" aria-label="关闭窗口" onClick={onClose}>
          <X size={21} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Field({ label, children, full = false }) {
  return (
    <label className={`field ${full ? "full" : ""}`}>
      <span>{label}</span>
      {React.isValidElement(children) && typeof label === "string"
        ? React.cloneElement(children, {
            "aria-label": children.props["aria-label"] || label,
          })
        : children}
    </label>
  );
}
function Stat({
  label,
  value,
  caption,
  icon: Icon,
  accent = false,
  negative = false,
}) {
  return (
    <div className={`stat ${accent ? "accent" : ""}`}>
      <div className="stat-top">
        <span>{label}</span>
        <span className="stat-icon">
          <Icon size={19} />
        </span>
      </div>
      <strong className={negative ? "negative" : ""}>{money(value)}</strong>
      <div className="stat-caption">{caption}</div>
    </div>
  );
}
function Trend({ entries, year, owner }) {
  const data = monthly(entries, year, owner);
  const elapsed =
    year < Number(today().slice(0, 4))
      ? 12
      : year > Number(today().slice(0, 4))
        ? 0
        : Number(today().slice(5, 7));
  const plotted = data.slice(0, elapsed);
  const max = Math.max(10000, ...data.flatMap((d) => [d.expense, d.income]));
  const h = 190;
  const path = (key) =>
    plotted
      .map(
        (d, i) =>
          `${i ? "L" : "M"}${48 + i * 47.1},${222 - (d[key] / max) * h}`,
      )
      .join(" ");
  return (
    <div className="line-chart">
      <svg
        viewBox="0 0 590 266"
        role="img"
        aria-label={`${year}年各月支出与补助趋势图`}
      >
        <defs>
          <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#229c86" stopOpacity=".18" />
            <stop offset="100%" stopColor="#229c86" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line
              x1="48"
              x2="569"
              y1={222 - h * t}
              y2={222 - h * t}
              stroke="#e7ecef"
              strokeDasharray="3 5"
            />
            <text x="2" y={226 - h * t} fill="#89959f" fontSize="11">
              {Math.round((max * t) / 100).toLocaleString()}
            </text>
          </g>
        ))}
        <path
          d={`${path("expense")} L${48 + Math.max(0, elapsed - 1) * 47.1},222 L48,222 Z`}
          fill="url(#area)"
        />
        <path
          d={path("income")}
          fill="none"
          stroke="#97b4cb"
          strokeWidth="2"
          strokeDasharray="5 6"
        />
        <path
          d={path("expense")}
          fill="none"
          stroke="#168c77"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        {data.map((d, i) => (
          <g key={i}>
            {i < elapsed && (
              <circle
                cx={48 + i * 47.1}
                cy={222 - (d.expense / max) * h}
                r="3.5"
                fill="#fff"
                stroke="#168c77"
                strokeWidth="2"
              >
                <title>
                  {d.month}月：支出 {money(d.expense)}，补助与奖励{" "}
                  {money(d.income)}
                </title>
              </circle>
            )}
            <text
              x={48 + i * 47.1}
              y="251"
              textAnchor="middle"
              fill="#89959f"
              fontSize="11"
            >
              {d.month}月
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
function Donut({ entries }) {
  const byCategory = categoryTotals(entries);
  const values = CATEGORIES.map((c) => byCategory[c]);
  const total = values.reduce((a, b) => a + b, 0);
  let offset = 0;
  return (
    <div className="donut-content">
      <div className="donut">
        <svg viewBox="0 0 180 180" role="img" aria-label="科研支出分类占比">
          <circle
            cx="90"
            cy="90"
            r="69"
            fill="none"
            stroke="#eef2f4"
            strokeWidth="22"
          />
          {values.map((v, i) => {
            const len = total ? (v / total) * 433.54 : 0;
            const node = (
              <circle
                key={i}
                cx="90"
                cy="90"
                r="69"
                fill="none"
                stroke={COLORS[i]}
                strokeWidth="22"
                strokeDasharray={`${len} ${433.54 - len}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 90 90)"
              />
            );
            offset += len;
            return node;
          })}
        </svg>
        <div className="donut-label">
          <span>科研支出</span>
          <strong>
            {total >= 1000000
              ? (total / 1000000).toFixed(2) + "万"
              : money(total)}
          </strong>
        </div>
      </div>
      <div className="legend-list">
        {CATEGORIES.map((c, i) => (
          <div key={c}>
            <span>
              <i style={{ background: COLORS[i] }} />
              {c}
            </span>
            <b>{total ? Math.round((values[i] / total) * 100) : 0}%</b>
          </div>
        ))}
      </div>
    </div>
  );
}
function Auth({ onMessage }) {
  const [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      const input = {
        email: f.get("email").trim(),
        password: f.get("password"),
      };
      const { error } = register
        ? await supabase.auth.signUp({
            ...input,
            options: { emailRedirectTo: location.origin + location.pathname },
          })
        : await supabase.auth.signInWithPassword(input);
      if (error) throw error;
      if (register)
        onMessage(
          "注册已提交，请查看邮箱并点击验证链接；已注册用户可直接登录。",
        );
    } catch (e) {
      onMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <div className="auth-story">
        <div className="brand">
          <img src="./icon.svg" alt="" />
          <strong>研助表</strong>
        </div>
        <div>
          <span className="eyebrow">RESEARCH · TOGETHER</span>
          <h1>
            专注每一次探索。
            <br />
            记清每一份投入。
          </h1>
          <p>
            你的课题组财务、助研补助与学习任务，
            <br />
            在一处有序协作。
          </p>
          <div className="auth-lines">
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
        <small>为小而专注的科研团队设计</small>
      </div>
      <div className="auth-form">
        <div className="auth-form-inner">
          <span className="eyebrow">欢迎来到研助表</span>
          <h2>{register ? "创建团队账号" : "登录你的工作台"}</h2>
          <p>使用老师邀请名单中的邮箱。</p>
          <form onSubmit={submit}>
            <Field label="邮箱">
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="name@university.edu.cn"
              />
            </Field>
            <Field label="密码">
              <input
                name="password"
                type="password"
                autoComplete={register ? "new-password" : "current-password"}
                required
                minLength={8}
                placeholder="至少 8 位密码"
              />
            </Field>
            <button className="primary full-width" disabled={busy}>
              {busy ? "正在处理…" : register ? "注册并验证邮箱" : "登录"}
              <ArrowRight size={17} />
            </button>
          </form>
          <button
            className="text-button"
            onClick={() => setRegister(!register)}
          >
            {register ? "已有账号？去登录" : "首次使用？注册团队账号"}
          </button>
          <div className="subtle-note">
            <ShieldCheck size={17} />
            师生权限由邀请名单决定，学生账目仅本人和老师可见。
          </div>
        </div>
      </div>
    </div>
  );
}
function Onboarding({ onMessage }) {
  const [degreeValue, setDegreeValue] = useState("master"),
    [busy, setBusy] = useState(false);
  return (
    <div className="setup-page">
      <div className="panel setup-card">
        <FlaskConical size={34} color="#168c77" />
        <h1>建立你的研助档案</h1>
        <p className="muted">
          选择当前年级，系统会生成剩余培养年限的年度报表。老师账号会自动识别。
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const f = new FormData(e.currentTarget);
            try {
              await store.action("register_profile", {
                p_name: f.get("name"),
                p_degree: degreeValue,
                p_grade: Number(f.get("grade")),
                p_start_year: Number(f.get("year")),
              });
              await store.sync();
            } catch (e) {
              onMessage(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="姓名">
            <input name="name" required maxLength={40} />
          </Field>
          <div className="form-grid">
            <Field label="培养身份">
              <select
                value={degreeValue}
                onChange={(e) => setDegreeValue(e.target.value)}
              >
                <option value="master">硕士研究生</option>
                <option value="doctor">博士研究生</option>
              </select>
            </Field>
            <Field label="当前年级">
              <select name="grade">
                {Array.from(
                  { length: degreeValue === "master" ? 3 : 5 },
                  (_, i) => (
                    <option key={i} value={i + 1}>
                      {i + 1} 年级
                    </option>
                  ),
                )}
              </select>
            </Field>
          </div>
          <Field label="第一份报表年份">
            <input
              name="year"
              type="number"
              min="2000"
              max="2100"
              defaultValue={today().slice(0, 4)}
              required
            />
          </Field>
          <p className="subtle-note">
            例如：硕士 2 年级，从 2026 年开始，生成 2026、2027 两年报表；记账从
            2026 年 6 月起。
          </p>
          <button className="primary full-width" disabled={busy}>
            保存档案并进入
            <ArrowRight size={17} />
          </button>
        </form>
        <button
          className="text-button"
          onClick={() => store.logout().catch((e) => onMessage(e.message))}
        >
          退出账号
        </button>
      </div>
    </div>
  );
}
export default function App() {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [view, setView] = useState("dashboard"),
    [year, setYear] = useState(Number(today().slice(0, 4))),
    [month, setMonth] = useState(0),
    [owner, setOwner] = useState(""),
    [query, setQuery] = useState(""),
    [modal, setModal] = useState(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [installPrompt, setInstallPrompt] = useState(null);
  const messageTimer = useRef();
  const notify = (text) => {
    setMessage(text);
    clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => setMessage(""), 8000);
  };
  useEffect(() => {
    store.init();
    const onInstall = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", onInstall);
    return () => window.removeEventListener("beforeinstallprompt", onInstall);
  }, []);
  const profile = state.data.profiles.find((p) => p.id === state.user?.id),
    teacher = profile?.role === "teacher";
  const members = state.data.profiles.filter(
    (p) => p.role === "student" && (teacher || p.id === profile?.id),
  );
  const entries = ledgerEntries(state.data.entries).filter(
    (e) => !e.deleted && (teacher || e.owner_id === profile?.id),
  );
  const selectedOwner = teacher ? owner : profile?.id;
  const availableYears = [...new Set(members.flatMap(years))].sort(
    (a, b) => a - b,
  );
  const period = { owner: selectedOwner, year, month: month || undefined };
  const total = summary(entries, period),
    annual = summary(entries, { owner: selectedOwner, year }),
    all = summary(entries, { owner: selectedOwner });
  const annualEntries = entries.filter(
    (e) =>
      e.date.startsWith(String(year)) &&
      (!selectedOwner || e.owner_id === selectedOwner),
  );
  const periodEntries = annualEntries.filter(
    (e) => !month || Number(e.date.slice(5, 7)) === month,
  );
  const visibleEntries = periodEntries
    .filter((e) =>
      [
        e.description,
        e.category,
        e.note,
        ...(e.items || []).map((i) => i.name),
        members.find((p) => p.id === e.owner_id)?.name,
      ].some((v) => v?.toLowerCase().includes(query.toLowerCase())),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const filteredTasks = state.data.tasks.map((t) => ({
    ...t,
    my_claim: state.data.claims.some(
      (c) => c.task_id === t.id && c.student_id === profile?.id,
    ),
  }));
  const memberWarning = (p) =>
    warning(
      month
        ? summary(entries, { owner: p.id, year, month })
        : {
            expense: Math.max(
              ...monthly(entries, year, p.id).map((s) => s.expense),
            ),
          },
      summary(entries, { owner: p.id }),
      state.data.settings,
    );
  const overviewMembers = members.filter(
    (p) => !selectedOwner || p.id === selectedOwner,
  );
  const alertMembers = overviewMembers.filter(
    (p) => memberWarning(p) !== "green",
  );
  async function run(fn, success) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      if (success) notify(success);
    } catch (e) {
      notify(e.message || "操作未完成，请重试");
    } finally {
      setBusy(false);
    }
  }
  const newEntry = () => {
    if (!members.length) {
      notify("请先邀请学生完成成员登记");
      return;
    }
    setModal({ type: "entry", owner: selectedOwner || members[0].id });
  };
  const title = `研助表-${teacher && !owner ? "团队" : members.find((p) => p.id === selectedOwner)?.name || "个人"}-${year}年${month ? month + "月" : "度"}`;
  const exportReport = (format) =>
    run(
      () =>
        format === "excel"
          ? exportExcel(
              periodEntries,
              members.filter((p) => !selectedOwner || p.id === selectedOwner),
              title,
            )
          : exportPDF(
              periodEntries,
              members.filter((p) => !selectedOwner || p.id === selectedOwner),
              title,
            ),
      "报表已生成，正在下载",
    );
  const install = async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      setInstallPrompt(null);
    } else setModal({ type: "install" });
  };
  const toast = message && (
    <div className="toast" role="status">
      <Info size={18} />
      <span>{message}</span>
      <button aria-label="关闭提示" onClick={() => setMessage("")}>
        <X size={17} />
      </button>
    </div>
  );
  if (state.loading)
    return (
      <div className="loading">
        <img src="./icon.svg" alt="" />
        <h2>研助表</h2>
        <p>正在打开你的工作台…</p>
      </div>
    );
  if (cloud && !state.user)
    return (
      <>
        <Auth onMessage={notify} />
        {state.error && <div className="error-fixed">{state.error}</div>}
        {toast}
      </>
    );
  if (cloud && !profile)
    return (
      <>
        <Onboarding onMessage={notify} />
        {state.error && <div className="error-fixed">{state.error}</div>}
        {toast}
      </>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView("dashboard");
          }}
        >
          <img src="./icon.svg" alt="研助表标志" />
          <div>
            <strong>研助表</strong>
            <small>RESEARCH LEDGER</small>
          </div>
        </a>
        <div className="team-label">
          <FlaskConical size={17} />
          {state.data.settings.team_name}
        </div>
        <div className="nav-label">工作空间</div>
        <nav>
          {nav.map(([id, label, Icon]) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              onClick={() => {
                setView(id);
                setQuery("");
              }}
            >
              <Icon size={20} />
              <span>
                {id === "dashboard"
                  ? teacher
                    ? "团队总览"
                    : "我的总览"
                  : label}
              </span>
              {id === "tasks" && (
                <b>
                  {
                    filteredTasks.filter(
                      (t) =>
                        !t.taken &&
                        t.status === "open" &&
                        t.deadline >= today(),
                    ).length
                  }
                </b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="install-card">
            <Smartphone size={23} />
            <strong>把研助表放进口袋</strong>
            <p>
              添加到手机桌面
              <br />
              离线也能随手记一笔
            </p>
            <button onClick={install}>
              添加到桌面
              <ArrowUpRight size={16} />
            </button>
          </div>
          <div className="sidebar-profile">
            <Avatar p={profile} />
            <div>
              <strong>{profile?.name}</strong>
              <small>{teacher ? "导师 · 管理员" : degree(profile)}</small>
            </div>
            <ShieldCheck size={17} />
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            <span>研助管理</span>
            <ChevronRight size={14} />
            <b>{nav.find((n) => n[0] === view)?.[1]}</b>
          </div>
          <div className="topbar-actions">
            <button
              className={`sync-status ${!state.online ? "offline" : ""}`}
              onClick={() => {
                if (!cloud)
                  notify("当前是独立演示数据。配置云数据库后将启用多人同步。");
                else store.sync();
              }}
              aria-label="同步数据"
            >
              {state.syncing ? (
                <RefreshCw size={16} className="spin" />
              ) : !state.online ? (
                <CloudOff size={17} />
              ) : cloud ? (
                <Cloud size={17} />
              ) : (
                <FlaskConical size={17} />
              )}
              <span>
                {!cloud
                  ? "演示模式"
                  : !state.online
                    ? "离线可记账"
                    : state.syncing
                      ? "同步中"
                      : state.error
                        ? "同步异常"
                        : state.data.queue.length
                          ? `${state.data.queue.length} 笔待同步`
                          : "云端已连接"}
              </span>
            </button>
            <span className="top-divider" />
            <Avatar p={profile} size="small" />
            <button
              className="icon-btn"
              aria-label="退出账号"
              onClick={() => run(() => store.logout())}
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <div className="content">
          {!cloud && (
            <div className="demo-bar">
              <span>
                <FlaskConical size={15} />
                <b>交互演示</b>
                <span className="demo-description">
                  示例数据仅保存在这台设备，可切换师生身份体验。
                </span>
              </span>
              <select
                aria-label="切换演示身份"
                value={profile?.id}
                onChange={(e) => {
                  store.selectDemo(e.target.value);
                  setOwner("");
                }}
              >
                {state.data.profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.role === "teacher" ? "老师" : degree(p)}
                  </option>
                ))}
              </select>
            </div>
          )}
          {(!state.online || state.error || state.data.queue.length > 0) && (
            <div className="notice">
              <WifiOff size={18} />
              <span>
                {state.error ||
                  (!state.online
                    ? "当前离线，新增账目将保存在本机。打开应用并恢复网络后自动同步。"
                    : `${state.data.queue.length} 笔记录等待同步到云端。`)}
              </span>
              {state.data.queue.length > 0 && (
                <button
                  className="text-button"
                  onClick={() => setModal({ type: "queue" })}
                >
                  查看待同步
                </button>
              )}
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {view === "tasks"
                  ? "GROW TOGETHER"
                  : view === "settings"
                    ? "YOUR WORKSPACE"
                    : `${year} · RESEARCH FINANCE`}
              </div>
              <h1>
                {view === "dashboard"
                  ? teacher
                    ? "团队经费总览"
                    : "我的研助总览"
                  : view === "ledger"
                    ? "每一笔，都有记录"
                    : view === "analysis"
                      ? "看见科研投入的脉络"
                      : view === "tasks"
                        ? "在研究中，一起进步"
                        : "工作台设置"}
              </h1>
              <p>
                {view === "dashboard"
                  ? teacher
                    ? `${members.length} 位研究伙伴，一个清晰有序的经费账本。`
                    : "记清实际补助与账面支出，按月核对差额。"
                  : view === "ledger"
                    ? "补助收入与工资、出差、科研花费按年月归档。"
                    : view === "analysis"
                      ? "从费用结构到月度趋势，让资金安排更有依据。"
                      : view === "tasks"
                        ? "选择一项学习任务，把新的想法变成新的能力。"
                        : "管理补助、预算提醒与手机使用偏好。"}
              </p>
            </div>
            <div className="heading-actions">
              {["dashboard", "ledger", "analysis"].includes(view) ? (
                <>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => exportReport("excel")}
                  >
                    <Download size={17} />
                    导出 Excel
                  </button>
                  <button
                    className="icon-btn"
                    title="PDF 与其他导出"
                    aria-label="PDF 与其他导出"
                    onClick={() => setModal({ type: "export" })}
                  >
                    <FileText size={19} />
                  </button>
                  {teacher && (
                    <button
                      className="secondary"
                      onClick={() => setView("settings")}
                    >
                      工资 / 补助
                    </button>
                  )}
                  <button className="primary" onClick={newEntry}>
                    <Plus size={18} />
                    记一笔
                  </button>
                </>
              ) : view === "tasks" && teacher ? (
                <button
                  className="primary"
                  onClick={() => setModal({ type: "task" })}
                >
                  <Plus size={18} />
                  发布任务
                </button>
              ) : null}
            </div>
          </div>
          {["dashboard", "ledger", "analysis"].includes(view) && (
            <div className="period-toolbar">
              <div className="period-controls">
                <CalendarDays size={18} />
                <select
                  aria-label="报表年份"
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                >
                  {[...new Set([...availableYears, year])].sort().map((y) => (
                    <option key={y} value={y}>
                      {y} 年
                    </option>
                  ))}
                </select>
                <select
                  aria-label="报表月份"
                  value={month}
                  onChange={(e) => setMonth(Number(e.target.value))}
                >
                  <option value="0">全年汇总</option>
                  {Array.from({ length: 12 }, (_, i) => (
                    <option
                      key={i}
                      value={i + 1}
                      disabled={year === 2026 && i < 5}
                    >
                      {i + 1} 月
                    </option>
                  ))}
                </select>
                {teacher && (
                  <select
                    aria-label="成员筛选"
                    value={owner}
                    onChange={(e) => setOwner(e.target.value)}
                  >
                    <option value="">全部成员</option>
                    {members.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <span className="period-note">
                {month ? `${year} 年 ${month} 月` : `${year} 年度`} ·{" "}
                {periodEntries.length} 笔记录
              </span>
            </div>
          )}
          {["dashboard", "ledger", "analysis"].includes(view) && (
            <div className="notice period-explainer">
              <CalendarDays size={18} />
              <span>
                记账起点：2026 年 6 月 ·{" "}
                {month
                  ? `当前查看 ${year} 年 ${month} 月`
                  : `当前查看 ${year} 年度汇总`}
                。{teacher ? "累计已发补助与奖金" : "累计补助与奖金"}：
                <b>{money(all.income)}</b>。固定工资已包含在补助中。
              </span>
            </div>
          )}
          {view === "dashboard" && (
            <>
              <div className="stats-grid">
                <Stat
                  label={teacher ? "本期团队已记账支出" : "本期补助与奖金"}
                  value={total.income}
                  caption="实际补助（含固定工资）+ 奖金"
                  icon={Wallet}
                  accent
                />
                <Stat
                  label="本期学生账面支出"
                  value={total.expense}
                  caption="固定工资 + 出差工资 + 科研花费"
                  icon={Coins}
                />
                <Stat
                  label="本期科研花费"
                  value={total.research}
                  caption="出差及科研事务的费用记录"
                  icon={NotebookPen}
                />
                <Stat
                  label="本期账面差额"
                  value={total.gap}
                  caption="补助与奖金 − 学生账面支出"
                  icon={ChartNoAxesCombined}
                  negative={total.gap < 0}
                />
              </div>
              <div className="income-breakdown">
                {[
                  ["固定工资 · 支出", total.salary],
                  ["实际补助 · 收入", total.allowance],
                  ["出差工资 · 支出", total.trip_salary],
                  ["奖金 · 收入", total.reward],
                ].map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{money(value)}</strong>
                  </div>
                ))}
              </div>
              <div className="chart-grid">
                <section className="panel trend-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        年度收支趋势{" "}
                        <span className="muted small-text">/ 元</span>
                      </h2>
                      <p>了解每个月的研究投入</p>
                    </div>
                    <div className="chart-key">
                      <span>
                        <i />
                        工资与科研支出
                      </span>
                      <span>
                        <i />
                        补助与奖金
                      </span>
                    </div>
                  </div>
                  <Trend entries={entries} year={year} owner={selectedOwner} />
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>费用构成</h2>
                      <p>{year} 年度 · 全部科研费用</p>
                    </div>
                    <ChartNoAxesCombined size={19} className="muted" />
                  </div>
                  <Donut entries={annualEntries} />
                </section>
              </div>
              {teacher ? (
                <section className="panel members-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        成员经费一览{" "}
                        <span className="count-bubble">
                          {overviewMembers.length}
                        </span>
                      </h2>
                      <p>按成员核对补助、工资和科研支出</p>
                    </div>
                    {alertMembers.length > 0 ? (
                      <Badge tone="yellow">
                        {alertMembers.length} 位成员需关注
                      </Badge>
                    ) : (
                      <Badge>预算状态正常</Badge>
                    )}
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>成员</th>
                          <th>账面支出</th>
                          <th>补助与奖金</th>
                          <th>科研花费</th>
                          <th>累计差额</th>
                          <th>{month ? "预算状态" : "单月 / 累计预警"}</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {overviewMembers.map((p) => {
                          const s = summary(entries, {
                              owner: p.id,
                              year,
                              month: month || undefined,
                            }),
                            a = summary(entries, { owner: p.id }),
                            w = memberWarning(p);
                          return (
                            <tr key={p.id}>
                              <td>
                                <div className="person-cell">
                                  <Avatar p={p} />
                                  <div>
                                    <strong>{p.name}</strong>
                                    <small>{degree(p)}</small>
                                  </div>
                                </div>
                              </td>
                              <td className="numeric">
                                <b>{money(s.expense)}</b>
                                <div className="mini-bar">
                                  <span
                                    style={{
                                      width:
                                        Math.min(
                                          100,
                                          (s.expense /
                                            state.data.settings.monthly_limit) *
                                            100,
                                        ) + "%",
                                      background:
                                        w === "red" ? "#df7c65" : "#319883",
                                    }}
                                  />
                                </div>
                              </td>
                              <td className="numeric">{money(s.income)}</td>
                              <td className="numeric">{money(s.research)}</td>
                              <td
                                className={`numeric ${a.gap < 0 ? "negative" : ""}`}
                              >
                                {money(a.gap)}
                              </td>
                              <td>
                                <Badge tone={w}>
                                  {w === "red"
                                    ? "超出阈值"
                                    : w === "yellow"
                                      ? "接近阈值"
                                      : "正常"}
                                </Badge>
                              </td>
                              <td>
                                <button
                                  className="icon-btn"
                                  aria-label={`查看${p.name}报表`}
                                  onClick={() => {
                                    setOwner(p.id);
                                    setView("ledger");
                                  }}
                                >
                                  <ChevronRight size={18} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {members.length === 0 && (
                    <Empty
                      title="等待第一位研究伙伴"
                      text="请按部署说明添加邀请邮箱，再由学生完成登记。"
                    />
                  )}
                </section>
              ) : (
                <div className="student-bottom">
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>我的培养年度</h2>
                      <GraduationCap size={22} />
                    </div>
                    <p className="muted">
                      {degree(profile)} 入组 · 剩余 {years(profile).length}{" "}
                      份年度报表
                    </p>
                    <div className="year-cards">
                      {years(profile).map((y) => (
                        <button
                          key={y}
                          onClick={() => {
                            setYear(y);
                            setMonth(0);
                            setView("ledger");
                          }}
                        >
                          <CalendarDays size={20} />
                          <strong>{y}</strong>
                          <span>
                            查看年度报表
                            <ArrowUpRight size={14} />
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                  <section className="panel cash-card">
                    <span className="eyebrow">个人账面差额 · 累计</span>
                    <h2>补助与支出，逐笔核对。</h2>
                    <strong>{money(all.gap)}</strong>
                    <p>累计差额 · 补助与奖金 {money(all.income)}</p>
                    <button
                      className="text-button"
                      onClick={() => setView("analysis")}
                    >
                      查看差额明细
                      <ArrowRight size={16} />
                    </button>
                  </section>
                </div>
              )}
              <div className="bottom-note">
                <ShieldCheck size={16} />
                <span>
                  {teacher
                    ? "成员财务仅对本人和老师可见。"
                    : "其他学生无法看到你的财务记录。"}
                  工资与补助是记账记录，不代表银行转账。
                </span>
              </div>
            </>
          )}
          {view === "ledger" && (
            <>
              <div className="ledger-summary">
                <div>
                  <span>月差额{!month ? "（全年合计）" : ""}</span>
                  <strong className={total.gap < 0 ? "negative" : ""}>
                    {money(total.gap)}
                  </strong>
                </div>
                <div>
                  <span>年差额 · {year}</span>
                  <strong>{money(annual.gap)}</strong>
                </div>
                <div>
                  <span>总差额 · 全部培养年度</span>
                  <strong>{money(all.gap)}</strong>
                </div>
                <div>
                  <span>本期补助与奖金</span>
                  <strong>{money(total.income)}</strong>
                </div>
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>财务流水</h2>
                    <p>日期范围、费用明细、工资支出与补助收入</p>
                  </div>
                  <div className="search">
                    <Search size={17} />
                    <input
                      aria-label="搜索账目"
                      placeholder="搜索事务、分类、备注"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                </div>
                <div className="table-wrap">
                  <table className="ledger-table">
                    <thead>
                      <tr>
                        <th>日期 / 成员</th>
                        <th>具体事务</th>
                        <th>分类</th>
                        <th>金额</th>
                        <th>收支方向</th>
                        <th>备注</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleEntries.map((e) => (
                        <tr key={e.id}>
                          <td>
                            <strong className="numeric">{dateRange(e)}</strong>
                            <small>
                              {members.find((p) => p.id === e.owner_id)?.name}
                            </small>
                          </td>
                          <td>
                            <div className="entry-description">
                              <span
                                className={`entry-icon ${isIncome(e) ? "income" : ""}`}
                              >
                                {!isIncome(e) ? (
                                  <ArrowUpRight size={17} />
                                ) : (
                                  <ArrowDownLeft size={17} />
                                )}
                              </span>
                              <div>
                                <strong>{e.description}</strong>
                                {!!e.items?.length && (
                                  <details className="entry-items">
                                    <summary>
                                      {e.items.length} 项费用明细
                                    </summary>
                                    {e.items.map((item, i) => (
                                      <div key={i}>
                                        {item.name} · {item.category}{" "}
                                        <b>{money(item.amount)}</b>
                                      </div>
                                    ))}
                                  </details>
                                )}
                                <small>
                                  {KIND[e.kind]}
                                  {state.data.queue.some(
                                    (q) => q.entry.id === e.id,
                                  )
                                    ? " · 待同步"
                                    : ""}
                                </small>
                              </div>
                            </div>
                          </td>
                          <td>
                            <Badge tone="gray">{e.category}</Badge>
                          </td>
                          <td
                            className={`numeric ${isIncome(e) ? "positive" : ""}`}
                          >
                            <b>
                              {isIncome(e) ? "+" : "−"}
                              {money(e.amount)}
                            </b>
                          </td>
                          <td>
                            <span>{isIncome(e) ? "收入" : "支出"}</span>
                          </td>
                          <td className="note-cell">{e.note || "—"}</td>
                          <td>
                            {!e.source_entry_id &&
                            !e.task_id &&
                            e.kind !== "salary" &&
                            (teacher ||
                              e.kind === "expense" ||
                              e.kind === "reward") ? (
                              <div className="row-actions">
                                <button
                                  className="icon-btn"
                                  aria-label={`编辑${e.description}`}
                                  onClick={() =>
                                    setModal({ type: "entry", entry: e })
                                  }
                                >
                                  <Pencil size={16} />
                                </button>
                                <button
                                  className="icon-btn"
                                  aria-label={`删除${e.description}`}
                                  onClick={() =>
                                    setModal({ type: "delete", entry: e })
                                  }
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            ) : (
                              <span className="muted small-text">
                                {e.source_entry_id
                                  ? "随出差事务联动"
                                  : e.task_id
                                    ? "任务自动记账"
                                    : e.kind === "salary"
                                      ? "年度年级标准"
                                      : "老师维护"}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!visibleEntries.length && (
                  <Empty
                    title="这个期间还没有账目"
                    text="选择其他年月，或记下第一笔科研投入。"
                    action={newEntry}
                  />
                )}
                <div className="table-footer">
                  <span>
                    共 {visibleEntries.length} 笔{query ? "匹配记录" : ""}
                  </span>
                  <span>差额 = 补助与奖金 − 工资与科研支出</span>
                </div>
              </section>
            </>
          )}
          {view === "analysis" && (
            <>
              <div className="stats-grid">
                <Stat
                  label="累计实际补助"
                  value={all.allowance}
                  caption="包含固定工资的实际发放金额"
                  icon={Coins}
                />
                <Stat
                  label="累计固定工资支出"
                  value={all.salary}
                  caption="按年度年级标准生成"
                  icon={Wallet}
                />
                <Stat
                  label="累计出差工资支出"
                  value={all.trip_salary}
                  caption="出差天数与下井天数计算"
                  icon={CalendarDays}
                />
                <Stat
                  label="累计账面差额"
                  value={all.gap}
                  caption="补助与奖金减去全部账面支出"
                  icon={ChartNoAxesCombined}
                  accent
                />
              </div>
              <div className="chart-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>年度收支趋势</h2>
                      <p>补助与奖金收入 · 工资与科研支出</p>
                    </div>
                  </div>
                  <Trend entries={entries} year={year} owner={selectedOwner} />
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>科研花费分类</h2>
                      <p>所选期间的费用明细，不包含工资</p>
                    </div>
                  </div>
                  <Donut entries={periodEntries} />
                </section>
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <h2>累计账面差额核对</h2>
                </div>
                <div className="calculation">
                  {[
                    ["实际补助（含固定工资）", all.allowance],
                    ["＋ 奖金", all.reward],
                    ["− 固定工资支出", all.salary],
                    ["− 出差工资支出", all.trip_salary],
                    ["− 出差及科研花费", all.research],
                  ].map(([name, value]) => (
                    <div key={name}>
                      <span>{name}</span>
                      <b>{money(value)}</b>
                    </div>
                  ))}
                  <div className="calculation-total">
                    <span>累计账面差额</span>
                    <strong>{money(all.gap)}</strong>
                  </div>
                </div>
                <p className="subtle-note">
                  按你们团队的补助制口径记录。出差花费仅登记为支出，不再另外增加团队发放金额。
                </p>
              </section>
            </>
          )}
          {view === "tasks" && (
            <>
              <div className="task-summary">
                <div>
                  <span className="task-summary-icon">
                    <GraduationCap size={27} />
                  </span>
                  <div>
                    <strong>
                      {
                        filteredTasks.filter(
                          (t) =>
                            !t.taken &&
                            t.status === "open" &&
                            t.deadline >= today(),
                        ).length
                      }{" "}
                      项任务，等你探索
                    </strong>
                    <p>一次精读、一项技能、一个更好的研究习惯。</p>
                  </div>
                </div>
                <div className="privacy-note">
                  <ShieldCheck size={17} />
                  {teacher
                    ? "仅你可查看任务领取者身份"
                    : "其他成员只会看到“已被选择”"}
                </div>
              </div>
              <div className="task-grid">
                {filteredTasks.map((t, i) => {
                  const claim = state.data.claims.find(
                    (c) => c.task_id === t.id,
                  );
                  const expired = t.deadline < today();
                  return (
                    <article className="panel task-card" key={t.id}>
                      <div className="task-card-top">
                        <span className={`task-art art-${i % 3}`}>
                          {i % 3 === 0 ? (
                            <BookOpen size={26} />
                          ) : i % 3 === 1 ? (
                            <ChartNoAxesCombined size={26} />
                          ) : (
                            <FlaskConical size={26} />
                          )}
                        </span>
                        <Badge
                          tone={
                            t.status === "completed"
                              ? "green"
                              : t.taken
                                ? "gray"
                                : expired
                                  ? "yellow"
                                  : "blue"
                          }
                        >
                          {t.status === "completed"
                            ? "已完成"
                            : t.my_claim
                              ? "我已选择"
                              : t.taken
                                ? "已被选择"
                                : expired
                                  ? "已截止"
                                  : "可领取"}
                        </Badge>
                      </div>
                      <span className="task-category">{t.category}</span>
                      <h2>{t.title}</h2>
                      <p className="task-description">{t.content}</p>
                      <div className="task-reward">
                        <Gift size={17} />
                        <div>
                          <small>完成奖励</small>
                          <strong>{t.reward}</strong>
                          <b className="positive">
                            悬赏奖金 {money(t.reward_amount || 0)}
                          </b>
                        </div>
                      </div>
                      <div className="task-deadline">
                        <Clock size={15} />
                        截止 {t.deadline}
                      </div>
                      {teacher && t.status !== "completed" && (
                        <button
                          className="text-button"
                          onClick={() => setModal({ type: "task", task: t })}
                        >
                          编辑任务 / 奖金
                        </button>
                      )}
                      <div className="task-footer">
                        {teacher ? (
                          <>
                            <span>
                              {claim
                                ? `领取人：${state.data.profiles.find((p) => p.id === claim.student_id)?.name || "成员"}`
                                : "尚未有人领取"}
                            </span>
                            {t.taken && t.status !== "completed" && (
                              <button
                                className="text-button"
                                disabled={busy}
                                onClick={() =>
                                  run(
                                    () =>
                                      store.action("complete_task", {
                                        p_id: t.id,
                                      }),
                                    "任务已验收，悬赏奖金已自动计入学生账单。",
                                  )
                                }
                              >
                                验收完成
                                <Check size={16} />
                              </button>
                            )}
                          </>
                        ) : t.status === "completed" ? (
                          <span>本次学习已完成</span>
                        ) : t.my_claim ? (
                          <button
                            className="secondary full-width"
                            disabled={busy}
                            onClick={() =>
                              run(
                                () =>
                                  store.action("claim_task", {
                                    p_id: t.id,
                                    p_cancel: true,
                                  }),
                                "已取消领取",
                              )
                            }
                          >
                            取消领取
                          </button>
                        ) : (
                          <button
                            className={
                              t.taken || expired
                                ? "secondary full-width"
                                : "primary full-width"
                            }
                            disabled={
                              t.taken ||
                              expired ||
                              busy ||
                              (!state.online && cloud)
                            }
                            onClick={() =>
                              run(
                                () =>
                                  store.action("claim_task", { p_id: t.id }),
                                "任务领取成功，老师可以看到你的选择。",
                              )
                            }
                          >
                            {t.taken
                              ? "已被其他成员选择"
                              : expired
                                ? "领取已截止"
                                : "选择这项任务"}
                            {!t.taken && !expired && <ArrowRight size={16} />}
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
              {!filteredTasks.length && (
                <Empty
                  title="新的学习任务，即将开始"
                  text={
                    teacher
                      ? "发布学习内容与奖励，邀请成员自主选择。"
                      : "老师发布任务后，你就可以在这里领取。"
                  }
                />
              )}
            </>
          )}
          {view === "settings" && (
            <Settings
              onSaved={(y, m, p) => {
                setYear(y);
                setMonth(m);
                setOwner(p);
              }}
              profile={profile}
              members={members}
              data={state.data}
              teacher={teacher}
              run={run}
              busy={busy}
              install={install}
              backup={() =>
                exportBackup({
                  ...state.data,
                  entries,
                  profiles: teacher ? state.data.profiles : members,
                  claims: state.data.claims.filter(
                    (c) => teacher || c.student_id === profile.id,
                  ),
                })
              }
            />
          )}
          <footer className="app-footer">
            <span>
              研助表 <span className="footer-dot">·</span>{" "}
              为每一份科研投入留下清晰记录
            </span>
            <span>
              {cloud
                ? state.data.lastSync
                  ? "上次同步 " +
                    new Date(state.data.lastSync).toLocaleString("zh-CN")
                  : "等待首次同步"
                : "本机演示 · 未连接云数据库"}
            </span>
          </footer>
        </div>
      </main>
      <nav className="mobile-nav">
        {nav.map(([id, label, Icon]) => (
          <button
            key={id}
            className={view === id ? "active" : ""}
            onClick={() => setView(id)}
          >
            <Icon size={21} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {modal?.type === "entry" && (
        <EntryForm
          entry={modal.entry}
          owner={modal.owner}
          members={members}
          teacher={teacher}
          year={year}
          month={month}
          busy={busy}
          onClose={() => setModal(null)}
          onSubmit={(entry) =>
            run(
              async () => {
                await store.saveEntry(entry);
                setModal(null);
              },
              cloud
                ? "已安全保存在本机，联网时自动同步"
                : "已保存到本机演示数据",
            )
          }
        />
      )}
      {modal?.type === "task" && (
        <TaskForm
          task={modal.task}
          busy={busy}
          onClose={() => setModal(null)}
          onSubmit={(task) =>
            run(async () => {
              await store.action("save_task", { p_task: task });
              setModal(null);
            }, "学习任务已发布")
          }
        />
      )}
      {modal?.type === "export" && (
        <Modal title="导出财务报表" onClose={() => setModal(null)}>
          <p className="muted">
            当前范围：{title}，共 {periodEntries.length}{" "}
            笔。修改页面上方年月及成员筛选可更换导出范围。
          </p>
          <div className="export-options">
            <button disabled={busy} onClick={() => exportReport("excel")}>
              <FileSpreadsheet size={30} />
              <strong>Excel 工作簿</strong>
              <span>财务明细 + 成员汇总，可继续编辑</span>
              <Download size={18} />
            </button>
            <button disabled={busy} onClick={() => exportReport("pdf")}>
              <FileText size={30} />
              <strong>PDF 打印报表</strong>
              <span>中文排版、自动分页、导师签字栏</span>
              <Download size={18} />
            </button>
          </div>
          {busy && (
            <p className="subtle-note">
              正在生成文件，首次 PDF 导出需加载中文字体…
            </p>
          )}
          <p className="subtle-note">
            导出包含本机待同步记录，请在交财务前确认同步状态与数据。本格式是通用财务报表，提交前可按学校模板调整。
          </p>
        </Modal>
      )}
      {modal?.type === "delete" && (
        <Modal title="删除这笔账目？" onClose={() => setModal(null)}>
          <p>
            {modal.entry.description} · {money(modal.entry.amount)}
          </p>
          <p className="muted">删除后将不再参与统计，云端会保留审计记录。</p>
          <div className="dialog-actions">
            <button className="secondary" onClick={() => setModal(null)}>
              保留
            </button>
            <button
              className="danger"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await store.saveEntry({ ...modal.entry, deleted: true });
                  setModal(null);
                }, "已删除")
              }
            >
              确认删除
            </button>
          </div>
        </Modal>
      )}
      {modal?.type === "install" && (
        <Modal title="添加研助表到手机桌面" onClose={() => setModal(null)}>
          <div className="install-steps">
            <div>
              <Smartphone size={25} />
              <h3>iPhone / iPad</h3>
              <p>
                用 Safari
                打开正式网站链接，点击“分享”，选择“添加到主屏幕”，再点“添加”。
              </p>
            </div>
            <div>
              <Smartphone size={25} />
              <h3>安卓手机</h3>
              <p>
                用 Chrome 或支持 PWA
                的浏览器打开链接，在菜单中选择“安装应用”或“添加到主屏幕”。
              </p>
            </div>
          </div>
          <div className="notice">
            <Info size={19} />
            <span>
              先联网打开并登录一次。离线可查看缓存及录入账目；恢复网络且应用打开时自动同步。关闭应用后，iPhone
              不保证后台同步。
            </span>
          </div>
        </Modal>
      )}
      {modal?.type === "queue" && (
        <Modal title="本机待同步记录" onClose={() => setModal(null)} wide>
          <p className="muted">
            同步冲突不会覆盖云端账目。请先保存本机备份，再放弃冲突副本、重新核对云端记录。
          </p>
          <button
            className="secondary"
            onClick={() => exportBackup(state.data)}
          >
            <Download size={17} />
            保存本机备份
          </button>
          {state.data.queue.map((q) => (
            <div className="queue-item" key={q.operation}>
              <strong>
                {q.entry.description} · {money(q.entry.amount)}
              </strong>
              <span>{q.entry.date}</span>
              <p className={q.error ? "negative" : "muted"}>
                {q.error || "等待网络同步"}
              </p>
              {q.error && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => store.discard(q.operation),
                      "已放弃本机副本，请核对云端账目后重新录入。",
                    )
                  }
                >
                  放弃本机副本并读取云端
                </button>
              )}
            </div>
          ))}
          {!state.data.queue.length && <p>全部记录已同步。</p>}
          <div className="dialog-actions">
            <button
              className="primary"
              disabled={state.syncing}
              onClick={() => store.sync()}
            >
              <RefreshCw size={17} />
              重新同步
            </button>
          </div>
        </Modal>
      )}
      {toast}
    </div>
  );
}
function Empty({ title, text, action }) {
  return (
    <div className="empty">
      <NotebookPen size={35} />
      <h3>{title}</h3>
      <p>{text}</p>
      {action && (
        <button className="primary" onClick={action}>
          <Plus size={17} />
          记一笔
        </button>
      )}
    </div>
  );
}
function EntryForm({
  entry,
  owner,
  members,
  teacher,
  year,
  month,
  busy,
  onClose,
  onSubmit,
}) {
  let initial = today();
  if (
    Number(initial.slice(0, 4)) !== year ||
    (month && Number(initial.slice(5, 7)) !== month)
  )
    initial = `${year}-${String(month || 1).padStart(2, "0")}-01`;
  if (initial < BOOK_START) initial = BOOK_START;
  const [kind, setKind] = useState(entry?.kind || "expense"),
    [selected, setSelected] = useState(entry?.owner_id || owner);
  const [start, setStart] = useState(entry?.date || initial),
    [end, setEnd] = useState(entry?.end_date || entry?.date || initial),
    [trip, setTrip] = useState(entry?.is_trip || false),
    [underground, setUnderground] = useState(
      String(entry?.underground_days || 0),
    ),
    [error, setError] = useState("");
  const [lines, setLines] = useState(() =>
    (entry?.items?.length
      ? entry.items
      : [
          {
            name: entry?.description || "",
            category: entry?.category || "差旅费",
            amount: entry?.amount || 0,
          },
        ]
    ).map((i) => ({
      ...i,
      value: String(i.amount / 100),
      key: crypto.randomUUID(),
    })),
  );
  const person = members.find((p) => p.id === selected),
    ys = years(person),
    lockedMonth = !!(entry?.salary_month || entry?.allowance_month);
  const updateLine = (key, patch) =>
    setLines(lines.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  let pay = null,
    payError = "",
    totalAmount = 0;
  try {
    totalAmount = lines.reduce((n, i) => n + cents(i.value || "0"), 0);
    if (trip && kind === "expense")
      pay = tripPay(start, end, Number(underground));
  } catch (e) {
    payError = e.message;
  }
  return (
    <Modal
      title={entry ? "编辑财务记录" : "记下一笔科研投入"}
      onClose={onClose}
      wide
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const f = new FormData(e.currentTarget);
            const items =
              kind === "expense"
                ? lines.map((i) => ({
                    name:
                      i.name.trim() ||
                      (lines.length === 1 ? f.get("description").trim() : ""),
                    category: i.category,
                    amount: cents(i.value),
                  }))
                : [];
            const value = normalizeEntry({
              ...entry,
              id: entry?.id || crypto.randomUUID(),
              owner_id: selected,
              date: start,
              end_date: kind === "expense" ? end : start,
              kind,
              category:
                kind === "expense" ? items[0]?.category || "其他" : KIND[kind],
              description: f.get("description").trim(),
              amount:
                kind === "expense"
                  ? items.reduce((n, i) => n + i.amount, 0)
                  : cents(f.get("amount")),
              note: f.get("note").trim(),
              deleted: false,
              items,
              is_trip: kind === "expense" && trip,
              underground_days: trip ? Number(underground) : 0,
            });
            validEntry(value, person);
            onSubmit(value);
          } catch (e) {
            setError(e.message);
          }
        }}
      >
        <div className="form-grid">
          <Field label="账目所属成员">
            <select
              value={selected}
              disabled={!!entry || !teacher}
              onChange={(e) => setSelected(e.target.value)}
            >
              {members.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {degree(p)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="记录类型">
            <select
              value={kind}
              disabled={lockedMonth}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="expense">科研支出 / 出差事务</option>
              <option value="reward">奖金（自行录入）</option>
              {teacher && <option value="allowance">额外补助</option>}
              {entry?.kind === "salary" && (
                <option value="salary">固定工资</option>
              )}
            </select>
          </Field>
          <Field
            label={kind === "expense" ? "开始日期（所属报表月份）" : "记账日期"}
          >
            <input
              type="date"
              value={start}
              disabled={lockedMonth}
              min={recordStart(person)}
              max={`${ys.at(-1)}-12-31`}
              required
              onChange={(e) => {
                setStart(e.target.value);
                if (end < e.target.value) setEnd(e.target.value);
              }}
            />
          </Field>
          {kind === "expense" ? (
            <Field label="结束日期（含当天）">
              <input
                type="date"
                value={end}
                min={start}
                max={`${ys.at(-1)}-12-31`}
                required
                onChange={(e) => setEnd(e.target.value)}
              />
            </Field>
          ) : (
            <Field label="金额 / 元">
              <input
                name="amount"
                type="number"
                inputMode="decimal"
                required
                min="0"
                max="100000000"
                step="0.01"
                defaultValue={entry ? entry.amount / 100 : ""}
              />
            </Field>
          )}
          <Field label="具体事务" full>
            <input
              name="description"
              required
              maxLength={200}
              defaultValue={entry?.description || ""}
              placeholder="例如：徐州矿区出差、实验测试、科研奖金"
            />
          </Field>
        </div>
        {kind === "expense" && (
          <>
            <div className="expense-lines">
              <div className="panel-heading">
                <h3>费用明细</h3>
                <button
                  className="text-button"
                  type="button"
                  disabled={lines.length >= 50}
                  onClick={() =>
                    setLines([
                      ...lines,
                      {
                        key: crypto.randomUUID(),
                        name: "",
                        category: "差旅费",
                        value: "0",
                      },
                    ])
                  }
                >
                  <Plus size={16} />
                  添加一项
                </button>
              </div>
              {lines.map((item, i) => (
                <div className="expense-line" key={item.key}>
                  <Field label={`第 ${i + 1} 项 · 名称`}>
                    <input
                      aria-label={`费用${i + 1}名称`}
                      value={item.name}
                      maxLength={80}
                      required={lines.length > 1}
                      placeholder="机票 / 住宿 / 餐饮 / 打车"
                      onChange={(e) =>
                        updateLine(item.key, { name: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="费用分类">
                    <select
                      aria-label={`费用${i + 1}分类`}
                      value={item.category}
                      onChange={(e) =>
                        updateLine(item.key, { category: e.target.value })
                      }
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="金额 / 元">
                    <input
                      aria-label={`费用${i + 1}金额`}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="100000000"
                      step="0.01"
                      required
                      value={item.value}
                      onChange={(e) =>
                        updateLine(item.key, { value: e.target.value })
                      }
                    />
                  </Field>
                  <button
                    className="icon-btn"
                    type="button"
                    disabled={lines.length === 1}
                    aria-label={`移除费用${i + 1}`}
                    onClick={() =>
                      setLines(lines.filter((v) => v.key !== item.key))
                    }
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              ))}
              <div className="expense-total">
                费用合计 <strong>{money(totalAmount)}</strong>
              </div>
            </div>
            <div className="trip-box">
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={trip}
                  onChange={(e) => setTrip(e.target.checked)}
                />
                这是出差事务，自动计算出差工资
              </label>
              {trip && (
                <>
                  <Field label="下井天数（学生填写）">
                    <input
                      type="number"
                      min="0"
                      max={pay?.days}
                      step="1"
                      required
                      value={underground}
                      onChange={(e) => setUnderground(e.target.value)}
                    />
                  </Field>
                  {pay ? (
                    <p>
                      {pay.days} 天 × 120 元 + 下井 {pay.underground} 天 × 60 元
                      = <strong>{money(pay.amount)}</strong>
                    </p>
                  ) : (
                    <p className="negative">{payError}</p>
                  )}
                  <p className="small-text muted">
                    出发、返回当天都计入。出差工资另记一项支出，和上方费用合计一起计入账面支出。
                  </p>
                </>
              )}
            </div>
            <p className="subtle-note">
              只需记录事务和费用。跨月事务的费用与出差工资计入开始日期所在月。
            </p>
          </>
        )}
        <Field label="备注" full>
          <textarea
            name="note"
            maxLength={1000}
            rows="3"
            defaultValue={entry?.note || ""}
            placeholder="项目、发票、奖金来源等"
          />
        </Field>
        {error && (
          <p className="negative" role="alert">
            {error}
          </p>
        )}
        <div className="subtle-note">
          <CloudUpload size={17} />
          离线先保存到本机；联网且应用打开时自动同步。
        </div>
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "保存中…" : "保存记录"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function TaskForm({ task, busy, onClose, onSubmit }) {
  const [error, setError] = useState("");
  return (
    <Modal title={task ? "编辑学习任务" : "发布新的学习任务"} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const f = new FormData(e.currentTarget);
            onSubmit({
              id: task?.id || crypto.randomUUID(),
              title: f.get("title").trim(),
              content: f.get("content").trim(),
              reward: f.get("reward").trim(),
              reward_amount: cents(f.get("reward_amount")),
              category: f.get("category"),
              deadline: f.get("deadline"),
            });
          } catch (e) {
            setError(e.message);
          }
        }}
      >
        <Field label="任务名称">
          <input
            name="title"
            required
            maxLength={120}
            defaultValue={task?.title || ""}
          />
        </Field>
        <Field label="学习内容与交付要求">
          <textarea
            name="content"
            required
            rows="4"
            maxLength={4000}
            defaultValue={task?.content || ""}
          />
        </Field>
        <Field label="奖励说明">
          <textarea
            name="reward"
            required
            maxLength={500}
            rows="2"
            defaultValue={task?.reward || ""}
            placeholder="非现金奖励、验收要求等"
          />
        </Field>
        <Field label="悬赏奖金 / 元（验收后自动记账）">
          <input
            name="reward_amount"
            type="number"
            inputMode="decimal"
            min="0"
            max="100000000"
            step="0.01"
            required
            defaultValue={(task?.reward_amount || 0) / 100}
          />
        </Field>
        <div className="form-grid">
          <Field label="任务分类">
            <select name="category" defaultValue={task?.category || "文献精读"}>
              {["文献精读", "技能提升", "团队共建", "研究实践"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="领取截止日期">
            <input
              name="deadline"
              type="date"
              min={task ? undefined : today()}
              required
              defaultValue={task?.deadline || ""}
            />
          </Field>
        </div>
        <p className="subtle-note">
          老师验收后，以上奖金自动记入领取学生账单；重复验收不会重复记账。金额为
          0 时不生成现金奖金。旧任务请先核对是否已手动发放，避免重复。
        </p>
        {error && <p className="negative">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={busy}>
            保存任务
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Settings({
  onSaved,
  profile,
  members,
  data,
  teacher,
  run,
  busy,
  install,
  backup,
}) {
  return (
    <div className="settings-grid">
      {teacher ? (
        <div className="settings-main">
          <Payroll
            onSaved={onSaved}
            members={members}
            data={data}
            run={run}
            busy={busy}
          />
          <section className="panel settings-panel">
            <div className="panel-heading">
              <h2>团队名称与预算提醒</h2>
            </div>
            <form
              key={JSON.stringify(data.settings)}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                run(
                  () =>
                    store.action("save_settings", {
                      p_settings: {
                        team_name: f.get("team_name").trim(),
                        monthly_limit: cents(f.get("monthly_limit")),
                        gap_limit: cents(f.get("gap_limit")),
                      },
                      p_stipends: [],
                    }),
                  "团队设置已保存",
                );
              }}
            >
              <Field label="课题组名称">
                <input
                  name="team_name"
                  required
                  maxLength={60}
                  defaultValue={data.settings.team_name}
                />
              </Field>
              <div className="form-grid">
                <Field label="每人单月账面支出预警 / 元">
                  <input
                    name="monthly_limit"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    defaultValue={data.settings.monthly_limit / 100}
                  />
                </Field>
                <Field label="累计负差额预警 / 元">
                  <input
                    name="gap_limit"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    defaultValue={data.settings.gap_limit / 100}
                  />
                </Field>
              </div>
              <p className="subtle-note">
                达到 80% 黄色提醒，达到 100%
                红色提醒。支出阈值包含固定工资、出差工资与科研花费。
              </p>
              <button className="primary" disabled={busy}>
                保存团队设置
              </button>
            </form>
          </section>
        </div>
      ) : (
        <section className="panel settings-panel">
          <div className="panel-heading">
            <h2>我的研究档案</h2>
            <GraduationCap size={24} />
          </div>
          <div className="profile-large">
            <Avatar p={profile} />
            <h2>{profile.name}</h2>
            <Badge tone="blue">{degree(profile)}</Badge>
          </div>
          <div className="calculation">
            <div>
              <span>培养年度</span>
              <b>{years(profile).join("、")}</b>
            </div>
            <div>
              <span>本月年级工资标准</span>
              <b>
                {money(
                  salaryFor(
                    profile,
                    Number(today().slice(0, 4)),
                    data.salaryRules?.find(
                      (r) => r.year === Number(today().slice(0, 4)),
                    )?.rates || {},
                  ),
                )}{" "}
                / 月（支出）
              </b>
            </div>
            <div>
              <span>记账起始月份</span>
              <b>{profile.start_month?.slice(0, 7)}</b>
            </div>
          </div>
          <p className="subtle-note">
            补助标准由老师统一维护。培养档案更正请联系老师按部署说明处理，以保留历史账目。
          </p>
        </section>
      )}
      <div className="settings-side">
        <section className="panel">
          <div className="panel-heading">
            <h2>随身工作台</h2>
            <Smartphone size={22} />
          </div>
          <p className="muted">
            支持 iPhone 与安卓手机。安装后可从桌面直接打开，在无网环境继续记账。
          </p>
          <button className="secondary full-width" onClick={install}>
            添加到桌面
            <ArrowUpRight size={17} />
          </button>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>数据与隐私</h2>
            <ShieldCheck size={22} />
          </div>
          <ul className="feature-list">
            <li>
              <Check size={16} />
              学生独立账本，老师汇总查看
            </li>
            <li>
              <Check size={16} />
              任务领取身份对其他学生隐藏
            </li>
            <li>
              <Check size={16} />
              离线账目保存于当前账号缓存
            </li>
            <li>
              <Check size={16} />
              同步冲突保留副本，由你核对
            </li>
          </ul>
          <button className="secondary full-width" onClick={backup}>
            <Download size={17} />
            导出本机数据备份
          </button>
          <p className="small-text muted">
            备份含个人账目，请保存在自己的设备。JSON 备份供人工恢复与审计使用。
          </p>
        </section>
        <section className="panel version-card">
          <img src="./icon.svg" alt="" />
          <div>
            <h3>研助表</h3>
            <p>版本 2.1.0 · {cloud ? "云端团队版" : "本机演示版"}</p>
          </div>
        </section>
      </div>
    </div>
  );
}
