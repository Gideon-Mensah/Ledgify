// Minimal Office Open XML writer for browser-side report exports.
// The ZIP container deliberately uses the STORE method so no third-party
// spreadsheet dependency or misleading HTML-as-XLS fallback is required.

const encoder = new TextEncoder();
const xml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  return crc >>> 0;
});
const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
const u16 = (value) => [value & 255, (value >>> 8) & 255];
const u32 = (value) => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
const zip = (files) => {
  const output = []; const directory = []; let offset = 0;
  Object.entries(files).forEach(([name, content]) => {
    const filename = encoder.encode(name); const data = typeof content === "string" ? encoder.encode(content) : content; const checksum = crc32(data);
    const local = new Uint8Array([80,75,3,4,20,0,0,0,0,0,0,0,33,0,...u32(checksum),...u32(data.length),...u32(data.length),...u16(filename.length),0,0,...filename]);
    output.push(local, data);
    directory.push(new Uint8Array([80,75,1,2,20,0,20,0,0,0,0,0,0,0,33,0,...u32(checksum),...u32(data.length),...u32(data.length),...u16(filename.length),0,0,0,0,0,0,0,0,0,0,0,0,...u32(offset),...filename]));
    offset += local.length + data.length;
  });
  const directorySize = directory.reduce((sum, item) => sum + item.length, 0);
  const end = new Uint8Array([80,75,5,6,0,0,0,0,...u16(directory.length),...u16(directory.length),...u32(directorySize),...u32(offset),0,0]);
  return new Blob([...output, ...directory, end], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
};

const column = (index) => {
  let result = ""; let value = index;
  while (value > 0) { value -= 1; result = String.fromCharCode(65 + (value % 26)) + result; value = Math.floor(value / 26); }
  return result;
};
const cell = (value, row, col, style = 0, forceText = false) => {
  const ref = `${column(col)}${row}`;
  if (!forceText && typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
};

const humanise = (value) => String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const number = (value) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; };
const account = (row) => row?.account || {};
const generated = () => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date());
const periodText = (metadata) => metadata.as_of_date ? `As at ${metadata.as_of_date}` : `${metadata.start_date || "Beginning"} to ${metadata.end_date || "Current date"}`;

