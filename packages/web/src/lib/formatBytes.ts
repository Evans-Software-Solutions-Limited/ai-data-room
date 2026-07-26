// Tiny byte-size formatter for the document detail modal (T-016) —
// version rows and the header show `sizeBytes` as a human string
// (e.g. "1.2 MB"). No equivalent existed in `lib/` prior to this.

const UNITS = ["B", "KB", "MB", "GB"] as const;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  // Rounding to 1 dp can push `value` up to 1024 for sizes just under a
  // boundary (e.g. 1048575 B → 1023.999… KB → "1024.0"); promote to the
  // next unit when that happens and one exists, so it reads "1 MB", not
  // "1024 KB".
  let rounded = Number(value.toFixed(1));
  if (rounded >= 1024 && unitIndex < UNITS.length - 1) {
    rounded /= 1024;
    unitIndex += 1;
  }

  // Trim a trailing ".0" so exact multiples read as "512 KB", not
  // "512.0 KB", while inexact sizes keep one decimal ("1.2 MB").
  const text = rounded.toFixed(1).replace(/\.0$/, "");
  return `${text} ${UNITS[unitIndex]}`;
}
