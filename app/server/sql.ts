/**
 * Shared SQL literal helper (RI-0021 R15). One definition for the whole
 * server; identifier interpolation is never allowed. Control characters
 * (incl. NUL) are rejected at the Zod boundary via hasControlChars before
 * values ever reach lit().
 */
export const lit = (value: unknown): string =>
  `'${String(value).replace(/'/g, "''")}'`;

export function hasControlChars(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export const safeText = (max: number) => (value: string) =>
  value.length <= max && !hasControlChars(value);