function financialRows(title, rows, metadata) {
  const output = [
    { values: [metadata.organisation || "Ledgify", ""], style: 1, height: 25 },
    { values: [title, ""], style: 2, height: 32 },
    { values: [periodText(metadata), ""], style: 3 },
    { values: [`Currency: ${metadata.currency || "—"}`, `Generated: ${generated()}`], style: 3 },
    { values: ["", ""], style: 0 },
  ];
  const totals = rows.find((row) => row.section === "Totals") || {};
  const addHeading = (label) => output.push({ values: [label, "Amount"], style: 4 });
  const addSubheading = (label) => output.push({ values: [label, ""], style: 5 });
  const addAccounts = (items) => items.forEach((item) => output.push({ values: [`   ${account(item).code ? `${account(item).code} · ` : ""}${account(item).name || "Unlabelled account"}`, number(item.amount)], styles: [0, 6] }));
  const addTotal = (label, value, grand = false) => output.push({ values: [label, number(value)], styles: [grand ? 8 : 5, grand ? 9 : 7] });
  const section = (label, items, totalLabel, totalValue, subheading = false) => { if (!items.length) return; (subheading ? addSubheading : addHeading)(label); addAccounts(items); addTotal(totalLabel, totalValue); };

  if (title === "Profit and Loss") {
    const income = rows.filter((row) => row.section === "income" && account(row).account_class !== "other_income");
    const otherIncome = rows.filter((row) => row.section === "income" && account(row).account_class === "other_income");
    const allExpenses = rows.filter((row) => row.section === "expenses");
    const costs = allExpenses.filter((row) => account(row).account_class === "cost_of_sales");
    const otherExpenses = allExpenses.filter((row) => account(row).account_class === "other_expense");
    const expenses = allExpenses.filter((row) => !["cost_of_sales", "other_expense"].includes(account(row).account_class));
    const total = (items) => items.reduce((sum, row) => sum + number(row.amount), 0);
    section("Income", income, "Total Income", total(income));
    section("Cost of Sales", costs, "Total Cost of Sales", total(costs));
    const grossProfit = total(income) - total(costs); if (costs.length) addTotal("Gross Profit", grossProfit);
    section("Operating Expenses", expenses, "Total Operating Expenses", total(expenses));
    if (expenses.length) addTotal("Operating Profit", grossProfit - total(expenses));
    section("Other Income", otherIncome, "Total Other Income", total(otherIncome));
    section("Other Expenses", otherExpenses, "Total Other Expenses", total(otherExpenses));
    addTotal(number(totals.net_profit) < 0 ? "Net Loss" : "Net Profit", totals.net_profit, true);
  } else if (title === "Trial Balance") {
    output.push({ values: ["Account Code", "Account Name", "Account Type", "Debit", "Credit", "Closing Balance"], style: 4 });
    rows.filter((row) => row.section === "rows").forEach((row) => output.push({ values: [account(row).code || "", account(row).name || "", humanise(account(row).account_type || account(row).account_class), number(row.debit), number(row.credit), number(row.net_balance)], styles: [10,0,0,6,6,6] }));
    output.push({ values: ["", "Totals", "", number(totals.total_debit), number(totals.total_credit), number(totals.difference)], styles: [5,5,5,7,7,7] });
    output.push({ values: [number(totals.difference) === 0 && totals.balanced !== false ? "BALANCED" : `OUT OF BALANCE: ${number(totals.difference)}`, ""], style: number(totals.difference) === 0 && totals.balanced !== false ? 11 : 12 });
  } else if (title === "Balance Sheet") {
    const assets = rows.filter((row) => row.section === "assets"); const liabilities = rows.filter((row) => row.section === "liabilities"); const equity = rows.filter((row) => row.section === "equity");
    const currentAssets = assets.filter((row) => ["bank", "current_asset", "receivable"].includes(account(row).account_class)); const nonCurrentAssets = assets.filter((row) => !currentAssets.includes(row));
    const currentLiabilities = liabilities.filter((row) => ["current_liability", "payable"].includes(account(row).account_class)); const nonCurrentLiabilities = liabilities.filter((row) => !currentLiabilities.includes(row));
    const total = (items) => items.reduce((sum, row) => sum + number(row.amount), 0);
    addHeading("Assets"); section("Current Assets", currentAssets, "Total Current Assets", total(currentAssets), true); section("Non-current Assets", nonCurrentAssets, "Total Non-current Assets", total(nonCurrentAssets), true); addTotal("Total Assets", totals.total_assets, true);
    addHeading("Liabilities"); section("Current Liabilities", currentLiabilities, "Total Current Liabilities", total(currentLiabilities), true); section("Non-current Liabilities", nonCurrentLiabilities, "Total Non-current Liabilities", total(nonCurrentLiabilities), true); addTotal("Total Liabilities", totals.total_liabilities);
    addHeading("Equity"); addAccounts(equity); addTotal("Total Equity", totals.total_equity);
    addTotal("Total Liabilities and Equity", totals.total_liabilities_and_equity, true);
    output.push({ values: [number(totals.difference) === 0 && totals.balanced !== false ? "ACCOUNTING EQUATION BALANCED" : `ACCOUNTING EQUATION OUT OF BALANCE: ${number(totals.difference)}`, ""], style: number(totals.difference) === 0 && totals.balanced !== false ? 11 : 12 });
  } else if (title === "Cash Flow Statement") {
    const total = (name) => number(totals[name]);
    for (const [key, label, totalKey] of [["operating","Cash Flows from Operating Activities","total_operating"],["investing","Cash Flows from Investing Activities","total_investing"],["financing","Cash Flows from Financing Activities","total_financing"],["unclassified","Unclassified Cash Flows","total_unclassified"]]) section(label, rows.filter((row) => row.section === key), key === "unclassified" ? "Net Unclassified Cash Flow" : `Net Cash from ${label.replace("Cash Flows from ", "")}`, total(totalKey));
    addTotal(total("net_cash_flow") < 0 ? "Net Decrease in Cash" : "Net Increase in Cash", total("net_cash_flow"));
    addTotal("Opening Cash Balance", total("opening_cash"));
    addTotal("Closing Cash Balance", total("closing_cash"), true);
    output.push({ values: [total("difference") === 0 && totals.balanced !== false ? "CASH RECONCILIATION BALANCED" : `CASH RECONCILIATION OUT OF BALANCE: ${total("difference")}`, ""], style: total("difference") === 0 && totals.balanced !== false ? 11 : 12 });
  }
  return output;
}

