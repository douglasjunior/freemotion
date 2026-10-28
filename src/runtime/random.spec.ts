import { random } from './random.js';


describe('random', () => {
  it('is deterministic for a seed', () => {
    expect(random('star-1')).toBe(random('star-1'));
    expect(random(42)).toBe(random('42'));
  });

  it('differs between seeds', () => {
    const values = new Set(Array.from({ length: 1000 }, (_, i) => random(i)));
    expect(values.size).toBe(1000);
  });

  it('stays within [0, 1) and spreads evenly', () => {
    const values = Array.from({ length: 10_000 }, (_, i) => random(`seed-${i}`));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean).toBeGreaterThan(0.48);
    expect(mean).toBeLessThan(0.52);
  });

  it('falls back to Math.random with null', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.123);
    expect(random(null)).toBe(0.123);
    spy.mockRestore();
  });
});
