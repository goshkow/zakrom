// CSV для Excel: точка с запятой, CRLF и BOM, чтобы кириллица открывалась без мастера импорта

// Excel выполняет ячейки, начинающиеся с =, +, -, @: такой текст экранируем апострофом.
// отрицательные числа («-12,5») оставляем как есть, иначе они станут текстом
export function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) && !/^-\d[\d\s.,]*$/.test(text) ? `'${text}` : text;
  return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(header, rows) {
  return [header, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n');
}