function genericRows(title, rows, metadata) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row || {})))];
  const display = (value) => value && typeof value === "object" ? value.name || value.code || JSON.stringify(value) : value ?? "";
  return [
    { values: [metadata.organisation || "Ledgify"], style: 1 }, { values: [title], style: 2 }, { values: [periodText(metadata)], style: 3 },
    { values: columns.map(humanise), style: 4 },
    ...rows.map((row) => ({ values: columns.map((key) => display(row[key])), styles: columns.map((key) => typeof row[key] === "number" ? 6 : key.includes("code") ? 10 : 0) })),
  ];
}

export function createXlsxWorkbook({ title, rows = [], metadata = {} }) {
  const specialised = ["Profit and Loss", "Trial Balance", "Balance Sheet", "Cash Flow Statement"].includes(title);
  const sheetRows = specialised ? financialRows(title, rows, metadata) : genericRows(title, rows, metadata);
  const maxColumns = Math.max(2, ...sheetRows.map((row) => row.values.length));
  const rowXml = sheetRows.map((item, index) => {
    const rowNumber = index + 1; const styles = item.styles || item.values.map(() => item.style || 0);
    return `<row r="${rowNumber}"${item.height ? ` ht="${item.height}" customHeight="1"` : ""}>${item.values.map((value, col) => cell(value, rowNumber, col + 1, styles[col] || 0, styles[col] === 10)).join("")}</row>`;
  }).join("");
  const widths = Array.from({ length: maxColumns }, (_, index) => `<col min="${index + 1}" max="${index + 1}" width="${index === 0 ? 42 : index === 1 ? 30 : 18}" customWidth="1"/>`).join("");
  const headerRow = specialised ? 6 : 4;
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${widths}</cols><sheetData>${rowXml}</sheetData><autoFilter ref="A${headerRow}:${column(maxColumns)}${Math.max(headerRow, sheetRows.length)}"/><printOptions horizontalCentered="1"/><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>&amp;L${xml(metadata.organisation || "Ledgify")}&amp;RPage &amp;P of &amp;N</oddFooter></headerFooter></worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="_(* #,##0.00_);_(* (#,##0.00);_(* &quot;-&quot;??_);_(@_)"/></numFmts><fonts count="5"><font><sz val="10"/><name val="Aptos"/></font><font><b/><sz val="11"/><color rgb="FF0E2D3A"/><name val="Aptos"/></font><font><b/><sz val="20"/><color rgb="FF0E2D3A"/><name val="Aptos Display"/></font><font><b/><color rgb="FFFFFFFF"/><name val="Aptos"/></font><font><b/><color rgb="FF067647"/><name val="Aptos"/></font></fonts><fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F4C5C"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF6F8"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCFCE7"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFEE2E2"/></patternFill></fill></fills><borders count="3"><border/><border><bottom style="thin"><color rgb="FFBFD0D7"/></bottom></border><border><top style="double"><color rgb="FF0F4C5C"/></top><bottom style="double"><color rgb="FF0F4C5C"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="13"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment wrapText="1"/></xf><xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0"><alignment wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0"><alignment horizontal="right"/></xf><xf numFmtId="164" fontId="1" fillId="3" borderId="1" xfId="0"><alignment horizontal="right"/></xf><xf numFmtId="0" fontId="1" fillId="3" borderId="2" xfId="0"/><xf numFmtId="164" fontId="1" fillId="3" borderId="2" xfId="0"><alignment horizontal="right"/></xf><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="4" fillId="4" borderId="1" xfId="0"/><xf numFmtId="0" fontId="1" fillId="5" borderId="1" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return zip({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(title).slice(0,31)}" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">'${xml(title).slice(0,31)}'!$${headerRow}:$${headerRow}</definedName><definedName name="_xlnm.Print_Area" localSheetId="0">'${xml(title).slice(0,31)}'!$A$1:$${column(maxColumns)}$${sheetRows.length}</definedName></definedNames></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": worksheet, "xl/styles.xml": styles,
  });
}
