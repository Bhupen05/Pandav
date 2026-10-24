// CSV for exports that open in a spreadsheet. A cell starting with = + - @
// (or a tab or carriage return) would run as a formula in Excel or Sheets,
// so it gets a leading apostrophe; cells with quotes, commas or line breaks
// are quoted.
const FORMULA_START = /^[=+\-@\t\r]/;

export const csvCell = (value) => {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const BOM = String.fromCharCode(0xfeff);

// `columns` is [{ header, value: (row) => any }]; returns the whole file,
// with a byte order mark so Excel reads it as UTF-8
export const toCsv = (rows, columns) => {
  const lines = [columns.map((column) => csvCell(column.header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(column.value(row))).join(','));
  }
  return `${BOM}${lines.join('\r\n')}\r\n`;
};

// Sends a CSV download
export const sendCsv = (res, filename, csv) => {
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`);
  res.send(csv);
};
