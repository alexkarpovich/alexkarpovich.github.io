(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TimeExcel = api;
})(typeof self !== "undefined" ? self : this, function () {
  function escapeXml(value) {
    return String(value == null ? "" : value)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function safeText(value) {
    const text = String(value == null ? "" : value);
    if (/^[=+\-@\t\r]/.test(text)) return "'" + text;
    return text;
  }

  function cell(value, type) {
    if (type === "Number") {
      return '<Cell><Data ss:Type="Number">' + Number(value || 0) + "</Data></Cell>";
    }
    return '<Cell><Data ss:Type="String">' + escapeXml(safeText(value)) + "</Data></Cell>";
  }

  function row(values) {
    return "<Row>" + values.map(function (value) {
      return Array.isArray(value) ? cell(value[0], value[1]) : cell(value, "String");
    }).join("") + "</Row>";
  }

  function sheet(name, rows) {
    return '<Worksheet ss:Name="' + escapeXml(name) + '"><Table>' + rows.join("") + "</Table></Worksheet>";
  }

  function labelList(labels, labelText) {
    return (labels || []).map(function (label) { return labelText(label); }).join(", ");
  }

  function hours(minutes) {
    return Math.round((Number(minutes) || 0) / 60 * 100) / 100;
  }

  function buildWorkbook(report, formatDuration, settings) {
    const summary = [
      row(["Author", "Card", "List", "Labels", "Time", "Minutes", "Hours", "Link"])
    ];
    report.groups.forEach(function (group) {
      group.rows.forEach(function (item) {
        summary.push(row([
          group.memberName,
          item.cardName,
          item.listName,
          labelList(item.labels, report.labelText || fallbackLabel),
          formatDuration(item.minutes, settings),
          [item.minutes, "Number"],
          [hours(item.minutes), "Number"],
          item.cardUrl
        ]));
      });
      summary.push(row([
        group.memberName,
        "Subtotal",
        "",
        "",
        formatDuration(group.minutes, settings),
        [group.minutes, "Number"],
        [hours(group.minutes), "Number"],
        ""
      ]));
    });
    summary.push(row([
      "Total",
      "",
      "",
      "",
      formatDuration(report.totalMinutes, settings),
      [report.totalMinutes, "Number"],
      [hours(report.totalMinutes), "Number"],
      ""
    ]));

    const entries = [
      row(["Date", "Author", "Card", "List", "Labels", "Time", "Minutes", "Hours", "Note", "Link"])
    ];
    report.entries.forEach(function (entry) {
      entries.push(row([
        entry.ymd,
        entry.memberName,
        entry.cardName,
        entry.listName,
        labelList(entry.labels, report.labelText || fallbackLabel),
        formatDuration(entry.minutes, settings),
        [entry.minutes, "Number"],
        [hours(entry.minutes), "Number"],
        entry.note,
        entry.cardUrl
      ]));
    });

    const epics = [
      row(["Epic", "Labels", "Limit", "Limit, min", "Spent by children", "Spent, min", "Remaining", "Remaining, min", "Status", "Link"])
    ];
    report.epics.forEach(function (epic) {
      const known = epic.known && epic.spentMinutes != null;
      epics.push(row([
        epic.cardName,
        labelList(epic.labels, report.labelText || fallbackLabel),
        formatDuration(epic.limitMinutes, settings),
        [epic.limitMinutes, "Number"],
        known ? formatDuration(epic.spentMinutes, settings) : "",
        known ? [epic.spentMinutes, "Number"] : ["", "String"],
        known ? formatDuration(epic.remainingMinutes, settings) : "",
        known ? [epic.remainingMinutes, "Number"] : ["", "String"],
        !known ? "Links not loaded" : epic.remainingMinutes < 0 ? "Over limit" : "Within limit",
        epic.cardUrl
      ]));
    });

    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<?mso-application progid="Excel.Sheet"?>\n' +
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
      sheet("Report", summary) +
      sheet("Entries", entries) +
      sheet("Epics", epics) +
      "</Workbook>";
  }

  function fallbackLabel(label) {
    return (label && (label.name || label.color)) || "";
  }

  return { buildWorkbook: buildWorkbook, escapeXml: escapeXml };
});
