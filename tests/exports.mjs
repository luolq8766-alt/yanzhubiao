import { readFile, writeFile, mkdir } from "node:fs/promises";
import { buildExcel, buildPDF } from "../src/exports.js";
import { seed, today } from "../src/domain.js";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import assert from "node:assert/strict";
const data = seed(),
  rows = data.entries.filter((e) => e.date.slice(0, 7) === today().slice(0, 7));
const target = process.argv[2] || "work/export-check";
await mkdir(target, { recursive: true });
const excel = await buildExcel(rows, data.profiles, "研助表 · 月度财务报表");
await writeFile(`${target}/report.xlsx`, excel);
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(excel);
assert.equal(workbook.worksheets.length, 3);
assert.equal(workbook.worksheets[0].rowCount, rows.length + 2);
assert.equal(workbook.worksheets[0].getCell("F3").type, 2);
const pdf = await buildPDF(
  rows,
  data.profiles,
  "研助表 · 月度财务报表",
  await readFile(new URL("../public/fonts/NotoSansSC.ttf", import.meta.url)),
);
await writeFile(`${target}/report.pdf`, pdf);
const document = await PDFDocument.load(pdf);
assert(document.getPageCount() >= 2);
console.log(
  `Export QA passed: XLSX numeric cells, ${rows.length} entries; PDF ${document.getPageCount()} pages, ${pdf.length} bytes, embedded Chinese font.`,
);
