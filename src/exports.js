import {
  money,
  summary,
  KIND,
  isIncome,
  cleanEntry,
  ledgerEntries,
  dateRange,
  tripPay,
} from "./domain.js";
export function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
export function exportBackup(data) {
  download(
    new Blob(
      [
        JSON.stringify(
          {
            app: "研助表",
            exported_at: new Date().toISOString(),
            ...data,
            entries: data.entries?.map(cleanEntry),
            queue: data.queue?.map((q) => ({
              ...q,
              entry: cleanEntry(q.entry),
            })),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
    "研助表-本机备份.json",
  );
}
function rowsFor(entries, profiles) {
  return entries
    .filter((e) => !e.deleted)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => [
      profiles.find((p) => p.id === e.owner_id)?.name || "",
      e.date,
      KIND[e.kind],
      e.category,
      e.description,
      e.amount / 100,
      isIncome(e) ? "收入" : "支出",
      isIncome(e) ? e.amount / 100 : 0,
      isIncome(e) ? 0 : e.amount / 100,
      e.note || "",
      e.end_date || e.date,
      e.is_trip
        ? tripPay(e.date, e.end_date || e.date, e.underground_days || 0).days
        : 0,
      e.underground_days || 0,
      e.source_entry_id || e.id,
    ]);
}
export async function buildExcel(entries, profiles, title) {
  entries = ledgerEntries(entries);
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "研助表";
  const sheet = wb.addWorksheet("财务明细", {
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });
  sheet.mergeCells("A1:N1");
  sheet.getCell("A1").value = title;
  sheet.getCell("A1").font = { bold: true, size: 18 };
  sheet.getRow(1).height = 34;
  const columns = [
    "成员",
    "开始日期 / 记账日期",
    "类型",
    "分类",
    "具体事务",
    "金额（元）",
    "收支方向",
    "收入（元）",
    "支出（元）",
    "备注",
    "结束日期",
    "出差天数",
    "下井天数",
    "关联事务编号",
  ];
  sheet.addRow(columns);
  rowsFor(entries, profiles).forEach((r) => sheet.addRow(r));
  sheet.columns = [
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 22 },
    { width: 40 },
    { width: 17 },
    { width: 16 },
    { width: 17 },
    { width: 17 },
    { width: 40 },
    { width: 16 },
    { width: 13 },
    { width: 13 },
    { width: 40 },
  ];
  sheet.views = [{ state: "frozen", ySplit: 2 }];
  sheet.autoFilter = { from: "A2", to: "N2" };
  sheet.getRow(2).eachCell((c) => {
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF142E3A" },
    };
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
  });
  sheet.eachRow((r, i) => {
    if (i > 2) {
      r.eachCell((c) => {
        c.alignment = { vertical: "middle", wrapText: true };
      });
      [6, 8, 9].forEach((n) => (r.getCell(n).numFmt = "#,##0.00"));
      r.height = 30;
    }
  });
  const sums = wb.addWorksheet("成员汇总");
  sums.addRow([
    "成员",
    "实际补助（元）",
    "奖金（元）",
    "收入合计（元）",
    "固定工资支出（元）",
    "出差工资支出（元）",
    "科研花费（元）",
    "支出合计（元）",
    "账面差额（元）",
    "团队已记账支出（元）",
  ]);
  profiles
    .filter((p) => p.role === "student")
    .forEach((p) => {
      const s = summary(entries, { owner: p.id });
      sums.addRow([
        p.name,
        ...[
          s.allowance,
          s.reward,
          s.income,
          s.salary,
          s.trip_salary,
          s.research,
          s.expense,
          s.gap,
          s.teamOutlay,
        ].map((n) => n / 100),
      ]);
    });
  sums.columns.forEach((c) => (c.width = 25));
  sums.getRow(1).font = { bold: true };
  sums.eachRow((r, i) => {
    if (i > 1) for (let j = 2; j <= 10; j++) r.getCell(j).numFmt = "#,##0.00";
  });
  sums.addRow([]);
  sums.addRow([
    "收入=实际补助（已含固定工资）+奖金；支出=固定工资+出差工资+科研花费；账面差额=收入-支出。",
  ]);
  sums.addRow([
    "团队已记账支出=实际补助+奖金。费用仅记录，不增加团队发放总额。",
  ]);
  sums.addRow(["记账从2026年6月起；账面记录不证明银行实际转账。"]);
  const items = wb.addWorksheet("费用分项");
  items.addRow([
    "成员",
    "开始日期",
    "结束日期",
    "具体事务",
    "费用名称",
    "费用分类",
    "金额（元）",
    "收支方向",
    "关联事务编号",
  ]);
  for (const e of entries.filter((e) => e.kind === "expense"))
    for (const item of e.items?.length
      ? e.items
      : [{ name: e.description, category: e.category, amount: e.amount }])
      items.addRow([
        profiles.find((p) => p.id === e.owner_id)?.name || "",
        e.date,
        e.end_date || e.date,
        e.description,
        item.name,
        item.category,
        item.amount / 100,
        "支出",
        e.id,
      ]);
  items.columns = [14, 16, 16, 35, 25, 24, 18, 18, 40].map((width) => ({
    width,
  }));
  items.getRow(1).font = { bold: true };
  items.views = [{ state: "frozen", ySplit: 1 }];
  items.autoFilter = { from: "A1", to: "I1" };
  items.eachRow((r, i) => {
    if (i > 1) r.getCell(7).numFmt = "#,##0.00";
    r.eachCell((c) => (c.alignment = { vertical: "middle", wrapText: true }));
  });
  return wb.xlsx.writeBuffer();
}
export async function buildPDF(entries, profiles, title, fontBytes) {
  entries = ledgerEntries(entries);
  const [{ PDFDocument, rgb }, { default: fontkit }] = await Promise.all([
    import("pdf-lib"),
    import("@pdf-lib/fontkit"),
  ]);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: false });
  let page,
    y,
    pageNo = 0;
  const widths = [54, 65, 70, 205, 65, 90, 190];
  const headers = [
    "成员",
    "日期",
    "类型/分类",
    "具体事务",
    "金额（元）",
    "收支方向",
    "备注",
  ];
  const line = (str, x, yy, size = 9) => {
    page.drawText(str, { x, y: yy, size, font, color: rgb(0.12, 0.19, 0.23) });
  };
  const wrap = (text, width, size = 9) => {
    const lines = [""];
    for (const c of String(text)) {
      if (c === "\n") {
        lines.push("");
        continue;
      }
      if (font.widthOfTextAtSize(lines.at(-1) + c, size) > width - 10)
        lines.push(c);
      else lines[lines.length - 1] += c;
    }
    return lines;
  };
  function newPage() {
    page = pdf.addPage([842, 595]);
    pageNo++;
    y = 552;
    line(title, 32, y, Math.min(18, 610 / font.widthOfTextAtSize(title, 1)));
    line(`研助表  /  第 ${pageNo} 页`, 665, y, 10);
    y -= 30;
    page.drawRectangle({
      x: 30,
      y: y - 7,
      width: 782,
      height: 23,
      color: rgb(0.89, 0.94, 0.94),
    });
    let x = 34;
    headers.forEach((h, i) => {
      line(h, x, y, 10);
      x += widths[i];
    });
    y -= 30;
    line(
      "金额单位：人民币元  |  成员确认：____________   导师签字：____________",
      32,
      23,
      9,
    );
  }
  newPage();
  const s = summary(entries);
  const data = entries
    .filter((e) => !e.deleted)
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const e of data) {
    const cols = [
      profiles.find((p) => p.id === e.owner_id)?.name || "",
      dateRange(e),
      e.kind === "expense" ? `${KIND[e.kind]}\n${e.category}` : KIND[e.kind],
      e.description +
        (e.items?.length
          ? "\n" + e.items.map((i) => `${i.name} ${money(i.amount)}`).join("；")
          : ""),
      money(e.amount).replace("¥", ""),
      isIncome(e) ? "收入" : "支出",
      e.note,
    ];
    const blocks = cols.map((t, i) => wrap(t, widths[i]));
    const lineCount = Math.max(...blocks.map((b) => b.length));
    if (lineCount <= 31 && lineCount * 14 + 10 > y - 55) newPage();
    let consumed = 0;
    while (consumed < lineCount) {
      let available = Math.floor((y - 55) / 14);
      if (available < 1) {
        newPage();
        available = Math.floor((y - 55) / 14);
      }
      const take = Math.min(available, lineCount - consumed);
      let x = 34;
      blocks.forEach((b, i) => {
        b.slice(consumed, consumed + take).forEach((t, j) =>
          line(t, x, y - j * 14),
        );
        x += widths[i];
      });
      y -= take * 14 + 10;
      consumed += take;
      if (consumed < lineCount) newPage();
    }
    page.drawLine({
      start: { x: 32, y: y + 9 },
      end: { x: 810, y: y + 9 },
      thickness: 0.4,
      color: rgb(0.83, 0.87, 0.89),
    });
  }
  if (y < 120) newPage();
  y -= 14;
  line(
    `补助与奖金 ${money(s.income)}    账面支出 ${money(s.expense)}    本期差额 ${money(s.gap)}`,
    32,
    y,
    11,
  );
  y -= 24;
  line(
    `固定工资 ${money(s.salary)}    出差工资 ${money(s.trip_salary)}    科研花费 ${money(s.research)}`,
    32,
    y,
    10,
  );
  y -= 24;
  line(
    "账面差额 = 补助 + 奖金 - 固定工资 - 出差工资 - 科研花费。补助已包含固定工资。",
    32,
    y,
    9,
  );
  y -= 18;
  line(
    "工资和补助为记账记录，不代表银行实际转账。本报表请按学校要求核对、签字。",
    32,
    y,
    9,
  );
  return pdf.save();
}

export async function exportExcel(entries, profiles, title) {
  download(
    new Blob([await buildExcel(entries, profiles, title)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `${title}.xlsx`,
  );
}
export async function exportPDF(entries, profiles, title) {
  const r = await fetch(`${import.meta.env.BASE_URL}fonts/NotoSansSC.ttf`);
  if (!r.ok) throw new Error("首次导出 PDF 需要联网下载中文字体");
  download(
    new Blob(
      [await buildPDF(entries, profiles, title, await r.arrayBuffer())],
      { type: "application/pdf" },
    ),
    `${title}.pdf`,
  );
}
