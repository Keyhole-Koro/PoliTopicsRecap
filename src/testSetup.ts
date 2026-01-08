// Ensure reporter layout has sane terminal width to avoid RangeError from negative padding.
const minColumns = 60;
if (!process.stdout.columns || process.stdout.columns < minColumns) {
  (process.stdout as typeof process.stdout & { columns?: number }).columns = minColumns;
}
if (!process.stderr.columns || process.stderr.columns < minColumns) {
  (process.stderr as typeof process.stderr & { columns?: number }).columns = minColumns;
}
