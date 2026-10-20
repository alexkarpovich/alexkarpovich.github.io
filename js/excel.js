(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TimeExcel = api;
})(typeof self !== "undefined" ? self : this, function () {
  const encoder = new TextEncoder();
  function xml(value) {
    return String(value == null ? "" : value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function safeText(value) {
    const text = String(value == null ? "" : value);
    return /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
  }
  function labelList(labels, labelText) { return (labels || []).map(labelText).join(", "); }
  function hours(minutes) { return Math.round((Number(minutes) || 0) / 60 * 100) / 100; }
  function cell(value) {
    if (Array.isArray(value) && value[1] === "Number") return '<c t="n"><v>' + (Number(value[0]) || 0) + '</v></c>';
    return '<c t="inlineStr"><is><t xml:space="preserve">' + xml(safeText(Array.isArray(value) ? value[0] : value)) + '</t></is></c>';
  }
  function colName(n) { let out = ""; while (n) { n--; out = String.fromCharCode(65 + n % 26) + out; n = Math.floor(n / 26); } return out; }
  function worksheet(rows) {
    const body = rows.map(function (values, ri) {
      return '<row r="' + (ri + 1) + '">' + values.map(function (v, ci) { return cell(v).replace("<c ", '<c r="' + colName(ci + 1) + (ri + 1) + '" '); }).join("") + '</row>';
    }).join("");
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + body + '</sheetData></worksheet>';
  }
  function crc32(data) {
    let crc = -1;
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i];
      for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (-(crc & 1) & 0xedb88320);
    }
    return (crc ^ -1) >>> 0;
  }
  function u16(out, value) { out.push(value & 255, (value >>> 8) & 255); }
  function u32(out, value) { out.push(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255); }
  function zip(files) {
    const chunks = [], central = [];
    let offset = 0;
    Object.keys(files).forEach(function (name) {
      const n = encoder.encode(name), d = encoder.encode(files[name]), crc = crc32(d), local = [];
      u32(local, 0x04034b50); u16(local, 20); u16(local, 0x0800); u16(local, 0); u16(local, 0); u16(local, 0);
      u32(local, crc); u32(local, d.length); u32(local, d.length); u16(local, n.length); u16(local, 0);
      chunks.push(new Uint8Array(local), n, d);
      const c = []; u32(c, 0x02014b50); u16(c, 20); u16(c, 20); u16(c, 0x0800); u16(c, 0); u16(c, 0); u16(c, 0);
      u32(c, crc); u32(c, d.length); u32(c, d.length); u16(c, n.length); u16(c, 0); u16(c, 0); u16(c, 0); u16(c, 0); u32(c, 0); u32(c, offset);
      central.push(new Uint8Array(c), n); offset += local.length + n.length + d.length;
    });
    const centralSize = central.reduce(function (s, item) { return s + item.length; }, 0), end = [];
    u32(end, 0x06054b50); u16(end, 0); u16(end, 0); u16(end, Object.keys(files).length); u16(end, Object.keys(files).length); u32(end, centralSize); u32(end, offset); u16(end, 0);
    return new Blob(chunks.concat(central, [new Uint8Array(end)]), { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  function buildWorkbook(report, formatDuration, settings) {
    const label = report.labelText || function (item) { return item && (item.name || item.color) || ""; };
    const summary = [["Author", "Card", "List", "Labels", "Time", "Minutes", "Hours", "Link"]];
    report.groups.forEach(function (g) {
      g.rows.forEach(function (i) { summary.push([g.memberName, i.cardName, i.listName, labelList(i.labels, label), formatDuration(i.minutes, settings), [i.minutes, "Number"], [hours(i.minutes), "Number"], i.cardUrl]); });
      summary.push([g.memberName, "Subtotal", "", "", formatDuration(g.minutes, settings), [g.minutes, "Number"], [hours(g.minutes), "Number"], ""]);
    });
    summary.push(["Total", "", "", "", formatDuration(report.totalMinutes, settings), [report.totalMinutes, "Number"], [hours(report.totalMinutes), "Number"], ""]);
    const entries = [["Date", "Author", "Card", "List", "Labels", "Time", "Minutes", "Hours", "Note", "Link"]];
    report.entries.forEach(function (e) { entries.push([e.ymd, e.memberName, e.cardName, e.listName, labelList(e.labels, label), formatDuration(e.minutes, settings), [e.minutes, "Number"], [hours(e.minutes), "Number"], e.note, e.cardUrl]); });
    const epics = [["Epic", "Labels", "Limit", "Limit, min", "Spent by children", "Spent, min", "Remaining", "Remaining, min", "Status", "Link"]];
    report.epics.forEach(function (e) { const known = e.known && e.spentMinutes != null; epics.push([e.cardName, labelList(e.labels, label), formatDuration(e.limitMinutes, settings), [e.limitMinutes, "Number"], known ? formatDuration(e.spentMinutes, settings) : "", known ? [e.spentMinutes, "Number"] : "", known ? formatDuration(e.remainingMinutes, settings) : "", known ? [e.remainingMinutes, "Number"] : "", !known ? "Links not loaded" : e.remainingMinutes < 0 ? "Over limit" : "Within limit", e.cardUrl]); });
    const files = {
      "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
      "_rels/.rels": '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      "xl/workbook.xml": '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/><sheet name="Entries" sheetId="2" r:id="rId2"/><sheet name="Epics" sheetId="3" r:id="rId3"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels": '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/></Relationships>',
      "xl/worksheets/sheet1.xml": worksheet(summary), "xl/worksheets/sheet2.xml": worksheet(entries), "xl/worksheets/sheet3.xml": worksheet(epics)
    };
    return zip(files);
  }
  return { buildWorkbook: buildWorkbook, escapeXml: xml };
});
