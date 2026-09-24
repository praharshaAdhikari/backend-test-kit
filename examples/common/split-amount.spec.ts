import { splitAmount } from './split-amount.js';

// A unit test: a pure function, no database, no mocks. The cheapest test there is.

describe('splitAmount', () => {
  it('splits evenly when the amount divides exactly', () => {
    expect(splitAmount(900, 3)).toEqual([300, 300, 300]);
  });

  it('gives the leftover cents to the first shares, one each', () => {
    expect(splitAmount(100, 3)).toEqual([34, 33, 33]);
  });

  // Table test: the rule every split must keep, checked on awkward numbers.
  it.each([
    [1, 3],
    [101, 4],
    [999_999, 7],
    [0, 5]
  ])('the shares of %i cents in %i parts add up to the total', (total, parts) => {
    const shares = splitAmount(total, parts);

    expect(shares).toHaveLength(parts);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(total);
  });

  it.each([
    ['a negative amount', -1, 2],
    ['fractional cents', 10.5, 2],
    ['zero parts', 100, 0],
    ['fractional parts', 100, 1.5]
  ])('rejects %s', (_label, total, parts) => {
    expect(() => splitAmount(total, parts)).toThrow(RangeError);
  });
});
