/**
 * Splits an amount in cents into `parts` shares that add up to exactly the total. Leftover cents
 * go to the first shares, one each: 100 into 3 is [34, 33, 33], never [33.33, 33.33, 33.33].
 */
export function splitAmount(totalCents: number, parts: number): number[] {
  if (!Number.isInteger(totalCents) || totalCents < 0) {
    throw new RangeError('totalCents must be a whole number of cents, 0 or more');
  }
  if (!Number.isInteger(parts) || parts < 1) {
    throw new RangeError('parts must be a whole number, 1 or more');
  }
  const share = Math.floor(totalCents / parts);
  const leftover = totalCents - share * parts;
  return Array.from({ length: parts }, (_, i) => share + (i < leftover ? 1 : 0));
}
